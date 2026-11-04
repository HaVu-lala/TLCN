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
  const webGoatTarget = new URL(targetUrl).pathname.toLowerCase().includes('/webgoat');
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
  // Hiện khung nhật ký và theo dõi theo thời gian thực trong lúc quét.
  empty.classList.add('hidden');
  report.classList.remove('hidden');
  const reqlogEl = document.querySelector('#reqlog');
  let liveCount = 0;
  if (reqlogEl) {
    reqlogEl.innerHTML = `<span class="trace-label">NHẬT KÝ YÊU CẦU — đang quét...</span><div class="reqlog-body" id="reqlog-body"></div>`;
  }
  const liveTimer = window.setInterval(async () => {
    try {
      const res = await fetch(`/api/live-log?after=${liveCount}`);
      const d = await res.json();
      if (d && d.entries && d.entries.length) {
        const body = document.querySelector('#reqlog-body');
        if (body) {
          body.insertAdjacentHTML('beforeend', d.entries.map(reqRow).join(''));
          body.scrollTop = body.scrollHeight;
        }
        liveCount = d.total;
        const label = reqlogEl && reqlogEl.querySelector('.trace-label');
        if (label) label.textContent = `NHẬT KÝ YÊU CẦU (${d.total})${d.running ? ' — đang quét...' : ''}`;
      }
    } catch (e) {}
  }, 400);
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
    window.clearInterval(liveTimer);
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
  document.querySelector('#timing').textContent = `Completed in ${data.duration_ms} ms · Precision ${data.evaluation.precision ?? '-'} · Recall ${data.evaluation.recall ?? '-'} · FPR ${data.evaluation.false_positive_rate ?? '-'} · Checks: ${Object.entries(data.test_timings_ms || {}).map(([name, ms]) => `${name} ${ms} ms`).join(', ')}`;
  document.querySelector('#trace').innerHTML = `<span class="trace-label">AGENT TRACE</span> ${data.agent_trace.map((step) => `<span class="trace-step">${escapeHtml(step.agent)}</span>`).join('<span class="trace-arrow">-&gt;</span>')}`;
  const reqlog = document.querySelector('#reqlog');
  if (reqlog) {
    const rows = (data.request_log || []);
    reqlog.innerHTML = `<span class="trace-label">NHẬT KÝ YÊU CẦU (${rows.length})</span>`
      + `<div class="reqlog-body" id="reqlog-body">`
      + (rows.length ? rows.map(reqRow).join('') : '<div class="reqlog-row">Không có yêu cầu nào được ghi lại.</div>')
      + `</div>`;
  }
  document.querySelector('#download').href = `/api/scans/${encodeURIComponent(data.scan_id)}/report.vi.html`;
  const list = document.querySelector('#finding-list');
  if (data.findings.length) {
    const counts = {};
    data.findings.forEach((f) => { const k = sevKey(f.severity); counts[k] = (counts[k] || 0) + 1; });
    const summary = `<div class="sev-summary">` + SEV_ORDER.map((k) =>
      `<span class="sev-pill sev-${k} ${counts[k] ? 'on' : ''}">${k.toUpperCase()} <b>${counts[k] || 0}</b></span>`).join('') + `</div>`;
    const cards = data.findings.slice()
      .sort((a, b) => SEV_ORDER.indexOf(sevKey(a.severity)) - SEV_ORDER.indexOf(sevKey(b.severity)))
      .map((f) => {
        const k = sevKey(f.severity);
        return `<article class="finding sev-${k}">`
          + `<div class="finding-head"><span class="sev-badge">${escapeHtml((f.severity || 'info').toUpperCase())}</span>`
          + `<span class="finding-cat">${escapeHtml(f.category)}</span></div>`
          + `<div class="finding-target"><code>${escapeHtml(f.parameter || 'response')}</code> @ ${escapeHtml(f.url)}</div>`
          + `<div class="finding-ev">${escapeHtml(f.evidence)}</div>`
          + (f.recommendation ? `<div class="finding-rem"><b>Khắc phục:</b> ${escapeHtml(f.recommendation)}</div>` : '')
          + `</article>`;
      }).join('');
    list.innerHTML = summary + cards;
  } else {
    list.innerHTML = `<article class="finding sev-info"><div class="finding-head"><span class="sev-badge">CLEAN</span>`
      + `<span class="finding-cat">Không có phát hiện được xác nhận</span></div>`
      + `<div class="finding-ev">Các kiểm thử đã chọn không xác nhận bằng chứng khớp. Điều này không đồng nghĩa ứng dụng an toàn.</div></article>`;
  }
}

const SEV_ORDER = ['critical', 'high', 'medium', 'low', 'info'];
function sevKey(s) { s = String(s || '').toLowerCase(); return SEV_ORDER.includes(s) ? s : 'info'; }

async function loadHistory() {
  const response = await fetch('/api/scans');
  if (!response.ok) return;
  const scans = await response.json();
  document.querySelector('#history-count').textContent = `${scans.length} RUNS`;
  document.querySelector('#history-list').innerHTML = scans.length ? scans.map((scan) => `<article class="history-item"><div><b>${escapeHtml(scan.target_url)}</b><small>${scan.pages} page(s) · ${scan.findings} finding(s) · ${scan.duration_ms} ms</small></div><span>${scan.f1_score === null ? 'F1 -' : `F1 ${scan.f1_score}`}</span><a href="/api/scans/${encodeURIComponent(scan.scan_id)}/report.vi.html" target="_blank" rel="noopener">Báo cáo</a></article>`).join('') : '<p class="summary">No previous campaigns.</p>';
}
function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char])); }

function reqRow(r) {
  const bad = r.status >= 400 || r.status === 0;
  const extra = r.args ? ` <span class="reqlog-args">[${escapeHtml(r.args)}]</span>` : '';
  return `<div class="reqlog-row"><span class="reqlog-ts">${escapeHtml(r.ts || '')}</span> `
    + `<span class="reqlog-m">${escapeHtml(r.method || '')}</span> `
    + `<span class="reqlog-url">${escapeHtml(r.url || '')}</span> `
    + `<span class="reqlog-st ${bad ? 'bad' : 'ok'}">HTTP ${escapeHtml(String(r.status))}</span>${extra}</div>`;
}
