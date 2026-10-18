"""Repeat authorized Sentinel positive/negative fixtures and export Chapter 3 data."""
import argparse
import csv
import json
import os
from pathlib import Path
import statistics
import subprocess
import sys
import time

import httpx

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from app.evaluation import CATEGORIES, EXTENDED_CATEGORIES, metrics

KINDS = dict(zip(CATEGORIES, ("reflected_xss", "stored_xss", "basic_sqli", "idor")))


def benchmark(api, repeats, output):
    reports, rows, ext_rows = [], [], []
    with httpx.Client(timeout=240) as client:
        for iteration in range(1, repeats + 1):
            for fixture in ("demo", "demo-safe"):
                response = client.post(api + "/api/scans", json={
                    "target_url": api + "/" + fixture, "authorized": True,
                    "session_headers": {"X-Lab-User": "user-1"},
                    "comparison_session_headers": {"X-Lab-User": "user-2"},
                })
                response.raise_for_status()
                report = response.json()
                if not report["evaluation"].get("ground_truth_available"):
                    raise RuntimeError("Target did not identify as a Sentinel benchmark fixture")
                reports.append(report)
                for case in report["evaluation"]["scenarios"]:
                    rows.append({"iteration": iteration, "fixture": fixture, **case,
                                 "test_duration_ms": report.get("test_timings_ms", {}).get(KINDS[case["category"]]),
                                 "scan_duration_ms": report["duration_ms"], "scan_id": report["scan_id"]})
                for case in report["evaluation"].get("extended", {}).get("scenarios", []):
                    ext_rows.append({"iteration": iteration, "fixture": fixture, **case,
                                     "check_duration_ms": report.get("test_timings_ms", {}).get("owasp_extended"),
                                     "scan_duration_ms": report["duration_ms"], "scan_id": report["scan_id"]})
    categories = {}
    for category in CATEGORIES:
        cases = [row for row in rows if row["category"] == category]
        outcomes = [row["outcome"] for row in cases]
        timings = [row["test_duration_ms"] for row in cases if row["test_duration_ms"] is not None]
        categories[category] = {**metrics(*(outcomes.count(k) for k in ("TP", "FP", "FN", "TN"))),
                                "median_test_duration_ms": round(statistics.median(timings), 2) if timings else None}
    counts = [sum(v[name] for v in categories.values()) for name in ("true_positive", "false_positive", "false_negative", "true_negative")]
    unmatched = sum(report["evaluation"].get("unmatched_findings", 0) for report in reports)
    ext_categories = {}
    for category in EXTENDED_CATEGORIES:
        cases = [row for row in ext_rows if row["category"] == category]
        outcomes = [row["outcome"] for row in cases]
        ext_categories[category] = metrics(*(outcomes.count(k) for k in ("TP", "FP", "FN", "TN")))
    ext_timings = [row["check_duration_ms"] for row in ext_rows if row.get("check_duration_ms") is not None]
    ext_overall = metrics(*[sum(v[name] for v in ext_categories.values()) for name in ("true_positive", "false_positive", "false_negative", "true_negative")]) if ext_categories else {}
    summary = {"tool": "Sentinel", "repeats": repeats, "scenario_observations": len(rows),
               "unique_scenarios": 8, "unmatched_findings": unmatched,
               "overall": metrics(*counts), "per_category": categories,
               "extended": {"categories": list(EXTENDED_CATEGORIES), "per_category": ext_categories,
                            "overall": ext_overall,
                            "median_check_ms": round(statistics.median(ext_timings), 2) if ext_timings else None,
                            "note": "OWASP Top 10:2025 A02/A03/A04/A07 scenarios on /demo (positive) and /demo-safe (negative). A02/A03/A04 are passive header/cookie checks; A07 is a bounded login check."},
               "timing_definition": "HTTP probes, verification and bounded refinement per check; excludes recon/planning. Not time to exploitation.",
               "llm_calls": sum(r["llm_calls"] for r in reports),
               "total_tokens": sum(r["llm_usage"].get("total_tokens", 0) for r in reports)}
    output.mkdir(parents=True, exist_ok=True)
    (output / "benchmark.json").write_text(json.dumps({"summary": summary, "rows": rows, "reports": reports}, ensure_ascii=False, indent=2), encoding="utf-8")
    with (output / "benchmark.csv").open("w", encoding="utf-8-sig", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)
    if ext_rows:
        with (output / "benchmark_extended.csv").open("w", encoding="utf-8-sig", newline="") as stream:
            writer = csv.DictWriter(stream, fieldnames=list(ext_rows[0]))
            writer.writeheader()
            writer.writerows(ext_rows)
    lines = ["# Sentinel local fixture benchmark", "", f"{repeats} repetitions, 8 unique scenarios. Repetitions are not independent vulnerability samples.", "",
             "| Category | TP | FP | FN | TN | Precision | Recall | F1 | FPR | Median check ms |",
             "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |"]
    for category, value in categories.items():
        keys = ("true_positive", "false_positive", "false_negative", "true_negative", "precision", "recall", "f1_score", "false_positive_rate", "median_test_duration_ms")
        lines.append("| " + category + " | " + " | ".join(str(value[k]) for k in keys) + " |")
    lines += ["", summary["timing_definition"], "", f"Unmatched claims outside the labeled cases: {unmatched}.",
              "", "SQLi in /demo is an error simulation. Static XSS evidence does not verify browser execution or CSP bypass. BOLA uses two fixed lab identities, not production authentication.",
              "", "These metrics apply only to the eight Sentinel fixture cases, not OWASP Juice Shop/WebGoat or the OWASP Top 10 as a whole."]
    if ext_categories:
        lines += ["", "## OWASP Top 10:2025 extended scenarios", "",
                  f"Positive on /demo, negative on /demo-safe. Median extended-check duration: {summary['extended']['median_check_ms']} ms.", "",
                  "| Category (OWASP 2025) | TP | FP | FN | TN | Precision | Recall | F1 | FPR |",
                  "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |"]
        labels = {"Security Misconfiguration": "A02 Security Misconfiguration",
                  "Software Supply Chain Exposure": "A03 Software Supply Chain",
                  "Cryptographic Failures": "A04 Cryptographic Failures",
                  "Authentication Failures": "A07 Authentication Failures"}
        for category, value in ext_categories.items():
            keys = ("true_positive", "false_positive", "false_negative", "true_negative", "precision", "recall", "f1_score", "false_positive_rate")
            lines.append("| " + labels.get(category, category) + " | " + " | ".join(str(value[k]) for k in keys) + " |")
        lines += ["", summary["extended"]["note"]]
    (output / "benchmark.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api", default="http://127.0.0.1:8765")
    parser.add_argument("--repeats", type=int, default=3)
    parser.add_argument("--output", type=Path, default=ROOT / "data" / "benchmark")
    parser.add_argument("--start-local", action="store_true", help="Start an isolated offline API on loopback port 8765")
    args = parser.parse_args()
    if args.repeats < 1:
        parser.error("--repeats must be positive")
    process = None
    try:
        if args.start_local:
            if args.api != "http://127.0.0.1:8765":
                parser.error("--start-local requires the default loopback API")
            env = {**os.environ, "DEEPSEEK_API_KEY": "", "BROWSER_SCAN_ENABLED": "false"}
            process = subprocess.Popen([sys.executable, "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8765"],
                                       cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                       creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
            for _ in range(60):
                if process.poll() is not None:
                    raise RuntimeError("Local API failed to start; check port 8765 and installed dependencies")
                try:
                    httpx.get(args.api + "/api/health", timeout=1).raise_for_status()
                    break
                except httpx.HTTPError:
                    time.sleep(0.2)
            else:
                raise RuntimeError("Local API startup timed out")
        benchmark(args.api.rstrip("/"), args.repeats, args.output)
    finally:
        if process:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()


if __name__ == "__main__":
    main()
