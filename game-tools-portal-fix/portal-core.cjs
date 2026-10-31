(function (root) {
  function geometry(portal, map = {}) {
    const edge = String(portal.edge || '').toUpperCase();
    const W = Number(map.w ?? map.width), H = Number(map.h ?? map.height);
    const x = Number(portal.x), y = Number(portal.y);
    const directions = { N: { x: 0, y: -1 }, S: { x: 0, y: 1 }, W: { x: -1, y: 0 }, E: { x: 1, y: 0 } };
    if (!directions[edge]) return null;
    let rect;
    const z = portal.zone;
    if (z && [z.x, z.y, z.w, z.h].every(v => Number.isFinite(Number(v))) && z.w > 0 && z.h > 0) {
      rect = { x: Number(z.x), y: Number(z.y), w: Number(z.w), h: Number(z.h) };
    // Geometry from the game's rf() gate builder; do not aim at the outside of map bounds.
    } else if (edge === 'N' && Number.isFinite(x)) rect = { x: x - 50, y: 200, w: 100, h: 66 };
    else if (edge === 'S' && Number.isFinite(x) && H > 0) rect = { x: x - 50, y: H - 100, w: 100, h: 70 };
    else if (edge === 'W' && Number.isFinite(y)) rect = { x: 40, y: y - 50, w: 80, h: 84 };
    else if (edge === 'E' && Number.isFinite(y) && W > 0) rect = { x: W - 120, y: y - 50, w: 80, h: 84 };
    else return null;
    const dir = directions[edge];
    const goal = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
    if (edge === 'N') goal.y = rect.y + rect.h - 8;
    if (edge === 'S') goal.y = rect.y + 8;
    if (edge === 'W') goal.x = rect.x + rect.w - 8;
    if (edge === 'E') goal.x = rect.x + 8;
    const at = { x: goal.x - dir.x * 64, y: goal.y - dir.y * 64 };
    return { rect, goal, at, dir, edge };
  }
  function inside(rect, p) { return p.x >= rect.x && p.x <= rect.x + rect.w && p.y >= rect.y && p.y <= rect.y + rect.h; }
  class Approach {
    constructor(g) { this.g = g; this.phase = 'align'; this.waitSince = null; this.lastInteract = -Infinity; this.interactions = 0; }
    update(now, me) {
      const g = this.g;
      if (![me?.x, me?.y].every(Number.isFinite)) return { kind: 'no-position' };
      const d = Math.hypot(g.goal.x - me.x, g.goal.y - me.y);
      const cross = g.dir.x ? g.goal.y - me.y : g.goal.x - me.x;
      const along = (g.goal.x - me.x) * g.dir.x + (g.goal.y - me.y) * g.dir.y;
      if (inside(g.rect, me) || (this.phase === 'enter' && along <= 0 && Math.abs(cross) <= 10)) {
        this.phase = 'wait'; if (this.waitSince === null) this.waitSince = now;
      }
      if (this.phase === 'wait') {
        if (now - this.waitSince >= 3200) return { kind: 'failed', precision: true };
        if (now - this.waitSince >= 800 && now - this.lastInteract >= 1000 && this.interactions < 2) {
          this.lastInteract = now; this.interactions++;
          return { kind: 'interact', precision: true };
        }
        return { kind: 'wait', precision: true };
      }
      if (this.phase === 'align' && Math.abs(cross) <= 10 && along >= 0 && along <= 140) this.phase = 'enter';
      if (this.phase === 'enter') {
        // Correct the cross-axis first, then move only INTO the gate. Never bounce back out.
        const dx = Math.abs(cross) > 10 ? (g.dir.x ? 0 : cross) : g.dir.x * Math.max(0, along);
        const dy = Math.abs(cross) > 10 ? (g.dir.x ? cross : 0) : g.dir.y * Math.max(0, along);
        return { kind: 'move', precision: true, dx, dy, distance: Math.hypot(dx, dy) };
      }
      return { kind: 'move', precision: d < 220, dx: g.at.x - me.x, dy: g.at.y - me.y, distance: d };
    }
  }
  const api = { geometry, inside, Approach };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.__gtPortalCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
