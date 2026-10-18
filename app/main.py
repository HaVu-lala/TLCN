from pathlib import Path
from time import perf_counter
from html import escape
from urllib.parse import parse_qs

from fastapi import FastAPI, HTTPException, Query, Header, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from app.agent import PentestAgent
from app.schemas import ScanRequest, ScanResult
from app.scope import ScopeError, validate_target
from app.repository import ScanRepository
from app.evaluation import evaluate_demo, evaluate_lab, evaluate_extended

app = FastAPI(title="Sentinel Web Pentest Agent", version="0.1.0")
static_dir = Path(__file__).parent / "static"
scan_repository = ScanRepository()
app.mount("/static", StaticFiles(directory=static_dir), name="static")
demo_notes: list[str] = []
safe_notes: list[str] = []
safe_login_failures = {"count": 0}

# A02/A03/A04 fixture headers. The vulnerable fixture omits security headers,
# discloses component versions and sets an insecure cookie; the safe fixture
# hardens all three.
INSECURE_HEADERS = {
    "Server": "Werkzeug/2.0.3 Python/3.12.1",
    "X-Powered-By": "Express/4.17.1",
    "Set-Cookie": "demo_session=4e7a1f9c; Path=/",
}
SECURE_HEADERS = {
    "Server": "sentinel",
    "Content-Security-Policy": "default-src 'self'",
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Set-Cookie": "demo_session=4e7a1f9c; Path=/; HttpOnly; Secure; SameSite=Strict",
}
LOGIN_FORM = "<form method='post' action='{action}'><label>User <input name='username'></label><label>Password <input name='password' type='password'></label><button>Login</button></form>"


async def _read_credentials(request: Request) -> dict[str, str]:
    """Parse credentials from query, urlencoded body or JSON without requiring python-multipart."""
    values: dict[str, str] = {key: val[-1] for key, val in parse_qs(request.url.query).items()}
    body = (await request.body()).decode("utf-8", "ignore")
    if body:
        content_type = request.headers.get("content-type", "")
        if "json" in content_type:
            import json as _json
            try:
                values.update({k: str(v) for k, v in _json.loads(body).items()})
            except ValueError:
                pass
        else:
            values.update({key: val[-1] for key, val in parse_qs(body).items()})
    return values


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
        f"<tr><td>{escape(item.category)}</td><td>{escape(item.severity)}</td><td>{escape(item.url)}</td><td>{escape(item.parameter or 'response')}</td><td>{escape(item.evidence)}</td><td>{escape(item.recommendation)}</td></tr>"
        for item in result.findings
    ) or "<tr><td colspan='6'>No confirmed findings</td></tr>"
    trace = "".join(f"<li><b>{escape(step.agent)}</b> [{escape(step.status)}] {escape(step.detail)}</li>" for step in result.agent_trace)
    return f"""<!doctype html><html><head><meta charset='utf-8'><title>Sentinel Report {escape(result.scan_id)}</title>
    <style>body{{font:15px system-ui;max-width:1100px;margin:40px auto;color:#172321}}h1{{color:#ff6b3d}}table{{border-collapse:collapse;width:100%}}th,td{{border:1px solid #d8ddd2;padding:10px;text-align:left;vertical-align:top}}th{{background:#c9f36b}}</style></head>
    <body><h1>Sentinel Security Report</h1><p><b>Target:</b> {escape(result.target_url)}<br><b>Duration:</b> {result.duration_ms} ms<br><b>Summary:</b> {escape(result.agent_summary)}</p>
    <h2>Agent trace</h2><ol>{trace}</ol><h2>Findings ({len(result.findings)})</h2><table><thead><tr><th>Category</th><th>Severity</th><th>URL</th><th>Parameter</th><th>Evidence</th><th>Recommendation</th></tr></thead><tbody>{findings}</tbody></table></body></html>"""


@app.get("/lich-su.html", response_class=HTMLResponse)
def history_vi() -> str:
    from app.report_vi import render_history_vi
    return render_history_vi(scan_repository.list())


@app.get("/api/scans/{scan_id}/report.vi.html", response_class=HTMLResponse)
def vietnamese_report(scan_id: str) -> str:
    from app.report_vi import render_vietnamese_report
    result = scan_repository.get(scan_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Scan not found")
    return render_vietnamese_report(result)


@app.get("/api/scans/{scan_id}/report.md")
def markdown_report(scan_id: str):
    from fastapi.responses import Response
    result = scan_repository.get(scan_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Scan not found")
    # HTML-escape untrusted content so opening the Markdown as HTML cannot execute evidence.
    lines = ["# Sentinel Security Report", "", f"Target: {escape(result.target_url)}", "",
             f"Duration: {result.duration_ms} ms", "", escape(result.agent_summary), ""]
    for item in result.findings:
        lines.extend([f"## {escape(item.category)} ({item.severity})", "",
                      f"URL: {escape(item.url)}", "", f"Parameter: {escape(item.parameter or 'response')}", "",
                      escape(item.evidence), "", escape(item.recommendation), ""])
    lines.extend(["## Check duration (ms)", "", *[f"- {name}: {duration}" for name, duration in result.test_timings_ms.items()], "",
                  "Durations include probes, verification and refinement; exclude recon and planning."])
    return Response("\n".join(lines), media_type="text/markdown", headers={"Content-Disposition": f'attachment; filename="sentinel-{scan_id}.md"'})


@app.get("/demo", response_class=HTMLResponse)
def demo_lab(q: str = "") -> HTMLResponse:
    """Intentionally vulnerable local fixture for offline demonstrations.

    Besides the reflected/stored/SQLi/BOLA cases, this response intentionally
    omits security headers (A02), discloses component versions (A03) and sets an
    insecure cookie (A04), and exposes a weak login form (A07 via /demo/login).
    """
    database_message = "SQL syntax error near input" if "'" in q else "No matching record."
    login_form = LOGIN_FORM.format(action="/demo/login")
    body = f"""<!doctype html><html><head><title>Sentinel Demo Lab</title></head>
    <body><h1>Demo Search</h1><form method='get' action='/demo'>
    <label>Search <input name='q' value='{q}'></label><button>Search</button></form>
    <form method='get' action='/demo/notes'><label>Note <input name='note'></label><button>Save note</button></form>
    {login_form}
    <p>Results for: {q}</p><p>{database_message}</p></body></html>"""
    return HTMLResponse(content=body, headers=INSECURE_HEADERS)


@app.post("/demo/login")
async def demo_login(request: Request) -> JSONResponse:
    """Weak authentication fixture: default credentials accepted, no lockout (A07)."""
    creds = await _read_credentials(request)
    if creds.get("username") == "admin" and creds.get("password") == "admin":
        return JSONResponse({"status": "ok", "token": "demo-session-token"})
    return JSONResponse({"status": "invalid"})


@app.get("/demo/notes", response_class=HTMLResponse)
def demo_notes_lab(note: str = "") -> str:
    """Intentionally vulnerable stored-XSS fixture for offline demonstrations."""
    if note:
        demo_notes.append(note)
    rendered_notes = "".join(f"<li>{item}</li>" for item in demo_notes)
    return f"<html><body><h1>Saved notes</h1><ul>{rendered_notes}</ul></body></html>"


@app.get("/demo/object", response_class=HTMLResponse)
def demo_object(object_id: str = Query("1", alias="id")) -> str:
    """Intentionally vulnerable object endpoint for two-session BOLA demonstrations."""
    objects = {"1": ("user-1", "Project Alpha"), "2": ("user-2", "Project Beta")}
    owner, project = objects.get(object_id, ("user-2", "Unknown project"))
    return f"<html><body><h1>Object {escape(object_id)}</h1><p>Owner: {owner}</p><p>Secret project data for {escape(project)}</p></body></html>"


@app.get("/demo-safe", response_class=HTMLResponse)
def safe_demo(q: str = "") -> HTMLResponse:
    login_form = LOGIN_FORM.format(action="/demo-safe/login")
    body = f"""<html><head><title>Sentinel Safe Demo Lab</title></head><body>
    <form method='get' action='/demo-safe'><input name='q' value='{escape(q, quote=True)}'><button>Search</button></form>
    <form method='get' action='/demo-safe/notes'><input name='note'><button>Save</button></form>
    {login_form}
    <p>Results for: {escape(q)}</p><p>No matching record.</p></body></html>"""
    return HTMLResponse(content=body, headers=SECURE_HEADERS)


@app.post("/demo-safe/login")
async def safe_login(request: Request) -> JSONResponse:
    """Hardened authentication fixture: rejects default credentials and locks out after repeated failures (A07 negative)."""
    creds = await _read_credentials(request)
    if safe_login_failures["count"] >= 3:
        return JSONResponse({"status": "locked", "detail": "too many attempts, try again later"}, status_code=429)
    if creds.get("username") == "legit-user" and creds.get("password") == "S3cure!pass":
        safe_login_failures["count"] = 0
        return JSONResponse({"status": "ok"}, headers={"Set-Cookie": "demo_session=auth; Path=/; HttpOnly; Secure; SameSite=Strict"})
    safe_login_failures["count"] += 1
    return JSONResponse({"status": "invalid"}, status_code=401)


@app.get("/demo-safe/notes", response_class=HTMLResponse)
def safe_notes_lab(note: str = "") -> str:
    if note:
        safe_notes.append(note)
    return "<html><body><ul>" + "".join(f"<li>{escape(item)}</li>" for item in safe_notes) + "</ul></body></html>"


@app.get("/demo-safe/object", response_class=HTMLResponse)
def safe_object(object_id: str = Query("1", alias="id"), x_lab_user: str | None = Header(default=None)) -> str:
    owner = {"1": "user-1", "2": "user-2"}.get(object_id)
    if owner is None:
        raise HTTPException(status_code=404, detail="Object not found")
    if x_lab_user != owner:
        raise HTTPException(status_code=403, detail="Object access denied")
    return f"<html><body>Owner: {owner}<p>Secret project data</p></body></html>"


@app.post("/api/scans", response_model=ScanResult)
def create_scan(request: ScanRequest) -> ScanResult:
    try:
        target = validate_target(str(request.target_url), request.authorized)
    except ScopeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    started = perf_counter()
    agent = None
    try:
        agent = PentestAgent(target, session_headers=request.session_headers, comparison_session_headers=request.comparison_session_headers, login=request.login)
        scan_id, pages, findings = agent.run()
    except ScopeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    finally:
        if agent:
            agent.recon.tools.client.close()
            if agent.attack.comparison_tools:
                agent.attack.comparison_tools.client.close()
    duration_ms = round((perf_counter() - started) * 1000, 2)
    evaluation = evaluate_demo(target, pages, findings)
    if not evaluation.get("ground_truth_available"):
        evaluation = evaluate_lab(target, pages, findings)
    extended = evaluate_extended(target, pages, findings)
    if extended.get("ground_truth_available"):
        evaluation = {**evaluation, "extended": extended}
    result = ScanResult(scan_id=scan_id, target_url=target, pages=pages, findings=findings, agent_summary=agent.summary, used_deepseek=agent.used_deepseek, duration_ms=duration_ms, evaluation=evaluation, agent_trace=agent.trace, llm_usage=agent.llm_usage, llm_calls=agent.llm_calls, llm_latency_ms=agent.llm_latency_ms, llm_cost_usd=agent.llm_cost_usd, test_timings_ms=agent.test_timings_ms)
    scan_repository.save(result)
    return result
