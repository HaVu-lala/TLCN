const fs = require('node:fs');
const assert = require('node:assert/strict');
const { chromium } = require('D:/Tools/game-tools-playwright/node_modules/playwright');
const source = fs.readFileSync(__dirname + '/upgrade.test-source.js', 'utf8').replace(
  'window.__gtUpgrade = { check, readState,',
  'window.__gtUpgrade = { setBox, runForTest: () => { running = true; return loop(); }, setMaxForTest: n => { cfg.maxLv = n; }, check, readState,');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 720, height: 900 } });
    await page.setContent('<style>.ng-forge2{width:300px}button,p{display:block;min-height:25px}.set-box{display:inline-block;width:16px;height:16px}</style><div id="fixture"></div>');
    await page.evaluate(() => {
      window.mock = { level: 9, linh: false, guard: false, stones: false, clicks: 0, message: '', renders: 0, zeroRate: false };
      window.renderFixture = () => {
        const m = window.mock; m.renders++;
        document.querySelector('#fixture').innerHTML = `<section class="ng-forge2">
          <button id="choose">Tự chọn đá</button>
          <button id="linh" role="switch" aria-checked="${m.linh}"><i class="set-box"></i><span><b>Linh thạch (còn 10)</b><small> — +10 % tỉ lệ</small></span></button>
          <button id="guard" role="switch" aria-checked="${m.guard}"><i class="set-box"></i><span><b>Hộ thạch sơ cấp (còn 10)</b><small> — hỏng không rớt cấp (bảo hộ tới +16)</small></span></button>
          <p>Xác suất thành công: <b>${m.stones && !m.zeroRate ? 25 : 0}%</b></p>
          <p>Hỏng: <b>${m.guard ? 'Hộ thạch giữ nguyên +' + m.level : 'rớt về +4'}</b></p>
          <button id="upgrade" ${m.stones ? '' : 'disabled'}>Nâng cấp +${m.level + 1}</button>
        </section><p>${m.message}</p>`;
        document.querySelector('#choose').onclick = () => setTimeout(() => { m.stones = true; renderFixture(); }, 450);
        for (const key of ['linh', 'guard']) document.querySelector('#' + key).onclick = () => setTimeout(() => { m[key] = !m[key]; renderFixture(); }, 150);
        document.querySelector('#upgrade').onclick = () => {
          m.clicks++;
          setTimeout(() => { m.level++; m.stones = false; m.guard = false; m.linh = false; m.message = 'Thành công — kiếm lên +' + m.level; renderFixture(); }, 200);
        };
      };
      renderFixture();
    });
    await page.addScriptTag({ content: source });
    const initial = await page.evaluate(() => {
      const s = __gtUpgrade.readState();
      return { cur: s.cur, realTag: s.linh.real.tagName, role: s.linh.real.getAttribute('role'), guard: s.hos[0].checked };
    });
    assert.deepEqual(initial, { cur: 9, realTag: 'BUTTON', role: 'switch', guard: false });
    assert.equal(await page.evaluate(() => __gtUpgrade.setBox(__gtUpgrade.readState().linh, true)), true);
    assert.equal(await page.evaluate(() => __gtUpgrade.readState().linh.checked), true, 'Read the replacement switch after rerender');
    await page.evaluate(() => { __gtUpgrade.setMaxForTest(10); return __gtUpgrade.runForTest(); });
    assert.equal(await page.evaluate(() => mock.clicks), 1, 'Prep waits for delayed stones and guard, then upgrades once');
    assert.equal(await page.evaluate(() => mock.level), 10);
    await page.evaluate(() => {
      mock.level = 9; mock.stones = false; mock.guard = false; mock.linh = false; mock.clicks = 0; mock.message = ''; renderFixture();
      const run = __gtUpgrade.runForTest(); setTimeout(() => __gtUpgrade.stop(), 40); return run;
    });
    assert.equal(await page.evaluate(() => mock.clicks), 0, 'Stop during preparation must not spend materials');
    await page.waitForTimeout(500);
    await page.evaluate(() => { mock.level = 9; mock.stones = false; mock.zeroRate = true; mock.guard = false; mock.clicks = 0; renderFixture(); return __gtUpgrade.runForTest(); });
    assert.equal(await page.evaluate(() => mock.clicks), 0, 'Zero chance must not upgrade');
    console.log('PASS: switch reading, 300px panel, rerendered controls, delayed preparation, protected upgrade, max level, stop during preparation, zero chance');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
