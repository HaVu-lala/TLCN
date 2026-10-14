# Sentinel Web Pentest Agent

## Giới thiệu

Đây là đồ án tiểu luận chuyên ngành với đề tài **Kiểm thử xâm nhập ứng dụng web sử dụng AI Agent**. Hệ thống mô phỏng một pentester ảo, có khả năng thu thập thông tin, lập kế hoạch kiểm thử, thực hiện các phép kiểm tra an toàn và tổng hợp báo cáo.

Agent sử dụng vòng lặp ReAct có giới hạn:

1. **Reconnaissance:** Crawl các trang cùng host và thu thập biểu mẫu HTML.
2. **Planning:** Sử dụng DeepSeek để chọn kế hoạch kiểm thử hoặc dùng kế hoạch dự phòng khi chưa có API key.
3. **Action:** Kiểm tra Reflected XSS, Stored XSS, SQL Injection và BOLA/IDOR bằng payload kiểm soát, không phá hoại.
4. **Reporting:** Ghi nhận URL, tham số, bằng chứng, mức độ nghiêm trọng và khuyến nghị xử lý.

## Chức năng chính

- Scope Guard giới hạn mục tiêu trong localhost, loopback, IP nội bộ hoặc host lab được cấu hình.
- Crawler phát hiện URL và form nhập liệu, có thể render input sinh bởi JavaScript bằng Playwright.
- Adapter nhận diện Juice Shop SPA và kiểm tra API search `/rest/products/search?q=...` khi trang không có HTML form.
- Kiến trúc Multi-Agent gồm Recon, Planning, Attack, Verification và Reporting Agent.
- Agent planner tích hợp DeepSeek API, có fallback offline.
- Phát hiện cơ bản Reflected XSS, Stored XSS và SQL Injection.
- Kiểm tra BOLA/IDOR bằng so sánh quyền truy cập object từ hai session lab.
- Lưu lịch sử campaign bằng SQLite.
- Xuất báo cáo JSON, HTML và Markdown.
- Tính Precision, Recall, F1-Score, TP, FP, FN, TN và FPR trên lab demo dương/âm; đo thời gian từng nhóm kiểm thử.
- Dashboard web để khởi chạy campaign và xem finding.

## Chạy local

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python -m playwright install chromium
Copy-Item .env.example .env
uvicorn app.main:app --reload
```

Mở http://127.0.0.1:8000. Dashboard mặc định sử dụng lab offline tại `http://127.0.0.1:8000/demo`. Lab này cố ý có dữ liệu phản chiếu, dữ liệu lưu trữ không an toàn và lỗi SQL mô phỏng để Agent tạo finding mà không cần API key.

Lịch sử scan được lưu tại `data/sentinel.sqlite3`. Chỉ kiểm thử những hệ thống thuộc quyền sở hữu hoặc có sự cho phép bằng văn bản.

## Cấu hình DeepSeek

`DEEPSEEK_API_KEY` là tùy chọn. Khi chưa có key, hệ thống dùng kế hoạch cố định và vẫn chạy offline.

Khi có key, cấu hình trong file `.env`:

```env
DEEPSEEK_API_KEY=your_key_here
DEEPSEEK_MODEL=deepseek-chat
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_INPUT_COST_PER_MILLION=0
DEEPSEEK_OUTPUT_COST_PER_MILLION=0
```

DeepSeek chỉ tham gia lựa chọn phép kiểm tra. Kết quả scan lưu số lần gọi, token usage, thời gian gọi và chi phí ước tính theo đơn giá cấu hình. Việc gửi HTTP vẫn được thực hiện bởi code deterministic và chịu kiểm soát scope.

## Chạy bằng Docker

```powershell
docker compose up --build
```

Mở http://127.0.0.1:8000. Môi trường Docker cung cấp nhiều ứng dụng web lab:

- OWASP Juice Shop: http://127.0.0.1:3000
- OWASP WebGoat: http://127.0.0.1:8082/WebGoat
- OWASP Mutillidae II: http://127.0.0.1:8083
- bWAPP: http://127.0.0.1:8084

Khi Sentinel chạy trong Docker, có thể dùng hostname nội bộ `juice-shop`, `webgoat`, `mutillidae` và `bwapp` để tránh phụ thuộc vào localhost của container. WebGoat cung cấp bài học có hướng dẫn; Mutillidae II và bWAPP cung cấp thêm các kịch bản injection, XSS, xác thực và session. Đây đều là ứng dụng cố ý có lỗ hổng và chỉ dùng trong môi trường được phép.

| Mục tiêu | Port | Mục đích thực nghiệm |
| --- | ---: | --- |
| Juice Shop | 3000 | So sánh nhiều nhóm lỗi trong ứng dụng hiện đại |
| WebGoat | 8082 | Thực nghiệm theo bài học OWASP có hướng dẫn |
| Mutillidae II | 8083 | Injection, XSS và lỗi cấu hình |
| bWAPP | 8084 | Bộ kịch bản lỗi web đa dạng |

## Đánh giá thực nghiệm

Mục tiêu `/demo` có bốn lỗi đã biết:

- Reflected XSS
- Stored XSS
- Potential SQL Injection thông qua lỗi SQL mô phỏng
- Potential BOLA/IDOR thông qua endpoint object thiếu kiểm tra quyền

Sau mỗi lần scan, hệ thống đối chiếu theo category + route + parameter với ground truth phiên bản hóa trong `docs/ground_truth.json`. Fixture `/demo-safe` cung cấp bốn mẫu âm để đo TN và FPR. Chỉ tính metric khi crawler nhận diện đúng fixture Sentinel tại `/demo` hoặc `/demo-safe`; một URL cùng path không đủ để xác nhận ground truth. BOLA demo yêu cầu hai header danh tính lab như ví dụ bên dưới.

Để thực nghiệm BOLA bằng hai session, gửi thêm `comparison_session_headers` trong request `/api/scans`. Ví dụ chỉ dùng header của hai tài khoản lab được cấp phép:

```json
{
  "target_url": "http://127.0.0.1:8000/demo",
  "authorized": true,
  "session_headers": {"X-Lab-User": "user-1"},
  "comparison_session_headers": {"X-Lab-User": "user-2"}
}
```

Dashboard cũng hỗ trợ authenticated scan. Mở mục `Authenticated lab session`,
nhập login URL của Juice Shop (`http://127.0.0.1:3000/rest/user/login`), email
và password của tài khoản lab. Sentinel sẽ tự tạo session/token cho campaign;
credential chỉ tồn tại trong request hiện tại và không được ghi vào report.

Endpoint báo cáo:

- JSON: `/api/scans/{scan_id}/report`
- HTML: `/api/scans/{scan_id}/report.html`
- Markdown: `/api/scans/{scan_id}/report.md`
- Lịch sử campaign: `/api/scans`

## Kiểm thử mã nguồn

## Quét Juice Shop và WebGoat

Nếu Sentinel chạy bằng Docker, nhập target **`http://juice-shop:3000/`** hoặc
**`http://webgoat:8080/WebGoat`** trên dashboard. `localhost` trong container
là container Sentinel, không phải máy Windows. Nếu Sentinel chạy trực tiếp
bằng Python, dùng `http://127.0.0.1:3000/` và `http://127.0.0.1:8082/WebGoat`.

Khởi động hai lab cùng Sentinel: `docker compose up --build sentinel juice-shop webgoat`.
WebGoat cần tạo tài khoản lab trước tại trang đăng ký, rồi nhập login URL
`http://webgoat:8080/WebGoat/login` (Docker) hoặc
`http://127.0.0.1:8082/WebGoat/login` (Python), username và password trên dashboard.

Các kiểm tra riêng đã triển khai:

- Juice Shop: SQLi tại `/rest/products/search`, so sánh input bình thường với dấu nháy;
  DOM XSS tại `/#/search`, chỉ ghi nhận khi Chromium thực thi marker duy nhất.
- WebGoat: SQLi tại `/WebGoat/SqlInjection/attack8`, gửi đủ `name`, `auth_tan` và
  xác nhận chuyển từ `lessonCompleted=false` sang `true` kèm bảng kết quả.

DOM XSS cần Chromium (`python -m playwright install chromium`). Lỗi browser
được ghi trong `pages[].lab_browser_error` của báo cáo JSON. Endpoint bài học
không tồn tại hoặc phiên không hợp lệ sẽ không được coi là lỗ hổng.
Chưa có kiểm tra riêng xác nhận Stored XSS hoặc BOLA cho hai lab này;
không nên hiểu kết quả không có finding là ứng dụng an toàn.
Các test giả lập HTTP kiểm chứng logic adapter; cần quét trên container thực tế
để xác nhận tương thích với phiên bản lab đang sử dụng.

Nguồn endpoint: [WebGoat attack8](https://github.com/WebGoat/WebGoat/blob/main/src/main/java/org/owasp/webgoat/lessons/sqlinjection/introduction/SqlInjectionLesson8.java)
và [Juice Shop search](https://github.com/juice-shop/juice-shop/blob/master/routes/search.ts).

### Chạy test

```powershell
pytest -q
```

Test bao gồm API, scope, repository và adapter lab.

### Benchmark dương/âm và thời gian từng nhóm

```powershell
python scripts/benchmark_lab.py --start-local --repeats 3
```

Lệnh tự chạy API offline tại `127.0.0.1:8765`, không dùng DeepSeek, rồi dừng API.
Kết quả JSON/CSV/Markdown nằm trong `data/benchmark`. Ba lần lặp gồm 24 quan sát
trên 8 trường hợp duy nhất. `test_timings_ms` đo probe + xác thực + refinement,
không gồm recon/planning và không phải thời gian khai thác thành công.
Xem chức năng, giới hạn và quy trình so sánh ZAP/Burp trong
[docs/lab_completion.md](docs/lab_completion.md).

## Cấu trúc chính

```text
app/
  agent.py          Điều phối Agent và vòng lặp kiểm thử
  tools.py          Crawler và HTTP request tool
  scope.py          Kiểm soát phạm vi mục tiêu
  repository.py     Lưu campaign bằng SQLite
  schemas.py        Mô hình request, finding và report
  main.py           FastAPI routes và lab demo
  static/           Dashboard frontend
tests/              Test scope, API health và repository
docs/               Tài liệu kiến trúc và đánh giá
```

## Giới hạn và hướng phát triển

Phiên bản hiện tại phục vụ tiểu luận, tập trung vào XSS, SQL Injection và BOLA/IDOR trong môi trường lab được cho phép. Pipeline gồm các worker Recon, Planning, Attack, Verification và Reporting; chỉ Planning gọi LLM, kèm một vòng refinement có giới hạn. Reflected/Stored XSS dùng bằng chứng HTML tĩnh; DOM XSS Juice Shop có oracle browser. Ground-truth manifest cho các lab Docker đã có scenario ID và oracle, nhưng phải chạy xác nhận từng scenario trước khi báo cáo metric. Benchmark với OWASP ZAP/Burp chưa được chạy.
