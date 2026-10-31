const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createBridge } = require('./input-bridge.cjs');
const bossCore = require('./boss-core.cjs');
assert.deepEqual(bossCore.zoneOrder(2, 1, 4), [3, 4, 1]);
assert.deepEqual(bossCore.zoneOrder(4, 1, 4), [1, 2, 3]);
assert.deepEqual(bossCore.zoneOrder(1, 1, 1), []);
assert.deepEqual(bossCore.zoneOrder(8, 2, 4), [2, 3, 4]);
assert.deepEqual(bossCore.zoneOrder(2, 4, 1), []);
const mob = []; mob[1] = 'Test'; mob[12] = 'elite';
assert.equal(bossCore.isBoss(mob), false);
mob[12] = 'boss'; assert.equal(bossCore.isBoss(mob), true);
mob[12] = 'npc'; assert.equal(bossCore.isBoss(mob), false);
assert.equal(bossCore.isBoss(mob, ['test']), true);
const store = new Map();
const world = [
  { key: 'a', name: 'A', links: ['b', 'c', 'missing'] },
  { key: 'b', name: 'B', links: ['a', 'd'], req: { level: 10 } },
  { key: 'c', name: 'C', links: ['d'] },
  { key: 'd', name: 'D', links: [] },
  { key: 'locked', req: { level: 99 }, links: [] },
];
const window = { MEONO_SCENE: { outer: { map: { key: 'a' }, world, hero: { level: 5 } } } };
const document = { body: null, addEventListener() {}, querySelector() { return null; } };
const context = vm.createContext({ window, document, console, location: { pathname: '/ngoai-gioi/a' },
  sessionStorage: { getItem: key => store.get(key) || null, setItem: (key, value) => store.set(key, value), removeItem: key => store.delete(key) },
  setTimeout, clearTimeout, setInterval, clearInterval });
vm.runInContext(fs.readFileSync(__dirname + '/travel.test-source.js', 'utf8').replace('window.__gtTravel = {', 'window.__testTap = tapMsg; window.__gtTravel = {'), context);
const api = window.__gtTravel;
assert.ok(api, 'Travel module must initialize');
const route = (a, b) => JSON.parse(JSON.stringify(api.route(a, b)));
assert.deepEqual(route('a', 'd'), ['c', 'd'], 'Must avoid locked intermediate map');
assert.deepEqual(route('a', 'a'), [], 'Already at destination');
assert.equal(route('a', 'missing'), null, 'Unknown maps are not destinations');
assert.equal(route('a', 'locked'), null, 'Locked target is not reachable');
assert.equal(route('d', 'a'), null, 'Respect one-way links');
world[1].req.level = 1;
assert.deepEqual(route('a', 'd'), ['b', 'd'], 'Cycle-safe shortest path');
assert.equal(api.go('d'), false, 'Normal Chrome cannot silently claim to move');
assert.equal(api.diagnostics().moving, false);
assert.equal(api.go('unknown'), false);
window.__testTap({ dir: 'req', url: 'https://meono.phanvanhoanganh.com/ngoai-gioi/a/lenh', body: JSON.stringify({ c: [['p', 900, 800]] }) });
assert.equal(api.diagnostics().position.x, 900);
window.__testTap({ dir: 'res', url: 'https://meono.phanvanhoanganh.com/ngoai-gioi/a/khu', json: { data: { full: { me: { x: 70, y: 214 } } } } });
assert.equal(api.diagnostics().position.x, 900, 'An older snapshot cannot rewind a fresh movement position');
window.MEONO_SCENE.outer.map.key = 'b';
assert.equal(api.diagnostics().position, null, 'Do not reuse coordinates from the previous map');
window.__testTap({ dir: 'res', url: 'https://meono.phanvanhoanganh.com/ngoai-gioi/a/khu', json: { data: { full: { me: { x: 100, y: 100 } } } } });
assert.equal(api.diagnostics().position, null, 'Ignore late responses from the old map');
window.__testTap({ dir: 'res', url: 'https://meono.phanvanhoanganh.com/ngoai-gioi/b/khu', json: { data: { full: { me: { x: 110, y: 300 } } } } });
assert.equal(api.diagnostics().position.x, 110, 'Accept the new map snapshot');
window.MEONO_SCENE.outer.map.key = 'a';
window.MEONO_VIEW = { outerView: { scene: { player: { x: 100, y: 100 } }, client: { cfg: { world }, map: { key: 'a' }, hero: { level: 5 } } } };
assert.equal(api.go('d'), true);
assert.equal(api.diagnostics().moving, true);
api.stop();
assert.equal(api.diagnostics().moving, false, 'Stop must invalidate the active trip');
async function testBridge() {
  const events = [];
  function page(label) { return { url: () => 'https://play.meono.phanvanhoanganh.com:8443/', isClosed: () => false,
    evaluate: async () => true,
    keyboard: { down: async key => events.push([label, 'down', key]), up: async key => events.push([label, 'up', key]) },
    mouse: { click: async () => {}, move: async () => {} } }; }
  const bridge = createBridge(), a = page('a'), b = page('b');
  await Promise.all([bridge.send(a, { t: 'keydown', key: 'KeyW' }), bridge.send(b, { t: 'keydown', key: 'KeyW' })]);
  assert.equal(events.length, 2, 'Keys are independent per page');
  await bridge.send(a, { t: 'keydown', key: 'KeyW' });
  assert.equal(events.length, 2, 'Duplicate keydown is suppressed');
  await bridge.release(a); await bridge.release(b);
  assert.equal(events.filter(e => e[1] === 'up').length, 2, 'Stop releases all held keys');
  await bridge.send(a, { t: 'keydown', key: 'Shift' });
  await bridge.send(a, { t: 'keydown', key: 'Shift' });
  assert.equal(events.filter(e => e[0] === 'a' && e[1] === 'down' && e[2] === 'Shift').length, 1, 'Sprint holds Shift without repeat spam');
  await bridge.send(a, { t: 'keydown', key: 'Shift', repeat: true });
  assert.equal(events.filter(e => e[0] === 'a' && e[1] === 'down' && e[2] === 'Shift').length, 2, 'Sprint renews after the game clears its key state');
  await bridge.release(a);
  assert.equal(events.at(-1)[2], 'Shift', 'Sprint key is released');
  await bridge.send(a, { t: 'keydown', key: 'KeyF' });
  a.evaluate = async () => false;
  await bridge.send(a, { t: 'keydown', key: 'KeyD' });
  assert.equal(events.at(-1)[1], 'up', 'Typing releases held gameplay keys');
  a.evaluate = async () => true;
  await bridge.release(a);
  await assert.rejects(bridge.send(a, { t: 'click', x: NaN, y: 1 }));
  await assert.rejects(bridge.send({ ...a, url: () => 'https://example.com/' }, { t: 'keydown', key: 'KeyW' }));
  let fail = true;
  a.keyboard.down = async () => { if (fail) { fail = false; throw Error('Transient input failure'); } events.push(['recovered']); };
  await assert.rejects(bridge.send(a, { t: 'keydown', key: 'KeyA' }));
  await bridge.send(a, { t: 'keydown', key: 'KeyA' });
  assert.equal(events.at(-1)[0], 'recovered', 'Queue recovers after an input failure');
  await bridge.release(a);
  console.log('PASS: route, locked maps, cycles, missing map, normal Chrome diagnostics, per-tab input, key release, input validation and queue recovery');
}
testBridge().catch(error => { console.error(error); process.exitCode = 1; });
