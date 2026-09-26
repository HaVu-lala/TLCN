from typing import Any, Literal

from pydantic import BaseModel, Field, HttpUrl


class ScanRequest(BaseModel):
    target_url: HttpUrl
    authorized: bool = Field(description="Explicit confirmation that the target is an authorized lab")
    session_headers: dict[str, str] = Field(default_factory=dict, description="Optional lab session headers, such as Cookie or Authorization")


class Finding(BaseModel):
    category: str
    severity: Literal["info", "low", "medium", "high"]
    url: str
    parameter: str | None = None
    evidence: str
    recommendation: str


class AgentTrace(BaseModel):
    agent: str
    status: Literal["completed", "skipped", "fallback"]
    detail: str


class ScanResult(BaseModel):
    scan_id: str
    target_url: str
    pages: list[dict[str, Any]]
    findings: list[Finding]
    agent_summary: str
    used_deepseek: bool
    duration_ms: float
    evaluation: dict[str, Any]
    agent_trace: list[AgentTrace] = Field(default_factory=list)
    llm_usage: dict[str, int] = Field(default_factory=dict)
    llm_calls: int = 0
    llm_latency_ms: float = 0.0
    llm_cost_usd: float | None = None
