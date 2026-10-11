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
- Xuất báo cáo JSON và HTML.
- Tính Precision, Recall, F1-Score, TP, FP, FN và thời gian scan trên lab demo.
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

Sau mỗi lần scan, hệ thống đối chiếu finding với ground truth phiên bản hóa trong `docs/ground_truth.json` và tính Precision, Recall, F1-Score, True Positive, False Positive, False Negative và thời gian thực thi. FPR được đánh dấu là chưa khả dụng khi chưa có tập mẫu âm. Chỉ số benchmark chỉ được tính khi mục tiêu có path chính xác là `/demo`.

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
- Lịch sử campaign: `/api/scans`

## Kiểm thử mã nguồn

```powershell
pytest -q
```

Kết quả hiện tại: **9 tests passed**.

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

Phiên bản hiện tại phục vụ tiểu luận, tập trung vào XSS, SQL Injection và BOLA/IDOR trong môi trường lab được cho phép. Pipeline gồm các Recon, Planning, Attack, Verification và Reporting Agent, kèm một vòng ReAct refinement có giới hạn. Ground-truth manifest cho các lab Docker đã có scenario ID và oracle, nhưng phải chạy xác nhận từng scenario trước khi báo cáo metric. Benchmark với OWASP ZAP là hướng phát triển tiếp theo.
