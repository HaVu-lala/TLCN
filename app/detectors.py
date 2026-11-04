"""Registry of standing security detectors.

This is the single extension point behind Tool 4 (run_security_checks) and the
deterministic pipeline's standing-check phase. Adding a new OWASP check is a
one-line @register inside the matching app/scenarios/tnN_*.py module; no tool,
schema, prompt or orchestration change is needed, and both the function-calling
and deterministic modes pick it up at once.

Mỗi detector được định nghĩa trong MỘT file kịch bản (app/scenarios/tn1..tn7),
để cấu trúc mã khớp 1-1 với 7 kịch bản thực nghiệm của báo cáo. File này chỉ giữ
hạ tầng registry; việc đăng ký diễn ra khi import gói app.scenarios ở cuối file.

Every detector keeps its own evidence-based oracle and is isolated in try/except,
so registering one can neither raise another's false-positive rate nor abort the
battery if it errors on an unusual target.
"""
from dataclasses import dataclass
from typing import Callable

from app.schemas import Finding


@dataclass
class DetectorContext:
    """Everything a standing detector may need, passed uniformly."""
    tools: object
    pages: list[dict]
    comparison_tools: object | None = None


Detector = Callable[["DetectorContext"], list[Finding]]
STANDING_DETECTORS: list[tuple[str, Detector]] = []


def register(name: str) -> Callable[[Detector], Detector]:
    """Register a standing detector under a human-readable name.

    Được gọi bằng decorator @register("...") bên trong từng file kịch bản.
    """
    def decorator(fn: Detector) -> Detector:
        STANDING_DETECTORS.append((name, fn))
        return fn
    return decorator


def run_all(ctx: DetectorContext) -> list[Finding]:
    """Run every registered standing detector; a failure in one is skipped."""
    findings: list[Finding] = []
    for _name, detector in STANDING_DETECTORS:
        try:
            findings.extend(detector(ctx) or [])
        except Exception:  # noqa: BLE001 - one detector must not abort the battery
            continue
    return findings


# Import các file kịch bản để kích hoạt việc đăng ký detector vào STANDING_DETECTORS.
# Đặt ở cuối file để register/DetectorContext đã sẵn sàng khi scenarios import ngược lại.
from app import scenarios  # noqa: E402,F401
