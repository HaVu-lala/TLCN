# Sentinel — Hệ thống kiểm thử xâm nhập ứng dụng web dùng AI Agent

## 1. Dự án này làm gì

Sentinel là đồ án tiểu luận chuyên ngành: một **AI Pentest Agent** mô phỏng chuyên gia kiểm thử xâm nhập (pentester) cho ứng dụng web. Theo vòng lặp **ReAct** và pipeline đa tác tử (Recon → Planning → Attack → Verification → Reporting), hệ thống tự động:

1. **Thu thập thông tin (Recon):** crawl các trang cùng host, bóc tách form/input/endpoint; render được cả input sinh bởi JavaScript (SPA) nhờ Playwright/Chromium.
2. **Lập kế hoạch (Planning):** dùng mô hình DeepSeek để suy luận, hoặc kế hoạch dự phòng khi không có API key.
3. **Tấn công có kiểm soát (Attack):** chèn payload không phá hoại kèm yêu cầu nền (baseline) để so sánh.
4. **Xác minh (Verification):** chỉ ghi nhận lỗ hổng khi có **bằng chứng thực tế** từ phản hồi máy chủ (**oracle tất định**), không dựa trên phán đoán của mô hình → tỷ lệ báo động giả rất thấp.
5. **Báo cáo (Reporting):** xuất báo cáo JSON, HTML, Markdown và **HTML tiếng Việt** kèm PoC và khuyến nghị.

Toàn bộ chỉ chạy trong môi trường lab **được cấp phép** (localhost/loopback/IP nội bộ/host lab cấu hình sẵn), được kiểm soát bởi **Scope Guard**.

## 2. Hai chế độ vận hành (`AGENT_MODE`)

- **`function_calling` — AI chỉ gọi tool:** khi có `DEEPSEEK_API_KEY`, LLM tự chủ chọn và gọi từng tool qua function-calling theo vòng lặp ReAct. LLM **không** trực tiếp gửi gói tin; mọi hành động mạng do mã Python thực thi dưới Scope Guard; việc kết luận lỗ hổng do oracle tất định quyết định.
- **`deterministic` — pipeline tất định (dự phòng):** chạy pipeline đa tác tử cố định, kết quả **tái lập được**, nhanh, không tốn token.
- **`auto` (mặc định):** có key thì function-calling, không thì deterministic; function-calling lỗi sẽ tự lùi về deterministic.

> Số liệu trích dẫn trong luận văn nên lấy từ chế độ **deterministic** cho ổn định; function-calling dùng để minh hoạ tính tự chủ của AI.

## 3. Các kịch bản & lỗ hổng phát hiện được

Mỗi kịch bản là một detector đăng ký vào registry (`app/scenarios/tn*.py`) hoặc một oracle ghim theo lab (`app/labs.py`). Thêm kịch bản mới = thêm một hàm `@register`, không phải sửa khung.

| Kịch bản | OWASP 2025 | Cách xác minh (oracle) |
| --- | --- | --- |
| SQL Injection | A05 Injection | Sai biệt số bản ghi true/false, hoặc chữ ký lỗi SQL |
| Reflected / Stored XSS | A05 Injection | Thực thi marker trong Chromium / đọc lại payload lưu trữ |
| XXE | A05 Injection | Nội dung `/etc/passwd` lọt vào phản hồi khi khai báo thực thể ngoài |
| Broken Access Control (BOLA/IDOR) | A01 | Đọc được đối tượng của người khác không bị từ chối |
| Path Traversal | A01 | Vượt bộ lọc đọc tệp ngoài phạm vi (chữ ký `root:...:0:0:`) |
| Security Misconfiguration | A02 | Thiếu security header; lộ `/ftp`, Spring Actuator `/actuator/env` |
| Software Supply Chain | A03 | Lộ phiên bản thành phần qua header |
| Cryptographic Failures | A04 | Cookie thiếu Secure/HttpOnly/SameSite; thiếu HSTS |
| Authentication Failures | A07 | Không khóa/giới hạn sau nhiều lần đăng nhập sai |
| Open Redirect | bổ sung | Location trỏ ra domain ngoài khi vượt allowlist |
| CSRF (heuristic) | bổ sung | Form đổi trạng thái thiếu token chống CSRF |

## 4. Ba môi trường thực nghiệm

| Môi trường | Cổng | Khởi động | Đăng nhập | Kết quả quét thật |
| --- | ---: | --- | --- | --- |
| **OWASP Juice Shop** | 3000 | Docker | Tùy chọn (login để có thêm BOLA) | 8 lỗ hổng (không login) / 10 (có login) |
| **OWASP WebGoat** | 8082 | Docker | **Bắt buộc** | 10 lỗ hổng |
| **Bookstore (tự xây)** | 8081 | webapp-runner + PostgreSQL | Không cần | 20 lỗ hổng (phủ đủ các kịch bản) |

- **Juice Shop / WebGoat**: dùng oracle ghim theo lab trong `app/labs.py`.
- **Bookstore**: ứng dụng Java do nhóm tự phát triển (`JVA-bookstore`), được bổ sung một số điểm cuối minh hoạ (`/search`, `/ebook`, `/import`) và biểu mẫu đăng nhập có thể crawl, để hệ thống phát hiện đầy đủ kịch bản bằng **bộ detector tổng quát** (không ghim theo lab).

> Tài khoản demo và các bước chi tiết nằm trong **[DEMO.md](DEMO.md)**.

## 5. Cài đặt & chạy local

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python -m playwright install chromium        # cần cho XSS / SPA
Copy-Item .env.example .env
uvicorn app.main:app --reload
```

Mở **http://localhost:8000**. Giao diện mặc định quét lab offline `http://127.0.0.1:8000/demo` (không cần API key). Lịch sử lưu tại `data/sentinel.sqlite3`.

### Giao diện (dashboard bảo mật)

- Nhập **Target URL**, tick **authorized**, bấm **Start campaign** (WebGoat cần điền thêm Login URL + tài khoản).
- **Nhật ký yêu cầu theo thời gian thực**: các request hệ thống gửi hiện ngay trong lúc quét (cũng in `[QUET] ...` ra terminal `uvicorn`).
- **Thanh severity + thẻ phát hiện** theo chuẩn CVSS (Critical/High/Medium/Low/Info), mỗi thẻ có loại lỗ hổng, tham số, URL, bằng chứng và khuyến nghị.
- Nút **"Xem báo cáo tiếng Việt →"** mở báo cáo đầy đủ (in/xuất PDF được).

## 6. Cấu hình DeepSeek (`.env`)

```env
DEEPSEEK_API_KEY=your_key_here          # để trống = chạy deterministic offline
DEEPSEEK_MODEL=deepseek-chat
DEEPSEEK_BASE_URL=https://api.deepseek.com
AGENT_MODE=auto                          # auto | function_calling | deterministic
DEEPSEEK_INPUT_COST_PER_MILLION=0
DEEPSEEK_OUTPUT_COST_PER_MILLION=0
```

Mỗi lần quét ghi lại số lần gọi LLM, token, độ trễ và chi phí ước tính theo đơn giá cấu hình.

## 7. Chạy lab thật bằng Docker

```powershell
docker compose up -d juice-shop webgoat       # Juice Shop :3000, WebGoat :8082
uvicorn app.main:app --reload                 # Sentinel :8000
```

Bookstore chạy riêng (không qua Docker compose):

```powershell
docker start bstore-pg
java -Dfile.encoding=UTF-8 -jar "d:\Tai lieu\ki6\ATUDWEB\JVA-bookstore\target\dependency\webapp-runner.jar" --port 8081 "d:\Tai lieu\ki6\ATUDWEB\JVA-bookstore\target\ROOT.war"
```

> `docker-compose.yml` còn khai báo sẵn `mutillidae` (:8083) và `bwapp` (:8084) để mở rộng, nhưng luận văn tập trung vào Juice Shop, WebGoat và Bookstore.

Quét trên giao diện: nhập target theo bảng Mục 4. Với WebGoat nhập thêm thông tin ở mục **Authenticated lab session**; credential chỉ tồn tại trong request, không ghi vào báo cáo.

## 8. Demo nhanh (script)

```powershell
python demo\run_scan_report.py                                      # Juice Shop: tự đăng nhập + quét + mở báo cáo
python demo\run_scan_report.py http://127.0.0.1:8082/WebGoat/start.mvc
python demo\run_scan_report.py http://localhost:8081/
python demo\demo_bangchung_sqli.py                                  # in từng Bước 1-6 SQLi với dữ liệu thật
```

Quy trình demo đầy đủ cho buổi bảo vệ: xem **[DEMO.md](DEMO.md)**.

## 9. Báo cáo

| Định dạng | Endpoint |
| --- | --- |
| **HTML tiếng Việt** (dạng bảng, in PDF được) | `/api/scans/{scan_id}/report.vi.html` |
| JSON | `/api/scans/{scan_id}/report` |
| HTML (EN) | `/api/scans/{scan_id}/report.html` |
| Markdown | `/api/scans/{scan_id}/report.md` |
| Danh sách campaign (JSON) | `/api/scans` |
| Nhật ký request thời gian thực | `/api/live-log?after=N` |
| Trang lịch sử tiếng Việt | `/lich-su.html` |

Báo cáo tiếng Việt gồm: tóm tắt, **quy trình quét (ReAct)**, bảng tổng hợp phát hiện, chi tiết từng lỗ hổng, và **nhật ký yêu cầu kiểm thử theo dòng thời gian**.

Xuất báo cáo ra file riêng (mở offline):

```powershell
python scripts\export_reports.py            # reports/index.html + reports/bao-cao-<scan_id>.html
```

## 10. Đánh giá thực nghiệm

- Fixture `/demo` (ca dương lõi + ca dương OWASP 2025) và `/demo-safe` (ca âm) có ground truth trong `docs/ground_truth.json`.
- Đối chiếu theo **category + route + parameter**; tính Precision, Recall, F1, TP/FP/FN/TN, FPR; đo thời gian từng nhóm.

```powershell
python scripts\benchmark_lab.py --start-local --repeats 3
```

Kết quả tham chiếu: benchmark lõi và nhóm OWASP mở rộng đều đạt **Precision = Recall = F1 = 1.0, FPR = 0.0**.

## 11. Chạy test

```powershell
pytest -q        # 73 test: API, scope, repository, adapter lab, detector mở rộng, orchestrator tool-calling
```

## 12. Cấu trúc mã nguồn

```text
app/
  main.py          FastAPI routes, lab demo (/demo, /demo-safe), endpoint báo cáo + /api/live-log + /lich-su.html
  agent.py         Điều phối đa tác tử (deterministic) + nhánh function-calling
  toolbox.py       Bộ tool + vòng lặp ReAct function-calling (AI chỉ gọi tool)
  tools.py         Crawler, HTTP request tool (log thời gian thực), Playwright, adapter Juice Shop/WebGoat/Bookstore
  labs.py          Oracle ghim theo lab (Juice Shop, WebGoat): SQLi/XSS/BOLA/PathTraversal/XXE/Auth/Misconfig
  scenarios/       Detector tổng quát đăng ký registry: tn1 SQLi … tn4 passive, tn7 auth, tn8 open-redirect,
                   tn9 csrf, tn10 path-traversal, tn11 xxe
  passive.py       Detector thụ động A02/A03/A04 (header/cookie/version)
  access_control.py / auth_checks.py / path_traversal.py / xxe.py / csrf.py / open_redirect.py / browser_xss.py
  evaluation.py    Metric lõi (evaluate_demo/lab) + mở rộng (evaluate_extended)
  scope.py         Scope Guard giới hạn mục tiêu
  repository.py    Lưu lịch sử campaign bằng SQLite
  report_vi.py     Báo cáo HTML tiếng Việt + trang lịch sử tiếng Việt
  static/          Dashboard frontend (giao diện + nhật ký thời gian thực + thẻ severity)
scripts/
  test_live_labs.py    Quét Juice Shop + WebGoat (đăng ký + đăng nhập)
  benchmark_lab.py     Benchmark dương/âm, xuất data/benchmark
  export_reports.py    Xuất báo cáo tiếng Việt ra file theo scan_id
  run_demo_experiment.py
demo/
  run_scan_report.py       Quét + tự mở báo cáo tiếng Việt
  demo_bangchung_sqli.py   Tái hiện từng bước SQLi với dữ liệu thật
docs/                ground_truth.json, figures và tài liệu đánh giá
tests/               73 test
DEMO.md              Hướng dẫn demo bảo vệ đầy đủ
```

## 13. Giới hạn & hướng phát triển

- Reflected/Stored XSS dùng oracle thực thi trình duyệt (Chromium) và đọc lại payload lưu trữ.
- Chế độ function-calling dao động theo từng lần chạy và tốn nhiều token hơn deterministic.
- Chưa benchmark đối sánh định lượng với OWASP ZAP / Burp Suite (so sánh hiện ở mức năng lực).
- Một số lỗ hổng trên Bookstore được minh hoạ qua điểm cuối tự thêm; trên Windows không có `/etc/passwd` nên dùng tệp mồi có chữ ký tương đương.

> Chỉ kiểm thử những hệ thống thuộc quyền sở hữu hoặc có sự cho phép bằng văn bản.
