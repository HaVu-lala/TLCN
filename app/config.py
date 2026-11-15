"""Cấu hình toàn hệ thống, nạp từ biến môi trường và file .env.

Mọi tham số điều khiển hành vi của Agent (khóa API DeepSeek, chế độ chạy, giới
hạn crawl, bật/tắt trình duyệt, chế độ quét chủ động...) đều tập trung ở đây để
dễ chỉnh và dễ trình bày trong báo cáo. Giá trị mặc định được chọn an toàn: chạy
được ngay cho lab nội bộ, không phá dữ liệu, không cần khóa API.
"""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Tập hợp tham số cấu hình; pydantic tự đọc từ .env và biến môi trường.

    Tên trường (viết thường, gạch dưới) chính là tên biến môi trường tương ứng,
    ví dụ trường ``deepseek_api_key`` đọc từ biến ``DEEPSEEK_API_KEY``.
    """

    # --- Kết nối mô hình ngôn ngữ DeepSeek (dùng cho lập kế hoạch và function-calling) ---
    deepseek_api_key: str = ""                              # Không có khóa -> Agent chạy chế độ tất định
    deepseek_model: str = "deepseek-chat"
    deepseek_base_url: str = "https://api.deepseek.com"

    # Chế độ hoạt động của Agent:
    #   auto             = dùng function-calling khi có khóa API, ngược lại chạy tất định
    #   function_calling = ép dùng AI gọi tool
    #   deterministic    = ép chạy quy trình tất định (không gọi AI)
    agent_mode: str = "auto"
    agent_timeout_seconds: float = 30.0                    # Thời gian chờ tối đa mỗi lần gọi LLM
    agent_max_tokens: int = 1600                           # Giới hạn token sinh ra mỗi lần gọi LLM

    # --- Phạm vi và giới hạn thu thập (Scope Guard + crawler) ---
    allowed_target_hosts: str = "localhost,127.0.0.1"     # Danh sách host hợp lệ, ngăn cách bằng dấu phẩy
    max_crawl_pages: int = 32                             # Số trang tối đa được thu thập mỗi phiên
    request_timeout_seconds: float = 8.0                 # Thời gian chờ tối đa mỗi yêu cầu HTTP

    # --- Thu thập bằng trình duyệt thật (Playwright/Chromium) cho ứng dụng SPA ---
    browser_scan_enabled: bool = True
    browser_timeout_ms: int = 15000

    # Chế độ chủ động/xâm lấn (như "Active scan" của Burp/ZAP): cho phép GHI dữ liệu
    # để bắt Stored XSS hộp đen. Mặc định TẮT để scan thường giữ tính không phá hoại.
    aggressive_scan: bool = False

    # --- Ước tính chi phí gọi LLM (USD trên 1 triệu token); mặc định 0 = không tính ---
    deepseek_input_cost_per_million: float = 0.0
    deepseek_output_cost_per_million: float = 0.0

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @property
    def allowed_hosts(self) -> set[str]:
        """Trả về tập host hợp lệ đã chuẩn hóa (viết thường, bỏ khoảng trắng)."""
        return {host.strip().lower() for host in self.allowed_target_hosts.split(",") if host.strip()}


# Thể hiện cấu hình dùng chung cho toàn bộ ứng dụng.
settings = Settings()
