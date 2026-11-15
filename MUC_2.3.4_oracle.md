## 2.3.4. Các bộ oracle xác minh

### a. Khái niệm và vai trò

Trong hệ thống, "oracle" là bộ quy tắc tất định (deterministic) đóng vai trò trọng tài: nó quan sát bằng chứng trong phản hồi HTTP và đưa ra kết luận cuối cùng một lỗ hổng có tồn tại hay không. Đây là điểm thiết kế cốt lõi để tách bạch hai vai trò: mô hình ngôn ngữ (AI) chỉ chịu trách nhiệm chọn kịch bản, mục tiêu và payload để thử, còn việc kết luận hoàn toàn do oracle quyết định bằng mã nguồn. Nhờ vậy, ngay cả khi AI suy luận sai hay "tưởng tượng" ra lỗ hổng, hệ thống cũng không ghi nhận phát hiện nào nếu thiếu bằng chứng khách quan. Cơ chế này giúp giảm mạnh tỷ lệ báo động giả (false positive) và bảo đảm mỗi phát hiện trong báo cáo đều có chứng cứ truy vết được.

Nguyên tắc chung của mọi oracle gồm ba yếu tố:

- So sánh với đường cơ sở (baseline): hệ thống luôn gửi một yêu cầu lành tính làm chuẩn, rồi so phản hồi của yêu cầu có tiêm payload với chuẩn đó. Chỉ phần khác biệt do payload gây ra mới được xét.
- Chỉ công nhận khi có chữ ký bằng chứng rõ ràng: thông báo lỗi cơ sở dữ liệu, nội dung tệp hệ thống, mã thực thi chạy thật trên trình duyệt, v.v.
- Khai báo mức độ trung thực: khi bằng chứng chưa đủ chắc chắn, oracle hạ mức độ xuống "nghi ngờ" (Potential) thay vì khẳng định, tránh thổi phồng kết quả.

Toàn bộ các oracle được tổ chức thành nhiều nhóm theo cơ chế bằng chứng, trình bày ở các mục dưới đây.

### b. Oracle họ tiêm nhiễm (VerificationAgent)

Đây là oracle trung tâm cho các kịch bản tiêm nhiễm, đặt tại lớp `VerificationAgent` (`app/agent.py`). Nó nhận một `AttackProbe` gồm phản hồi tiêm, phản hồi baseline, mã trạng thái và loại kiểm thử, rồi áp các quy tắc sau:

- SQL Injection (oracle hai nhánh): Nhánh A công nhận khi phản hồi tiêm xuất hiện chữ ký lỗi cơ sở dữ liệu (ví dụ `sql syntax`, `sqlite error`, `SequelizeDatabaseError`) mà baseline thành công không có. Nhánh B dành cho trường hợp ứng dụng che giấu thông báo lỗi: nếu một dấu nháy đơn khiến máy chủ trả lỗi 5xx trong khi đầu vào lành tính trả mã bình thường (2xx hoặc 4xx), oracle ghi nhận ở mức "nghi ngờ" (medium) vì đây chỉ là dấu hiệu gián tiếp.
- Reflected XSS: chỉ công nhận khi payload được phản chiếu nguyên vẹn dưới dạng thẻ `script` hoặc trình xử lý sự kiện hoạt động trong ngữ cảnh HTML, không nằm trong vùng trung hòa như `textarea`, `title`, `template`, và phản hồi thành công (2xx). Đây là bằng chứng tĩnh trên HTML.
- Stored XSS: điều kiện tương tự Reflected XSS, nhưng marker phải được lưu phía máy chủ và trả lại ở một lần đọc độc lập sau đó, nhằm phân biệt với trường hợp chỉ phản chiếu tức thời.
- BOLA/IDOR: công nhận khi một phiên thứ hai (danh tính khác) đọc được đúng đối tượng của phiên thứ nhất mà không bị từ chối phân quyền, thể hiện qua việc hai phản hồi trùng nội dung đối tượng.

### c. Oracle thực thi bằng trình duyệt

Với XSS trên các ngữ cảnh JavaScript phức tạp, hệ thống dùng oracle mạnh hơn: thực thi thật bằng trình duyệt Chromium không giao diện (`app/browser_xss.py` và kiểm tra DOM XSS trong `app/labs.py`). Payload mang một marker duy nhất dưới dạng lời gọi `alert`. Oracle chỉ ghi nhận phát hiện khi hộp thoại `alert` mang đúng marker được kích hoạt thực sự trong trình duyệt. Vì phải chạy được mã mới công nhận, nhóm oracle này có tỷ lệ báo động giả rất thấp và là bằng chứng khai thác mạnh hơn so với kiểm tra phản chiếu tĩnh.

### d. Oracle chữ ký nội dung tệp hệ thống

Nhóm này áp dụng cho Path Traversal (`app/path_traversal.py`) và XXE (`app/xxe.py`). Payload được thiết kế để đọc tệp hệ thống đã biết là `/etc/passwd`. Oracle chỉ công nhận khi phản hồi tiêm chứa đúng chữ ký đặc trưng của tệp này (biểu thức `root:.*:0:0:`) mà yêu cầu baseline lành tính không có. Việc neo vào một chữ ký nội dung cụ thể, thay vì chỉ dựa vào mã trạng thái, giúp loại trừ gần như hoàn toàn nhầm lẫn.

### e. Oracle quan sát tiêu đề và chuyển hướng

- Open Redirect (`app/open_redirect.py`): khác hẳn họ tiêm nhiễm, oracle không soi nội dung thân phản hồi mà soi tiêu đề `Location`. Nó chèn một tên miền mồi vào tham số đích và chỉ công nhận khi máy chủ trả mã 3xx kèm `Location` trỏ đúng ra tên miền ngoài đã chèn.
- Kiểm tra thụ động A02/A03/A04 (`app/passive.py`): nhóm này không tấn công, chỉ đọc phản hồi để phát hiện cấu hình sai: thiếu các tiêu đề bảo mật trên tài liệu HTML, lộ dấu vết lỗi/stack trace, lộ phiên bản phần mềm, và cookie thiếu cờ an toàn (Secure, HttpOnly) hay thiếu HSTS. Do chỉ quan sát, nhóm này áp dụng đồng nhất cho mọi môi trường.

### f. Oracle kiểm soát truy cập

Đặt tại `app/access_control.py`, oracle này thực hiện forced-browsing kiểu DAST: gọi thẳng danh sách các endpoint quản trị phổ biến (ví dụ `/api/admin/dashboard`, `/actuator/env`) bằng một phiên không có quyền quản trị. Nó công nhận lỗi Broken Access Control (BFLA) khi endpoint trả về HTTP 200 kèm dữ liệu JSON cho phiên không đủ quyền, tức thiếu kiểm tra quyền cấp chức năng. Trường hợp BOLA/IDOR hai phiên dùng chung oracle với `VerificationAgent` đã nêu ở mục b.

### g. Oracle hành vi mang tính heuristic

Một số lỗ hổng không có bằng chứng tuyệt đối trong một yêu cầu, nên oracle chỉ kết luận ở mức dấu hiệu:

- Authentication Failures (`app/auth_checks.py`): thử một lần đăng nhập sai làm chuẩn cộng với chín lần sai liên tiếp (tổng mười lần). Nếu suốt mười lần không quan sát thấy cơ chế khóa hay giới hạn tần suất, oracle kết luận "chưa thấy cơ chế khóa trong lượt thử". Đây là dấu hiệu heuristic theo WSTG-ATHN-03, không khẳng định chắc chắn thiếu khóa theo từng tài khoản.
- CSRF (`app/csrf.py`): nếu một biểu mẫu POST (đổi trạng thái) không có trường token chống CSRF thì đánh dấu "nghi ngờ" ở mức thấp. Oracle nêu rõ đây chỉ là dấu hiệu vì ứng dụng có thể chống bằng SameSite cookie hoặc header tùy biến, nên mức độ được để nhẹ để tránh thổi phồng.

### h. Oracle ghim theo môi trường huấn luyện

Với hai môi trường chuẩn là OWASP Juice Shop và WebGoat, hệ thống dùng thêm các oracle ghim riêng theo từng bài học trong `app/labs.py` (hàm `check_lab`). Các oracle này biết trước đường dẫn, tham số và dấu hiệu hoàn thành của từng bài (ví dụ cặp mệnh đề đúng/sai `OR 1=1--` làm số sản phẩm thay đổi trên Juice Shop, hay payload boolean làm "hoàn thành bài học" trên WebGoat), nên cho bằng chứng chính xác và ổn định trên các lab quen thuộc. Môi trường tự xây (Bookstore) không dùng oracle ghim mà đi qua các bộ detector tổng quát ở các mục trên.

### i. Bảng tổng hợp các bộ oracle

| Bộ oracle | Vị trí mã | Điều kiện công nhận | Mức độ |
|---|---|---|---|
| SQL Injection (2 nhánh) | `agent.py` (VerificationAgent) | Chữ ký lỗi CSDL, hoặc dấu nháy gây 5xx trong khi baseline bình thường | Cao / Nghi ngờ |
| Reflected / Stored XSS (tĩnh) | `agent.py` | Marker phản chiếu/lưu lại dạng thẻ script hoạt động | Trung bình / Cao |
| XSS thực thi trình duyệt | `browser_xss.py`, `labs.py` | Chromium kích hoạt alert mang marker duy nhất | Cao |
| Path Traversal / XXE | `path_traversal.py`, `xxe.py` | Phản hồi chứa chữ ký `/etc/passwd` (`root:...:0:0:`) | Cao |
| Open Redirect | `open_redirect.py` | Mã 3xx và Location trỏ ra tên miền ngoài đã chèn | Trung bình |
| Kiểm tra thụ động A02/A03/A04 | `passive.py` | Thiếu header bảo mật, lộ stack trace/phiên bản, cookie thiếu cờ | Trung bình |
| Broken Access Control (BFLA) | `access_control.py` | Endpoint quản trị trả 200 kèm JSON cho phiên không đủ quyền | Cao |
| BOLA/IDOR | `agent.py`, `labs.py` | Phiên thứ hai đọc được đối tượng của phiên thứ nhất | Cao |
| Authentication Failures | `auth_checks.py` | 10 lần đăng nhập sai không thấy cơ chế khóa | Cao (heuristic) |
| CSRF | `csrf.py` | Form POST đổi trạng thái thiếu token chống CSRF | Thấp (nghi ngờ) |

### j. Nguyên tắc thiết kế và hạn chế

Các bộ oracle tuân thủ ba nguyên tắc nhất quán. Thứ nhất, luôn đối chứng baseline để quy kết đúng nguyên nhân do payload. Thứ hai, ưu tiên độ chính xác: chỉ công nhận khi có chữ ký bằng chứng cứng, và hạ mức độ xuống "nghi ngờ" khi chứng cứ chỉ là gián tiếp. Thứ ba, bảo vệ dữ liệu: với các bằng chứng nhạy cảm (bảng nhân viên, hồ sơ người dùng, nội dung giỏ hàng), oracle chỉ giữ dấu hiệu kết luận mà không lưu dữ liệu thật của nạn nhân vào báo cáo.

Về hạn chế, các oracle mang tính heuristic (Authentication Failures, CSRF) chỉ đưa ra dấu hiệu, chưa phải khẳng định tuyệt đối, do không khai thác hết mọi ngữ cảnh nghiệp vụ. Ngoài ra, oracle hoạt động theo mô hình hộp đen dựa trên bằng chứng quan sát được, nên một số lỗ hổng nằm sau nhiều bước nghiệp vụ phức tạp có thể không được kích hoạt trong lượt quét tự động.
