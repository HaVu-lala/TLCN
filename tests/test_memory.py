from app.memory import LongTermMemory
from app.schemas import Finding


def _finding(cat, url, param):
    return Finding(category=cat, severity="high", url=url, parameter=param, evidence="e", recommendation="r")


def test_long_term_memory_persists_and_recalls(tmp_path):
    mem = LongTermMemory(str(tmp_path / "ltm.sqlite3"))
    target = "http://127.0.0.1:3000/"
    findings = [
        _finding("SQL Injection", "http://127.0.0.1:3000/rest/products/search", "q"),
        _finding("Potential BOLA/IDOR", "http://127.0.0.1:3000/rest/basket/1", "basketId"),
    ]
    pages = [{"endpoints": [{"url": "http://127.0.0.1:3000/rest/products/search"}],
              "forms": [{"action": "http://127.0.0.1:3000/login"}]}]

    mem.remember(target, findings, pages)
    recalled = mem.recall(target)
    assert recalled["scans_seen"] == 1
    cats = {k["category"] for k in recalled["known_findings"]}
    assert "SQL Injection" in cats and "Potential BOLA/IDOR" in cats
    # kỹ thuật đã thành công được lưu lại
    assert any("SQLi" in k["technique"] for k in recalled["known_findings"])
    # sơ đồ bề mặt tấn công được lưu
    paths = {s["path"] for s in recalled["known_surface"]}
    assert "/rest/products/search" in paths and "/login" in paths


def test_long_term_memory_accumulates_across_sessions(tmp_path):
    mem = LongTermMemory(str(tmp_path / "ltm.sqlite3"))
    target = "http://127.0.0.1:8082/WebGoat"
    f = [_finding("Stored XSS", "http://127.0.0.1:8082/WebGoat/x", "text")]
    mem.remember(target, f, [])
    mem.remember(target, f, [])
    recalled = mem.recall(target)
    assert recalled["scans_seen"] == 2
    xss = next(k for k in recalled["known_findings"] if k["category"] == "Stored XSS")
    assert xss["hits"] == 2  # cùng một phát hiện được củng cố qua các phiên


def test_recall_empty_for_unknown_host(tmp_path):
    mem = LongTermMemory(str(tmp_path / "ltm.sqlite3"))
    recalled = mem.recall("http://127.0.0.1:9999/")
    assert recalled["scans_seen"] == 0
    assert recalled["known_findings"] == []
