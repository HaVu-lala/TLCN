# GIẢI THÍCH CODE — AI Pentest Agent (Sentinel)

> Tài liệu này giúp hiểu nhanh **luồng hoạt động**, **vai trò từng file**, **ánh xạ 7 thực nghiệm**
> và **cách đọc code** để tự tin báo cáo. Tham chiếu theo *tên hàm/tên file* (không theo số dòng
> để không lạc hậu khi sửa code).

---

## 0. Tóm tắt 1 phút (nói với cô)

Sentinel là một **AI Pentest Agent** kiểm thử xâm nhập ứng dụng web theo **hộp đen**, trên các
mục tiêu **được cấp phép**. Ba ý cốt lõi cần nhớ:

1. **AI chỉ CHỌN và GỬI, không KẾT LUẬN.** Mô hình DeepSeek lập kế hoạch / điều phối gọi công cụ;
   còn việc *khẳng định một lỗ hổng là có thật* luôn do **oracle tất định trong code** quyết định
   dựa trên bằng chứng từ phản hồi thật của máy chủ. Nhờ vậy kết quả tái lập được và ít báo động giả.
2. **An toàn & hợp pháp.** Mọi yêu cầu đi ra đều qua **Scope Guard** (`app/scope.py`,
   `WebTools._guard_request`): chỉ localhost/loopback/IP nội bộ/host trong allowlist. Payload mặc
   định không phá dữ liệu (SQLi chỉ thử dấu nháy đơn; chế độ ghi dữ liệu `aggressive_scan` mặc định TẮT).
3. **Hai chế độ chạy chung một bộ oracle.** `deterministic` (pipeline tất định, dùng cho số liệu)
   và `function_calling` (AI gọi 5 công cụ) — cả hai đều kết luận bằng cùng code oracle/detector.

---

## 1. Bức tranh tổng thể

```
Người dùng
   │  POST /api/scans  (target_url, authorized, [login], [session_headers])
   ▼
app/main.py  create_scan()
   │  validate_target()  ← app/scope.py  (SCOPE GUARD: chặn ngoài phạm vi)
   ▼
app/agent.py  PentestAgent.run()
   │
   ├─(A) CHẾ ĐỘ TẤT ĐỊNH  _run_deterministic()
   │       Recon → Memory → Planning(AI) → Attack → Verify(ORACLE)
   │       → Lab oracle → Refine → Standing detectors → Dedup → Report
   │
   └─(B) CHẾ ĐỘ FUNCTION-CALLING  _run_function_calling()
           app/toolbox.py  ToolCallingAgent.run()  (vòng lặp ReAct, AI gọi 5 tool)
   ▼
ScanResult (app/schemas.py)  →  lưu SQLite (app/repository.py)
   ▼
Báo cáo: /api/scans/{id}/report.vi.html  ← app/report_vi.py  (tiếng Việt, cho luận văn)
Đánh giá: app/evaluation.py  (Precision/Recall/F1 khi có ground truth)
```

- **Kiến trúc đa tác tử (pipeline):** 5 vai trò tuần tự trong `app/agent.py`:
  `ReconAgent → PlanningAgent → AttackAgent → VerificationAgent → ReportingAgent`
  (thêm *SessionManager* ở khâu đăng nhập và *một vòng ReAct bổ sung* `AttackAgent.refine`).
- **Kiến trúc 5 công cụ (function-calling):** trong `app/toolbox.py`, mô hình chỉ phát lời gọi,
  Python thực thi: `reconnaissance → http_request → probe_and_verify → run_security_checks → generate_report`.

---

## 2. Luồng hoạt động đầu-cuối

### 2A. Chế độ TẤT ĐỊNH — `PentestAgent._run_deterministic()` (dễ giải thích nhất)

Đây là luồng nên trình bày với cô, vì tái lập được và là nguồn số liệu.

| Bước | Làm gì | Ở đâu (file → hàm) |
|---|---|---|
| B1. Thu thập (Recon) | Duyệt trang, bóc form/tham số/endpoint; render SPA bằng Chromium | `agent.py ReconAgent.run` → `tools.py WebTools.crawl` (+`_augment_with_browser`) |
| B2. Bộ nhớ dài hạn | Truy hồi tri thức các phiên trước của host | `memory.py LongTermMemory.recall` |
| B3. Lập kế hoạch (AI) | DeepSeek chọn các loại test; nếu không có key/lỗi → dùng cả 4 test | `agent.py PlanningAgent.run` → `reasoning.py ReasoningAgent.decide` |
| B4. Tấn công | Gửi payload (XSS/SQLi/IDOR) vào form & endpoint, kèm yêu cầu nền (baseline) | `agent.py AttackAgent.run` (`_request`, `_request_endpoint`) |
| B5. **Xác minh (ORACLE)** | **Kết luận lỗ hổng từ bằng chứng** — KHÔNG do AI | `agent.py VerificationAgent.run` |
| B6. Oracle theo lab | Oracle ghim sẵn cho Juice Shop/WebGoat | `labs.py check_lab` |
| B7. Vòng ReAct bổ sung | Thử payload mạnh hơn cho loại chưa xác nhận (1 vòng, có giới hạn) | `agent.py AttackAgent.refine` |
| B8. Bộ dò thường trực | Chạy toàn bộ registry detector (A01/A02/A03/A04/A07, Open Redirect, Path, XXE, CSRF) | `detectors.py run_all` → `scenarios/tn*.py` |
| B9. Gộp & báo cáo | Khử trùng lặp, tóm tắt, ghi bộ nhớ | `schemas.py dedupe_findings` + `agent.py ReportingAgent.run` + `memory.py remember` |

### 2B. Chế độ FUNCTION-CALLING — `PentestAgent._run_function_calling()`

Dùng để chứng minh "AI điều phối thật". Mô hình nhận `SYSTEM_PROMPT` (trong `toolbox.py`) rồi tự
phát các lời gọi công cụ trong **vòng lặp ReAct** (`ToolCallingAgent.run`, tối đa `MAX_STEPS = 20`):

| Tool | Chức năng | Hàm Python |
|---|---|---|
| 1. `reconnaissance` | Thu thập bề mặt | `toolbox.py ToolBox.reconnaissance` → `WebTools.crawl` |
| 2. `http_request` | Gửi 1 yêu cầu có kiểm soát | `ToolBox.http_request` → `WebTools.request` |
| 3. `probe_and_verify` | Tiêm payload + baseline rồi gọi oracle (SQLi/XSS/IDOR) | `ToolBox.probe_and_verify` → `VerificationAgent.run` |
| 4. `run_security_checks` | Chạy toàn bộ detector thường trực + oracle lab | `ToolBox.run_security_checks` → `run_all` + `check_lab` |
| 5. `generate_report` | Tổng hợp & dừng | `ToolBox.generate_report` |

> **Cơ chế chạy bù:** nếu mô hình dừng sớm / quên gọi `run_security_checks`, bộ điều phối tự chạy bù
> (cuối `ToolCallingAgent.run`) để độ phủ không kém chế độ tất định.

### 2C. Điểm mấu chốt: AI **không** quyết định lỗ hổng

Dù ở chế độ nào, phát hiện cuối cùng đều do **oracle/detector tất định** sinh ra:
`VerificationAgent.run` (họ tiêm nhiễm), `run_all` (các detector thường trực) và `check_lab` (oracle lab).
Mô hình chỉ giúp *chọn* test/điểm cần thử. Đây là câu trả lời quan trọng nhất khi cô hỏi về độ tin cậy.

---

## 3. Vai trò từng file trong `app/`

### Nhóm nền tảng (ít phụ thuộc, đọc trước)
| File | Vai trò |
|---|---|
| `config.py` | Mọi cấu hình (khóa DeepSeek, chế độ agent, giới hạn crawl, bật/tắt trình duyệt, `aggressive_scan`). Đọc từ `.env`. |
| `schemas.py` | "Hợp đồng dữ liệu": `ScanRequest` (đầu vào), `Finding` (một lỗ hổng), `ScanResult` (kết quả), `AgentTrace` (nhật ký), `dedupe_findings` (khử trùng). |
| `scope.py` | **Scope Guard**: `validate_target` chỉ cho quét mục tiêu hợp lệ. |
| `repository.py` | Lưu/đọc kết quả quét vào SQLite (`ScanRepository`). |
| `memory.py` | Bộ nhớ dài hạn qua SQLite (`LongTermMemory.recall/remember`). |
| `_playwright_compat.py` | Vá tương thích Playwright trên Windows khi chạy dưới uvicorn. |

### Nhóm thu thập & gọi LLM
| File | Vai trò |
|---|---|
| `tools.py` | **Trái tim lớp hành động**: `WebTools` — `crawl` (thu thập + render SPA), `request` (gửi có kiểm soát + ghi log), `_login` (đăng nhập Juice/WebGoat/WooCommerce), `_guard_request` (scope). Có nhật ký trực tiếp `LIVE_LOG` cho giao diện. |
| `reasoning.py` | Lớp suy luận bằng LLM: `ReasoningAgent.decide` (gọi DeepSeek, bắt JSON đúng schema, tự fallback). `public_url`/`page_context` lọc dữ liệu nhạy cảm trước khi gửi mô hình. |

### Nhóm điều phối
| File | Vai trò |
|---|---|
| `agent.py` | 5 tác tử pipeline + `PentestAgent` (chọn chế độ). **`VerificationAgent.run` là oracle tiêm nhiễm chính.** |
| `toolbox.py` | 5 công cụ function-calling + `ToolCallingAgent` (vòng ReAct) + `SYSTEM_PROMPT`. |
| `main.py` | Ứng dụng FastAPI: API quét, các trang báo cáo, và fixture lab nội bộ `/demo` + `/demo-safe`. |

### Nhóm detector thường trực (registry)
| File | Vai trò |
|---|---|
| `detectors.py` | Hạ tầng registry: `@register`, `run_all`, `DetectorContext`. Import `scenarios` để nạp detector. |
| `scenarios/tn*.py` | **Mỗi file = một kịch bản**, chỉ `@register` một hàm mỏng gọi tới oracle thật. (Xem bảng ánh xạ ở Mục 4.) |

### Nhóm oracle chi tiết (logic phát hiện thật)
| File | Phát hiện | Hàm chính |
|---|---|---|
| `labs.py` | Oracle ghim theo lab (Juice Shop/WebGoat): SQLi, XSS, BOLA, Path, XXE, A02, A07 | `check_lab`, `_juice_shop_*`, `_webgoat_*`, `lab_*_checks` |
| `passive.py` | A02 (thiếu header, lộ stack trace), A03 (lộ phiên bản), A04 (cookie/HSTS) — chỉ đọc phản hồi | `passive_findings`, `_a02/_a03/_a04` |
| `access_control.py` | A01 forced-browsing endpoint quản trị | `check_access_control` |
| `auth_checks.py` | A07 (credential mặc định + loạt đăng nhập sai → kiểm khóa) | `check_authentication`, `_run_auth_checks` |
| `browser_xss.py` | Reflected XSS xác nhận bằng Chromium thực thi | `browser_reflected_xss` |
| `stored_xss.py` | Stored XSS hộp đen (gieo-dấu-rồi-xem-lại) — chỉ khi `aggressive_scan` | `stored_xss_blackbox` |
| `open_redirect.py` | Open Redirect (soi header Location 3xx) | `check_open_redirect` |
| `path_traversal.py` | Path Traversal (oracle chữ ký `/etc/passwd`) | `check_path_traversal` |
| `xxe.py` | XXE (external entity → lộ `/etc/passwd`) | `check_xxe` |
| `csrf.py` | CSRF (heuristic nghi ngờ, độ tin thấp) | `check_csrf` |

### Nhóm báo cáo & đánh giá
| File | Vai trò |
|---|---|
| `report_vi.py` | **Báo cáo tiếng Việt** (bảng + giải thích đời thường + ánh xạ OWASP) — bản dùng trong luận văn. `render_vietnamese_report`, `render_history_vi`. |
| `evaluation.py` | Chấm điểm Precision/Recall/F1/FPR khi có ground truth (`evaluate_demo/lab/extended`). |
| `static/` | Giao diện web (index.html, app.js, styles.css) — dashboard + nhật ký quét trực tiếp. |

---

## 4. Ánh xạ 7 thực nghiệm (báo cáo) → file code

> **LƯU Ý QUAN TRỌNG (hay gây nhầm):** số **Thực nghiệm trong luận văn (TN1–TN7)** KHÁC số trong
> **tên file scenario (tn1–tn11)**. Tên file đi theo thứ tự nhóm OWASP, còn báo cáo gộp lại còn 7.

| Thực nghiệm (báo cáo) | Nhóm OWASP | File scenario | Oracle/detector thật |
|---|---|---|---|
| **TN1** SQL Injection | A05 Injection | `scenarios/tn1_sql_injection.py` | `agent.py VerificationAgent.run` (nhánh `basic_sqli`) + `labs.py check_lab` |
| **TN2** XSS (phản chiếu/lưu/DOM) | A05 Injection | `scenarios/tn2_xss.py` | `browser_xss.py`, `stored_xss.py`, `labs.py`, `VerificationAgent.run` |
| **TN3** Broken Access Control / BOLA | A01 | `scenarios/tn3_access_control.py` | `access_control.py check_access_control` + `VerificationAgent.run` (IDOR 2 phiên) + `labs.py` |
| **TN4** Kiểm toán thụ động (A02+A03+A04) | A02/A03/A04 | `scenarios/tn4_passive_audit.py` | `passive.py passive_findings` + `labs.py lab_misconfig_checks` |
| **TN5** Authentication Failures | A07 | `scenarios/tn7_auth.py` ⚠️ (file tên *tn7*) | `auth_checks.py check_authentication` + `labs.py lab_auth_failure_checks` |
| **TN6** Path Traversal | A01 | `scenarios/tn10_path_traversal.py` ⚠️ (file tên *tn10*) | `path_traversal.py check_path_traversal` + `labs.py` |
| **TN7** XXE | A05 | `scenarios/tn11_xxe.py` ⚠️ (file tên *tn11*) | `xxe.py check_xxe` + `labs.py` |

> Hai file `scenarios/tn8_open_redirect.py` và `scenarios/tn9_csrf.py` là **detector bổ sung**
> (Open Redirect, CSRF), KHÔNG nằm trong 7 thực nghiệm chính của luận văn.
>
> Nếu muốn, có thể đổi nhãn comment `[TN7]/[TN10]/[TN11]` trong code cho khớp số báo cáo (TN5/TN6/TN7)
> — nói tôi biết, tôi sẽ sửa đồng loạt (chỉ là comment, không đổi logic).

---

## 5. Cách đọc code để hiểu nhanh

**Nếu chỉ có 15 phút, đọc theo thứ tự này:**

1. `app/main.py` → hàm `create_scan` — *điểm vào*, thấy ngay luồng tổng.
2. `app/agent.py` → `PentestAgent.run` rồi `_run_deterministic` — *xương sống* của toàn hệ thống,
   có cả "bản đồ 9 bước" ghi trong docstring.
3. `app/agent.py` → `VerificationAgent.run` — *oracle* kết luận lỗ hổng (chỗ quan trọng nhất).
4. `app/tools.py` → `WebTools.crawl` và `request` — cách thu thập và gửi yêu cầu.
5. `app/toolbox.py` → `ToolCallingAgent.run` — nếu cần hiểu chế độ AI gọi tool.

**Mẹo:** mỗi hàm đều có **docstring tiếng Việt** nói rõ *làm gì*; đọc docstring trước, đọc thân hàm sau.
Các file trong `scenarios/` rất ngắn (chỉ "đăng ký" detector), nên đọc để thấy *bức tranh*, còn
*logic thật* nằm ở các file oracle (Mục 3).

---

## 6. Hỏi–đáp mẫu (những câu cô hay hỏi)

**Q: Có phải AI tự phán đoán ra lỗ hổng không? Có đáng tin không?**
→ Không. AI chỉ *chọn* và *gọi* công cụ. Mọi kết luận do **oracle tất định** trong code quyết định
dựa trên bằng chứng thật (chữ ký lỗi CSDL, marker thực thi trong trình duyệt, chênh lệch số bản ghi…).
Vì tất định nên **chạy lại cho cùng kết quả** và **ít báo động giả**.

**Q: Không có mạng hoặc hết khóa DeepSeek thì sao?**
→ Hệ thống tự **fallback** sang pipeline tất định (kế hoạch dự phòng gồm cả 4 test), quét vẫn chạy
bình thường — chỉ không có bước "AI chọn test". (Xem `PlanningAgent.run` và `PentestAgent.run`.)

**Q: Làm sao không phá dữ liệu / không vượt phạm vi?**
→ **Scope Guard** chặn mọi yêu cầu ra ngoài origin mục tiêu (`scope.py`, `WebTools._guard_request`);
payload mặc định không phá dữ liệu (SQLi chỉ dùng dấu nháy đơn `'`); chế độ ghi dữ liệu để bắt
Stored XSS hộp đen (`aggressive_scan`) **mặc định TẮT**.

**Q: Số liệu trong báo cáo lấy từ chế độ nào?**
→ Từ **pipeline tất định** (ổn định, 0 token LLM). Đánh giá có đáp án ghim: Juice Shop TP 4/4,
WebGoat TP 5/5 (Recall trong phạm vi kịch bản ghim). Chi tiết ở Mục 3.4 của luận văn.

**Q: Hai chế độ khác nhau chỗ nào?**
→ `deterministic`: chạy cố định theo 9 bước, dễ tái lập, dùng đo số liệu. `function_calling`: AI tự
chọn thứ tự gọi 5 công cụ (chứng minh điều phối bằng AI), nhưng **chung một bộ oracle** nên bằng chứng
như nhau; đổi lại tốn token và chậm hơn.

**Q: DeepSeek dùng để làm gì cụ thể?**
→ Hai việc: (1) *lập kế hoạch* chọn test ở pipeline (`reasoning.py decide`); (2) *điều phối gọi công cụ*
ở chế độ function-calling (`toolbox.py`). Nó **không** tự phát hiện lỗ hổng.

**Q: Chống báo động giả bằng cách nào?**
→ Mỗi phát hiện phải qua oracle bằng chứng; trường hợp bằng chứng yếu chỉ gắn nhãn *"nghi ngờ"*
(Potential SQL Injection, Potential CSRF…) chứ không khẳng định. Trên tập ca âm fixture nội bộ, hệ
thống không sinh phát hiện sai (FPR = 0 trong phạm vi đó).

---

*Tài liệu đi kèm mã nguồn `app/` (đã viết lại sạch, chú thích tiếng Việt từng hàm). Mọi tham chiếu
dùng tên hàm/tên file để không lạc hậu khi code thay đổi.*
