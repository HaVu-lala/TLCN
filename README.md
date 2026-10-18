# Sentinel — Hệ thống kiểm thử xâm nhập ứng dụng web dùng AI Agent

## 1. Dự án này làm gì

Sentinel là đồ án tiểu luận chuyên ngành: một **AI Pentest Agent** mô phỏng chuyên gia kiểm thử xâm nhập (pentester) cho ứng dụng web. Hệ thống tự động:

1. **Thu thập thông tin (Recon):** crawl các trang cùng host, bóc tách form/input/endpoint, render được cả input sinh bởi JavaScript (SPA) nhờ Playwright.
2. **Lập kế hoạch (Planning):** dùng mô hình DeepSeek để suy luận, hoặc kế hoạch dự phòng khi không có API key.
3. **Tấn công có kiểm soát (Action):** chèn payload không phá hoại để kiểm tra lỗ hổng.
4. **Xác thực (Verification):** chỉ ghi nhận lỗ hổng khi có **bằng chứng thực tế** từ phản hồi máy chủ (oracle tất định), không dựa trên phán đoán của mô hình.
5. **Báo cáo (Reporting):** xuất báo cáo JSON, HTML, Markdown và **HTML tiếng Việt** kèm PoC và khuyến nghị.

Toàn bộ chỉ chạy trong môi trường lab **được cấp phép** (localhost/loopback/IP nội bộ/host lab cấu hình sẵn).

## 2. Hai chế độ vận hành (`AGENT_MODE`)

- **`function_calling` — AI chỉ gọi tool:** khi có `DEEPSEEK_API_KEY`, LLM tự chủ chọn và gọi từng tool qua cơ chế function-calling theo vòng lặp ReAct. LLM **không** trực tiếp gửi gói tin; mọi hành động mạng do mã Python thực thi dưới Scope Guard; việc xác nhận lỗ hổng do oracle tất định quyết định.
- **`deterministic` — pipeline tất định (dự phòng):** chạy pipeline đa agent cố định (Recon → Planning → Attack → Verification → Reporting), kết quả **tái lập được**, nhanh, không tốn token.
- **`auto` (mặc định):** có key thì dùng function-calling, không thì dùng deterministic; function-calling lỗi sẽ tự lùi về deterministic.

> Khuyến nghị: số liệu trích dẫn (luận văn) nên lấy từ chế độ **deterministic** cho ổn định; function-calling dùng để minh hoạ tính tự chủ của AI (có đánh đổi: chậm hơn, tốn token, dao động theo lần chạy).

## 3. Bộ 9 tool mà AI có thể gọi

| Tool | Vai trò | Nhóm OWASP 2025 |
| --- | --- | --- |
| `reconnaissance` | Crawl URL, phân tích HTML form, bóc input/endpoint | — |
| `http_request` | Gửi GET/POST, quản lý Cookie/Authorization, scope guard | — |
| `inject_payload` | Chèn payload + baseline để so sánh | A05 |
| `verify_vulnerability` | Oracle tất định: phân tích sai biệt mã trạng thái & response body | A05/A01 |
| `generate_report` | Tổng hợp finding, trích request/response làm PoC | — |
| `audit_response_security` | Kiểm thụ động header/cookie/version | A02, A03, A04 |
| `test_authentication` | Kiểm đăng nhập yếu (default creds, không khóa) | A07 |
| `test_object_authorization` | So sánh 2 phiên để phát hiện BOLA/IDOR | A01 |
| `run_lab_checks` | Chạy oracle riêng của Juice Shop/WebGoat | A05/A01/A02/A07 |

5 tool đầu là bộ lõi theo đề cương (Tool 1–5); 4 tool sau mở rộng để phủ thêm OWASP Top 10:2025.

## 4. Các lỗ hổng phát hiện được

- **A01 Broken Access Control:** BOLA/IDOR (so sánh 2 phiên).
- **A02 Security Misconfiguration:** thiếu security headers (CSP/X-Frame-Options/X-Content-Type-Options), lộ stack trace, lộ thư mục/endpoint nhạy cảm (`/ftp`, Spring Actuator `/actuator/env`).
- **A03 Software Supply Chain:** lộ phiên bản thành phần qua header.
- **A04 Cryptographic Failures:** cookie thiếu Secure/HttpOnly/SameSite, thiếu HSTS.
- **A05 Injection:** SQL Injection, Reflected XSS, Stored XSS, DOM XSS (Juice Shop, oracle Chromium).
- **A07 Authentication Failures:** chấp nhận credential mặc định, không khóa tài khoản sau nhiều lần sai.

### 6 kịch bản quét được trên CẢ Juice Shop và WebGoat

| # | Kịch bản | OWASP 2025 | Juice Shop | WebGoat |
| --- | --- | --- | --- | --- |
| 1 | SQL Injection | A05 | product search | SqlInjection/attack8 |
| 2 | Stored XSS | A05 | product review | stored-xss lesson |
| 3 | BOLA/IDOR | A01 | /rest/basket/1 | IDOR/profile |
| 4 | Security Misconfiguration (thiếu header) | A02 | thiếu CSP | thiếu CSP/XFO/XCTO |
| 5 | Lộ endpoint/file nhạy cảm | A02 | `/ftp` listing | `/actuator/env` |
| 6 | Authentication Failures (không khóa) | A07 | `/rest/user/login` | `/WebGoat/login` |

Kết quả quét thực tế (deterministic): **Juice Shop 7 lỗ hổng** (6 kịch bản trên + DOM XSS), **WebGoat 6 lỗ hổng**.

## 5. Cài đặt & chạy local

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python -m playwright install chromium        # cần cho DOM XSS / SPA
Copy-Item .env.example .env
uvicorn app.main:app --reload
```

Mở **http://127.0.0.1:8000**. Dashboard mặc định quét lab offline `http://127.0.0.1:8000/demo` (không cần API key). Lịch sử lưu tại `data/sentinel.sqlite3`.

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
docker compose up -d juice-shop webgoat       # labs: 3000 và 8082
uvicorn app.main:app --reload                 # app Sentinel ở 8000
```

| Mục tiêu | Port | Mục đích |
| --- | ---: | --- |
| Juice Shop | 3000 | Ứng dụng SPA/REST hiện đại |
| WebGoat | 8082 | Bài học OWASP có hướng dẫn |
| Mutillidae II | 8083 | Injection, XSS, lỗi cấu hình |
| bWAPP | 8084 | Bộ kịch bản lỗi web đa dạng |

Quét 2 lab (tự đăng ký tài khoản + đăng nhập + quét):

```powershell
python scripts\test_live_labs.py --lab all
```

Hoặc quét thủ công trên dashboard: nhập target `http://127.0.0.1:3000/` hoặc `http://127.0.0.1:8082/WebGoat`, với WebGoat nhập thêm thông tin ở mục **Authenticated lab session**. Khi chạy trong Docker dùng hostname `juice-shop`, `webgoat`; credential chỉ tồn tại trong request, không ghi vào báo cáo.

BOLA bằng 2 phiên: gửi thêm `comparison_session_headers`:

```json
{
  "target_url": "http://127.0.0.1:8000/demo",
  "authorized": true,
  "session_headers": {"X-Lab-User": "user-1"},
  "comparison_session_headers": {"X-Lab-User": "user-2"}
}
```

## 8. Báo cáo

| Định dạng | Endpoint |
| --- | --- |
| JSON | `/api/scans/{scan_id}/report` |
| HTML (EN) | `/api/scans/{scan_id}/report.html` |
| Markdown | `/api/scans/{scan_id}/report.md` |
| **HTML tiếng Việt** (giải thích cho người ngoài ngành, dạng bảng, in PDF được) | `/api/scans/{scan_id}/report.vi.html` |
| Danh sách campaign (JSON) | `/api/scans` |
| **Trang lịch sử tiếng Việt** | `/lich-su.html` |

Xuất mỗi báo cáo thành một file riêng theo `scan_id` (mở offline, không cần server):

```powershell
python scripts\export_reports.py            # tạo reports/index.html + reports/bao-cao-<scan_id>.html
```

## 9. Đánh giá thực nghiệm

- Fixture `/demo` (4 ca dương lõi + 4 ca dương OWASP 2025) và `/demo-safe` (các ca âm) có ground truth phiên bản hóa trong `docs/ground_truth.json`.
- Đối chiếu theo **category + route + parameter**; tính Precision, Recall, F1, TP/FP/FN/TN, FPR; đo thời gian từng nhóm.
- Nhóm OWASP 2025 mở rộng được chấm **riêng** để không ảnh hưởng benchmark lõi.

```powershell
python scripts\benchmark_lab.py --start-local --repeats 3
```

Lệnh tự chạy API offline, không dùng DeepSeek, xuất `data/benchmark/benchmark.{json,csv,md}` và `benchmark_extended.csv`. Kết quả tham chiếu: benchmark lõi (8 fixture) và nhóm mở rộng (A02/A03/A04/A07) đều đạt **Precision = Recall = F1 = 1.0, FPR = 0.0**. `test_timings_ms` đo probe + xác thực + refinement (không gồm recon/planning, không phải thời gian khai thác).

## 10. Chạy test

```powershell
pytest -q        # 54 test: API, scope, repository, adapter lab, detector mở rộng, orchestrator tool-calling
```

## 11. Cấu trúc mã nguồn

```text
app/
  main.py          FastAPI routes, lab demo (/demo, /demo-safe), các endpoint báo cáo + /lich-su.html
  agent.py         Điều phối đa agent (deterministic) + nhánh function-calling
  toolbox.py       9 tool + vòng lặp ReAct function-calling (AI chỉ gọi tool)
  reasoning.py     Phiên LLM có schema (Pydantic), redact dữ liệu trước khi gửi
  tools.py         Crawler, HTTP request tool, Playwright, adapter Juice Shop/WebGoat
  labs.py          Oracle riêng từng lab + extended_lab_checks (A07/A02 cho lab)
  passive.py       Detector thụ động A02/A03/A04 (header/cookie/version)
  auth_checks.py   Detector A07 (default creds, không khóa) cho form login
  evaluation.py    Metric lõi (evaluate_demo/lab) + mở rộng (evaluate_extended)
  scope.py         Scope Guard giới hạn mục tiêu
  repository.py    Lưu lịch sử campaign bằng SQLite
  report_vi.py     Báo cáo HTML tiếng Việt + trang lịch sử tiếng Việt
  schemas.py       Mô hình request/finding/report
  static/          Dashboard frontend
scripts/
  test_live_labs.py    Quét Juice Shop + WebGoat (đăng ký + đăng nhập)
  benchmark_lab.py     Benchmark dương/âm, xuất data/benchmark
  export_reports.py    Xuất báo cáo tiếng Việt ra file theo scan_id
docs/                ground_truth.json và tài liệu đánh giá
tests/               54 test
```

## 12. Giới hạn & hướng phát triển

- Reflected/Stored XSS dùng bằng chứng HTML tĩnh; DOM XSS Juice Shop có oracle Chromium.
- Chế độ function-calling dao động theo từng lần chạy và tốn nhiều token hơn deterministic.
- Chưa chạy benchmark đối sánh định lượng với OWASP ZAP / Burp Suite (so sánh hiện ở mức năng lực).
- WebGoat còn nhiều bài học khác (JWT, Crypto, Path Traversal…) cần oracle riêng theo phiên bản — để hướng phát triển.

> Chỉ kiểm thử những hệ thống thuộc quyền sở hữu hoặc có sự cho phép bằng văn bản.
