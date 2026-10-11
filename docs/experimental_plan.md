# Experimental plan

## Reproducible demo experiment

1. Start the local API:

   ```powershell
   python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
   ```

2. In another terminal, run the experiment:

   ```powershell
   python scripts/run_demo_experiment.py
   ```

3. Record the JSON output, including findings, duration, `llm_usage`, and the
   evaluation fields. With an empty `DEEPSEEK_API_KEY`, the deterministic
   fallback should detect Reflected XSS, Stored XSS, Potential SQL Injection,
   and Potential BOLA/IDOR in the local `/demo` fixture.

The expected categories and their source are versioned in
[`ground_truth.json`](ground_truth.json). The demo is the only target where
Precision, Recall, and F1 are currently reported. False Positive Rate is marked
unavailable because the project does not yet include a negative-case dataset.

## Docker lab experiments

For Juice Shop, the scanner recognizes the Angular shell and adds its local
search API as a deterministic adapter input. This avoids treating the SPA shell
as a completed scan with zero probes. A zero finding result is still valid when
the API response contains no controlled XSS or SQL error evidence.

The authorized Docker targets are:

| Target | Internal host | Port |
| --- | --- | ---: |
| OWASP Juice Shop | `juice-shop` | 3000 |
| OWASP WebGoat | `webgoat` | 8082 |
| OWASP Mutillidae II | `mutillidae` | 8083 |
| bWAPP | `bwapp` | 8084 |

These targets are exploratory until each selected exercise has a verified
scenario, expected result, and reset procedure. Do not report benchmark
metrics for them using the `/demo` oracle.

## Session context

A scan may receive operator-supplied lab headers through `session_headers`, for
example a `Cookie` or `Authorization` header. Headers are held by the scan's
HTTP client and are not included in `ScanResult` or persisted reports. Only use
credentials for an explicitly authorized local lab.

For the two-session BOLA experiment, provide `session_headers` for the owner
session and `comparison_session_headers` for a second authorized session. The
demo fixture intentionally returns object 1 to both sessions so the verifier
can demonstrate missing object-level authorization. The comparison headers are
used only in memory and are not persisted in reports.

The Docker ground-truth manifest contains scenario IDs for Juice Shop,
WebGoat, Mutillidae II, and bWAPP. Each scenario remains `requires-run` until
the exact route, expected behavior, and reset procedure are recorded.
