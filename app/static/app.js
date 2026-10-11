const form = document.querySelector('#scan-form');
const runButton = document.querySelector('#run');
const phase = document.querySelector('#phase');
const empty = document.querySelector('#empty');
const report = document.querySelector('#report');

loadHistory();

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  runButton.disabled = true;
  const progressSteps = [
    ['Mapping target...', 'RECON'],
    ['Planning checks...', 'PLANNING'],
    ['Running controlled probes...', 'ATTACK'],
    ['Verifying responses...', 'VERIFY'],
  ];
  let progressIndex = 0;
  runButton.querySelector('span').textContent = progressSteps[0][0];
  phase.textContent = 'RECON';
  const progressTimer = window.setInterval(() => {
    progressIndex = (progressIndex + 1) % progressSteps.length;
    runButton.querySelector('span').textContent = progressSteps[progressIndex][0];
    phase.textContent = progressSteps[progressIndex][1];
  }, 700);
  const loginUrl = document.querySelector('#login-url').value.trim();
  const loginUser = document.querySelector('#login-user').value.trim();
  const loginPassword = document.querySelector('#login-password').value;
  const targetUrl = document.querySelector('#target').value.trim();
  const loginValues = [loginUrl, loginUser, loginPassword];
  const webGoatTarget = targetUrl.includes(':8082') && targetUrl.toLowerCase().includes('/webgoat');
  if (webGoatTarget && !loginValues.every(Boolean)) {
    window.clearInterval(progressTimer);
    runButton.disabled = false;
    runButton.querySelector('span').textContent = 'Start campaign';
    phase.textContent = 'BLOCKED';
    empty.classList.remove('hidden');
    empty.querySelector('h2').textContent = 'WebGoat login is required';
    empty.querySelector('p').textContent = 'Fill Login URL, username, and password before scanning WebGoat.';
    return;
  }
  if (loginValues.some(Boolean) && loginValues.some((value) => !value)) {
    window.clearInterval(progressTimer);
    runButton.disabled = false;
    runButton.querySelector('span').textContent = 'Start campaign';
    phase.textContent = 'BLOCKED';
    empty.classList.remove('hidden');
    empty.querySelector('h2').textContent = 'Complete all login fields or leave them empty';
    empty.querySelector('p').textContent = 'Authenticated scans require Login URL, username, and password.';
    return;
  }
  const login = loginValues.every(Boolean) ? {login_url: loginUrl, username: loginUser, password: loginPassword} : undefined;
  try {
    const response = await fetch('/api/scans', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({target_url: targetUrl, authorized: document.querySelector('#authorized').checked, login})});
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || 'Campaign failed');
    renderReport(data);
    loadHistory();
    phase.textContent = 'COMPLETE';
  } catch (error) {
    phase.textContent = 'BLOCKED';
    empty.classList.remove('hidden');
    empty.querySelector('h2').textContent = error.message;
    empty.querySelector('p').textContent = 'Check the target and scope confirmation, then try again.';
  } finally {
    window.clearInterval(progressTimer);
    runButton.disabled = false;
    runButton.querySelector('span').textContent = 'Start campaign';
  }
});

function renderReport(data) {
  empty.classList.add('hidden');
  report.classList.remove('hidden');
  document.querySelector('#pages').textContent = data.pages.length;
  document.querySelector('#endpoints').textContent = data.pages.reduce((count, page) => count + (page.endpoints?.length || 0), 0);
  document.querySelector('#findings').textContent = data.findings.length;
  document.querySelector('#ai').textContent = data.used_deepseek ? 'DEEPSEEK' : 'FALLBACK';
  document.querySelector('#f1').textContent = data.evaluation.ground_truth_available ? data.evaluation.f1_score : '-';
  document.querySelector('#summary').textContent = data.agent_summary;
  document.querySelector('#timing').textContent = `Completed in ${data.duration_ms} ms · Precision ${data.evaluation.precision ?? '-'} · Recall ${data.evaluation.recall ?? '-'}`;
  document.querySelector('#trace').innerHTML = `<span class="trace-label">AGENT TRACE</span> ${data.agent_trace.map((step) => `<span class="trace-step">${escapeHtml(step.agent)}</span>`).join('<span class="trace-arrow">-&gt;</span>')}`;
  document.querySelector('#download').href = `/api/scans/${encodeURIComponent(data.scan_id)}/report`;
  const list = document.querySelector('#finding-list');
  list.innerHTML = data.findings.length ? data.findings.map((finding) => `<article class="finding"><div class="finding-head"><span>${escapeHtml(finding.category)}</span><span class="severity">${escapeHtml(finding.severity)}</span></div><p><code>${escapeHtml(finding.parameter || 'response')}</code> at ${escapeHtml(finding.url)}<br>${escapeHtml(finding.evidence)}<br><strong>Remediation:</strong> ${escapeHtml(finding.recommendation)}</p></article>`).join('') : '<article class="finding" style="border-color:#52b788"><div class="finding-head"><span>No confirmed findings</span><span class="severity" style="color:#368f63">CLEAR</span></div><p>Checks completed without a matching response signature.</p></article>';
}

async function loadHistory() {
  const response = await fetch('/api/scans');
  if (!response.ok) return;
  const scans = await response.json();
  document.querySelector('#history-count').textContent = `${scans.length} RUNS`;
  document.querySelector('#history-list').innerHTML = scans.length ? scans.map((scan) => `<article class="history-item"><div><b>${escapeHtml(scan.target_url)}</b><small>${scan.pages} page(s) · ${scan.findings} finding(s) · ${scan.duration_ms} ms</small></div><span>${scan.f1_score === null ? 'F1 -' : `F1 ${scan.f1_score}`}</span><a href="/api/scans/${encodeURIComponent(scan.scan_id)}/report.html" target="_blank" rel="noopener">Report</a></article>`).join('') : '<p class="summary">No previous campaigns.</p>';
}
function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char])); }
