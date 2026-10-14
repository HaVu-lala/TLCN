# Hoàn thiện lab và mã nguồn

## Chức năng thực hiện

| Chức năng | Hiện thực | Bằng chứng / giới hạn |
| --- | --- | --- |
| Thu thập URL, biểu mẫu, input, API | `app/tools.py` | Crawl có giới hạn, adapter Juice Shop/WebGoat, Playwright tùy chọn |
| Lập kế hoạch bằng AI | `app/agent.py`, `app/reasoning.py` | JSON được Pydantic kiểm tra; chỉ chọn bốn phép thử; fallback khi thiếu key hoặc lỗi API |
| Quản lý HTTP và phiên | `app/tools.py` | Cookie/header, đăng nhập lab; chặn request và redirect khác origin, kể cả browser |
| SQLi | `AttackAgent`, `app/labs.py` | So sánh lỗi với baseline; adapter Juice Shop dùng cặp điều kiện đúng/sai, WebGoat dùng oracle bài học |
| Reflected/Stored XSS | `AttackAgent`, `VerificationAgent` | Marker riêng; kiểm tra ngữ cảnh HTML; Stored XSS phải xuất hiện trong request đọc lại độc lập |
| DOM XSS Juice Shop | `app/labs.py` | Chỉ xác nhận khi Chromium thực thi đúng marker; cần Chromium |
| BOLA/IDOR | `AttackAgent`, `/demo/object` | Hai danh tính lab `user-1`/`user-2`; yêu cầu owner và người khác nhận cùng dữ liệu của owner. Chưa tổng quát cho các lab Docker |
| Phản hồi và kiểm thử lại | `AttackAgent.refine` | Một lượt bổ sung có giới hạn, không lặp vô hạn |
| Lịch sử và báo cáo | `app/repository.py`, `app/main.py` | SQLite, JSON, HTML và Markdown |
| Đánh giá | `app/evaluation.py`, `scripts/benchmark_lab.py` | TP/FP/FN/TN, Precision/Recall/F1/FPR và thời gian từng phép kiểm tra |

## Chạy benchmark tái lập

```powershell
python -m pytest tests -q
python scripts/benchmark_lab.py --start-local --repeats 3
```

Lệnh thứ hai tự chạy API tạm thời trên `127.0.0.1:8765`, tắt DeepSeek và browser,
thực hiện hai fixture, lưu kết quả vào `data/benchmark`, rồi dừng API. Không sửa
`.env`. Nếu cổng đã được dùng, dừng tiến trình đó hoặc dùng API riêng với `--api`
và bỏ `--start-local`.

- `/demo`: bốn trường hợp dương.
- `/demo-safe`: bốn trường hợp âm với encode HTML và kiểm tra owner.
- Danh tính owner: `X-Lab-User: user-1`; danh tính so sánh: `X-Lab-User: user-2`.
- Báo cáo: `benchmark.json` chứa dữ liệu gốc; `benchmark.csv` chứa từng quan sát;
  `benchmark.md` chứa bảng theo nhóm lỗ hổng.
- Chỉ gán ground truth khi crawler nhận diện đúng fixture, không chỉ dựa vào path.
- Đơn vị đối chiếu là category + route + parameter. Bằng chứng trùng chỉ tính một lần.
- Thời gian từng phép thử gồm gửi probe, xác thực và refinement; không gồm recon
  và planning. Đây là thời gian kiểm thử, không phải thời gian khai thác thành công.
- Ba lần lặp tạo 24 quan sát trên **8 trường hợp duy nhất**; không xem là 24 mẫu độc lập.

SQLi của demo là mô phỏng lỗi SQL. Reflected/Stored XSS dùng bằng chứng HTML tĩnh,
chưa chứng minh browser thực thi hay vượt CSP. Benchmark offline không đo chất
lượng suy luận AI. Không suy rộng số liệu demo sang ứng dụng thực tế.

## Các môi trường thay DVWA

Compose cung cấp Juice Shop, WebGoat, Mutillidae II và bWAPP. Tất cả cổng được bind
vào loopback máy host. Khởi động bằng `docker compose up --build`. Sentinel trong
Docker dùng host nội bộ được ghi trong README, không dùng localhost cho container khác.

Đã thử khởi động Docker Desktop nhưng Docker API vẫn không khả dụng trong lần kiểm tra này, vì vậy chưa tái chạy các container
và chưa xác nhận dữ liệu benchmark cho chúng. Các tệp kết quả cũ vẫn được giữ;
không coi chúng là kết quả mới của lần sửa này. Ground truth các lab ngoài demo
vẫn chưa được bật.

## Quy trình so sánh với ZAP/Burp

Chạy từng công cụ trên cùng phiên bản lab, cùng URL/form và trạng thái dữ liệu.
Ghi rõ cấu hình scan, session, browser, AI/fallback và đơn giá token. Với BOLA,
cung cấp hai danh tính tương đương; công cụ không hỗ trợ cần đánh dấu chưa kiểm thử.

Đối chiếu từng finding theo category + route + parameter với ground truth đã xác
nhận thủ công; các nhận định ngoài bộ trường hợp ghi riêng. Tính TP/FP/FN/TN theo
cùng đơn vị và dùng cùng công thức trong `app/evaluation.py`. Ghi thời gian toàn
campaign và thời gian từng nhóm riêng, không so thời gian toàn scan với thời gian
probe. Báo cáo median qua các lần lặp; không điền số liệu chưa chạy. Dự án hiện
chưa chạy ZAP/Burp nên chưa có kết luận công cụ nào chính xác hoặc nhanh hơn.

## Cập nhật 15/10/2026

Docker đã khởi động sau khi sao lưu socket runtime lỗi. Juice Shop và WebGoat đã được chạy và quét trực tiếp; xem data/live-labs-summary.md cùng hai báo cáo JSON tại thư mục gốc. Chưa kiểm chứng Mutillidae/bWAPP hay chạy so sánh ZAP/Burp; ground truth Docker vẫn chưa bật. Bộ test hiện đạt 36 test.
