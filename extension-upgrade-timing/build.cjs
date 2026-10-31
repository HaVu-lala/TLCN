const fs = require('node:fs');
const path = require('node:path');
const source = 'D:/Tools/game-tools-extension';
const original = fs.readFileSync(path.join(source, 'game-tools.js'), 'utf8');
const start = original.indexOf('// ===================== Đập đồ (trước đây: upgrade.js) =====================');
const end = original.indexOf('// ===================== Đi tới map', start);
if (start < 0 || end < 0) throw Error('Upgrade module missing');
let upgrade = original.slice(start, end);
function patch(a, b) { if (!upgrade.includes(a)) throw Error('Patch mismatch: ' + a.slice(0, 70)); upgrade = upgrade.replace(a, b); }
const helper = fs.readFileSync(path.join(__dirname, 'timing-core.cjs'), 'utf8').replace('module.exports = { createUpgradeTiming };', '');
patch("  const CK = 'gtUpgradeCfg';", helper + "\n  const upgradeTiming = createUpgradeTiming();\n  const CK = 'gtUpgradeCfg';");
patch('let running = false, ui = {}', 'let upgradeEpoch = 0, loopBusy = false;\n  let running = false, ui = {}');
patch("const stop = why => { running = false;", "const stop = why => { running = false; upgradeEpoch++;");
patch('  async function loop() {', `  async function loop() {
    if (loopBusy) return;
    loopBusy = true;
    const epoch = ++upgradeEpoch;
    const active = () => running && epoch === upgradeEpoch;
    try {`);
patch('    while (running) {', '    while (active()) {');
patch('      press(s.btn);', '      if (!active()) return;\n      press(s.btn);');
patch('        for (let i = 0; i < 100; i++) {', '        for (let i = 0; i < 100 && active(); i++) {');
patch('      stat.tries++;', '      if (!active()) return;\n      stat.tries++;');
patch("if (!r) { say('… Không thấy kết quả sau 6 giây, đọc lại\\n' + summary()); await sleep(1000); r = readState(); }", "if (!r) return stop('chưa xác nhận được kết quả sau 6 giây; không tự bấm lại.');");
patch('      await sleep(cfg.delay + Math.random() * 150);', `      const delay = upgradeTiming.randomDelayMs();
      const completed = await upgradeTiming.wait({ delay, active,
        onTick: seconds => say('⏳ Lượt tiếp theo sau ' + seconds + ' giây (ngẫu nhiên 10–15 giây).\\n' + summary()) });
      if (!completed) return;`);
patch('    }\n  }\n  function check() {', `    }
    } finally { loopBusy = false; if (epoch === upgradeEpoch) { running = false; sync(); } }
  }
  function check() {`);
patch('<label>Nghỉ giữa 2 lần <input type="number" id="dl" min="100" step="50" style="width:65px"> ms</label>', '<label>Nghỉ ngẫu nhiên 10–15 giây sau mỗi kết quả</label>');
patch("    $('dl').value = cfg.delay; $('dl').onchange = e => { cfg.delay = Math.max(100, +e.target.value || DEF.delay); save(); };\n", '');
patch("if (running) { running = false; say(", "if (running) { running = false; upgradeEpoch++; say(");
patch('      running = true; sync(); loop().catch', "      if (loopBusy) { say('Đang chờ lượt trước dừng; thử lại sau một chút.'); return; }\n      running = true; sync(); loop().catch");
patch('stop: () => { running = false; }', "stop: () => stop('người dùng dừng')");
const next = original.slice(0, start) + upgrade + original.slice(end);
fs.writeFileSync(path.join(__dirname, 'game-tools.js'), next);
fs.writeFileSync(path.join(__dirname, 'upgrade.test-source.js'), upgrade);
const manifest = JSON.parse(fs.readFileSync(path.join(source, 'manifest.json'), 'utf8'));
manifest.version = '2.6.0.1';
fs.writeFileSync(path.join(__dirname, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log('Built game-tools-extension timing update 2.6.0.1');
