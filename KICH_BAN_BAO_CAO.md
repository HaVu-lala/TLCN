# KỊCH BẢN BÁO CÁO — nói trước cô

> **Cách dùng:** đọc để thuộc ý, khi bảo vệ nói tự nhiên. Dòng bắt đầu bằng **EM NÓI:** là câu có thể nói gần như nguyên văn. Mở sẵn các file code để khi cô bảo "xem code" thì chỉ việc nhảy tới (gõ tìm `[TN` trong editor).

---

## PHẦN 1 — Giới thiệu (≈1 phút)

**EM NÓI:** "Em xin trình bày tiểu luận: xây dựng hệ thống kiểm thử xâm nhập ứng dụng web có dùng AI Agent, tên là **Sentinel**. Hệ thống tự động dò lỗ hổng của một trang web, rồi tự viết báo cáo. Điểm đặc biệt là **AI chỉ lo phần suy nghĩ và lên kế hoạch, còn việc kết luận có lỗ hổng hay không thì do một bộ quy tắc chặt chẽ quyết định dựa trên bằng chứng** — nên rất ít báo nhầm. Em sẽ demo trực tiếp và có đối chứng với công cụ OWASP ZAP."

---

## PHẦN 2 — Hệ thống chạy thế nào (≈2 phút, nói đơn giản)

**EM NÓI:** "Đây là kiểm thử **hộp đen**: hệ thống chỉ gửi yêu cầu HTTP tới trang web như một người tấn công bên ngoài, **không đọc mã nguồn của mục tiêu**.

Mỗi lần quét đi qua **5 bước**:
1. **Trinh sát** — dò ra các trang, các ô nhập, các đường dẫn.
2. **Lập kế hoạch** — AI (mô hình DeepSeek) chọn nên thử những kịch bản tấn công nào.
3. **Tấn công** — gửi payload thử (ví dụ một dấu nháy để thử SQL).
4. **Xác minh** — đây là bước quan trọng nhất: một **oracle** (bộ quy tắc) xem bằng chứng trong phản hồi để **kết luận**. Không có bằng chứng thì không ghi nhận.
5. **Báo cáo** — tổng hợp và xuất báo cáo tiếng Việt.

Em nhấn mạnh lại: **AI không tự phán có lỗ hổng. AI chỉ chọn thử cái gì; oracle mới là người kết luận.** Nhờ vậy nếu AI chọn sai thì cũng không báo lỗ hổng bừa."

(Nếu cô hỏi: "Toàn bộ mạch chạy nằm ở `app/agent.py`, bắt đầu từ `app/main.py` khi bấm quét. Hệ thống có đúng 5 công cụ và có bộ chặn phạm vi Scope Guard chỉ cho quét lab được phép.")

---

## PHẦN 2B — MẠCH CHẠY MỘT LẦN QUÉT TỪ ĐẦU TỚI CUỐI (bản đồ file)

> **Dùng khi cô hỏi:** "Chạy một lần quét thì nó đi qua những file nào?", "Thu thập endpoint ở đâu?", "Kịch bản từ đầu đến cuối ra sao?". Nói theo thứ tự dưới đây, chỉ tay vào từng file.

**EM NÓI:** "Em xin kể lại một lần quét đi từ lúc em bấm Start cho tới khi ra báo cáo, qua 9 bước:

**Khởi động.** Em bấm Start trên giao diện → `app/main.py` hàm `create_scan()` **dòng 237** nhận yêu cầu. Trước tiên nó gọi **Scope Guard**: `validate_target(...)` ở **main.py dòng 239** → `app/scope.py` hàm `validate_target` **dòng 11**, chỉ chấp nhận host nằm trong `settings.allowed_hosts` (**scope.py dòng 18**), host lạ thì ném `ScopeError` (**scope.py dòng 28**) — nên không thể quét bừa site ngoài. Qua được mới tạo `PentestAgent` (**main.py dòng 246**) và gọi `agent.run()` (**main.py dòng 247**) → vào `PentestAgent.run()` ở **`app/agent.py` dòng 273**.

Tại đây hệ thống chọn **một trong hai chế độ** (điều kiện ở `_function_calling_enabled`, **agent.py dòng 269–271**):
- Có key DeepSeek và chế độ `auto`/`function_calling` → chạy **function-calling** (`_run_function_calling`, **agent.py dòng 281**), AI tự gọi công cụ qua `app/toolbox.py`.
- Không → chạy **pipeline cố định** (`_run_deterministic`, **agent.py dòng 305**). Em giải thích theo pipeline cho dễ hình dung; function-calling đi qua **cùng các bước verify/detector** bên dưới, chỉ khác ở chỗ AI điều phối.

**Bước 1 — Trinh sát & THU THẬP ENDPOINT.** `pages = self.recon.run()` ở **agent.py dòng 334** → `ReconAgent.run()` (**agent.py dòng 60**) gọi `WebTools.crawl()` ở **`app/tools.py` dòng 190**. Đây chính là chỗ **thu thập endpoint**: duyệt trang, gom các form (ô nhập), đường dẫn, và tham số GET phản chiếu, đưa vào danh sách `endpoints` của mỗi trang (**tools.py dòng 254–290**). Với trang có JavaScript/modal (Bookstore, Juice Shop), còn mở trình duyệt thật bắt endpoint ẩn gọi qua API — `_augment_with_browser` (**tools.py dòng 327**), hợp nhất endpoint ở **tools.py dòng 475**. Đếm số endpoint ở **agent.py dòng 335**, log 'Discovered N page(s) and M endpoint(s)' ở **agent.py dòng 336**.

**Bước 2 — Nhớ phiên trước.** `self.memory.recall(...)` ở **agent.py dòng 337** → `LongTermMemory.recall()` **`app/memory.py` dòng 81** (đọc SQLite `data/sentinel.sqlite3`), lấy lại phát hiện/bề mặt các lần quét cũ cùng host để không làm lại từ đầu.

**Bước 3 — Lập kế hoạch (AI).** `plan = self.planner.run(pages, memory=recalled)` ở **agent.py dòng 339** → `PlanningAgent.run()` (**agent.py dòng 71**) đưa danh sách trang/endpoint cho **DeepSeek** để AI chọn các kịch bản tấn công. Nếu không gọi được AI thì có nhánh dự phòng (`fallback`).

**Bước 4→7 — Vòng lặp tấn công–xác minh theo từng kịch bản.** Vòng `for kind in plan` ở **agent.py dòng 351**:
- **B4 Tấn công:** `self.attack.run(pages, [kind])` **dòng 353** → `AttackAgent.run()` (**agent.py dòng 92**) gửi payload vào form/endpoint đã thu (bản đồ loại tấn công ở comment **agent.py dòng 313–316**).
- **B5 Xác minh (ORACLE):** `self.verifier.run(probes)` **dòng 355** → `VerificationAgent.run()` (**agent.py dòng 196**) xem bằng chứng để kết luận; không bằng chứng thì không ghi nhận.
- **B6 Oracle chuyên biệt lab:** `check_lab(...)` **dòng 356** → **`app/labs.py` dòng 14** (ghim riêng Juice Shop/WebGoat).
- **B7 ReAct tinh chỉnh:** `self.attack.refine(...)` **dòng 357** rồi xác minh lại ở **dòng 359**.

**Bước 8 — Bộ detector tổng quát (Bookstore và mọi môi trường).** Dựng `DetectorContext` ở **agent.py dòng 368**, gọi `run_all(ctx)` ở **dòng 369** → `app/detectors.py` hàm `run_all` **dòng 46**, chạy lần lượt mọi detector trong `STANDING_DETECTORS` (**detectors.py dòng 49**). Mỗi detector = **một hàm có `@register(...)` trong một file `app/scenarios/tnX_*.py`** (ví dụ `tn4_passive_audit.py` dòng 23–24, `tn1_sql_injection.py` dòng 55–56); các file này gọi detector thật (`app/browser_xss.py`, `app/access_control.py`, `app/passive.py`...). Việc import để đăng ký nằm ở **detectors.py dòng 59**.

**Bước 9 — Gộp trùng & báo cáo.** `dedupe_findings(findings)` ở **agent.py dòng 374** gộp phát hiện trùng; `ReportingAgent.run()` ở **agent.py dòng 375** (**định nghĩa dòng 243**) sinh tóm tắt + khuyến nghị; lưu lại phiên bằng `self.memory.remember(...)` **dòng 377**; trả kết quả **dòng 378**. Khi em mở trang báo cáo tiếng Việt (endpoint `vietnamese_report` **main.py dòng 118**) thì HTML được dựng bởi `render_vietnamese_report()` ở **`app/report_vi.py` dòng 94**.

Tóm một câu: **Start → `create_scan` (`main.py:237`) → Scope Guard (`scope.py:11`) → `agent.run` (`agent.py:273`) → gom endpoint (`tools.py:190`, gọi ở `agent.py:334`) → nhớ phiên (`memory.py:81`) → AI lập kế hoạch (`agent.py:339`) → vòng tấn công/xác minh (`agent.py:351–361`) → detector theo kịch bản (`detectors.py:46` + `scenarios/`) → gộp + báo cáo (`agent.py:374–378`, `report_vi.py:94`).** Toàn bộ mạch điều phối nằm trong `app/agent.py`, và ngay trong file đó có sẵn **bản đồ từng bước ở comment dòng 306–332** để tra nhanh."

---

## PHẦN 3 — Demo trực tiếp (vừa bấm vừa nói)

**EM NÓI (mở http://localhost:8000):** "Em quét thật luôn ạ. Em nhập địa chỉ ứng dụng lab, bấm Start. 
- Bên trái là **các bước agent đang chạy**; bên phải là **nhật ký từng yêu cầu gửi đi theo thời gian thực**. 
- Quét xong, đây là **danh sách lỗ hổng**: mỗi cái có mức độ, loại OWASP, **bằng chứng**, và cách khắc phục. 
- Em mở **báo cáo tiếng Việt** — in ra PDF được. Tất cả do hệ thống tự làm, em không gõ tay gì thêm."

---

## PHẦN 4 — Khi cô bảo "mở code kịch bản X ra xem" (nói đủ CẢ 3 MÔI TRƯỜNG)

> **Quy tắc quan trọng:** cùng một lỗ hổng nhưng **Juice Shop và WebGoat** dùng oracle ghim theo lab trong **`app/labs.py`**, còn **Bookstore (tự xây)** dùng **bộ detector tổng quát** (các file `app/*.py` riêng). Nên code mỗi môi trường ở **chỗ khác nhau** — phải nói rõ cả 3.

### SQL Injection
**EM NÓI:** "SQL Injection là chèn ký tự phá câu truy vấn CSDL. Trên cả 3 môi trường đều phát hiện được, nhưng cơ chế hơi khác:
- **Juice Shop** (`/rest/products/search`): code ở **`app/labs.py`** nhãn `[TN1]` **dòng 57**. Gửi dấu nháy đơn (**dòng 63**), rồi cặp đúng/sai `OR 1=1--` và `OR 1=2--` (**dòng 70–71**); nếu số sản phẩm khác nhau thì kết luận (**dòng 80**).
- **WebGoat** (`/SqlInjection/attack8`): cũng ở **`app/labs.py`** **dòng 84**; payload boolean làm bài học 'hoàn thành' và trả bảng nhân viên thì kết luận (**dòng 94**).
- **Bookstore** (`/api/login`): đây là app tự xây nên đi **đường tổng quát** — oracle ở **`app/agent.py`** `VerificationAgent` **dòng 216**; khi dấu nháy làm máy chủ **lỗi 500** còn input thường trả **401** thì kết luận 'nghi ngờ SQLi' mức Trung bình (**dòng 227**)."

### XSS
**EM NÓI:** "XSS là chèn mã chạy trong trình duyệt. Ba môi trường là ba ngữ cảnh khác nhau:
- **Juice Shop**: DOM XSS ở trang tìm kiếm — **`app/labs.py`** nhãn `[TN2]` **dòng 23**, dùng Chromium kiểm tra mã có chạy thật không.
- **WebGoat**: Stored XSS (đăng bình luận) — **`app/labs.py`** **dòng 98**, đăng payload rồi đọc lại ở request khác.
- **Bookstore**: Reflected XSS ở `/search` và `/ebook` — **`app/browser_xss.py`** nhãn `[TN2]` **dòng 41**, oracle bắt alert thực thi ở **dòng 61**."

### Broken Access Control (vượt quyền)
**EM NÓI:** "Lỗi truy cập dữ liệu/chức năng không đúng quyền:
- **Juice Shop**: BOLA — đọc giỏ hàng của người khác qua id. Code **`app/labs.py`** nhãn `[TN3]` **dòng 169**.
- **WebGoat**: IDOR — đọc hồ sơ người khác. Code **`app/labs.py`** **dòng 122**.
- **Bookstore**: BFLA — gọi thẳng `/api/admin/dashboard` mà **không đăng nhập vẫn trả dữ liệu quản trị**. Code **`app/access_control.py`** nhãn `[TN3]` **dòng 29**, danh sách endpoint admin **dòng 16–18**, kết luận **dòng 65**."

### Kiểm tra thụ động (header / cookie / lộ phiên bản — A02/A03/A04)
**EM NÓI:** "Nhóm này **không tấn công**, chỉ đọc phản hồi, nên áp dụng cho **cả 3 môi trường** như nhau — code **`app/passive.py`** nhãn `[TN4]` **dòng 159**: thiếu header bảo mật (**dòng 132**), lộ phiên bản (**dòng 141**), cookie thiếu cờ an toàn / thiếu HSTS (**dòng 150**). Thêm phần lộ cấu hình riêng theo lab: **Juice Shop** lộ thư mục `/ftp` (**`app/labs.py` dòng 415**), **WebGoat** lộ `/actuator/env` (**`app/labs.py` dòng 384**)."

### Authentication Failures (đăng nhập sai nhiều lần không thấy cơ chế khóa)
**EM NÓI:** "Cả 3 môi trường đều thử **10 lần đăng nhập sai liên tiếp**:
- **Juice Shop** (`/rest/user/login`): **`app/labs.py`** nhãn `[TN7]` **dòng 396**.
- **WebGoat** (`/WebGoat/login`): **`app/labs.py`** **dòng 364**, 10 lần đều quay về `/login?error`.
- **Bookstore** (`/api/login`): đi đường tổng quát — **`app/auth_checks.py`** nhãn `[TN7]` **dòng 118**; số 10 đặt ở **dòng 43** (`MAX_LOCKOUT_ATTEMPTS = 9` + 1 lần nền = **tổng cộng đúng 10 lần**, không phải 11), vòng lặp **dòng 171**. Cả 10 lần không quan sát thấy cơ chế khóa thì kết luận."
>
> **Nói thêm nếu cô hỏi kỹ:** đây là **dấu hiệu heuristic** — mỗi lần thử dùng định danh khác nhau và chưa thử lại bằng mật khẩu đúng trên cùng tài khoản hợp lệ, nên hệ thống chỉ kết luận *chưa thấy cơ chế giới hạn trong lượt thử*, không khẳng định chắc chắn thiếu khóa theo từng tài khoản (theo OWASP WSTG-ATHN-03). Đã ghi rõ trong luận văn.

### Path Traversal (duyệt thư mục)
**EM NÓI:** "Đọc được tệp ngoài thư mục cho phép:
- **Juice Shop**: `/ftp` vượt bộ lọc bằng null-byte — **`app/labs.py`** nhãn `[TN10]` **dòng 257**.
- **WebGoat**: đặt tên tệp chứa `../` — **`app/labs.py`** **dòng 290**.
- **Bookstore** (`/ebook?file=`): đường tổng quát — **`app/path_traversal.py`** nhãn `[TN10]` **dòng 68**; payload `../` **dòng 21–22**; chỉ kết luận khi lộ đúng chữ ký `/etc/passwd` (`root:...:0:0:`, **dòng 19**)."

### XXE (thực thể ngoài trong XML)
**EM NÓI:** "Bộ đọc XML nạp cả tệp hệ thống:
- **Juice Shop**: `/file-upload` nạp XML có thực thể ngoài — **`app/labs.py`** nhãn `[TN11]` **dòng 273**.
- **WebGoat**: `/xxe/simple` — **`app/labs.py`** **dòng 309**.
- **Bookstore** (`/import`): đường tổng quát — **`app/xxe.py`** nhãn `[TN11]` **dòng 38**; payload khai báo thực thể trỏ `/etc/passwd` **dòng 17–18**; lộ nội dung tệp thì kết luận **dòng 48**."

### Open Redirect & CSRF (bổ sung, chủ yếu 1–2 môi trường)
**EM NÓI:** "Hai nhóm bổ sung ngoài OWASP lõi:
- **Open Redirect**: rõ nhất trên **Juice Shop** — **`app/labs.py`** nhãn `[TN8]` **dòng 229**; bộ tổng quát **`app/open_redirect.py`** **dòng 66** áp cho mọi môi trường (nhét tên miền mồi, soi header `Location` **dòng 83–84**).
- **CSRF**: thấy rõ trên **Bookstore** (`/api/login`) — **`app/csrf.py`** nhãn `[TN9]` **dòng 20**; form POST thiếu token chống CSRF thì đánh dấu 'nghi ngờ' mức thấp. Em để mức nhẹ để tránh thổi phồng."

> **Mẹo nói gọn:** "File mô tả kịch bản luôn là `app/scenarios/tnX.py`. Code chạy thật thì **Juice Shop/WebGoat ở `app/labs.py`** (hàm `_juice_shop_*` / `_webgoat_*`), còn **Bookstore ở các detector tổng quát** — chỗ nào cũng có nhãn `[TNX]` để tìm nhanh."

---

## PHẦN 5 — Điểm mạnh & Hạn chế (nói trung thực)

**Mạnh — EM NÓI:** 
"Thứ nhất, **ít báo nhầm** vì mỗi lỗ hổng đều có bằng chứng cụ thể. 
Thứ hai, em **đối chứng với OWASP ZAP**: trên Bookstore, ZAP và hệ thống của em trùng nhau ở SQLi, XSS, Path Traversal; còn XXE và lỗi vượt quyền quản trị thì **ZAP chưa ghi nhận trong lượt quét** (quét chủ động của ZAP chưa hoàn tất ổn định nên em không kết luận ZAP bỏ sót), trong khi oracle chuyên biệt của hệ thống em xác nhận được, lại ít cảnh báo nhiễu hơn. Em còn dùng Burp để **kiểm chứng lại bằng tay** từng lỗ hổng. 
Thứ ba, **báo cáo tiếng Việt dễ đọc**."

**Yếu — EM NÓI (chủ động nêu):** 
"Em cũng xin nêu thẳng hạn chế: 
- Chế độ để AI tự gọi công cụ (function-calling) **chạy không ổn định bằng** chế độ cố định (pipeline) và tốn token hơn; nên **phần đánh giá định lượng** (độ chính xác, FPR, TP 4/4 & 5/5 — mục 3.4) em lấy từ chế độ cố định. Riêng **bảng tổng hợp phát hiện theo từng môi trường** (mục 3.3.8: Juice 9/11, WebGoat 9, Bookstore 12) là bản ghi chế độ function-calling có DeepSeek. Hai chế độ dùng **chung bộ oracle kết luận** nên bằng chứng mỗi phát hiện là như nhau. 
- Em **chưa so sánh định lượng chung mẫu số** với ZAP/Burp — mới là so sánh về **năng lực phát hiện**. 
- Vài lỗ hổng **nằm sau nhiều bước nghiệp vụ** (như Stored XSS phải mua hàng rồi mới đánh giá) thì quét tự động hộp đen chưa với tới, cần làm tay bổ sung. 
- Chỉ số 'không báo nhầm' đo trên **bộ dữ liệu có đáp án**, chưa phải trên web lớn."

---

## PHẦN 6 — Câu hỏi hay bị hỏi (trả lời nhanh)

- **"AI có tự tìm ra lỗ hổng không?"** → "Không ạ. AI chỉ chọn kịch bản để thử. Kết luận là do oracle dựa trên bằng chứng. Em tách rõ hai vai để tránh báo nhầm."
- **"Sao SQLi trên Bookstore chỉ mức Trung bình?"** → "Vì mới thấy dấu nháy làm máy chủ lỗi 500 (bình thường là 401), nhưng chưa lộ thông báo lỗi SQL rõ ràng, nên em để mức *nghi ngờ* cho trung thực."
- **"Hơn ZAP chỗ nào?"** → "Trùng ở nhóm tiêm nhiễm; XXE và vượt quyền quản trị thì ZAP chưa ghi nhận trong lượt quét (quét chủ động chưa hoàn tất ổn định, nên em không kết luận ZAP bỏ sót), còn hệ thống em xác nhận được và ít nhiễu hơn. Nhưng em không nói hơn tuyệt đối."
- **"Bằng chứng ở đâu ra?"** → "Em chạy `demo\demo_bangchung_sqli.py` cho cô xem dữ liệu thật từng bước, hoặc dán URL vào trình duyệt xem phản hồi."
- **"Pipeline cũng ra như vậy thì sao phải dùng function-calling?"** → "Function-calling mới là phần AI Agent đúng đề tài: AI tự chọn công cụ, mục tiêu, payload theo ReAct; còn pipeline là chuỗi bước cố định sẵn. Hai chế độ trùng kết quả trên lab quen là điều tốt — nó chứng minh AI tự điều phối vẫn ra đúng nhờ chung bộ oracle, không phải lý do bỏ AI. Pipeline em giữ làm chuẩn đo ổn định và dự phòng khi không có key. Em nói thẳng là function-calling không giỏi hơn về số liệu, còn tốn token và kém ổn định hơn; giá trị của nó là tính tự chủ và khả năng thích ứng với mục tiêu mới."

---

> **Lưu ý về số dòng:** các số dòng ở Phần 4 đúng với bản code hiện tại. Nếu sửa code làm lệch dòng, mở file **gõ tìm `[TN`** là tới đúng chỗ.
