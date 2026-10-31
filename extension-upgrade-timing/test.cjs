const assert = require('node:assert/strict');
const { createUpgradeTiming } = require('./timing-core.cjs');
const timing = createUpgradeTiming();
assert.equal(timing.randomDelayMs(() => 0), 10000);
assert.equal(timing.randomDelayMs(() => 0.5), 12500);
assert.equal(timing.randomDelayMs(() => 1), 15000);
for (let i = 0; i < 1000; i++) { const n = timing.randomDelayMs(); assert.ok(n >= 10000 && n <= 15000); }
(async () => {
  let time = 0, running = true; const ticks = [];
  const completed = await timing.wait({ delay: 12000, active: () => running, now: () => time,
    sleep: async ms => { time += ms; }, onTick: seconds => ticks.push(seconds) });
  assert.equal(completed, true); assert.equal(time, 12000);
  assert.equal(ticks[0], 12); assert.equal(ticks.at(-1), 1);
  time = 0;
  const cancelled = await timing.wait({ delay: 15000, active: () => running, now: () => time,
    sleep: async ms => { time += ms; if (time >= 350) running = false; } });
  assert.equal(cancelled, false); assert.ok(time <= 450, 'Stop cancels countdown promptly');
  console.log('PASS: random 10–15s bounds, full countdown, prompt cancellation');
})().catch(e => { console.error(e); process.exitCode = 1; });
