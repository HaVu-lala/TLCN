# HƯỚNG DẪN DEMO BẢO VỆ — Hệ thống Sentinel

Tài liệu ghi đầy đủ các bước demo từ đầu tới cuối. Nên **chạy thử trọn quy trình ở nhà 1 lần** trước buổi bảo vệ.

**Cổng sử dụng:** Juice Shop `:3000` · WebGoat `:8082` · Bookstore `:8081` · Sentinel (giao diện) `:8000`.

---

## 0. CHUẨN BỊ (làm 1 lần)

Mở PowerShell tại thư mục dự án và kích hoạt môi trường ảo:
```powershell
cd "D:\Tai lieu\ki6\TLCN"
Set-ExecutionPolicy -Scope Process -ExecutionPolicy RemoteSigned
.\.venv\Scripts\Activate.ps1
```

Cài trình duyệt cho kịch bản XSS/SPA (chỉ cần 1 lần):
```powershell
python -m playwright install chromium
```

Mở sẵn **Docker Desktop**, đợi biểu tượng cá voi báo "running".

---

## 1. KHỞI ĐỘNG MÔI TRƯỜNG

### 1.1. Lab Juice Shop + WebGoat (Docker)
```powershell
docker compose up -d juice-shop webgoat
docker ps
```
- Juice Shop lên gần như ngay: http://localhost:3000
- WebGoat (Spring Boot) cần ~1-2 phút: http://localhost:8082/WebGoat/login

### 1.2. Bookstore (KHÔNG chạy bằng Docker — chạy riêng)
```powershell
docker start bstore-pg
java "-Dfile.encoding=UTF-8" -jar "d:\Tai lieu\ki6\ATUDWEB\JVA-bookstore\target\dependency\webapp-runner.jar" --port 8081 "d:\Tai lieu\ki6\ATUDWEB\JVA-bookstore\target\ROOT.war"
```
Đợi khởi động xong, kiểm tra http://localhost:8081. (Để nguyên cửa sổ này cho Bookstore chạy.)

### 1.3. Hệ thống Sentinel (giao diện)
Mở **terminal khác** (đã `.venv`):
```powershell
cd "D:\Tai lieu\ki6\TLCN"
.\.venv\Scripts\Activate.ps1
uvicorn app.main:app --reload
```
Khi thấy `Application startup complete` là xong → http://localhost:8000

---

## 2. TÀI KHOẢN & THÔNG TIN QUÉT TỪNG MÔI TRƯỜNG

| Môi trường | Cổng | Target URL | Đăng nhập | Login URL / Tài khoản |
|---|---|---|---|---|
| **Juice Shop** | 3000 | `http://localhost:3000` | Tùy chọn (login để có thêm BOLA — **phải đăng ký trước**, xem ghi chú dưới) | `http://localhost:3000/rest/user/login` · `demo@juice.lab` / `Demo12345!` |
| **WebGoat** | 8082 | `http://127.0.0.1:8082/WebGoat/start.mvc` | **Bắt buộc** | `http://127.0.0.1:8082/WebGoat/login` · `baove2026` / `Sentinel1` |
| **Bookstore** | 8081 | `http://localhost:8081/` | Không cần | — |

Kết quả tham chiếu (quét thật):
- Juice Shop: 9 phát hiện (không login) hoặc **11** (có login, thêm BOLA + CSRF).
- WebGoat: **9** phát hiện.
- Bookstore: **12** phát hiện (phủ đủ 7 kịch bản): 2 Reflected XSS (`/search`, `/ebook`), 2 nghi ngờ SQLi (`/api/login`, `/api/profile/password`), 2 vượt quyền quản trị (BFLA), Security Misconfiguration, Cryptographic Failures, Authentication Failures, nghi ngờ CSRF, Path Traversal, XXE.

> Các số đếm phát hiện theo môi trường ở trên là bản ghi **function-calling (có DeepSeek)** — mục 3.3.8 luận văn (Juice Shop 9/11, WebGoat 9, Bookstore 12). Phần **đánh giá định lượng** (Precision/Recall/F1, FPR, TP 4/4 Juice & 5/5 WebGoat) lấy từ chế độ **pipeline tất định (không DeepSeek)** — mục 3.4. Mỗi lần chạy live có thể lệch nhẹ tùy chế độ và trạng thái lab; số trong luận văn là số tham chiếu để đối chiếu.

> Lưu ý: tài khoản tồn tại trên lab **đang chạy**. Nếu khởi động lại container (Juice/WebGoat) thì dữ liệu reset → phải đăng ký lại.
> - **Juice Shop KHÔNG có sẵn tài khoản.** Nếu quét qua giao diện và muốn có BOLA, phải **đăng ký trước** rồi mới điền 3 ô đăng nhập. Nếu điền tài khoản chưa tồn tại, hệ thống báo lỗi `Lab login failed` và dừng phiên quét. Cách đăng ký (1 lần, sau khi Juice đã chạy):
>   - Dễ nhất: mở http://localhost:3000/#/register trên trình duyệt, tạo `demo@juice.lab` / `Demo12345!`.
>   - Hoặc API: `POST http://localhost:3000/api/Users` (email, password, passwordRepeat, securityQuestion, securityAnswer).
>   - Hoặc **dùng script Mục 6** (`run_scan_report.py`) — tự đăng ký tài khoản ngẫu nhiên và quét kèm BOLA, không cần bước đăng ký tay.
> - Đăng ký WebGoat: trang http://localhost:8082/WebGoat/registration (mật khẩu **6-10 ký tự**).

---

## 3. DEMO CHÍNH — QUA GIAO DIỆN WEB

1. Mở **http://localhost:8000** (nếu vừa đổi giao diện, nhấn **Ctrl+F5** để nạp bản mới).
2. Nhập **Target URL** (xem bảng Mục 2).
3. Tick ô **authorized** (bắt buộc).
4. Nếu quét **WebGoat**: điền thêm **Login URL + Email/username + Password** (bắt buộc, điền đủ cả 3).
   Nếu quét **Juice Shop** và muốn có BOLA: **đăng ký tài khoản trước** (xem ghi chú Mục 2), rồi điền 3 ô đăng nhập (`demo@juice.lab` / `Demo12345!`). Không cần BOLA thì để trống cả 3 ô (điền tài khoản chưa tồn tại sẽ làm hỏng phiên quét).
   Nếu quét **Bookstore**: để trống 3 ô đăng nhập.
5. Bấm **Start campaign**.
6. Màn hình hiển thị:
   - **Chỉ số**: Pages / Endpoints / Findings / AI planner / F1.
   - **AGENT TRACE**: các tác tử theo mô hình ReAct (SessionManager → Recon → LongTermMemory → Planning → Attack → Verification → ReActFeedback → ExtendedDetectors → Reporting).
   - **NHẬT KÝ YÊU CẦU**: log từng request hệ thống gửi, **cập nhật theo thời gian thực** trong lúc quét (có thời gian, phương thức, URL, mã trạng thái, payload).
   - **Thanh severity**: CRITICAL / HIGH / MEDIUM / LOW / INFO kèm số lượng.
   - **Danh sách phát hiện**: mỗi thẻ có mức độ (màu), loại lỗ hổng, tham số, URL, bằng chứng, khuyến nghị khắc phục.
7. Bấm **"Xem báo cáo tiếng Việt →"** để mở báo cáo đầy đủ (dạng tài liệu, in/xuất PDF được).

> Câu nói: *"Toàn bộ lỗ hổng này do hệ thống tự quét và tự sinh báo cáo, em chạy trực tiếp ngay bây giờ ạ."*

---

## 4. XEM LOG QUÁ TRÌNH (3 cách)

1. **Thời gian thực trên giao diện**: mục **"NHẬT KÝ YÊU CẦU"** dưới phần kết quả — các dòng chạy ra dần khi quét.
2. **Thời gian thực ở terminal**: cửa sổ chạy `uvicorn` in các dòng `[QUET] <giờ> <method> <url> -> HTTP <mã>` theo thời gian thực.
3. **Trong báo cáo**: mục **"Quy trình quét"** (các bước ReAct) và **"Nhật ký yêu cầu kiểm thử (theo dòng thời gian)"**.

---

## 5. DEMO CHI TIẾT TỪNG BƯỚC (khi thầy cô hỏi "bằng chứng này đâu ra")

```powershell
python demo\demo_bangchung_sqli.py
```
Dùng **chính công cụ WebTools của hệ thống** chạy qua đúng logic oracle trong `app/labs.py`, in ra từng Bước 1-6 + nhật ký request thật, khớp đúng ảnh bằng chứng TN1 – Juice Shop trong luận văn:
```
Bước 1  q=apple                   -> 2 sản phẩm
Bước 2  q=sentinel-no-match       -> 0 sản phẩm   (nền)
Bước 3  q='                       -> HTTP 200, không lộ lỗi SQL
Bước 4  q=...')) OR 1=1--         -> 46 sản phẩm   (mệnh đề đúng)
        q=...')) OR 1=2--         -> 0 sản phẩm    (mệnh đề sai)
Bước 5  counts [0, 46, 0] -> kết luận SQL Injection
Bước 6  in nhật ký request thật
```
Có thể dán trực tiếp các URL trên vào trình duyệt cho thầy cô xem phản hồi JSON thật.

---

## 6. DEMO NHANH BẰNG SCRIPT (tự quét + tự mở báo cáo)

```powershell
python demo\run_scan_report.py                                      # Juice Shop (tự đăng nhập, có BOLA)
python demo\run_scan_report.py http://127.0.0.1:8082/WebGoat/start.mvc
python demo\run_scan_report.py http://localhost:8081/
```

---

## 7. GIẢI THÍCH CÁC MỤC TRONG BÁO CÁO / TRACE

- **Finding**: loại lỗ hổng, mức độ, URL, bằng chứng (request/response), khuyến nghị. Mọi kết luận do **oracle tất định** đưa ra dựa trên bằng chứng, không do AI đoán → báo động giả rất thấp.
- **ReActFeedback — "Bỏ qua / Executed 0 bounded refinement probes"**: vòng phản hồi thứ hai chỉ chạy thêm probe cho kịch bản **chưa** kết luận ở lượt đầu. Trên Juice Shop lượt đầu đã đủ nên bỏ qua (0 probe) — là cơ chế tiết kiệm, **không phải lỗi**.
- **Planning (AI / FALLBACK)**: có khóa DeepSeek thì AI chọn kế hoạch; không có thì dùng kế hoạch mặc định. Cả hai đều đúng vì phần kết luận nằm ở oracle.

---

## 8. CÂU HỎI THẦY CÔ HAY HỎI & CÁCH TRẢ LỜI

### 8.1. Demo & vận hành
- **"Bằng chứng này đâu ra?"** → Chạy `demo\demo_bangchung_sqli.py`, dữ liệu thật hiện ra khớp ảnh trong luận văn; có thể dán URL vào trình duyệt cho xem JSON thật.
- **"Hệ thống tự làm hay em làm tay?"** → Quét qua giao diện (:8000), hệ thống tự crawl, tự tấn công, tự kết luận và tự sinh báo cáo; cho xem log thời gian thực ở giao diện và terminal.
- **"Sao chỗ này 0 probe / Bỏ qua?"** → Vòng phản hồi ReAct thứ hai chỉ tinh chỉnh kịch bản **chưa** kết luận; lượt đầu đã đủ nên bỏ qua — cơ chế tiết kiệm, không phải lỗi (xem Mục 7).
- **"Môi trường nào cần đăng nhập?"** → WebGoat bắt buộc; Juice Shop tùy chọn (login để có thêm BOLA); Bookstore không cần.

### 8.2. Phương pháp & kiến trúc
- **"Đây là kiểm thử hộp đen hay hộp trắng?"** → **Hộp đen (DAST)**: chỉ tương tác qua HTTP như kẻ tấn công bên ngoài, không đọc mã nguồn mục tiêu. Kết luận dựa trên phản hồi máy chủ quan sát được.
- **"Pipeline gồm những giai đoạn nào?"** → 5 giai đoạn đa tác tử theo ReAct: **Recon → Planning → Attack → Verification → Reporting**, kèm SessionManager, LongTermMemory và 1 lượt tinh chỉnh (refine) có giới hạn.
- **"Hệ thống có mấy công cụ (tool)?"** → **Đúng 5 tool**: reconnaissance, http_request, probe_and_verify, run_security_checks, generate_report.
- **"Scope Guard là gì?"** → Bộ chặn phạm vi: chỉ cho quét localhost/loopback/IP nội bộ hoặc host trong allowlist (`ALLOWED_TARGET_HOSTS`); mọi request/redirect ra ngoài origin đều bị chặn → đảm bảo chỉ kiểm thử mục tiêu được phép.
- **"Hệ thống có phá hoại dữ liệu không?"** → Không. Payload **không phá hoại** (ví dụ chỉ chèn một dấu nháy đơn, hoặc payload so sánh true/false), không xóa/sửa dữ liệu; chỉ quan sát phản hồi.

### 8.3. Vai trò của AI
- **"AI làm gì trong hệ thống?"** → AI (DeepSeek) lo **trinh sát và lập kế hoạch** chọn kịch bản; phần **KẾT LUẬN** lỗ hổng luôn do **oracle tất định** dựa trên bằng chứng, không do AI đoán.
- **"Có mấy chế độ chạy AI?"** → `deterministic` (pipeline tất định, AI chỉ lập kế hoạch — ổn định; dùng cho **phần đánh giá có đáp án** ở mục 3.4: P/R/F1, FPR trên fixture, TP 4/4 Juice & 5/5 WebGoat), `function_calling` (AI tự gọi từng tool theo ReAct, có DeepSeek; dùng cho **bảng tổng hợp phát hiện theo môi trường** ở mục 3.3.8: Juice 9/11, WebGoat 9, Bookstore 12), và `auto` (có key thì function-calling, lỗi thì lùi về deterministic). Cả hai chế độ **dùng chung một bộ oracle kết luận** nên bằng chứng cho mỗi phát hiện là như nhau.
- **"Nếu pipeline cũng ra kết quả như vậy thì tại sao phải dùng function-calling?"** → (1) Function-calling mới là phần **'AI Agent' đúng đề tài** — AI tự suy luận chọn tool/mục tiêu/payload theo ReAct; pipeline là chuỗi bước người cố định sẵn, bản chất gần một scanner thường. (2) Trên lab đã biết hai chế độ trùng nhau là **điều mong muốn**: chứng minh để AI tự điều phối **vẫn ra đúng ground truth** (nhờ chung bộ oracle), không phá vỡ tính đúng — đây là bằng chứng tin cậy, không phải lý do bỏ AI. (3) Pipeline giữ vai trò **baseline đo định lượng ổn định + phương án dự phòng** (`auto`: không key hoặc LLM lỗi thì lùi về deterministic). Nói thẳng: trong phạm vi đã đo, function-calling **không nhỉnh hơn độ chính xác, còn tốn token và kém ổn định hơn**; giá trị của nó là **tính tự chủ** và khả năng thích ứng với mục tiêu lạ chưa có kịch bản dựng sẵn.
- **"Dùng mô hình AI nào?"** → **deepseek-chat** qua HTTPS, JSON mode, nhiệt độ 0, max_tokens 1600; chế độ deterministic chỉ gọi LLM **1 lần/phiên** (cho bước lập kế hoạch), có phương án dự phòng offline khi không có key.
- **"Nếu AI trả lời sai thì sao?"** → Không ảnh hưởng tính đúng: AI chỉ **chọn kịch bản**; nếu AI chọn thiếu/sai, oracle vẫn không kết luận bừa (không có bằng chứng thì không ghi nhận). Khi không có key, kế hoạch dự phòng vẫn phủ các kịch bản.
- **"ReAct là gì?"** → Vòng lặp Reasoning → Acting → Observation: mô hình suy luận, phát lệnh gọi tool, nhận quan sát (HTTP status/body/headers) rồi lặp lại cho tới khi đủ bằng chứng hoặc hết ngân sách bước.
- **"Bộ nhớ dài hạn để làm gì?"** → Lưu bằng SQLite (`app/memory.py`): số lần quét, loại phát hiện, bề mặt form/endpoint theo host, kỹ thuật đã thành công — truy hồi ở các phiên sau để hỗ trợ lập kế hoạch nhanh hơn.

### 8.4. Độ tin cậy & đánh giá
- **"Làm sao biết không phải báo động giả?"** → Mỗi lỗ hổng chỉ ghi nhận khi có **bằng chứng tất định** từ phản hồi máy chủ (ví dụ sai biệt số bản ghi true/false của SQLi, marker thực thi trong Chromium của XSS, chữ ký `root:...:0:0:` của Path Traversal). Không có bằng chứng thì không kết luận.
- **"Precision/Recall/F1/FPR đo thế nào?"** → Trên bộ fixture có **ground truth** (`/demo` = ca dương, `/demo-safe` = ca âm): đối chiếu theo category + route + parameter. Kết quả: **P = R = F1 = 1.0, FPR = 0** trên fixture.
- **"FPR của Juice Shop/WebGoat là bao nhiêu?"** → **Không khả dụng** cho các lab này vì chưa có tập ca âm (không có mẫu số FP/TN). FPR = 0 chỉ tính trên `/demo-safe` (có ca âm ground truth). Đây là điểm cần nói trung thực.
- **"Thử đăng nhập sai bằng nhiều username khác nhau thì sao khẳng định là không khóa tài khoản?"** → Đúng là phép thử dùng định danh khác nhau mỗi lần và chưa thử lại bằng mật khẩu đúng trên cùng một tài khoản hợp lệ, nên đây là **dấu hiệu heuristic**: hệ thống chỉ kết luận *chưa quan sát thấy cơ chế giới hạn trong lượt thử*, **không** khẳng định chắc chắn thiếu khóa theo từng tài khoản (đúng theo OWASP WSTG-ATHN-03). Giới hạn này đã ghi rõ trong luận văn (mục 3.3.5).
- **"So với OWASP ZAP/Burp thì sao?"** → Có đối chiếu năng lực với ZAP (Mục 3.4.4 luận văn): ZAP baseline chủ yếu ra cảnh báo cấu hình; Sentinel kết luận lỗ hổng theo bằng chứng. Chưa benchmark định lượng đối sánh trực tiếp (ghi trong phần Giới hạn).

### 8.5. Kịch bản & OWASP
- **"Phát hiện được những loại lỗ hổng nào?"** → 11 loại phủ 7/10 nhóm OWASP 2025: SQLi, Reflected/Stored/DOM XSS (A05), BOLA/IDOR + Path Traversal (A01), Security Misconfiguration (A02), Supply Chain (A03), Cryptographic Failures (A04), Authentication Failures (A07), XXE (A05), cộng Open Redirect và CSRF (bổ sung).
- **"BOLA trên Bookstore khác gì Juice Shop?"** → Juice Shop/WebGoat là **BOLA cấp đối tượng** (đọc đối tượng của người khác qua id); Bookstore là **BFLA cấp chức năng** (truy cập endpoint quản trị `/api/admin/*` khi không có quyền). Đã phân biệt trong caption luận văn.
- **"SQLi trên Bookstore sao chỉ mức Trung bình?"** → Đó là oracle **sai biệt trạng thái** (dấu nháy → HTTP 500, input thường → 401) nhưng lỗi CSDL bị ẩn, chưa thấy chữ ký lỗi SQL → gán "nghi ngờ (Potential)" mức Trung bình, tránh thổi phồng.
- **"XSS được xác minh thế nào?"** → Reflected: dùng **Chromium thực thi** — chỉ ghi nhận khi hộp thoại alert mang marker ngẫu nhiên duy nhất được kích hoạt. Stored: đọc lại payload ở một request độc lập sau.

### 8.6. Môi trường & giới hạn
- **"Bookstore tự xây có gì khác?"** → Web do nhóm tự phát triển (Java servlet + PostgreSQL), được bổ sung vài điểm cuối minh họa (`/search`, `/ebook`, `/import`) để hệ thống phát hiện đủ kịch bản bằng **bộ detector tổng quát** (không ghim theo lab). Đây là minh bạch đã ghi trong luận văn.
- **"Hạn chế của hệ thống là gì?"** → (1) Chế độ function-calling dao động theo từng lần chạy và tốn token hơn deterministic; (2) chưa benchmark định lượng với ZAP/Burp; (3) một số lỗ hổng sau rào nghiệp vụ nhiều bước (ví dụ Stored XSS ở phần đánh giá sản phẩm, phải mua → nhận hàng → mở modal) nằm ngoài tầm quét hộp đen tự động, cần phiên có trạng thái hoặc kiểm thử thủ công bổ sung.
- **"Vì sao chỉ quét lab, không quét web thật?"** → Vì đạo đức và pháp lý: chỉ kiểm thử hệ thống thuộc sở hữu hoặc có phép bằng văn bản; Scope Guard thực thi điều này ở mức kỹ thuật.
- **"Hướng phát triển?"** → Thêm chế độ xác nhận chủ động (confirm) có kiểm soát, benchmark định lượng với ZAP/Burp, mở rộng oracle cho các lỗ hổng sau xác thực/nghiệp vụ, hỗ trợ thêm mục tiêu.

---

## 9. TẮT MÔI TRƯỜNG SAU DEMO

- Dừng Sentinel: `Ctrl + C` ở cửa sổ `uvicorn`.
- Dừng Bookstore: `Ctrl + C` ở cửa sổ webapp-runner; rồi `docker stop bstore-pg`.
- Dừng lab Docker: `docker compose stop juice-shop webgoat`.

---

## 10. XỬ LÝ SỰ CỐ

- **"no configuration file provided: not found"**: đang chạy `docker compose` **sai thư mục** (không có `docker-compose.yml`). Phải `cd` về thư mục dự án trước: `cd /d "D:\Tai lieu\ki6\TLCN"` (cmd) hoặc `cd "D:\Tai lieu\ki6\TLCN"` (PowerShell), rồi chạy lại `docker compose up -d juice-shop webgoat`.
- **"failed to connect to the docker API ... daemon is running"**: Docker Desktop chưa chạy. Mở Docker Desktop, đợi "running", chạy lại `docker compose up -d`.
- **Bookstore: `Could not find or load main class .encoding=UTF-8`**: PowerShell tách nhầm tham số. Bọc nháy `java "-Dfile.encoding=UTF-8" -jar ...` (như Mục 1.2) hoặc bỏ hẳn flag đó (Java mới mặc định UTF-8).
- **Quét lỗi 400 / scope**: chưa tick ô **authorized**.
- **WebGoat lỗi "Lab login failed"**: tài khoản chưa tồn tại hoặc sai mật khẩu. Đăng ký lại ở http://localhost:8082/WebGoat/registration (mật khẩu 6-10 ký tự), rồi điền đúng Login URL `http://127.0.0.1:8082/WebGoat/login`.
- **Không mở được :8000**: chưa chạy `uvicorn app.main:app --reload`.
- **Giao diện vẫn là bản cũ**: nhấn **Ctrl + F5** (bỏ cache CSS/JS).
- **Kịch bản XSS không chạy**: chưa cài trình duyệt — `python -m playwright install chromium`.
- **WebGoat trả 000 / chưa lên**: đợi thêm 1-2 phút (Spring Boot khởi động chậm).
- **Bookstore không lên**: kiểm tra `docker start bstore-pg` (cần PostgreSQL cổng 5432) rồi chạy lại webapp-runner.
- **Cổng 8000/8081 bị chiếm ("address already in use")**: tìm tiến trình giữ cổng `netstat -ano | findstr :8000` rồi `taskkill /F /PID <pid>`.

---

## 11. BẢN ĐỒ CODE — HỆ THỐNG CHẠY NHƯ NÀO, TỪNG KỊCH BẢN Ở FILE NÀO

> Dùng khi cô bảo "mở code chỗ này ra xem". Mẹo: trong editor gõ tìm `[TN` để nhảy tới đúng từng kịch bản (các nhãn tiếng Việt đã gắn sẵn trong code).

### 11.1. Luồng chạy tổng quát (chế độ `deterministic` — pipeline tất định; function-calling dùng cùng bộ oracle)

Bấm **Start campaign** ở giao diện → gọi API → chạy pipeline đa tác tử → sinh báo cáo:

| Bước | Việc | File / hàm |
|---|---|---|
| Điểm vào | API nhận yêu cầu quét | `app/main.py` → `@app.post("/api/scans")` `create_scan()` → tạo `PentestAgent` |
| Điều phối | Chạy toàn pipeline | `app/agent.py` → `PentestAgent.run()` / `_run_deterministic()` (có sẵn **BẢN ĐỒ B1–B9** trong comment) |
| B1 Recon | Thu thập trang/endpoint/form | `ReconAgent.run()` → `WebTools.crawl()` (`app/tools.py`) |
| B2 Memory | Truy hồi phiên trước (SQLite) | `app/memory.py` |
| B3 Planning | AI (DeepSeek) chọn kịch bản | `PlanningAgent.run()` (`app/agent.py`), có fallback offline |
| B4 Attack | Dựng payload theo plan | `AttackAgent.run()` (`app/agent.py`) |
| B5 Verify | **ORACLE kết luận** (SQLi/XSS/IDOR) | `VerificationAgent.run()` (`app/agent.py`) |
| B6 Oracle lab | Oracle ghim theo Juice/WebGoat | `check_lab()` (`app/labs.py`) |
| B7 ReAct refine | 1 vòng tinh chỉnh bổ sung | `AttackAgent.refine()` (`app/agent.py`) |
| B8 Standing detectors | Chạy registry các kịch bản | `run_all()` (`app/detectors.py`) → các file `app/scenarios/tn*.py` |
| B9 Report | Dedup + sinh báo cáo tiếng Việt | `ReportingAgent.run()` → `app/report_vi.py` |

- **5 tool**: `app/toolbox.py` (`TOOL_SCHEMAS`): reconnaissance, http_request, probe_and_verify, run_security_checks, generate_report. Chế độ `function_calling` đi qua đây; chế độ `deterministic` dùng **cùng oracle** ở trên.
- **Scope Guard** (chặn phạm vi): `app/scope.py`. **Cấu hình/chế độ AI**: `app/config.py`.

### 11.2. Bản đồ TỪNG KỊCH BẢN (payload ở đâu, oracle kết luận ở đâu)

> Mỗi kịch bản có 1 file "điểm neo" trong `app/scenarios/tn*.py` (docstring tiếng Việt đầy đủ) + (các) hàm oracle thực thi mang nhãn `[TNx]`.

| Mã | Lỗ hổng (OWASP) | File điểm neo | Code oracle thật (payload + cách kết luận) |
|---|---|---|---|
| **TN1** | SQL Injection (A05) | `app/scenarios/tn1_sql_injection.py` | `app/labs.py` khối `[TN1]` — **payload** dấu nháy `'`, cặp `OR 1=1--`/`OR 1=2--` (Juice `/rest/products/search`, WebGoat `attack8`). Đường chủ động: `app/agent.py` `VerificationAgent` (kind `basic_sqli`) qua `app/toolbox.py` `probe_and_verify`. **Kết luận**: chữ ký lỗi SQL/5xx, hoặc true/false đổi số bản ghi. |
| **TN2** | XSS (A05) | `app/scenarios/tn2_xss.py` | Reflected: `app/browser_xss.py` (Chromium **thực thi** marker alert). Stored: `app/stored_xss.py` + `app/labs.py`. DOM Juice: `app/labs.py` khối `[TN2]`. **Payload** `<img src=x onerror=alert(marker)>`. **Kết luận**: alert marker duy nhất chạy, hoặc đọc lại payload ở request độc lập. |
| **TN3** | Broken Access Control (A01) | `app/scenarios/tn3_access_control.py` | BFLA forced-browsing: `app/access_control.py` (`/api/admin/*`). BOLA 2 phiên: `app/agent.py` `VerificationAgent` + `app/labs.py` (Juice/WebGoat). **Kết luận**: endpoint quản trị trả dữ liệu khi không quyền, hoặc đọc được đối tượng của người khác qua id. |
| **TN4** | Thụ động A02/A03/A04 | `app/scenarios/tn4_passive_audit.py` | `app/passive.py` (`passive_findings`) + lab misconfig `app/labs.py` (`lab_misconfig_checks`: `/ftp`, `/actuator/env`). **Không gửi payload** — chỉ đọc header/cookie/version. **Kết luận**: thiếu header bảo mật, thiếu cờ cookie/HSTS, lộ phiên bản, lộ thư mục. |
| **TN7** | Authentication Failures (A07) | `app/scenarios/tn7_auth.py` | `app/auth_checks.py` (`check_authentication`, form chung) + `app/labs.py` (`lab_auth_failure_checks`, Juice/WebGoat). **Payload**: credential mặc định + **10 lần** đăng nhập sai. **Kết luận**: không quan sát thấy cơ chế khóa/giới hạn tần suất trong lượt thử (dấu hiệu heuristic). |
| **TN8** | Open Redirect | `app/scenarios/tn8_open_redirect.py` | `app/open_redirect.py` + `app/labs.py`. **Payload**: URL ngoài vào tham số đích chuyển hướng. **Kết luận**: header `Location` (3xx) trỏ ra domain ngoài. |
| **TN9** | CSRF (nghi ngờ) | `app/scenarios/tn9_csrf.py` | `app/csrf.py`. Heuristic: form POST thiếu token chống CSRF → `Potential CSRF` (severity thấp, ngoài tập chấm điểm). |
| **TN10** | Path Traversal | `app/scenarios/tn10_path_traversal.py` | `app/path_traversal.py` + `app/labs.py`. **Payload**: chuỗi `../` (Juice `/ftp` + null-byte). **Kết luận**: lộ chữ ký `/etc/passwd` hoặc đọc được tệp ngoài thư mục. |
| **TN11** | XXE | `app/scenarios/tn11_xxe.py` | `app/xxe.py` + `app/labs.py`. **Payload**: tài liệu XML khai báo external entity trỏ `/etc/passwd` (Juice `/file-upload`, WebGoat `/xxe/simple`). **Kết luận**: phản hồi lộ nội dung tệp. |

> Lưu ý: tên file `tn*.py` là **mã kịch bản trong code** (theo OWASP), có thể KHÁC số "Thực nghiệm" trong luận văn (vd luận văn "Thực nghiệm 5 = Authentication Failures" ứng với code `tn7_auth.py`). Khi show code cứ bám theo **tên lỗ hổng**, không bám theo con số.

### 11.3. THỨ TỰ GỌI của từng kịch bản (đầu tiên gọi file nào → rồi file nào)

> Dùng khi cô hỏi "lúc chạy nó đi qua những đâu". **Xương sống chung** (bước 1–4) giống nhau cho mọi kịch bản; chỗ khác nhau là từ bước 5.

**Xương sống chung (mọi kịch bản):**
```
1. app/main.py   create_scan()                 (nhận request, tạo PentestAgent)
2. app/agent.py  PentestAgent._run_deterministic()   (điều phối)
3. app/agent.py  ReconAgent.run() → app/tools.py WebTools.crawl()   (thu thập trang/endpoint/form)
4. app/agent.py  PlanningAgent.run()            (AI chọn plan)
   ... (tới đây rẽ theo từng kịch bản) ...
cuối. app/agent.py ReportingAgent.run() → app/report_vi.py   (sinh báo cáo)
```

**TN1 — SQL Injection** (đường CHỦ ĐỘNG):
```
5. app/agent.py AttackAgent.run()         (bơm payload: dấu nháy ')
6. app/agent.py VerificationAgent.run()   (oracle: chữ ký lỗi SQL / 5xx)
7. app/labs.py  check_lab() khối [TN1]    (oracle lab: cặp OR 1=1-- / OR 1=2--, đếm sản phẩm)
   (function_calling: bước 5-6 qua app/toolbox.py probe_and_verify)
```

**TN2 — XSS** (chạy ở 2 chỗ):
```
5. app/agent.py AttackAgent.run() + VerificationAgent.run()   (reflected/stored HTML tĩnh)
6. app/labs.py  check_lab() khối [TN2]                        (DOM XSS Juice qua Chromium)
7. app/detectors.py run_all() → app/scenarios/tn2_xss.py → app/browser_xss.py browser_reflected_xss()  (Chromium THỰC THI marker) ; stored → app/stored_xss.py
```

**TN3 — Broken Access Control:**
```
5. (nếu có phiên so sánh) app/agent.py VerificationAgent.run()  (BOLA/IDOR) + app/labs.py check_lab() khối [TN3]
6. app/detectors.py run_all() → app/scenarios/tn3_access_control.py → app/access_control.py check_access_control()   (BFLA forced-browsing /api/admin/*)
```

**TN4 — Thụ động A02/A03/A04** (không có bước Attack, chỉ đọc phản hồi):
```
5. app/detectors.py run_all() → app/scenarios/tn4_passive_audit.py
     → app/passive.py passive_findings()        (A02 header / A03 version / A04 cookie-HSTS)
     → app/labs.py lab_misconfig_checks()        (lộ /ftp, /actuator/env)
```

**TN7 — Authentication Failures:**
```
5. app/detectors.py run_all() → app/scenarios/tn7_auth.py
     → app/auth_checks.py check_authentication()   (form chung: credential mặc định + 10 lần sai)
     → app/labs.py lab_auth_failure_checks()        (Juice/WebGoat)
```

**TN8 — Open Redirect:**
```
5. app/detectors.py run_all() → app/scenarios/tn8_open_redirect.py
     → app/open_redirect.py check_open_redirect()  (soi header Location 3xx) + app/labs.py lab_open_redirect_checks()
```

**TN9 — CSRF:**
```
5. app/detectors.py run_all() → app/scenarios/tn9_csrf.py → app/csrf.py check_csrf()   (form POST thiếu token → Potential CSRF)
```

**TN10 — Path Traversal:**
```
5. app/detectors.py run_all() → app/scenarios/tn10_path_traversal.py
     → app/path_traversal.py check_path_traversal()  (chữ ký /etc/passwd) + app/labs.py lab_path_traversal_checks()  (Juice /ftp null-byte)
```

**TN11 — XXE:**
```
5. app/detectors.py run_all() → app/scenarios/tn11_xxe.py
     → app/xxe.py check_xxe()  (external entity → /etc/passwd) + app/labs.py lab_xxe_checks()  (Juice /file-upload, WebGoat /xxe/simple)
```

> Tóm tắt: **TN1 (SQLi)** đi đường chủ động `AttackAgent → VerificationAgent → check_lab`. **TN2, TN3** chạy cả đường chủ động lẫn standing detector. **TN4, TN7, TN8, TN9, TN10, TN11** chạy ở bước **standing detectors** (`detectors.py run_all → scenarios/tn*.py → module oracle`). Tất cả cùng kết thúc ở `ReportingAgent → report_vi.py`.
