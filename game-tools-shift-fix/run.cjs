const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('D:/Tools/game-tools-playwright/node_modules/playwright');
const { createBridge } = require('./input-bridge.cjs');
const url = process.argv[2] || 'https://play.meono.phanvanhoanganh.com:8443/';
const bridge = createBridge();
(async () => {
  const ctx = await chromium.launchPersistentContext(path.join(__dirname, 'profile'), {
    channel: 'chrome',
    headless: false, viewport: null,
    args: ['--start-maximized'],
  });
  await ctx.exposeBinding('__gtPW', ({ page, frame }, action) => {
    if (frame !== page.mainFrame()) throw Error('Main frame only');
    return bridge.send(page, action);
  });
  // Chrome mới không hỗ trợ nạp tiện ích giải nén bằng cờ dòng lệnh.
  // Nạp cùng mã vào đầu trang, chỉ trên đúng tên miền game.
  const tools = fs.readFileSync(path.join(__dirname, 'game-tools.js'), 'utf8');
  await ctx.addInitScript({ content: `if (location.protocol === 'https:' && (location.hostname === 'meono.phanvanhoanganh.com' || location.hostname.endsWith('.meono.phanvanhoanganh.com'))) {\n${tools}\n}` });
  const monitor = page => {
    page.on('framenavigated', frame => { if (frame === page.mainFrame()) bridge.release(page); });
    page.on('crash', () => bridge.release(page));
    page.on('close', () => bridge.release(page));
    page.on('console', message => { if (message.type() === 'error') console.error(message.text()); });
  };
  ctx.pages().forEach(monitor); ctx.on('page', monitor);
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto(url);
  console.log('Đăng nhập game trong cửa sổ riêng, mở Đi tới map và chọn đích.');
  process.on('SIGINT', async () => { await Promise.all(ctx.pages().map(p => bridge.release(p))); await ctx.close(); });
})().catch(error => { console.error(error.message); process.exitCode = 1; });
