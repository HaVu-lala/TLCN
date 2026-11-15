"""Mô hình dữ liệu (pydantic) dùng chung cho toàn hệ thống.

Đây là "hợp đồng dữ liệu" giữa các thành phần: yêu cầu quét đầu vào
(:class:`ScanRequest`), một lỗ hổng đã xác nhận (:class:`Finding`), một bước trong
nhật ký điều phối (:class:`AgentTrace`) và kết quả quét hoàn chỉnh trả cho giao
diện (:class:`ScanResult`). Các chuỗi ``category``/``severity`` trong Finding được
báo cáo tiếng Việt và phần đánh giá dùng để phân loại, nên giữ nguyên để không vỡ.
"""
from typing import Any, Literal
from urllib.parse import parse_qsl, urlencode, urlsplit

from pydantic import BaseModel, Field, HttpUrl


class LoginRequest(BaseModel):
    """Thông tin đăng nhập hợp pháp (tùy chọn) để tạo phiên quét có xác thực."""
    login_url: HttpUrl
    username: str
    password: str


class ScanRequest(BaseModel):
    """Tham số một yêu cầu quét gửi tới ``POST /api/scans``."""
    target_url: HttpUrl
    authorized: bool = Field(description="Explicit confirmation that the target is an authorized lab")
    session_headers: dict[str, str] = Field(default_factory=dict, description="Optional lab session headers, such as Cookie or Authorization")
    comparison_session_headers: dict[str, str] = Field(default_factory=dict, description="Optional second authorized lab session used for BOLA comparison")
    login: LoginRequest | None = Field(default=None, description="Optional authorized lab login used to create a scan session")


class Finding(BaseModel):
    """Một lỗ hổng đã được oracle xác nhận (không phải phán đoán của AI).

    ``evidence`` là bằng chứng rút ra từ phản hồi thực tế của máy chủ;
    ``recommendation`` là khuyến nghị khắc phục.
    """
    category: str
    severity: Literal["info", "low", "medium", "high"]
    url: str
    parameter: str | None = None
    evidence: str
    recommendation: str


# Thứ hạng mức độ nghiêm trọng, dùng khi khử trùng lặp để giữ bản nặng nhất.
SEVERITY_RANK = {"info": 0, "low": 1, "medium": 2, "high": 3}


def _vulnerability_url(finding: Finding) -> str:
    """URL của lỗ hổng sau khi bỏ tham số đang kiểm (giá trị tham số là payload từng lần).

    Nhờ loại bỏ tham số đã test, hai phát hiện trên cùng một điểm yếu nhưng khác
    giá trị payload sẽ cùng một khóa khi khử trùng lặp.
    """
    parts = urlsplit(finding.url)
    query = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True) if k != finding.parameter]
    return parts._replace(query=urlencode(query)).geturl()


def dedupe_findings(findings: list[Finding]) -> list[Finding]:
    """Gộp mỗi điểm yếu về một phát hiện: ưu tiên mức nặng nhất, rồi bản mới nhất (ghim theo lab)."""
    unique: dict[tuple, Finding] = {}
    for finding in findings:
        key = (finding.category, _vulnerability_url(finding), finding.parameter)
        kept = unique.get(key)
        if kept is None or SEVERITY_RANK[finding.severity] >= SEVERITY_RANK[kept.severity]:
            unique[key] = finding
    return list(unique.values())


class AgentTrace(BaseModel):
    """Một dòng nhật ký điều phối: thành phần nào đã chạy, trạng thái và chi tiết.

    Các trường ``llm_*`` ghi lại việc dùng mô hình ngôn ngữ (số lần gọi, token, độ
    trễ, chi phí) để báo cáo chứng minh "có dùng AI thật".
    """
    agent: str
    status: Literal["completed", "skipped", "fallback"]
    detail: str
    mode: Literal["ai", "fallback", "tool"] = "tool"
    decision: dict[str, Any] = Field(default_factory=dict)
    decision_reason: str = ""
    fallback_reason: str | None = None
    llm_calls: int = 0
    llm_usage: dict[str, int] = Field(default_factory=dict)
    llm_latency_ms: float = 0.0
    llm_cost_usd: float | None = None


class AutonomyReport(BaseModel):
    """Đo mức tự chủ của AI ở chế độ function-calling, TÁCH phần AI tự làm khỏi phần fallback.

    Mục đích thực nghiệm: chứng minh AI điều phối tốt, không phải nhờ lưới an toàn cứu.
    - ``self_sufficient``   : AI tự hoàn tất mọi bước bắt buộc, fallback không phải can thiệp.
    - ``findings_by_model`` : số phát hiện xác nhận TRƯỚC khi fallback chạy (do AI tự điều phối).
    - ``findings_by_fallback``: số phát hiện do fallback bổ sung sau khi AI bỏ bước.
    - ``mandatory_autorun`` : các tool bắt buộc mà AI quên, Python phải chạy hộ.
    - ``tools_invoked_by_model``: các tool AI tự gọi (không trùng lặp).
    """
    self_sufficient: bool = True
    findings_total: int = 0
    findings_by_model: int = 0
    findings_by_fallback: int = 0
    tools_invoked_by_model: list[str] = Field(default_factory=list)
    mandatory_autorun: list[str] = Field(default_factory=list)
    model_steps: int = 0
    model_tool_calls: int = 0


class ScanResult(BaseModel):
    """Kết quả hoàn chỉnh của một phiên quét, lưu lại và trả cho giao diện/báo cáo."""
    scan_id: str
    target_url: str
    pages: list[dict[str, Any]]
    findings: list[Finding]
    agent_summary: str
    used_deepseek: bool
    duration_ms: float
    test_timings_ms: dict[str, float] = Field(default_factory=dict)
    evaluation: dict[str, Any]
    agent_trace: list[AgentTrace] = Field(default_factory=list)
    request_log: list[dict[str, Any]] = Field(default_factory=list)
    llm_usage: dict[str, int] = Field(default_factory=dict)
    llm_calls: int = 0
    llm_latency_ms: float = 0.0
    llm_cost_usd: float | None = None
    autonomy: AutonomyReport | None = None
