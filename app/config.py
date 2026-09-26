from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    deepseek_api_key: str = ""
    deepseek_model: str = "deepseek-chat"
    deepseek_base_url: str = "https://api.deepseek.com"
    allowed_target_hosts: str = "localhost,127.0.0.1"
    max_crawl_pages: int = 8
    request_timeout_seconds: float = 8.0

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @property
    def allowed_hosts(self) -> set[str]:
        return {host.strip().lower() for host in self.allowed_target_hosts.split(",") if host.strip()}


settings = Settings()
