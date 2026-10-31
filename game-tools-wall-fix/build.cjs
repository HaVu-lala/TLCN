const fs = require('node:fs');
const path = require('node:path');
const source = 'D:/Tools/game-tools-extension';
let code = fs.readFileSync(path.join(source, 'game-tools.js'), 'utf8');
function patchCode(from, to) {
  if (!code.includes(from)) throw Error('Feature patch mismatch: ' + from.slice(0, 80));
  code = code.replace(from, to);
}
patchCode('sprint: null,', 'sprint: true,');
patchCode("if (want) { kevS('keydown', shiftHeld); shiftHeld = true; }", "if (want && (!shiftHeld || Date.now() - shiftRenewedAt >= 1500)) { kevS('keydown', shiftHeld); shiftHeld = true; shiftRenewedAt = Date.now(); }");
patchCode('let shiftHeld = false, virt = false;', 'let shiftHeld = false, virt = false, shiftRenewedAt = 0;');
patchCode("send({ t: 'keydown', key: keyName(e) });", "send({ t: 'keydown', key: keyName(e), repeat: !!e.repeat });");
patchCode("const typingNow = () => { const a = document.activeElement; return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable); };", `const typingNow = () => {
    let a = document.activeElement;
    while (a?.shadowRoot?.activeElement) a = a.shadowRoot.activeElement;
    return !!a && (a.isContentEditable || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' ||
      (a.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'submit', 'range'].includes(a.type)));
  };`);
patchCode("else if (shiftHeld) { kevS('keyup'); shiftHeld = false; }", "else if (!want && shiftHeld) { kevS('keyup'); shiftHeld = false; }");
patchCode('setInterval(shiftTick, 250);', `setInterval(shiftTick, 250);
  addEventListener('blur', () => { if (shiftHeld) { kevS('keyup'); shiftHeld = false; } });
  addEventListener('pagehide', () => { if (shiftHeld) { kevS('keyup'); shiftHeld = false; } });`);
patchCode('window.__vut = { onBagFull, isBusy: () => busy, cfg };', `window.__vut = { onBagFull, isBusy: () => busy, cfg,
    setSprint(enabled) { cfg.sprint = !!enabled; save(); shiftTick(); if (ui.sprint) ui.sprint.checked = cfg.sprint; }
  };`);
patchCode("ui = { status: $('ss'), list: $('ls'), at: $('at'), fab: $('fab') };", "ui = { status: $('ss'), list: $('ls'), at: $('at'), fab: $('fab'), sprint: $('sp') };");
const bossStart = code.indexOf('// ===================== Săn boss (trước đây: bt.js) =====================');
const bossEnd = code.indexOf('// =====================', bossStart + 30);
let boss = code.slice(bossStart, bossEnd);
function patchBoss(from, to) {
  if (!boss.includes(from)) throw Error('Boss patch mismatch: ' + from.slice(0, 80));
  boss = boss.replace(from, to);
}
patchBoss('const DEFS = { bossNames: [],', 'const DEFS = { cycleZones: true, zoneStart: 1, zones: 30, bossNames: [],');
patchBoss("if (c[0] === 'p') setPos(c[1], c[2]);", "if (((window.__gtCmd || {})[c[0]] || c[0]) === 'p') setPos(c[1], c[2]);");
patchBoss("const isBoss = m => (cfg.bossRe && cfg.bossRe.test(String(m[12]))) || cfg.bossNames.includes(m[1]) || (typeof m[12] === 'string' && m[12] !== '' && !NOT_BOSS.includes(m[12]));", 'const isBoss = m => window.__gtBossCore.isBoss(m, cfg.bossNames);');
patchBoss("const pollTimer = setInterval(() => { if (on && !paused && !hopping && !document.hidden) poll(); }, cfg.pollMs);", `let polling = false;
    const pollTimer = setInterval(async () => {
      if (!on || paused || hopping || document.hidden || polling) return;
      polling = true; try { await poll(); } finally { polling = false; }
    }, cfg.pollMs);`);
patchBoss("if (bw) {", "if (bw && bw >= cfg.zoneStart && bw <= cfg.zones && bw !== z) {");
patchBoss('for (let i = 0; i < cfg.zones; i++) {\n          const tz = ((z + i) % cfg.zones) + 1;', `for (const tz of window.__gtBossCore.zoneOrder(z, cfg.zoneStart, cfg.zones)) {
          if (!on || paused) return null;`);
patchBoss('const r = await gotoZone(tz);', 'if (!on || paused) return null;\n          const r = await gotoZone(tz);');
patchBoss("if (r !== 'full') break;", "if (r !== 'full' && r !== 'missing') break;");
patchBoss("if (isOpen()) press(btn); return false; }\n      const c =", "if (isOpen()) press(btn); return 'missing'; }\n      const c =");
patchBoss('if (z === cfg.homeZone && !watchZone())', 'if (!cfg.cycleZones && z === cfg.homeZone && !watchZone())');
patchBoss("if (paused || typing() || document.hidden) { release(); continue; }", "if (paused || typing() || document.hidden || window.__gtTravel?.diagnostics().moving) { release(); continue; }");
patchBoss("start() { paused = false;", "start() { if (typeof window.__gtPW !== 'function' && !window.MEONO_VIEW) { log('Cần mở bằng bản thử để game nhận phím/chuột.'); return; } paused = false;");
patchBoss('on = false; paused = true; clearInterval(pollTimer); release();', 'on = false; paused = true; clearInterval(pollTimer); release(); setAuto(am.initial);');
patchBoss('<div class="row"><label>Khu nhà', `<div class="row"><label><input type="checkbox" id="cycle"> Tự đổi khu khi hết boss</label></div>
  <div class="row"><label><input type="checkbox" id="sprint"> Giữ Shift chạy nhanh</label></div>
  <div class="row"><label>Từ khu <input type="number" id="zs" min="1" max="60" style="width:50px"></label><label>đến <input type="number" id="ze" min="1" max="60" style="width:50px"></label></div>
  <div class="row"><label>Khu nhà`);
patchBoss("const apply = () => {", `$('cycle').checked = !!EXT_SAVED.cycleZones;
    $('sprint').checked = !!window.__vut?.cfg.sprint;
    $('sprint').onchange = e => window.__vut?.setSprint(e.target.checked);
    $('zs').value = EXT_SAVED.zoneStart; $('ze').value = EXT_SAVED.zones;
    const apply = () => {`);
patchBoss("$('hz').onchange =", `$('cycle').onchange = e => { EXT_SAVED.cycleZones = e.target.checked; apply(); };
    const saveRange = () => {
      const a = Math.max(1, Math.min(60, Math.trunc(+$('zs').value || 1)));
      const b = Math.max(a, Math.min(60, Math.trunc(+$('ze').value || a)));
      EXT_SAVED.zoneStart = a; EXT_SAVED.zones = b;
      $('zs').value = a; $('ze').value = b; apply();
    };
    $('zs').onchange = saveRange; $('ze').onchange = saveRange;
    $('hz').onchange =`);
code = code.slice(0, bossStart) + boss + code.slice(bossEnd);
code = fs.readFileSync(path.join(__dirname, 'boss-core.cjs'), 'utf8') + '\n' + code;
const marker = '// ===================== Đi tới map (trước đây: travel.js) =====================';
const start = code.indexOf(marker);
if (start < 0) throw Error('Travel module not found');
let travel = code.slice(start);
function replace(from, to) {
  if (!travel.includes(from)) throw Error('Patch no longer matches: ' + from.slice(0, 80));
  travel = travel.replace(from, to);
}
replace("let lastFrom = '', ui = {}", "let runId = 0, renderSignature = '';\n  let lastFrom = '', ui = {}");
replace('lootPaused = false, autoWas = null;', 'lootPaused = false, autoWas = null, bossWasRunning = false;');
replace('  function holdOthers() {', `  function holdOthers() {
    if (window.__bt && !window.__bt.isPaused()) { bossWasRunning = true; window.__bt.pause(); }`);
replace('  function releaseOthers() {', `  function releaseOthers() {
    if (bossWasRunning && window.__bt) window.__bt.resume();
    bossWasRunning = false;`);
const routeStart = travel.indexOf('  function route(a, b) {');
const routeEnd = travel.indexOf('  const nameOf =', routeStart);
travel = travel.slice(0, routeStart) + `  function route(a, b) {
    if (!a || !b) return null;
    if (a === b) return [];
    const lookup = new Map(places().map(p => [info(p).key, p]));
    if (!lookup.has(a) || !lookup.has(b) || lockReason(lookup.get(b))) return null;
    const queue = [a], previous = new Map([[a, null]]);
    for (let head = 0; head < queue.length; head++) {
      const key = queue[head];
      for (const next of neighbors(lookup.get(key))) {
        if (!lookup.has(next) || previous.has(next) || lockReason(lookup.get(next))) continue;
        previous.set(next, key);
        if (next === b) {
          const result = [];
          for (let at = b; at !== a; at = previous.get(at)) result.push(at);
          return result.reverse();
        }
        queue.push(next);
      }
    }
    return null;
  }
` + travel.slice(routeEnd);
replace("if (e && Number.isFinite(y) && W)", "if (e === 'E' && Number.isFinite(y) && W)");
replace('async function hopByMove(pt) {', 'async function hopByMove(pt, token) {');
replace('while (target && currentKey() === m0 && Date.now() - t0 < 90000)', 'while (target && token === runId && currentKey() === m0 && Date.now() - t0 < 45000)');
replace('if (!me) { await sleep(150); continue; }', `if (!me || !Number.isFinite(me.x) || !Number.isFinite(me.y)) {
          if (now - t0 > 5000) { status('Không đọc được vị trí. Hãy di chuyển nhân vật một bước rồi thử lại.'); return false; }
          await sleep(150); continue;
        }`);
replace('Date.now() - tOut < 600 && target', 'Date.now() - tOut < 600 && target && token === runId');
replace('    let dx = pt.x - me.x, dy = pt.y - me.y;', `    const v = view();
    if (!v?.camera || !(Number(v.zoom) > 0)) return false;
    const sx = (pt.x - v.camera.x) * v.zoom;
    const sy = (pt.y - v.camera.y) * v.zoom;
    if (sx < 20 || sy < 20 || sx > r.width - 20 || sy > r.height - 20) return false;
    let dx = sx - r.width / 2, dy = sy - r.height / 2;`);
replace('        releaseKeys();\n        const d = Math.hypot', '        const d = Math.hypot');
replace('lastClick = now; clickToward(g.at, me); status(', 'lastClick = now; if (view()?.camera) { releaseKeys(); if (!clickToward(g.at, me)) steer(g.at.x - me.x, g.at.y - me.y); } else steer(g.at.x - me.x, g.at.y - me.y); status(');
replace("function finish(msg) { releaseKeys();", "function finish(msg) { runId++; releaseKeys();");
replace('hopByMove(portal).then(ok => {\n        if (!target) return;', `const chosen = portal, token = runId;
      hopByMove(chosen, token).then(ok => {
        if (!target || token !== runId) return;`);
replace("finish('⛔ 3 lần không qua được cổng ' + portal.label + '.');", "finish('⛔ 3 lần không qua được cổng ' + chosen.label + '.');");
replace("}).finally(() => { keyBusy = false; lastWalk = Date.now(); });", `}).catch(error => {
        if (token === runId) finish('Lỗi di chuyển: ' + error.message);
      }).finally(() => { keyBusy = false; lastWalk = Date.now(); });`);
replace('  function go(place) {', `  function go(place) {
    if (!place) return status('Không tìm thấy map đích.');
    if (!sceneOf()?.player && typeof window.__gtPW !== 'function') {
      status('Chrome thường: game chặn phím/chuột giả lập. Hãy mở bằng run.cjs để dùng tự đi; tab này vẫn xem được tuyến đường.');
      return false;
    }
    if (info(place).locked) return status(info(place).locked);
    if (!route(currentKey(), info(place).key)) return status('Chưa có tuyến hợp lệ tới map này.');
    runId++; releaseKeys();`);
replace("target = { ...info(place), zone: wantZone() };", "target = { ...info(place), zone: wantZone() };");
replace("const q = norm(ui.q.value), cur = currentKey();", `const q = norm(ui.q.value), cur = currentKey();
    const signature = JSON.stringify([cur, q, target?.key, places().map(info)]);
    if (signature === renderSignature) return;
    renderSignature = signature;`);
replace("if (!document.hidden && host.style.display !== 'none') render();", "if (!document.hidden && $('p').classList.contains('open') && host.style.display !== 'none') render();");
replace("$('fab').onclick = () => { $('p').classList.toggle('open'); render(); };", "$('fab').onclick = () => { $('p').classList.toggle('open'); render(); };");
replace("route, places: () => places().map(info)", `route, places: () => places().map(info),
    diagnostics: () => ({ map: currentKey(), maps: places().length, portals: mapPortals().length,
      directControl: !!sceneOf()?.player, inputBridge: typeof window.__gtPW === 'function',
      position: playerPos(), moving: !!target, status: ui.st?.textContent || '' })`);
replace("if (p) go(p); return !!p;", "return p ? go(p) !== false : false;");
replace("holdOthers(); sync(); render();", "holdOthers(); sync(); render(); return true;");
// Return after setting the status, not before it.
travel = travel.replace("holdOthers(); sync(); render(); return true;\n    status(", "holdOthers(); sync(); render();\n    status(");
replace("'...');\n  }\n\n  // ===== giao diện", "'...');\n    return true;\n  }\n\n  // ===== giao diện");
// Replace the old near-gate push/backtrack loop with a tested portal controller.
const tapStart = travel.indexOf('  function tapMsg(m) {');
const tapEnd = travel.indexOf('  const hookTap', tapStart);
if (tapStart < 0 || tapEnd < 0) throw Error('Cannot locate position observer');
travel = travel.slice(0, tapStart) + `  function tapMsg(m) {
    try {
      const map = currentKey(), packetMap = mapKeyOf(m.url || '');
      if (packetMap && map && packetMap !== map) return;
      if (pos.map && pos.map !== map) { pos.p = null; pos.t = 0; pos.requestT = 0; }
      pos.map = map;
      if (m.dir === 'req' && typeof m.body === 'string' && m.body.includes('"c"')) {
        for (const c of (JSON.parse(m.body).c || [])) {
          if (((window.__gtCmd || {})[c[0]] === 'p' || c[0] === 'm4j' || c[0] === 'p') && Number.isFinite(c[1]) && Number.isFinite(c[2])) {
            pos.p = { x: c[1], y: c[2] }; pos.t = pos.requestT = Date.now(); pos.source = 'movement';
          }
        }
      } else if (m.dir === 'res' && Date.now() - (pos.requestT || 0) > 750) {
        const me = m.json?.data?.full?.me;
        if (Number.isFinite(me?.x) && Number.isFinite(me?.y)) { pos.p = { x: me.x, y: me.y }; pos.t = Date.now(); pos.source = 'snapshot'; }
      }
    } catch (_) {}
  }
` + travel.slice(tapEnd);
travel = travel.replace(" : pos.p; };", " : pos.map === currentKey() ? pos.p : null; };");
travel = travel.replace("position: playerPos(), moving: !!target", "position: playerPos(), positionAge: pos.t ? Date.now() - pos.t : null, trace: window.__gtTravelTrace || null, moving: !!target");
const edgeStart = travel.indexOf('  function edgeGate(p) {');
const edgeEnd = travel.indexOf('  // bấm chuột', edgeStart);
if (edgeStart < 0 || edgeEnd < 0) throw Error('Cannot locate gate geometry');
travel = travel.slice(0, edgeStart) + `  function edgeGate(p) {
    return window.__gtPortalCore.geometry(p, (outerCfg() || {}).map || {});
  }\n` + travel.slice(edgeEnd);
const hopStart = travel.indexOf('  async function hopByMove(pt, token) {');
const hopEnd = travel.indexOf('  let keyBusy = false;', hopStart);
if (hopStart < 0 || hopEnd < 0) throw Error('Cannot locate portal movement');
travel = travel.slice(0, hopStart) + fs.readFileSync(path.join(__dirname, 'portal-hop.js'), 'utf8') + '\n' + travel.slice(hopEnd);
// A single failed entry should stop; retrying the same broken gate recreates the bounce.
travel = travel.replace("else if (++fails >= 3) finish('⛔ 3 lần không qua được cổng ' + chosen.label + '.');", "else finish(window.__gtLastGateFailure || ('Không qua được cổng ' + chosen.label + '. Đã dừng; kiểm tra thông báo trong game.'));");
travel = travel.replace('runId++; releaseKeys();\n    if (!places()', 'runId++; releaseKeys(); window.__gtLastGateFailure = null;\n    if (!places()');
// Remove the old retry else, now unreachable and syntactically invalid after unconditional else.
travel = travel.replace("\n        else { portal = null; status('⚠️ Chưa qua được cổng, thử lại (' + fails + '/3)'); }", '');
code = code.slice(0, start) + travel;
code = fs.readFileSync(path.join(__dirname, 'portal-core.cjs'), 'utf8') + '\n' + code;
code = code.replace('const want = !!cfg.sprint &&', 'const want = !!cfg.sprint && !window.__gtTravelPrecision &&');
code = code.replace('if (cfg.sprint) { inp.setVirtualSprint(true);', 'if (cfg.sprint && !window.__gtTravelPrecision) { inp.setVirtualSprint(true);');
code = code.replace('setSprint(enabled) { cfg.sprint', 'refreshSprint() { shiftTick(); },\n    setSprint(enabled) { cfg.sprint');
// Share parsed response bodies and never make the game wait for the boss observer.
const beforeBossFetch = `if (url.includes('/khu?zone=')) { S.khuUrl = new URL(url, location.href).href.split('?')[0]; onFull(((await res.clone().json()).data || {}).full); }
        else if (/\\/vao(\\?|$)/.test(url)) onFull(((await res.clone().json()).data || {}).full);
        else if (url.includes('/lenh')) onPacket(((await res.clone().json()).data || {}).packet);`;
if (!code.includes(beforeBossFetch)) throw Error('Boss fetch performance patch mismatch');
code = code.replace(beforeBossFetch, `if (url.includes('/khu?zone=')) {
          S.khuUrl = new URL(url, location.href).href.split('?')[0];
          window.__gtObserveResponse(res, window.__gtReadJSON, j => onFull((j.data || {}).full));
        } else if (/\\/vao(\\?|$)/.test(url)) {
          window.__gtObserveResponse(res, window.__gtReadJSON, j => onFull((j.data || {}).full));
        } else if (url.includes('/lenh')) {
          window.__gtObserveResponse(res, window.__gtReadJSON, j => onPacket((j.data || {}).packet));
        }`);
code = code.replace("res.clone().json().then(j => emit(", "window.__gtReadJSON(res).then(j => emit(");
code = code.replace("const status = t => { if (ui.st) ui.st.textContent = t; };", "const status = t => { if (ui.st && ui.st.textContent !== t) ui.st.textContent = t; };");
code = fs.readFileSync(path.join(__dirname, 'network-cache.cjs'), 'utf8') + '\n' + code;
fs.writeFileSync(path.join(__dirname, 'game-tools.js'), code);
fs.writeFileSync(path.join(__dirname, 'travel.test-source.js'), travel);
const manifest = JSON.parse(fs.readFileSync(path.join(source, 'manifest.json'), 'utf8'));
manifest.version = '2.6.6';
manifest.name += ' — sửa tìm đường';
fs.writeFileSync(path.join(__dirname, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log('Built optimized extension 2.6.6');
