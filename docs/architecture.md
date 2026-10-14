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
Precision, Recall, F1, and elapsed time in milliseconds. The /demo-safe fixture adds TN and FPR. The versioned manifest
is stored in [`docs/ground_truth.json`](ground_truth.json). Docker lab targets are
marked `ground_truth_available: false` until a test oracle is defined, so their
results are not presented as benchmark metrics.

The Docker lab provides four isolated targets: OWASP Juice Shop on port 3000, OWASP WebGoat on port 8082, OWASP Mutillidae II on port 8083, and bWAPP on port 8084. These targets are intended for authorized experiments; the application scope explicitly allows the internal Compose hostnames `juice-shop`, `webgoat`, `mutillidae`, and `bwapp`.

## Current limitations and next steps

The current implementation is an offline-first MVP. It already separates the
pipeline into Recon, Planning, Attack, Verification, and Reporting agents,
persists campaign reports in SQLite, and exports JSON and HTML reports.

The identified `/demo` and `/demo-safe` targets are the reproducible positive/negative benchmark fixtures. The external Docker
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
- Token usage and configured API cost are included in results. The /demo-safe fixture now supplies negative cases for FPR; test_timings_ms measures each check including verification and refinement.
- Add a reproducible benchmark script and compare the results with OWASP ZAP.
- Extend the planner with an explicit observation-feedback loop; the current
	pipeline now has one bounded observation-feedback refinement pass rather than
	an unbounded iterative ReAct loop.

## Fixture benchmark update

See [lab_completion.md](lab_completion.md) for the current functional coverage.
Both /demo and /demo-safe now have identified, versioned ground truth. Evaluation
requires category, route and parameter matching. Stored XSS uses an independent
read, SQL error checks require a successful non-error baseline, and BOLA on the
Sentinel fixtures requires two known distinct lab identities. Only Planning uses
the LLM; the other agents are deterministic workers. Docker ground truth is still
unverified. The repeated benchmark exports JSON, CSV and Markdown.
