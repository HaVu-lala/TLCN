const assert = require('node:assert/strict');
const { geometry, Approach, inside } = require('./portal-core.cjs');
const { safeVector } = require('./portal-core.cjs');
const map = { w: 2000, h: 1400 };
for (const edge of ['N', 'S', 'W', 'E']) {
  const g = geometry({ edge, x: 900, y: 650 }, map);
  assert.ok(inside(g.rect, g.goal), edge + ' target is inside portal');
  assert.ok(g.goal.y >= 250 && g.goal.y <= map.h - 70 && g.goal.x >= 70 && g.goal.x <= map.w - 70, edge + ' target stays inside walkable map bounds');
  const control = new Approach(g);
  let me = { ...g.at }, now = 0, backwards = 0;
  for (let i = 0; i < 120; i++) {
    const step = control.update(now, me);
    if (step.kind === 'wait' || step.kind === 'interact') break;
    if (step.kind !== 'move') throw Error(edge + ': unexpected state ' + step.kind);
    if (step.dx * g.dir.x + step.dy * g.dir.y < 0) backwards++;
    const n = Math.hypot(step.dx, step.dy) || 1;
    const length = Math.min(12, n);
    me.x += step.dx / n * length; me.y += step.dy / n * length; now += 150;
  }
  assert.ok(inside(g.rect, me), edge + ' enters the gate');
  assert.equal(backwards, 0, edge + ' never moves back out of aligned gate');
  const step = control.update(now + 4000, me);
  assert.equal(step.kind, 'failed', edge + ' blocked entry stops instead of bouncing');
}
const top = geometry({ edge: 'N', x: 800 }, map);
assert.equal(top.goal.y, 258, 'Regression: north gate is at y=258, not y=110');
const c = new Approach(top);
const initial = c.update(0, { x: 840, y: 340 });
assert.equal(initial.dx < 0, true, 'Align horizontally before entering');
const inGate = new Approach(top);
assert.equal(inGate.update(0, top.goal).kind, 'wait', 'Starting inside a gate does not retreat');
assert.equal(inGate.update(850, top.goal).kind, 'interact');
assert.equal(inGate.update(900, top.goal).kind, 'wait', 'Throttle interaction');
assert.equal(geometry({ edge: 'unknown', x: 1, y: 1 }, map), null);
assert.equal(geometry({ edge: 'E', y: 100 }, {}), null, 'Unknown dimensions must not invent a gate');
assert.equal(geometry({ edge: 'N', x: 99999 }, map), null, 'A portal outside the map must not drive the player into a wall');
const bounds = { x: 70, y: 214, right: 1930, bottom: 1340 };
for (const [p, vector] of [
  [{ x: 70, y: 500 }, { dx: -100, dy: 50 }],
  [{ x: 1930, y: 500 }, { dx: 100, dy: 50 }],
  [{ x: 500, y: 214 }, { dx: 50, dy: -100 }],
  [{ x: 500, y: 1340 }, { dx: 50, dy: 100 }],
]) {
  const fixed = safeVector(bounds, p, { kind: 'move', ...vector });
  assert.equal(fixed.blockedByWall, true);
  assert.ok(fixed.dx === 0 || fixed.dy === 0, 'Slide along wall without pressing into it');
}
console.log('PASS: N/S/E/W geometry, walkable targets, alignment, no reverse oscillation, blocked-entry timeout, interaction throttle');
