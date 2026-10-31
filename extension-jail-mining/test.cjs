const assert = require('node:assert/strict');
const { createMiner } = require('./jail-mining.js');
const { isMiningLabel } = require('./jail-mining.js');
for (const label of ['Đập đá', '⛏ Đập đá', '⛏️ Đập đá', '⛏️ Đập đá (không bớt án)', 'Đập đá khổ sai', 'Đập đá', 'Đập đá (nghỉ 10 giây)']) assert.equal(isMiningLabel(label), true, label);
for (const label of ['Đập đồ', 'Nâng cấp +10', 'Làm giấy ra tù', 'Bắt đầu', 'Đi tới map']) assert.equal(isMiningLabel(label), false, label);
(async () => {
  let now = 0, tick, clicks = 0, visible = true;
  const button = { disabled: false };
  const miner = createMiner({ now: () => now, random: () => 0.5, find: () => visible ? button : null,
    click: async () => { clicks++; }, setInterval: fn => { tick = fn; return 1; }, clearInterval() {} });
  assert.equal(miner.start(), true); assert.equal(miner.state().nextAt, 12500);
  now = 12499; await tick(); await new Promise(r => setImmediate(r)); assert.equal(clicks, 0);
  now = 12500; await tick(); await new Promise(r => setImmediate(r)); assert.equal(clicks, 1);
  assert.equal(miner.state().nextAt, 25000);
  miner.stop(); now = 30000; await tick(); assert.equal(clicks, 1, 'Stop prevents additional clicks');
  miner.start(); visible = false; await tick(); assert.equal(miner.state().running, false);
  console.log('PASS: 12.5s scheduling, no early click, next interval, Stop, missing jail button');
})().catch(error => { console.error(error); process.exitCode = 1; });
