"""Scenario-level metrics for identified Sentinel fixtures, not arbitrary URLs."""
from urllib.parse import urlparse
import json
from pathlib import Path

MANIFEST = json.loads((Path(__file__).resolve().parents[1] / "docs" / "ground_truth.json").read_text(encoding="utf-8"))

CATEGORIES = ("Reflected XSS", "Stored XSS", "Potential SQL Injection", "Potential BOLA/IDOR")

# OWASP Top 10:2025 categories added on top of the four core injection/access cases.
# Scored separately so they never disturb the core benchmark above.
EXTENDED_CATEGORIES = ("Security Misconfiguration", "Software Supply Chain Exposure",
                       "Cryptographic Failures", "Authentication Failures")


def metrics(tp: int, fp: int, fn: int, tn: int) -> dict:
    precision = tp / (tp + fp) if tp + fp else 0.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    return {
        "true_positive": tp, "false_positive": fp, "false_negative": fn, "true_negative": tn,
        "precision": round(precision, 4), "recall": round(recall, 4),
        "f1_score": round(2 * precision * recall / (precision + recall), 4) if precision + recall else 0.0,
        "fpr_available": bool(fp + tn), "false_positive_rate": round(fp / (fp + tn), 4) if fp + tn else None,
    }


def evaluate_demo(target: str, pages: list[dict], findings: list) -> dict:
    path = urlparse(target).path
    fixture = next((f for f in MANIFEST["fixtures"] if f.get("target_path") == path and f.get("fixture_id") and f.get("ground_truth_available")), None)
    identity = fixture["fixture_id"] if fixture else None
    if not identity or not any(p.get("fixture_id") == identity and p.get("status") == 200 for p in pages):
        return {"ground_truth_available": False, "fpr_available": False}
    positive = bool(fixture["expected_findings"])
    scenarios = []
    matched = set()
    for category in CATEGORIES:
        suffix = "/notes" if category == "Stored XSS" else "/object" if category == "Potential BOLA/IDOR" else ""
        parameter = "note" if suffix == "/notes" else "id" if suffix == "/object" else "q"
        hits = [i for i, f in enumerate(findings) if f.category == category and urlparse(f.url).path == path + suffix and f.parameter == parameter]
        matched.update(hits)
        detected = bool(hits)
        scenarios.append({"category": category, "expected_positive": positive, "detected": detected,
                          "outcome": ("TP" if detected else "FN") if positive else ("FP" if detected else "TN")})
    outcomes = [s["outcome"] for s in scenarios]
    # Only unmatched findings within the four scored categories count as false positives.
    # Findings from other OWASP categories are evaluated separately by evaluate_extended.
    core_indices = {i for i, f in enumerate(findings) if f.category in CATEGORIES}
    unexpected = len(core_indices - matched)
    result = metrics(outcomes.count("TP"), outcomes.count("FP") + unexpected, outcomes.count("FN"), outcomes.count("TN"))
    # Extra findings are unmatched claims; they are not negative test cases for FPR.
    negative_count = outcomes.count("FP") + outcomes.count("TN")
    result["fpr_available"] = bool(negative_count)
    result["false_positive_rate"] = outcomes.count("FP") / negative_count if negative_count else None
    return {**result, "ground_truth_available": True, "fixture_id": identity,
            "manifest_version": MANIFEST["version"], "expected_findings": len(fixture["expected_findings"]), "scenarios": scenarios, "unmatched_findings": unexpected,
            "measurement_unit": "category + route + parameter; duplicate evidence counts once"}


def evaluate_lab(target: str, pages: list[dict], findings: list) -> dict:
    """Scenario-level metrics for pinned Docker labs using explicit route/parameter oracles.

    A scenario is scored as TP when at least one finding matches both its category and its route
    prefix (:parameter). Unmatched findings are reported separately and are never counted as FP,
    because the absence of an oracle on a route is not evidence that the route is safe.
    """
    page_labs = {p.get("lab") for p in pages if p.get("lab")}
    page_fixture_ids = {p.get("fixture_id") for p in pages if p.get("fixture_id")}
    fixture = next(
        (f for f in MANIFEST["fixtures"]
         if f.get("ground_truth_available") and f.get("scenarios")
         and (f.get("fixture_id") in page_fixture_ids or f.get("name") in page_labs)),
        None,
    )
    if not fixture:
        return {"ground_truth_available": False, "fpr_available": False}
    scenarios = []
    matched = set()
    for scenario in fixture["scenarios"]:
        route = scenario["route"].split("{")[0].rstrip("/")
        hits = [i for i, f in enumerate(findings)
                if f.category == scenario["category"]
                and urlparse(f.url).path.rstrip("/").startswith(route)
                and f.parameter == scenario["parameter"]]
        matched.update(hits)
        scenarios.append({"id": scenario["id"], "category": scenario["category"],
                          "expected_positive": True, "detected": bool(hits),
                          "outcome": "TP" if hits else "FN"})
    outcomes = [s["outcome"] for s in scenarios]
    unexpected = len(set(range(len(findings))) - matched)
    result = metrics(outcomes.count("TP"), 0, outcomes.count("FN"), 0)
    # No oracle is defined for non-vulnerable routes on these labs, so FPR stays unavailable.
    result["fpr_available"] = False
    result["false_positive_rate"] = None
    return {**result, "ground_truth_available": True, "fixture_id": fixture.get("fixture_id"),
            "manifest_version": MANIFEST["version"], "expected_findings": len(fixture["scenarios"]),
            "scenarios": scenarios, "unmatched_findings": unexpected,
            "measurement_unit": "category + route prefix + parameter; duplicate evidence counts once",
            "note": "Precision/Recall cover only the pinned, oracle-backed scenarios listed here."}


def evaluate_extended(target: str, pages: list[dict], findings: list) -> dict:
    """Scenario-level metrics for the added OWASP Top 10:2025 categories.

    The /demo fixture is the positive case (every extended category is expected);
    /demo-safe is the negative case (none expected). Matching is by category and
    by the finding URL path falling under the fixture path, since passive findings
    carry no parameter. Kept independent of evaluate_demo so the core benchmark
    is never affected.
    """
    path = urlparse(target).path.rstrip("/") or "/"
    fixture = next((f for f in MANIFEST["fixtures"]
                    if f.get("target_path") == path and f.get("fixture_id")
                    and f.get("ground_truth_available") and f.get("name") in ("demo", "demo-safe")), None)
    identity = fixture["fixture_id"] if fixture else None
    if not identity or not any(p.get("fixture_id") == identity and p.get("status") == 200 for p in pages):
        return {"ground_truth_available": False, "fpr_available": False}
    positive = fixture["name"] == "demo"
    scenarios = []
    matched = set()
    for category in EXTENDED_CATEGORIES:
        hits = [i for i, f in enumerate(findings)
                if f.category == category and (urlparse(f.url).path.rstrip("/") or "/").startswith(path)]
        matched.update(hits)
        detected = bool(hits)
        scenarios.append({"category": category, "expected_positive": positive, "detected": detected,
                          "outcome": ("TP" if detected else "FN") if positive else ("FP" if detected else "TN")})
    outcomes = [s["outcome"] for s in scenarios]
    extended_indices = {i for i, f in enumerate(findings) if f.category in EXTENDED_CATEGORIES}
    unexpected = len(extended_indices - matched)
    result = metrics(outcomes.count("TP"), outcomes.count("FP") + unexpected, outcomes.count("FN"), outcomes.count("TN"))
    negative_count = outcomes.count("FP") + outcomes.count("TN")
    result["fpr_available"] = bool(negative_count)
    result["false_positive_rate"] = outcomes.count("FP") / negative_count if negative_count else None
    return {**result, "ground_truth_available": True, "fixture_id": identity,
            "manifest_version": MANIFEST["version"], "scenarios": scenarios, "unmatched_findings": unexpected,
            "categories": list(EXTENDED_CATEGORIES),
            "measurement_unit": "category + route prefix; duplicate evidence counts once"}
