# Bản thử tìm đường, Shift và săn boss 2.6.2

Đây là bản sao độc lập; tiện ích đang cài ở D:\Tools\game-tools-extension chưa bị ghi đè.

## Chạy thử

Trong PowerShell tại thư mục này:

    node run.cjs

Một cửa sổ trình duyệt riêng sẽ mở. Runner dùng Chromium của Playwright nếu đã có, nếu không thì dùng Chrome đã cài. Mã tiện ích được nạp vào đầu trang game, không cần cài thêm tiện ích vào hồ sơ đang chơi. Đăng nhập thủ công, vào ngoại giới, di chuyển nhân vật một bước rồi mở **Đi tới map** và chọn đích. Nhấn **Dừng** để ngừng. Hồ sơ đăng nhập thử nghiệm nằm trong thư mục `profile` tại đây; không chia sẻ thư mục đó.

Không đóng hoặc đổi hồ sơ Chrome đang chơi. Runner không bỏ qua lỗi chứng chỉ HTTPS. Nếu gặp cảnh báo chứng chỉ, dừng để kiểm tra địa chỉ máy chủ.

## Những gì đã sửa

- Trang thật không có MEONO_VIEW và chặn sự kiện giả lập: báo rõ khi chạy Chrome thường; dùng trình chạy riêng cho thao tác tự động.
- Giữ phím, hàng đợi thao tác độc lập theo từng tab; hàng đợi tiếp tục sau lỗi; nhả phím khi chuyển cảnh hoặc dừng runner.
- Dừng phiên cũ khi đổi đích; xử lý lỗi bất đồng bộ; chờ vị trí tối đa 5 giây, mỗi lần thử cổng tối đa 45 giây.
- Không đoán tọa độ chuột từ tâm màn hình khi thiếu camera/zoom. Dùng hướng phím và cơ chế thoát kẹt trong trường hợp đó.
- Không dựng lại danh sách map khi dữ liệu không đổi hoặc bảng bị đóng; tìm đường dùng hàng đợi với chỉ số và truy vết thay vì sao chép tuyến liên tục.
- Đường đi không qua map khóa, map thiếu hoặc cổng sai hướng.

## Kiểm tra

    node build.cjs
    node --check game-tools.js
    node test.cjs

Kiểm thử bằng dữ liệu giả, chưa xác nhận chạy qua cổng trên máy chủ thật. Cần chơi thử và đối chiếu trạng thái hiện trên bảng. Từ bảng điều khiển trình duyệt, `window.__gtTravel.diagnostics()` trả thông tin map, số cổng, vị trí và trạng thái cầu nối; không chứa token đăng nhập.

Runner dùng thư viện Playwright đã cài tại D:\Tools\game-tools-playwright\node_modules và Google Chrome đã cài. Máy khác cần cài thư viện và cập nhật đường dẫn.

## Shift và săn boss đổi khu

Trong **Đánh & Săn boss**, bật **Giữ Shift chạy nhanh** và **Tự đổi khu khi hết boss**, chọn khoảng khu rồi bấm **Quét boss** trước khi **Chạy**. Công cụ bỏ qua khu đầy và mục khu không có; nếu chuyển khu lỗi liên tiếp sẽ tạm dừng. Chỉ bắt đầu săn khi người dùng bấm Chạy, không tự bật lúc tải trang.

Khi tắt chế độ đổi khu, bot quay về cơ chế cũ: farm tại khu nhà chờ boss. Khi bật chế độ đổi khu, bot tiếp tục dò khu thay vì đứng chờ ở khu nhà. Khi đi tới map khác, săn boss tạm dừng và được chạy lại sau khi hành trình kết thúc. Nhấn **Tạm dừng** hoặc **Tắt hẳn** trong bảng săn boss để dừng săn.

Kiểm thử bổ sung: thứ tự đổi khu có quay vòng, khoảng khu chỉ có một khu, dữ liệu khu không hợp lệ và nhận diện boss theo loại/tên. Chưa xác minh chiến đấu hoặc đổi khu thành công trên máy chủ thật.
