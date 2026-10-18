"""Báo cáo tiếng Việt, chuyên nghiệp, dạng bảng — dễ hiểu cho cả người ngoài ngành.

Mỗi phát hiện được giải thích bằng ngôn ngữ thường (là gì / nguy hiểm ra sao /
nên làm gì), kèm bảng chi tiết kỹ thuật và ánh xạ OWASP Top 10:2025.
"""
from datetime import datetime
from html import escape

SEVERITY_VI = {
    "high": ("Cao", "#d93025", 3),
    "medium": ("Trung bình", "#e8710a", 2),
    "low": ("Thấp", "#f2a600", 1),
    "info": ("Thông tin", "#5f6368", 0),
}

OWASP_VI = {
    "Reflected XSS": "A05:2025 – Injection",
    "Stored XSS": "A05:2025 – Injection",
    "DOM XSS": "A05:2025 – Injection",
    "SQL Injection": "A05:2025 – Injection",
    "Potential SQL Injection": "A05:2025 – Injection",
    "Potential BOLA/IDOR": "A01:2025 – Broken Access Control",
    "Security Misconfiguration": "A02:2025 – Security Misconfiguration",
    "Potential Sensitive Configuration Exposure": "A02:2025 – Security Misconfiguration",
    "Software Supply Chain Exposure": "A03:2025 – Software Supply Chain",
    "Cryptographic Failures": "A04:2025 – Cryptographic Failures",
    "Authentication Failures": "A07:2025 – Authentication Failures",
}

# (Tên dễ hiểu, Mô tả đời thường, Ảnh hưởng/nguy cơ)
CATEGORY_VI = {
    "Reflected XSS": ("Chèn mã độc phản chiếu (Reflected XSS)",
        "Kẻ tấn công nhét đoạn mã vào ô tìm kiếm hoặc đường dẫn; khi nạn nhân mở liên kết đó, mã chạy ngay trong trình duyệt của họ.",
        "Đánh cắp phiên đăng nhập, mạo danh người dùng, lừa thao tác trên tài khoản nạn nhân."),
    "Stored XSS": ("Mã độc được lưu trên hệ thống (Stored XSS)",
        "Kẻ tấn công lưu đoạn mã độc vào website (bình luận, đánh giá sản phẩm). Mã tự chạy mỗi khi có người khác xem.",
        "Ảnh hưởng mọi người xem nội dung đó, kể cả quản trị viên; có thể chiếm tài khoản hàng loạt."),
    "DOM XSS": ("Mã độc chạy trên trình duyệt (DOM XSS)",
        "Trang web xử lý dữ liệu nhập ngay trong trình duyệt mà không làm sạch, khiến mã của kẻ tấn công được thực thi.",
        "Đánh cắp thông tin phiên, chuyển hướng hoặc thao túng giao diện người dùng."),
    "SQL Injection": ("Tấn công cơ sở dữ liệu (SQL Injection)",
        "Kẻ tấn công nhập chuỗi đặc biệt vào ô dữ liệu để lừa cơ sở dữ liệu chạy lệnh của chúng.",
        "Đọc, sửa, xóa dữ liệu hoặc vượt qua đăng nhập — một trong những lỗ hổng nguy hiểm nhất."),
    "Potential SQL Injection": ("Nghi ngờ tấn công cơ sở dữ liệu (SQL Injection)",
        "Hệ thống phản hồi bất thường với dữ liệu đặc biệt — dấu hiệu có thể can thiệp vào câu truy vấn cơ sở dữ liệu.",
        "Nếu khai thác được: đọc/sửa/xóa dữ liệu hoặc vượt đăng nhập."),
    "Potential BOLA/IDOR": ("Xem trộm dữ liệu người khác (IDOR)",
        "Chỉ cần đổi mã số trên đường dẫn (ví dụ id=1 thành id=2), người dùng xem được dữ liệu của người khác vì hệ thống không kiểm tra quyền sở hữu.",
        "Lộ thông tin cá nhân, đơn hàng, giỏ hàng… của người dùng khác."),
    "Security Misconfiguration": ("Cấu hình bảo mật thiếu an toàn",
        "Hệ thống thiếu thiết lập bảo vệ cần thiết (thiếu lớp phòng vệ của trình duyệt, hoặc để lộ thư mục/cấu hình nội bộ).",
        "Giúp kẻ tấn công dò tìm và khai thác dễ dàng hơn."),
    "Potential Sensitive Configuration Exposure": ("Lộ cấu hình nhạy cảm",
        "Một endpoint quản trị trả về thông tin cấu hình mà không yêu cầu đăng nhập.",
        "Lộ thông tin nội bộ phục vụ cho các bước tấn công sâu hơn."),
    "Software Supply Chain Exposure": ("Lộ phiên bản thành phần phần mềm",
        "Hệ thống để lộ tên và phiên bản các thành phần đang dùng.",
        "Kẻ tấn công tra cứu lỗ hổng đã biết của đúng phiên bản để tấn công."),
    "Cryptographic Failures": ("Bảo vệ dữ liệu/kết nối yếu",
        "Cookie phiên hoặc kết nối không được bảo vệ đúng cách (thiếu cờ an toàn, không mã hóa bắt buộc).",
        "Dữ liệu dễ bị nghe lén hoặc đánh cắp khi truyền trên mạng."),
    "Authentication Failures": ("Cơ chế đăng nhập yếu",
        "Chức năng đăng nhập thiếu biện pháp bảo vệ (không khóa tài khoản khi dò mật khẩu, hoặc chấp nhận mật khẩu mặc định).",
        "Tài khoản dễ bị dò mật khẩu và chiếm đoạt."),
}

DEFAULT = ("Vấn đề an toàn thông tin", "Phát hiện một điểm yếu an toàn thông tin.", "Cần được xem xét và khắc phục.")


def _sev(finding):
    return SEVERITY_VI.get(finding.severity, ("Khác", "#5f6368", 0))


def render_vietnamese_report(result) -> str:
    findings = sorted(result.findings, key=lambda f: _sev(f)[2], reverse=True)
    total = len(findings)
    counts = {k: 0 for k in SEVERITY_VI}
    for f in findings:
        counts[f.severity] = counts.get(f.severity, 0) + 1
    now = datetime.now().strftime("%d/%m/%Y %H:%M")

    # Bảng thống kê mức độ
    stat_rows = "".join(
        f"<tr><td><span class='dot' style='background:{color}'></span>{label}</td>"
        f"<td style='text-align:center'>{counts.get(key,0)}</td></tr>"
        for key, (label, color, _) in sorted(SEVERITY_VI.items(), key=lambda x: x[1][2], reverse=True)
    )

    # Bảng tổng hợp
    summary_rows = []
    for i, f in enumerate(findings, 1):
        label, color, _ = _sev(f)
        title = CATEGORY_VI.get(f.category, DEFAULT)[0]
        owasp = OWASP_VI.get(f.category, "—")
        summary_rows.append(
            f"<tr><td style='text-align:center'>{i}</td><td>{escape(title)}</td>"
            f"<td><span class='badge' style='background:{color}'>{label}</span></td>"
            f"<td>{escape(owasp)}</td><td class='mono'>{escape(f.url)}</td></tr>")
    summary_table = "".join(summary_rows) or "<tr><td colspan='5'>Không có phát hiện.</td></tr>"

    # Chi tiết
    details = []
    for i, f in enumerate(findings, 1):
        label, color, _ = _sev(f)
        title, what, risk = CATEGORY_VI.get(f.category, DEFAULT)
        owasp = OWASP_VI.get(f.category, "—")
        details.append(f"""
        <div class='finding'>
          <h3>{i}. {escape(title)} <span class='badge' style='background:{color}'>{label}</span></h3>
          <table class='kv'>
            <tr><th>Phân loại OWASP 2025</th><td>{escape(owasp)}</td></tr>
            <tr><th>Mức độ nghiêm trọng</th><td>{label}</td></tr>
            <tr><th>Vị trí (URL)</th><td class='mono'>{escape(f.url)}</td></tr>
            <tr><th>Tham số</th><td class='mono'>{escape(f.parameter or '(toàn trang)')}</td></tr>
            <tr><th>Lỗ hổng này là gì?</th><td>{escape(what)}</td></tr>
            <tr><th>Vì sao nguy hiểm?</th><td>{escape(risk)}</td></tr>
            <tr><th>Bằng chứng kỹ thuật</th><td>{escape(f.evidence)}</td></tr>
            <tr><th>Khuyến nghị khắc phục</th><td>{escape(f.recommendation)}</td></tr>
          </table>
        </div>""")
    details_html = "".join(details) or "<p>Không phát hiện lỗ hổng nào trong phạm vi kiểm thử.</p>"

    high, med = counts.get("high", 0), counts.get("medium", 0)
    verdict = ("hệ thống tồn tại lỗ hổng NGHIÊM TRỌNG cần xử lý ngay." if high else
               "hệ thống tồn tại lỗ hổng mức trung bình cần khắc phục." if med else
               "chưa phát hiện lỗ hổng nghiêm trọng trong phạm vi kiểm thử." if total else
               "không phát hiện lỗ hổng trong phạm vi kiểm thử.")

    return f"""<!doctype html><html lang='vi'><head><meta charset='utf-8'>
    <meta name='viewport' content='width=device-width, initial-scale=1'>
    <title>Báo cáo kiểm thử an toàn — {escape(result.scan_id)}</title>
    <style>
      html{{color-scheme:light}}
      *{{box-sizing:border-box}}
      body{{font:15px/1.6 -apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:960px;margin:0 auto;padding:28px 20px;color:#1a1a1a;background:#ffffff}}
      header.cover{{border-bottom:3px solid #0b5;padding-bottom:16px;margin-bottom:8px}}
      header.cover h1{{color:#0b5;font-size:26px;margin:0 0 6px}}
      .meta{{color:#444a50;font-size:14px}}
      .meta b{{color:#1a1a1a}}
      h2{{font-size:20px;border-left:4px solid #0b5;padding-left:10px;margin-top:34px}}
      h3{{font-size:18px;margin:0 0 10px}}
      table{{border-collapse:collapse;width:100%;margin:12px 0;font-size:14px}}
      th,td{{border:1px solid #d8dee4;padding:9px 11px;text-align:left;vertical-align:top}}
      thead th{{background:#0b5;color:#fff;font-weight:600}}
      tbody tr:nth-child(even){{background:#f6f8fa}}
      table.kv th{{background:#f0f3f6;width:210px;white-space:nowrap}}
      table.stat{{max-width:360px}}
      .badge{{color:#fff;padding:2px 10px;border-radius:20px;font-size:12px;white-space:nowrap}}
      .dot{{display:inline-block;width:11px;height:11px;border-radius:50%;margin-right:8px;vertical-align:middle}}
      .mono{{font-family:Consolas,monospace;font-size:13px;word-break:break-all}}
      .verdict{{background:#fff4e5;border:1px solid #ffd8a8;border-radius:10px;padding:12px 16px;margin:14px 0}}
      .finding{{border:1px solid #e1e4e8;border-radius:12px;padding:16px 18px;margin:16px 0;page-break-inside:avoid}}
      footer{{color:#6a6f78;font-size:13px;margin-top:30px;border-top:1px solid #eee;padding-top:12px}}
      @media print{{body{{max-width:none}}.finding{{border-color:#ccc}}}}
    </style></head>
    <body>
      <header class='cover'>
        <h1>BÁO CÁO KIỂM THỬ XÂM NHẬP ỨNG DỤNG WEB</h1>
        <div class='meta'>
          <div><b>Hệ thống mục tiêu:</b> {escape(result.target_url)}</div>
          <div><b>Ngày lập báo cáo:</b> {now}</div>
          <div><b>Thời gian quét:</b> {result.duration_ms:.0f} mili-giây · <b>Mã phiên:</b> {escape(result.scan_id)}</div>
          <div><b>Thực hiện bởi:</b> Hệ thống AI Pentest Agent (Sentinel)</div>
        </div>
      </header>

      <h2>1. Tóm tắt</h2>
      <div class='verdict'>Qua kiểm thử tự động, {verdict} Tổng cộng phát hiện <b>{total}</b> vấn đề an toàn thông tin
      ({counts.get('high',0)} mức Cao, {counts.get('medium',0)} mức Trung bình, {counts.get('low',0)} mức Thấp).</div>
      <table class='stat'>
        <thead><tr><th>Mức độ nghiêm trọng</th><th style='text-align:center'>Số lượng</th></tr></thead>
        <tbody>{stat_rows}</tbody>
      </table>

      <h2>2. Bảng tổng hợp phát hiện</h2>
      <table>
        <thead><tr><th>STT</th><th>Lỗ hổng</th><th>Mức độ</th><th>Phân loại OWASP 2025</th><th>Vị trí</th></tr></thead>
        <tbody>{summary_table}</tbody>
      </table>

      <h2>3. Chi tiết từng lỗ hổng</h2>
      {details_html}

      <h2>4. Phạm vi và phương pháp</h2>
      <p>Báo cáo được tạo tự động bằng hệ thống AI Pentest Agent theo mô hình ReAct (suy luận – hành động),
      kiểm thử theo phương pháp hộp đen trên hệ thống <b>được cấp phép</b> trong môi trường phòng lab.
      Mỗi lỗ hổng chỉ được ghi nhận khi có bằng chứng xác thực từ phản hồi thực tế của máy chủ
      (không dựa trên phán đoán). Kết quả phản ánh trạng thái tại thời điểm quét.</p>

      <footer>Báo cáo tạo tự động — Hệ thống kiểm thử xâm nhập ứng dụng web có sử dụng AI Agent.
      Chỉ sử dụng cho mục đích kiểm thử hợp pháp. Mã phiên quét: {escape(result.scan_id)}.</footer>
    </body></html>"""


def render_history_vi(scans, href_template: str = "/api/scans/{sid}/report.vi.html") -> str:
    """Trang lịch sử tiếng Việt: bảng liệt kê mọi lần quét kèm link mở báo cáo."""
    rows = []
    for index, s in enumerate(scans, 1):
        counts = {"high": 0, "medium": 0, "low": 0, "info": 0}
        for f in s.findings:
            counts[f.severity] = counts.get(f.severity, 0) + 1
        href = href_template.format(sid=s.scan_id)
        rows.append(
            f"<tr><td style='text-align:center'>{index}</td>"
            f"<td class='mono'>{escape(s.target_url)}</td>"
            f"<td style='text-align:center'><b>{len(s.findings)}</b></td>"
            f"<td style='text-align:center;color:#d93025'>{counts.get('high',0)}</td>"
            f"<td style='text-align:center;color:#e8710a'>{counts.get('medium',0)}</td>"
            f"<td style='text-align:center;color:#8a6d00'>{counts.get('low',0)}</td>"
            f"<td style='text-align:center'>{s.duration_ms:.0f}</td>"
            f"<td class='mono' style='font-size:12px'>{escape(s.scan_id)}</td>"
            f"<td><a href='{escape(href)}'>Xem báo cáo</a></td></tr>")
    body_rows = "".join(rows) or "<tr><td colspan='9'>Chưa có lần quét nào.</td></tr>"
    return f"""<!doctype html><html lang='vi'><head><meta charset='utf-8'>
    <meta name='viewport' content='width=device-width, initial-scale=1'>
    <title>Lịch sử kiểm thử an toàn</title>
    <style>
      html{{color-scheme:light}}
      body{{font:15px/1.6 -apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:1040px;margin:0 auto;padding:28px 20px;color:#1a1a1a;background:#fff}}
      h1{{color:#0b5;font-size:24px}}
      p.sub{{color:#444a50}}
      table{{border-collapse:collapse;width:100%;margin-top:16px;font-size:14px}}
      th,td{{border:1px solid #d8dee4;padding:8px 10px;text-align:left}}
      thead th{{background:#0b5;color:#fff}}
      tbody tr:nth-child(even){{background:#f6f8fa}}
      .mono{{font-family:Consolas,monospace;word-break:break-all}}
      a{{color:#0a66c2;font-weight:600;text-decoration:none}}
      a:hover{{text-decoration:underline}}
    </style></head><body>
      <h1>Lịch sử kiểm thử an toàn ứng dụng web</h1>
      <p class='sub'>Tổng cộng <b>{len(scans)}</b> lần quét đã lưu. Nhấn “Xem báo cáo” để mở báo cáo tiếng Việt của từng lần.</p>
      <table>
        <thead><tr><th>STT</th><th>Mục tiêu</th><th>Tổng lỗ</th><th>Cao</th><th>TB</th><th>Thấp</th><th>Thời gian (ms)</th><th>Mã phiên</th><th>Báo cáo</th></tr></thead>
        <tbody>{body_rows}</tbody>
      </table>
    </body></html>"""
