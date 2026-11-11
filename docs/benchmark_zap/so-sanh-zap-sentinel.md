# So sánh Sentinel với OWASP ZAP (Chương 3)

## 1. Thiết lập thực nghiệm

- Công cụ đối chứng: **OWASP ZAP** (image `ghcr.io/zaproxy/zaproxy:stable`, chạy qua Docker).
- Burp Suite không dùng để benchmark vì bản **Community không có scanner tự động** (chỉ proxy thủ công); bản tự quét là Burp Professional (trả phí).
- Hai chế độ ZAP:
  - **Baseline** (`zap-baseline.py`): spider + luật **thụ động** (passive) — nhanh, không gửi payload tấn công.
  - **Full/Active** (`zap-full-scan.py`): spider + luật **chủ động** (active) — gửi payload tiêm nhiễm, chậm hơn nhiều.
- Mục tiêu chạy qua `host.docker.internal`: Juice Shop `:3000`, WebGoat `:8082/WebGoat/login`, Bookstore `:8081`.
- Đối chứng với Sentinel chạy cùng ba môi trường (chế độ deterministic).

## 2. Kết quả ZAP baseline (thụ động)

| Môi trường | FAIL | WARN (loại cảnh báo) | PASS | Cao | Trung bình | Thấp | Info |
|---|---:|---:|---:|---:|---:|---:|---:|
| Juice Shop | 0 | 9 | 59 | 1 | 2 | 5 | 3 |
| WebGoat | 0 | 11 | 57 | 0 | 3 | 6 | 5 |
| Bookstore | 0 | 15 | 53 | 0 | 4 | 8 | 5 |

Cảnh báo ZAP baseline **chủ yếu là cấu hình/thụ động**: thiếu Content-Security-Policy, thiếu anti-clickjacking header, thiếu cờ cookie (SameSite), thiếu các header CORP/COEP/COOP, thiếu token chống CSRF, lộ phiên bản thư viện JS (Vulnerable JS Library — mức Cao duy nhất, trên Juice Shop), và nhiều mục Low/Info (timestamp, storable content, "User Controllable HTML Element — Potential XSS").

**Điểm mấu chốt:** ở chế độ baseline, ZAP **không xác nhận** bất kỳ lỗ hổng tiêm nhiễm/kiểm soát truy cập nào (SQLi, XSS thực thi, BOLA/IDOR, Path Traversal, XXE) — vì baseline không gửi payload chủ động. Dấu hiệu XSS chỉ dừng ở mức **Info "Potential XSS"** (heuristic thụ động, chưa chứng minh thực thi).

## 3. Kết quả Sentinel (có xác nhận khai thác)

| Môi trường | Số phát hiện (đã xác nhận) |
|---|---:|
| Juice Shop (có đăng nhập) | 11 |
| WebGoat | 10 |
| Bookstore | 11 |

Mỗi phát hiện do **oracle tất định** kết luận dựa trên bằng chứng thực tế (sai biệt số bản ghi true/false của SQLi; hộp thoại alert mang marker duy nhất được Chromium thực thi cho XSS; đọc lại payload lưu trữ; chữ ký `root:...:0:0:` của Path Traversal/XXE; đọc được đối tượng/endpoint quản trị cho BOLA/BFLA).

## 4. So sánh theo nhóm lỗ hổng

Ký hiệu: ✓ = phát hiện **và** xác nhận; △ = chỉ gợi ý/cảnh báo không xác nhận; ✗ = không phát hiện.

| Nhóm OWASP 2025 / Lỗ hổng | ZAP baseline | Sentinel |
|---|:---:|:---:|
| A05 – SQL Injection | ✗ | ✓ (sai biệt true/false, hoặc chữ ký lỗi SQL) |
| A05 – XSS (reflected/stored/DOM) | △ "Potential XSS" (Info) | ✓ (Chromium thực thi / đọc lại payload lưu) |
| A05 – XXE | ✗ | ✓ (nội dung /etc/passwd lọt vào phản hồi) |
| A01 – BOLA/IDOR | ✗ | ✓ (đọc đối tượng người khác) |
| A01 – BFLA (truy cập quản trị) | ✗ | ✓ (Bookstore /api/admin/*) |
| A01 – Path Traversal | ✗ | ✓ (chữ ký root:...:0:0:) |
| Open Redirect | ✗ | ✓ (Juice /redirect) |
| A02 – Security Misconfiguration (header/CSP) | ✓ (rất nhiều) | ✓ (các mục chính) |
| A04 – Cryptographic Failures (cờ cookie/HSTS) | ✓ | ✓ |
| A03 – Supply Chain (lộ phiên bản) | ✓ (Vulnerable JS Library) | ✓ (banner phiên bản) |
| CSRF (thiếu token) | ✓ (Absence of Anti-CSRF Tokens) | ✓ (heuristic) |

## 5. Nhận xét

1. **Bề rộng vs chiều sâu:** ZAP baseline cho **nhiều cảnh báo thụ động** (header/cấu hình/thông tin) — trùng với nhóm A02/A03/A04/CSRF mà Sentinel cũng phát hiện, nhưng kèm nhiều mục Low/Info mang tính nhiễu (noise). Ngược lại, ZAP baseline **bỏ sót toàn bộ** nhóm tiêm nhiễm và kiểm soát truy cập (SQLi, XSS thực thi, BOLA/BFLA, Path Traversal, XXE) mà Sentinel **xác nhận được bằng bằng chứng**.
2. **Xác nhận khai thác (oracle tất định):** ZAP (kể cả khi active scan) báo cáo cảnh báo theo luật, còn Sentinel chỉ ghi nhận khi **chứng minh được tác động** (ví dụ marker XSS thực sự chạy trong trình duyệt, truy vấn SQL bị điều khiển qua sai biệt true/false) → tỷ lệ báo động giả thấp, mỗi phát hiện kèm PoC.
3. **FAIL = 0 ở baseline** không có nghĩa mục tiêu an toàn; chỉ nghĩa là luật thụ động không đủ để kết luận các lỗ hổng cần tương tác chủ động — đúng giới hạn của quét thụ động.
4. **Giới hạn đối chứng:** đây là so sánh **năng lực/định tính + đếm cảnh báo**, không phải benchmark Precision/Recall chung mẫu số (ZAP và Sentinel định nghĩa "phát hiện" khác nhau: ZAP đếm cảnh báo theo luật, Sentinel đếm lỗ hổng đã xác nhận). Kết quả active scan của ZAP (mục 6) bổ sung cho công bằng ở nhóm tiêm nhiễm.

## 6. ZAP full/active scan trên Bookstore (bổ sung)

Khác với baseline, **active scan có gửi payload tiêm nhiễm** nên bắt được một số lỗ hổng chủ động:

| Mức | Loại cảnh báo (active) | Số |
|---|---|---:|
| Cao | Cross Site Scripting (Reflected) | 2 |
| Cao | SQL Injection | 1 |
| Cao | Path Traversal | 1 |
| Trung bình | Absence of Anti-CSRF Tokens / CSP / Clickjacking / SRI | 4 loại |
| Thấp / Info | (header, cookie, thông tin...) | 9 / 6 loại |

Tổng: 22 loại cảnh báo (3 Cao, 4 Trung bình, 9 Thấp, 6 Info).

**Quan sát quan trọng:**
- ZAP active **bắt được** SQL Injection, Reflected XSS và Path Traversal trên Bookstore (trùng với Sentinel ở các nhóm này).
- Nhưng ZAP active **bỏ sót XXE** (điểm cuối `/import` cần một tài liệu XML khai báo external entity đúng cách — active scan mặc định không tạo được) và **bỏ sót BFLA/truy cập quản trị** (`/api/admin/*` — cần tri thức về endpoint quản trị và ngữ cảnh phân quyền). Sentinel **xác nhận cả hai** nhờ oracle chuyên biệt.
- **Chi phí & độ ổn định:** active scan **không hoàn tất gọn** trong môi trường thực nghiệm — lần chạy thứ nhất container dừng đột ngột (`unexpected EOF`, dấu hiệu cạn bộ nhớ), lần thứ hai **quá 10 phút vẫn chưa kết thúc** (bị cắt theo giới hạn thời gian) dù đã cấp 4 GB RAM. Trong khi đó Sentinel quét Bookstore hoàn tất **~60 giây**, kết quả **tái lập được**.

**Kết luận bổ sung:** ngay cả ở chế độ active, ZAP **vẫn bỏ sót** các lỗ hổng cần tri thức ngữ cảnh/nghiệp vụ (XXE theo đúng điểm cuối, kiểm soát truy cập cấp chức năng) mà oracle chuyên biệt của Sentinel phát hiện; đồng thời active scan **chậm và kém ổn định** hơn nhiều so với pipeline tất định của Sentinel.
