from pathlib import Path
from time import perf_counter
from urllib.parse import urlparse
from html import escape

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from app.agent import PentestAgent
from app.schemas import ScanRequest, ScanResult
from app.scope import ScopeError, validate_target
from app.repository import ScanRepository

app = FastAPI(title="Sentinel Web Pentest Agent", version="0.1.0")
static_dir = Path(__file__).parent / "static"
scan_repository = ScanRepository()
app.mount("/static", StaticFiles(directory=static_dir), name="static")
demo_notes: list[str] = []


@app.get("/", include_in_schema=False)
def index() -> FileResponse:
    return FileResponse(static_dir / "index.html")


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "sentinel-agent"}


@app.get("/api/scans")
def list_scans() -> list[dict[str, object]]:
    return [
        {
            "scan_id": result.scan_id,
            "target_url": result.target_url,
            "findings": len(result.findings),
            "pages": len(result.pages),
            "duration_ms": result.duration_ms,
            "f1_score": result.evaluation.get("f1_score"),
            "used_deepseek": result.used_deepseek,
        }
        for result in scan_repository.list()
    ]


@app.get("/api/scans/{scan_id}/report")
def download_report(scan_id: str) -> JSONResponse:
    result = scan_repository.get(scan_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Scan not found")
    return JSONResponse(content=result.model_dump(), headers={"Content-Disposition": f'attachment; filename="sentinel-{scan_id}.json"'})


@app.get("/api/scans/{scan_id}/report.html", response_class=HTMLResponse)
def html_report(scan_id: str) -> str:
    result = scan_repository.get(scan_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Scan not found")
    findings = "".join(
        f"<tr><td>{escape(item.category)}</td><td>{escape(item.severity)}</td><td>{escape(item.url)}</td><td>{escape(item.evidence)}</td><td>{escape(item.recommendation)}</td></tr>"
        for item in result.findings
    ) or "<tr><td colspan='5'>No confirmed findings</td></tr>"
    trace = "".join(f"<li><b>{escape(step.agent)}</b> [{escape(step.status)}] {escape(step.detail)}</li>" for step in result.agent_trace)
    return f"""<!doctype html><html><head><meta charset='utf-8'><title>Sentinel Report {escape(result.scan_id)}</title>
    <style>body{{font:15px system-ui;max-width:1100px;margin:40px auto;color:#172321}}h1{{color:#ff6b3d}}table{{border-collapse:collapse;width:100%}}th,td{{border:1px solid #d8ddd2;padding:10px;text-align:left;vertical-align:top}}th{{background:#c9f36b}}</style></head>
    <body><h1>Sentinel Security Report</h1><p><b>Target:</b> {escape(result.target_url)}<br><b>Duration:</b> {result.duration_ms} ms<br><b>Summary:</b> {escape(result.agent_summary)}</p>
    <h2>Agent trace</h2><ol>{trace}</ol><h2>Findings ({len(result.findings)})</h2><table><thead><tr><th>Category</th><th>Severity</th><th>URL</th><th>Evidence</th><th>Recommendation</th></tr></thead><tbody>{findings}</tbody></table></body></html>"""


@app.get("/demo", response_class=HTMLResponse)
def demo_lab(q: str = "") -> str:
    """Intentionally vulnerable local fixture for offline demonstrations."""
    database_message = "SQL syntax error near input" if "'" in q else "No matching record."
    return f"""<!doctype html><html><head><title>Sentinel Demo Lab</title></head>
    <body><h1>Demo Search</h1><form method='get' action='/demo'>
    <label>Search <input name='q' value='{q}'></label><button>Search</button></form>
    <form method='get' action='/demo/notes'><label>Note <input name='note'></label><button>Save note</button></form>
    <p>Results for: {q}</p><p>{database_message}</p></body></html>"""


@app.get("/demo/notes", response_class=HTMLResponse)
def demo_notes_lab(note: str = "") -> str:
    """Intentionally vulnerable stored-XSS fixture for offline demonstrations."""
    if note:
        demo_notes.append(note)
    rendered_notes = "".join(f"<li>{item}</li>" for item in demo_notes)
    return f"<html><body><h1>Saved notes</h1><ul>{rendered_notes}</ul></body></html>"


@app.get("/demo/object", response_class=HTMLResponse)
def demo_object(object_id: str = Query("1", alias="id")) -> str:
    """Intentionally vulnerable object endpoint for offline BOLA/IDOR demonstrations."""
    owner = "user-1" if object_id == "1" else "user-2"
    return f"<html><body><h1>Object {escape(object_id)}</h1><p>Owner: {owner}</p><p>Secret project data for object {escape(object_id)}</p></body></html>"


@app.post("/api/scans", response_model=ScanResult)
def create_scan(request: ScanRequest) -> ScanResult:
    try:
        target = validate_target(str(request.target_url), request.authorized)
    except ScopeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    started = perf_counter()
    agent = PentestAgent(target, session_headers=request.session_headers)
    scan_id, pages, findings = agent.run()
    duration_ms = round((perf_counter() - started) * 1000, 2)
    evaluation: dict[str, object] = {"ground_truth_available": False, "fpr_available": False}
    if urlparse(target).path == "/demo":
        expected = {"Reflected XSS", "Stored XSS", "Potential SQL Injection", "Potential BOLA/IDOR"}
        detected = {finding.category for finding in findings}
        true_positive = len(expected & detected)
        false_positive = len(detected - expected)
        false_negative = len(expected - detected)
        precision = true_positive / (true_positive + false_positive) if true_positive + false_positive else 0
        recall = true_positive / len(expected) if expected else 0
        f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0
        evaluation = {"ground_truth_available": True, "fpr_available": False, "expected_findings": len(expected), "true_positive": true_positive, "false_positive": false_positive, "false_negative": false_negative, "precision": round(precision, 3), "recall": round(recall, 3), "f1_score": round(f1, 3)}
    result = ScanResult(scan_id=scan_id, target_url=target, pages=pages, findings=findings, agent_summary=agent.summary, used_deepseek=agent.used_deepseek, duration_ms=duration_ms, evaluation=evaluation, agent_trace=agent.trace, llm_usage=agent.llm_usage, llm_calls=agent.llm_calls, llm_latency_ms=agent.llm_latency_ms, llm_cost_usd=agent.llm_cost_usd)
    scan_repository.save(result)
    return result
