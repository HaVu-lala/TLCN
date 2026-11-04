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
java -Dfile.encoding=UTF-8 -jar "d:\Tai lieu\ki6\ATUDWEB\JVA-bookstore\target\dependency\webapp-runner.jar" --port 8081 "d:\Tai lieu\ki6\ATUDWEB\JVA-bookstore\target\ROOT.war"
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
| **Juice Shop** | 3000 | `http://localhost:3000` | Tùy chọn (login để có thêm BOLA) | `http://localhost:3000/rest/user/login` · `demo@juice.lab` / `Demo12345` |
| **WebGoat** | 8082 | `http://127.0.0.1:8082/WebGoat/start.mvc` | **Bắt buộc** | `http://127.0.0.1:8082/WebGoat/login` · `baove2026` / `Sentinel1` |
| **Bookstore** | 8081 | `http://localhost:8081/` | Không cần | — |

Kết quả tham chiếu (quét thật):
- Juice Shop: 9 lỗ hổng (không login) hoặc **11** (có login, thêm BOLA + CSRF).
- WebGoat: **10** lỗ hổng.
- Bookstore: **11** điểm lỗ hổng duy nhất (phủ đủ 7 loại; các payload lặp trên cùng URL và tham số chỉ tính một lần).

> Lưu ý: tài khoản tồn tại trên lab **đang chạy**. Nếu khởi động lại container (Juice/WebGoat) thì dữ liệu reset → phải đăng ký lại.
> - Đăng ký Juice Shop: `POST http://localhost:3000/api/Users` (email, password, passwordRepeat, securityQuestion, securityAnswer).
> - Đăng ký WebGoat: trang http://localhost:8082/WebGoat/registration (mật khẩu **6-10 ký tự**).

---

## 3. DEMO CHÍNH — QUA GIAO DIỆN WEB

1. Mở **http://localhost:8000** (nếu vừa đổi giao diện, nhấn **Ctrl+F5** để nạp bản mới).
2. Nhập **Target URL** (xem bảng Mục 2).
3. Tick ô **authorized** (bắt buộc).
4. Nếu quét **WebGoat**: điền thêm **Login URL + Email/username + Password** (bắt buộc, điền đủ cả 3).
   Nếu quét **Juice Shop** và muốn có BOLA: điền 3 ô đăng nhập của Juice Shop. Không thì để trống.
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

- **"Bằng chứng này đâu ra?"** → Chạy `demo\demo_bangchung_sqli.py`, dữ liệu thật hiện ra khớp ảnh.
- **"Hệ thống tự làm hay em làm tay?"** → Quét qua giao diện (:8000), hệ thống tự sinh báo cáo; chỉ cho xem log thời gian thực ở giao diện và terminal.
- **"AI làm gì trong này?"** → AI (ReAct) lo trinh sát và lập kế hoạch kịch bản; phần KẾT LUẬN lỗ hổng do oracle tất định dựa trên bằng chứng.
- **"Sao chỗ này 0 probe / Bỏ qua?"** → Xem Mục 7: lượt đầu đã đủ, không cần tinh chỉnh thêm.
- **"Bookstore tự xây có gì khác?"** → Web do nhóm tự phát triển, được bổ sung vài điểm cuối dễ bị tấn công để minh họa đủ kịch bản; hệ thống phát hiện bằng bộ detector tổng quát (không ghim theo lab).
- **"Môi trường nào cần đăng nhập?"** → WebGoat bắt buộc; Juice Shop tùy chọn (login để có BOLA); Bookstore không cần.

---

## 9. TẮT MÔI TRƯỜNG SAU DEMO

- Dừng Sentinel: `Ctrl + C` ở cửa sổ `uvicorn`.
- Dừng Bookstore: `Ctrl + C` ở cửa sổ webapp-runner; rồi `docker stop bstore-pg`.
- Dừng lab Docker: `docker compose stop juice-shop webgoat`.

---

## 10. XỬ LÝ SỰ CỐ

- **"failed to connect to the docker API ... daemon is running"**: Docker Desktop chưa chạy. Mở Docker Desktop, đợi "running", chạy lại `docker compose up -d`.
- **Quét lỗi 400 / scope**: chưa tick ô **authorized**.
- **WebGoat lỗi "Lab login failed"**: tài khoản chưa tồn tại hoặc sai mật khẩu. Đăng ký lại ở http://localhost:8082/WebGoat/registration (mật khẩu 6-10 ký tự), rồi điền đúng Login URL `http://127.0.0.1:8082/WebGoat/login`.
- **Không mở được :8000**: chưa chạy `uvicorn app.main:app --reload`.
- **Giao diện vẫn là bản cũ**: nhấn **Ctrl + F5** (bỏ cache CSS/JS).
- **Kịch bản XSS không chạy**: chưa cài trình duyệt — `python -m playwright install chromium`.
- **WebGoat trả 000 / chưa lên**: đợi thêm 1-2 phút (Spring Boot khởi động chậm).
- **Bookstore không lên**: kiểm tra `docker start bstore-pg` (cần PostgreSQL cổng 5432) rồi chạy lại webapp-runner.
- **Cổng 8000/8081 bị chiếm ("address already in use")**: tìm tiến trình giữ cổng `netstat -ano | findstr :8000` rồi `taskkill /F /PID <pid>`.
