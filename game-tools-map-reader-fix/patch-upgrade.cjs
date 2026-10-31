const fs = require('node:fs');
module.exports = function patchUpgrade(code, dir) {
  const start = code.indexOf('// ===================== Đập đồ (trước đây: upgrade.js) =====================');
  const end = code.indexOf('// ===================== Đi tới map', start);
  if (start < 0 || end < 0) throw Error('Upgrade section missing');
  let upgrade = code.slice(start, end);
  function patch(a, b) { if (!upgrade.includes(a)) throw Error('Upgrade patch mismatch: ' + a.slice(0, 70)); upgrade = upgrade.replace(a, b); }
  patch('    ROOT = null;\n    for (let e = b;', "    ROOT = b?.closest('.ng-forge2') || null;\n    if (ROOT) return ROOT;\n    for (let e = b;");
  patch('r.width >= 400', 'r.width >= 180');
  patch('const autoBtn = () => buttons().find', "const autoBtn = () => [...root().querySelectorAll('button,[role=button],a')].filter(visible).find");
  patch('let box = inp || nearestBox(hit.el)', "let box = hit.el.closest('[role=switch],[role=checkbox]') || inp || nearestBox(hit.el)");
  patch("let textRow = hit.el.closest('label') || hit.el.parentElement || hit.el;", "let textRow = hit.el.closest('[role=switch],[role=checkbox],label') || hit.el.parentElement || hit.el;");
  patch('let running = false, ui = {}', 'let upgradeRunId = 0, loopBusy = false;\n  let running = false, ui = {}');
  patch("const stop = why => { running = false;", "const stop = why => { running = false; upgradeRunId++;");
  const boxStart = upgrade.indexOf('  async function setBox(sb, want) {');
  const boxEnd = upgrade.indexOf('  // dòng "Hỏng:', boxStart);
  upgrade = upgrade.slice(0, boxStart) + `  async function setBox(sb, want) {
    if (!sb) return false;
    const token = upgradeRunId;
    const fresh = () => sb.key === 'linh' ? readState().linh : readState().hos.find(h => h.key === sb.key);
    let current = fresh();
    if (!current || current.disabled) return !want && current?.checked === false;
    if (current.checked === want) return true;
    press(current.box); // exactly once; never blindly toggle it again
    const until = Date.now() + 3500;
    while (Date.now() < until && token === upgradeRunId) {
      await sleep(100);
      current = fresh();
      if (current?.checked === want) return true;
    }
    return false;
  }
` + upgrade.slice(boxEnd);
  const loopStart = upgrade.indexOf('  async function loop() {');
  const loopEnd = upgrade.indexOf('  function check() {', loopStart);
  upgrade = upgrade.slice(0, loopStart) + fs.readFileSync(dir + '/upgrade-loop.js', 'utf8') + '\n' + upgrade.slice(loopEnd);
  patch("if (running) { running = false; say(", "if (running) { running = false; upgradeRunId++; say(");
  patch('      running = true; sync(); loop().catch', "      if (loopBusy) { say('Đang chờ lượt trước dừng.'); return; }\n      running = true; sync(); loop().catch");
  patch('stop: () => { running = false; }', "stop: () => stop('người dùng dừng')");
  fs.writeFileSync(dir + '/upgrade.test-source.js', upgrade);
  return code.slice(0, start) + upgrade + code.slice(end);
};
