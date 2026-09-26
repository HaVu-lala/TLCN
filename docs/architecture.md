# Architecture

The system uses a bounded multi-agent ReAct-style pipeline. `PentestAgent` is a compatibility facade that orchestrates specialized workers:

- **ReconAgent:** `WebTools.crawl()` extracts same-host pages and HTML forms.
- **PlanningAgent:** DeepSeek selects only `reflected_xss`, `basic_sqli`, or `idor`; without a key, a deterministic plan keeps the demo runnable.
- **AttackAgent:** `WebTools.request()` submits controlled markers and a quote probe to discovered form fields.
- **VerificationAgent:** response signatures become validated `Finding` objects.
- **ReportingAgent:** produces the summary, structured report and agent trace.

The scope guard runs before the Agent is constructed. By default it accepts local and private lab addresses only. The implementation deliberately does not include destructive payloads, arbitrary host pivoting, brute force, credential theft, or persistence.

## Offline evaluation

The `/demo` fixture has three known vulnerabilities: reflected XSS, a simulated SQL error, and an object endpoint without object-level authorization. After a scan, the API compares detected categories with that ground truth and returns true positives, false positives, false negatives, Precision, Recall, F1, and elapsed time in milliseconds. Other targets are marked `ground_truth_available: false` until a test oracle is defined, so their results are not presented as benchmark metrics.

The Docker lab provides four isolated targets: OWASP Juice Shop on port 3000, OWASP WebGoat on port 8082, OWASP Mutillidae II on port 8083, and bWAPP on port 8084. These targets are intended for authorized experiments; the application scope explicitly allows the internal Compose hostnames `juice-shop`, `webgoat`, `mutillidae`, and `bwapp`.

## Next thesis milestones

- Add authenticated session capture with explicit credentials supplied by the operator.
- Add a ground-truth dataset for Juice Shop, WebGoat, Mutillidae II, and bWAPP.
- Persist campaigns and export JSON/HTML reports.
- Compare precision, recall, F1, false positives, latency, and token cost against OWASP ZAP.
- Split the single Agent into Recon, Attack, Verification, and Reporting workers once the MVP metrics are stable.
