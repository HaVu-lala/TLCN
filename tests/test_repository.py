from app.repository import ScanRepository
from app.schemas import ScanResult


def test_repository_round_trip(tmp_path):
    repository = ScanRepository(str(tmp_path / "scans.sqlite3"))
    result = ScanResult(
        scan_id="scan-1",
        target_url="http://localhost/demo",
        pages=[],
        findings=[],
        agent_summary="done",
        used_deepseek=False,
        duration_ms=12.3,
        evaluation={"ground_truth_available": False},
    )

    repository.save(result)

    assert repository.get("scan-1") == result
    assert repository.list()[0].scan_id == "scan-1"
