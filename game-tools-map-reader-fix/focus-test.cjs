const assert = require('node:assert/strict');
const { chromium } = require('D:/Tools/game-tools-playwright/node_modules/playwright');
const { createBridge } = require('./input-bridge.cjs');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.route('https://meono.phanvanhoanganh.com/**', route => route.fulfill({ contentType: 'text/html', body: '<canvas class="scene-canvas"></canvas><div id="tool"></div>' }));
    await page.goto('https://meono.phanvanhoanganh.com/shift-local-fixture');
    await page.evaluate(() => {
      const root = document.querySelector('#tool').attachShadow({ mode: 'open' });
      root.innerHTML = '<button id="run">Run</button><input id="text">';
      root.addEventListener('keydown', e => e.stopPropagation());
      root.addEventListener('keyup', e => e.stopPropagation());
      window.shiftEvents = [];
      window.addEventListener('keydown', e => { if (e.code.startsWith('Shift')) window.shiftEvents.push([e.code, e.isTrusted]); });
      root.querySelector('#run').focus();
    });
    const bridge = createBridge();
    await bridge.send(page, { t: 'keydown', key: 'Shift' });
    assert.deepEqual(await page.evaluate(() => window.shiftEvents), [['ShiftLeft', true]], 'Shift reaches game despite tool panel stopping propagation');
    await bridge.send(page, { t: 'keydown', key: 'Shift', repeat: true });
    assert.equal(await page.evaluate(() => window.shiftEvents.length), 2);
    await page.evaluate(() => document.querySelector('#tool').shadowRoot.querySelector('#text').focus());
    await bridge.send(page, { t: 'keydown', key: 'KeyW' });
    assert.equal(await page.evaluate(() => document.querySelector('#tool').shadowRoot.activeElement.id), 'text', 'Do not steal typing focus');
    await bridge.release(page);
    console.log('PASS: trusted Shift reaches game from shadow panel; renewal works; text entry retains focus');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
