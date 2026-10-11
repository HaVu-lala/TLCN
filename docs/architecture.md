# Architecture

The system uses a bounded multi-agent ReAct-style pipeline. `PentestAgent` is a compatibility facade that orchestrates specialized workers:

- **ReconAgent:** `WebTools.crawl()` extracts same-host pages and HTML forms; a
	bounded Juice Shop adapter exposes `/rest/products/search?q=...` when the
	Angular shell has no HTML forms.
- **PlanningAgent:** DeepSeek selects only `reflected_xss`, `basic_sqli`, or `idor`; without a key, a deterministic plan keeps the demo runnable.
- **AttackAgent:** `WebTools.request()` submits controlled markers and a quote probe to discovered form fields.
- **VerificationAgent:** response signatures become validated `Finding` objects.
- **ReportingAgent:** produces the summary, structured report and agent trace.

The scope guard runs before the Agent is constructed. By default it accepts local and private lab addresses only. The implementation deliberately does not include destructive payloads, arbitrary host pivoting, brute force, credential theft, or persistence.

## Offline evaluation

The `/demo` fixture has four known vulnerabilities: reflected XSS, stored XSS,
a simulated SQL error, and an object endpoint without object-level
authorization. After a scan, the API compares detected categories with that
ground truth and returns true positives, false positives, false negatives,
Precision, Recall, F1, and elapsed time in milliseconds. The versioned manifest
is stored in [`docs/ground_truth.json`](ground_truth.json). Other targets are
marked `ground_truth_available: false` until a test oracle is defined, so their
results are not presented as benchmark metrics.

The Docker lab provides four isolated targets: OWASP Juice Shop on port 3000, OWASP WebGoat on port 8082, OWASP Mutillidae II on port 8083, and bWAPP on port 8084. These targets are intended for authorized experiments; the application scope explicitly allows the internal Compose hostnames `juice-shop`, `webgoat`, `mutillidae`, and `bwapp`.

## Current limitations and next steps

The current implementation is an offline-first MVP. It already separates the
pipeline into Recon, Planning, Attack, Verification, and Reporting agents,
persists campaign reports in SQLite, and exports JSON and HTML reports.

The `/demo` target is the reproducible benchmark fixture. The external Docker
targets (OWASP Juice Shop, WebGoat, Mutillidae II, and bWAPP) are available for
authorized manual experiments. Their versioned scenario manifest exists, but
each scenario remains `requires-run` until its exact route, expected behavior,
and reset procedure are verified; Precision, Recall, and F1 are not reported
for them before that step.

Remaining thesis work includes:

- Run and record the two-session BOLA/IDOR experiment with real credentials in
	an authorized lab. The API now accepts separate owner and comparison session
	headers and keeps them out of persisted reports.
- Add broader SQLi verification beyond database error signatures.
- Record token usage, API cost, false-positive rate, and per-agent latency.
	Token usage is now included in each scan result; FPR remains explicitly
	unavailable until a negative-case dataset is added.
- Add a reproducible benchmark script and compare the results with OWASP ZAP.
- Extend the planner with an explicit observation-feedback loop; the current
	pipeline now has one bounded observation-feedback refinement pass rather than
	an unbounded iterative ReAct loop.
