// ===================== Đi tới map (trước đây: travel.js) =====================
try {
// 🧭 Đi tới map — dùng thẳng đối tượng của game (window.MEONO_VIEW), cùng cách với boss.js:
// - Danh sách map của thế giới: outerView.client.cfg.world (key, name, region, links = map kề, req = điều kiện mở)
// - Map đang đứng: outerView.client.map.key
// - Cổng của map: scene.portals (vùng cổng) + scene.outerPlan.portals (cổng dẫn tới map nào)
// - Đi tới cổng: scene.approach({kind:'portal'}) = hàm game dùng khi bấm mũi tên; đứng trong cổng → scene.interact()
// - Đường ngắn nhất: tìm theo chiều rộng (ít cổng nhất) trên đồ thị links, bỏ qua map chưa mở khoá
(() => {
  if (window.__gtTravelExt) return;
  window.__gtTravelExt = true;

  const GOALK = 'gtTravelGoal';
  const ss = { get: k => { try { return sessionStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { sessionStorage.setItem(k, v); } catch (e) {} }, del: k => { try { sessionStorage.removeItem(k); } catch (e) {} } };
  const norm = v => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/đ/g, 'd').replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ').trim();

  let runId = 0, renderSignature = '';
  let lastFrom = '', ui = {}, target = null, portal = null, lastWalk = 0, fails = 0, stuck = { t: 0, d: Infinity }, lootPaused = false, autoWas = null, bossWasRunning = false;
  const status = t => { if (ui.st) ui.st.textContent = t; };

  // ===== đọc dữ liệu game =====
  const view = () => window.MEONO_VIEW || null;
  const ctl = () => view() && view().outerView || null;
  const sceneOf = () => { const v = view(); return (v && v.outerView && v.outerView.scene) || (v && v.scene) || null; };
  // trên trang thật game KHÔNG tạo window.MEONO_VIEW (chỉ có khi chạy localhost) → đọc thẳng cấu hình ngoại giới MEONO_SCENE.outer
  const outerCfg = () => { const s = window.MEONO_SCENE; return (s && s.outer) || null; };
  const mapKeyOf = u => (String(u || '').match(/\/ngoai-gioi\/([^/?#]+)/) || [])[1] || '';
  const currentKey = () => {
    const v = view(), o = outerCfg();
    return String((v && v.outerView && v.outerView.client && v.outerView.client.map && v.outerView.client.map.key) || (v && v.opts && v.opts.world && v.opts.world.current) ||
      (o && o.map && o.map.key) || mapKeyOf(location.pathname) || (window.MEONO_SCENE && window.MEONO_SCENE.key) || '');
  };
  function places() {
    const v = view(), c = v && v.outerView && v.outerView.client, o = outerCfg();
    const rows = (c && c.cfg && c.cfg.world) || (v && v.opts && v.opts.world && v.opts.world.outer) || (o && o.world) || [];
    return Array.isArray(rows) ? rows.filter(r => r && typeof r === 'object') : [];
  }
  function heroState() {
    const c = ctl() && ctl().client, o = outerCfg() || {};
    if (c) return { hero: c.hero || (c.state && c.state.hero) || null, quests: (c.state && c.state.quests) || {} };
    return { hero: o.hero || (o.state && o.state.hero) || null, quests: (o.state && o.state.quests) || o.quests || {} };
  }
  function lockReason(place) {
    const req = place && (place.req || (place.map && place.map.req)); if (!req) return '';
    const { hero, quests } = heroState();
    if (!hero) return '';                      // không đọc được nhân vật → không chặn (game sẽ tự báo nếu chưa mở)
    // chỉ chặn khi đọc chắc được số liệu (không kiểm tra bái sư: game không bắt buộc)
    if (req.level && Number.isFinite(Number(hero.level)) && Number(hero.level) < Number(req.level)) return 'Cần cấp ' + req.level;
    if (req.step && quests && Number.isFinite(Number(quests.chain_done)) && Number(quests.chain_done) < Number(req.step)) return 'Cần nhiệm vụ bước ' + req.step;
    return '';
  }
  const info = p => ({ key: String((p && (p.key || (p.map && p.map.key))) || ''), name: String((p && (p.name || (p.map && p.map.name) || p.key)) || 'Khu chưa có tên'), region: String((p && (p.region_name || p.regionName || p.region)) || ''), locked: lockReason(p) });
  const neighbors = p => { const l = (p && (p.links ?? (p.map && p.map.links))) || []; return Array.isArray(l) ? l.map(x => String(typeof x === 'object' ? (x.to ?? x.key ?? x.map) : x || '')).filter(Boolean) : []; };
  // đường ít cổng nhất từ a tới b (bỏ qua map chưa mở) → danh sách mã map
  function route(a, b) {
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
  const nameOf = k => { const p = places().find(x => info(x).key === k); return p ? info(p).name : k; };
  function portalPos(pt) {
    const z = pt && pt.zone;
    if (z) {
      const x = Number(z.centerX ?? (Number(z.x) + Number(z.w) / 2));
      // cổng kích hoạt ở mép dưới vùng cổng, không phải chính giữa
      const bottom = Number(z.bottom), calc = Number(z.y) + Number(z.h), cy = Number(z.centerY ?? (Number(z.y) + Number(z.h) / 2));
      const y = Number.isFinite(bottom) ? bottom - 4 : Number.isFinite(calc) ? calc - 4 : cy;
      if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };
    }
    const p = (pt && (pt.pos || pt.position || pt.at || pt.point)) || pt;
    const x = Number(p && (p.x ?? pt.x)), y = Number(p && (p.y ?? pt.y));
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
  }
  function mapPortals() {
    const s = sceneOf(), list = s && s.portals, plans = (s && s.outerPlan && Array.isArray(s.outerPlan.portals)) ? s.outerPlan.portals : [];
    if (!Array.isArray(list)) {
      // không có đối tượng cảnh của game → cổng từ cấu hình map (MEONO_SCENE.outer.map.portals)
      const o = outerCfg(), urls = (window.MEONO_SCENE && window.MEONO_SCENE.urls) || {};
      const raw = (o && o.map && Array.isArray(o.map.portals)) ? o.map.portals : [];
      return raw.map((p, i) => ({
        id: String(p.id ?? i), pos: portalPos(p), gate: edgeGate(p),
        to: String(p.to || mapKeyOf(urls['gate:' + p.id]) || ''),
        label: String(p.name || p.label || p.to || 'Cổng'),
      }));
    }
    return list.map((pt, i) => ({ pt, i, pos: portalPos(pt) })).filter(x => x.pos).map(({ pt, i, pos }) => ({
      id: String(pt.id ?? pt.key ?? i), pos,
      to: String((plans.find(p => String(p && p.id) === String(pt.id)) || {}).to || pt.to || pt.to_key || ''),
      label: String(pt.label || pt.name || pt.title || pt.to_name || pt.to || 'Cổng chưa rõ đích'),
    }));
  }

  // ===== không có MEONO_VIEW: đi thẳng tới cổng (không dò F2 từng mục) =====
  // Vị trí cổng tính như game: mỗi cổng nằm ở 1 mép bản đồ (edge N/S/W/E) tại toạ độ x (mép trên/dưới) hoặc y (mép trái/phải).
  // Đi bằng BẤM CHUỘT lên bản đồ (game tự tìm đường vòng qua vật cản); tới sát mép thì giữ phím đi thẳng vào cổng.
  // Kẹt (2,5 giây không nhích) → lách bằng phím: lùi lại, đi ngang 1 đoạn (đổi bên mỗi lần kẹt) rồi bấm chuột lại.
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const pos = { p: null, t: 0 };
  function tapMsg(m) {
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
  const hookTap = () => { if (!hookTap.done && window.__lootTap && window.__lootTap.subs) { window.__lootTap.subs.add(tapMsg); hookTap.done = true; } };
  const playerPos = () => { const s = sceneOf(); return s && s.player ? { x: s.player.x, y: s.player.y } : pos.map === currentKey() ? pos.p : null; };
  const KEY = { up: { key: 'w', code: 'KeyW', keyCode: 87 }, down: { key: 's', code: 'KeyS', keyCode: 83 }, left: { key: 'a', code: 'KeyA', keyCode: 65 }, right: { key: 'd', code: 'KeyD', keyCode: 68 } };
  const kev = (type, k) => (document.querySelector('.scene-canvas') || document.body).dispatchEvent(new KeyboardEvent(type, { key: k.key, code: k.code, keyCode: k.keyCode, which: k.keyCode, bubbles: true, cancelable: true, composed: true }));
  const held = { up: false, down: false, left: false, right: false };
  function setHeld(w) { for (const d of Object.keys(held)) { if (w[d] && !held[d]) { held[d] = true; kev('keydown', KEY[d]); } else if (!w[d] && held[d]) { held[d] = false; kev('keyup', KEY[d]); } } }
  const releaseKeys = () => setHeld({});
  function steer(dx, dy) { const ax = Math.abs(dx), ay = Math.abs(dy), t = 0.414; setHeld({ left: dx < 0 && ax > 10 && ax > t * ay, right: dx > 0 && ax > 10 && ax > t * ay, up: dy < 0 && ay > 10 && ay > t * ax, down: dy > 0 && ay > 10 && ay > t * ax }); }
  // cổng theo mép bản đồ: at = điểm đứng trước cổng, dir = hướng đi vào cổng
  function edgeGate(p) {
    return window.__gtPortalCore.geometry(p, (outerCfg() || {}).map || {});
  }
  // bấm chuột lên bản đồ ở hướng điểm đích (camera giữ nhân vật ở giữa khung; điểm ngoài màn hình thì bấm ở mép theo hướng đó)
  function clickToward(pt, me) {
    const cv = document.querySelector('canvas.scene-canvas') || document.querySelector('.scene-canvas'); if (!cv || !me) return false;
    const r = cv.getBoundingClientRect(); if (!r.width) return false;
    const v = view();
    if (!v?.camera || !(Number(v.zoom) > 0)) return false;
    const sx = (pt.x - v.camera.x) * v.zoom;
    const sy = (pt.y - v.camera.y) * v.zoom;
    if (sx < 20 || sy < 20 || sx > r.width - 20 || sy > r.height - 20) return false;
    let dx = sx - r.width / 2, dy = sy - r.height / 2;
    const lim = Math.min(r.width / 2 - 40, r.height / 2 - 40), d = Math.hypot(dx, dy) || 1;
    if (d > lim) { dx = dx / d * lim; dy = dy / d * lim; }
    const x = r.left + r.width / 2 + dx, y = r.top + r.height / 2 + dy;
    const o = { bubbles: true, cancelable: true, composed: true, view: window, button: 0, buttons: 1, clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', isPrimary: true };
    for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) cv.dispatchEvent(new (t.startsWith('pointer') ? PointerEvent : MouseEvent)(t, o));
    return true;
  }
  async function hopByMove(pt, token) {
    const m0 = currentKey(), g = pt.gate;
    if (!g?.rect) { status('Không đọc được vùng kích hoạt cổng ' + pt.label + '. Đã dừng.'); return false; }
    const approach = new window.__gtPortalCore.Approach(g);
    const t0 = Date.now(); let progress = null, dodges = 0, staleSince = 0, lastTrace = 0;
    let precisionApplied = false;
    const setPrecision = enabled => {
      window.__gtTravelPrecision = enabled;
      if (precisionApplied !== enabled) { precisionApplied = enabled; window.__vut?.refreshSprint?.(); }
    };
    const fail = message => { window.__gtLastGateFailure = message; status(message); return false; };
    const active = () => !!target && token === runId && currentKey() === m0;
    const tap = async key => { kev('keydown', key); await sleep(45); kev('keyup', key); };
    try {
      while (active() && Date.now() - t0 < 45000) {
        const now = Date.now(), me = playerPos();
        if (!sceneOf()?.player && (!pos.t || now - pos.t > 1000)) {
          releaseKeys();
          if (!staleSince) staleSince = now;
          status('Đang chờ vị trí mới của nhân vật; tạm nhả phím để tránh đâm tường.');
          if (now - staleSince > 5000) return fail('Mất đồng bộ vị trí quá 5 giây. Đã dừng, không tiếp tục đẩy vào tường.');
          await sleep(150); continue;
        }
        staleSince = 0;
        const step = window.__gtPortalCore.safeVector(g.bounds, me, approach.update(now, me));
        if (now - lastTrace >= 1000) {
          lastTrace = now;
          window.__gtTravelTrace = { map: m0, gate: pt.id, phase: approach.phase,
            x: me?.x, y: me?.y, age: sceneOf()?.player ? 0 : now - pos.t,
            bounds: g.bounds, goal: g.goal, dx: step.dx, dy: step.dy, source: pos.source || 'scene' };
          if (typeof window.__gtDiag === 'function') window.__gtDiag(window.__gtTravelTrace).catch(() => {});
        }
        if (step.blockedByWall && !step.dx && !step.dy) return fail('Hướng đi đang bị chặn bởi mép map. Đã lưu chẩn đoán và dừng.');
        setPrecision(!!step.precision);
        if (step.kind === 'no-position') {
          releaseKeys(); if (now - t0 > 5000) return fail('Không đọc được vị trí nhân vật.');
          await sleep(150); continue;
        }
        if (step.kind === 'failed') return fail('Đã đứng trong cổng nhưng game chưa cho qua. Kiểm tra điều kiện map hoặc thông báo của game.');
        if (step.kind === 'wait' || step.kind === 'interact') {
          releaseKeys();
          status('Đã vào vùng cổng ' + pt.label + ', đang chờ chuyển map…');
          if (step.kind === 'interact') {
            await tap({ key: 'Escape', code: 'Escape', keyCode: 27 });
            if (active()) await tap({ key: 'Enter', code: 'Enter', keyCode: 13 });
          }
          await sleep(100); continue;
        }
        // Far from the gate, retain bounded obstacle recovery. Near the gate, never backtrack.
        if (!step.precision) {
          if (!progress) progress = { t: now, x: me.x, y: me.y };
          if (now - progress.t > 2600) {
            if (Math.hypot(me.x - progress.x, me.y - progress.y) < 12) {
              if (++dodges > 3) return fail('Bị vật cản trước cổng; đã dừng để tránh chạy lặp.');
              const side = dodges % 2 ? 1 : -1;
              steer(-step.dy * side, step.dx * side); await sleep(200); releaseKeys();
            }
            progress = { t: Date.now(), x: me.x, y: me.y };
          }
          steer(step.dx, step.dy); await sleep(80); continue;
        }
        // Let the shared sprint controller release Shift before the precise approach.
        setHeld({ left: step.dx < -4, right: step.dx > 4, up: step.dy < -4, down: step.dy > 4 });
        const duration = Math.max(20, Math.min(70, step.distance / 280 * 1000 * 0.55));
        await sleep(duration); releaseKeys();
        status('Căn cổng ' + pt.label + ' · ' + (approach.phase === 'enter' ? 'đi vào cổng' : 'căn thẳng hàng'));
        await sleep(120);
      }
    } finally { setPrecision(false); releaseKeys(); }
    return currentKey() !== m0;
  }

  let keyBusy = false;

  // ===== tự đánh / Nhặt + Đánh: tạm dừng khi đang đi, tới nơi trả lại =====
  // nút TỰ ĐÁNH trên giao diện (khi không có đối tượng game)
  const autoBtn = () => document.querySelector('.ng-slot.is-auto');
  const autoBtnOn = () => { const b = autoBtn(); if (!b) return false; const ap = b.getAttribute('aria-pressed'); return ap != null ? ap === 'true' : /is-on/.test(b.className); };
  const clickAuto = () => { const b = autoBtn(); if (!b) return; for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) b.dispatchEvent(new (t.startsWith('pointer') ? PointerEvent : MouseEvent)(t, { bubbles: true, cancelable: true, composed: true, view: window, button: 0 })); b.click(); };
  function holdOthers() {
    if (window.__bt && !window.__bt.isPaused()) { bossWasRunning = true; window.__bt.pause(); }
    if (window.__loot && typeof window.__loot.isPaused === 'function' && !window.__loot.isPaused()) { window.__loot.pause(); lootPaused = true; }
    const c = ctl(); if (c && typeof c.toggleAuto === 'function') { if (c.autoOn) { autoWas = true; c.toggleAuto(); } } else if (autoBtnOn()) { autoWas = true; clickAuto(); }
  }
  function releaseOthers() {
    if (bossWasRunning && window.__bt) window.__bt.resume();
    bossWasRunning = false;
    const c = ctl(); if (autoWas) { if (c && typeof c.toggleAuto === 'function') { if (!c.autoOn) c.toggleAuto(); } else if (!autoBtnOn()) clickAuto(); }
    autoWas = null;
    if (lootPaused && window.__loot && typeof window.__loot.start === 'function') window.__loot.start();
    lootPaused = false;
  }
  function finish(msg) { runId++; releaseKeys(); target = null; portal = null; ss.del(GOALK); releaseOthers(); status(msg); sync(); render(); }

  // ===== vòng đi =====
  function pulse() {
    if (!target) return;
    const at = Date.now();
    if (at - lastWalk < 350) return;
    const cur = currentKey();
    if (!cur) { status('Đang chờ game tải map hiện tại...'); return; }
    if (cur === target.key) {
      if (target.zone && zoneNow() !== target.zone) {
        if (!zoneBusy) { zoneBusy = true; status('Đã tới ' + target.name + ' → chuyển sang Khu ' + target.zone + '...'); gotoZone(target.zone).then(r => finish(r === true ? '✅ Đã tới ' + target.name + ' · Khu ' + target.zone + '.' : '⚠️ Đã tới ' + target.name + ' nhưng ' + r)).finally(() => { zoneBusy = false; }); }
        return;
      }
      return finish('✅ Đã tới ' + target.name + (target.zone ? ' · Khu ' + target.zone : '') + '.');
    }
    // chọn cổng kế tiếp trên đường ngắn nhất
    if (!portal || portal.fromKey !== cur) {
      const path = route(cur, target.key);
      const next = path && path[0];
      const p = next && mapPortals().find(x => x.to === next);
      if (!next || !p) return finish('⛔ Không có đường cổng tới ' + target.name + ' từ ' + nameOf(cur) + '. Đã dừng để tránh đi sai.');
      if (lastFrom !== cur) { fails = 0; lastFrom = cur; }
      portal = { ...p, fromKey: cur, steps: path.length }; stuck = { t: at, d: Infinity };
      status('🧭 ' + nameOf(cur) + ' → ' + nameOf(next) + ' (còn ' + path.length + ' cổng: ' + path.map(nameOf).join(' → ') + ')');
    }
    const s = sceneOf(), pl = s && s.player;
    if (!pl) {
      // không có đối tượng cảnh (trang thật): đi bằng F2 + Enter
      if (keyBusy) return;
      keyBusy = true;
      const chosen = portal, token = runId;
      hopByMove(chosen, token).then(ok => {
        if (!target || token !== runId) return;
        if (ok) { portal = null; fails = 0; }
        else finish(window.__gtLastGateFailure || ('Không qua được cổng ' + chosen.label + '. Đã dừng; kiểm tra thông báo trong game.'));
      }).catch(error => {
        if (token === runId) finish('Lỗi di chuyển: ' + error.message);
      }).finally(() => { keyBusy = false; lastWalk = Date.now(); });
      return;
    }
    // cổng thật đang hiện (đổi map là đối tượng cổng thay mới)
    const live = Array.isArray(s.portals) ? s.portals.find(x => String(x && (x.id ?? x.key)) === portal.id) : null;
    const pos = live ? portalPos(live) : portal.pos;
    if (!pos) return finish('⛔ Không đọc được vị trí cổng trên map hiện tại.');
    const d = Math.hypot(pos.x - pl.x, pos.y - pl.y);
    lastWalk = at;
    // không tiến lại gần trong 20 giây → bỏ
    if (d < stuck.d - 20) stuck = { t: at, d }; else if (at - stuck.t > 20000) { if (++fails >= 3) return finish('⛔ Kẹt, không tới được cổng ' + portal.label + '.'); stuck = { t: at, d }; }
    const act = s.activePortal, here = act && String(act.id) === portal.id;
    const go = () => { if (typeof s.approach === 'function') s.approach({ key: 'portal:' + portal.id, kind: 'portal', x: pos.x, y: pos.y }); else if (typeof s.handlePointer === 'function') s.handlePointer(pos.x, pos.y); else if (pl.walkTo) pl.walkTo(pos.x, pos.y); };
    if (d <= 28) { if (here && typeof s.interact === 'function') s.interact(); else go(); status('Đang qua cổng: ' + portal.label + '...'); return; }
    go();
    status('🧭 Chạy tới cổng ' + portal.label + ' (' + Math.round(d) + ') · còn ' + portal.steps + ' cổng tới ' + target.name);
  }
  // ===== khu =====
  let zoneBusy = false;
  const zoneNow = () => { const b = document.querySelector('button.scene-zone'); const m = b && (b.textContent || '').match(/Khu\s*(\d+)/); return m ? +m[1] : null; };
  const pressEl = el => { for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) el.dispatchEvent(new (t.startsWith('pointer') ? PointerEvent : MouseEvent)(t, { bubbles: true, cancelable: true, composed: true, view: window, button: 0 })); el.click(); };
  async function gotoZone(n) {
    if (zoneNow() === n) return true;
    const btn = document.querySelector('button.scene-zone'); if (!btn) return 'không thấy nút chọn khu';
    const isOpen = () => document.querySelector('.scene-zone-panel.is-open');
    if (!isOpen()) { pressEl(btn); await sleep(450); }
    const items = [...document.querySelectorAll('.scene-zone__item')];
    const it = items.find(x => ((x.querySelector('.scene-zone__n') || {}).textContent || '').trim() === 'Khu ' + n);
    if (!it) { if (isOpen()) pressEl(btn); return 'không thấy "Khu ' + n + '" (map có ' + items.length + ' khu)'; }
    const c = (((it.querySelector('.scene-zone__c') || {}).textContent) || '').match(/(\d+)\s*\/\s*(\d+)/);
    if (c && +c[1] >= +c[2]) { if (isOpen()) pressEl(btn); return 'Khu ' + n + ' đang đầy (' + c[0] + ')'; }
    pressEl(it);
    for (let i = 0; i < 30 && zoneNow() !== n; i++) await sleep(150);
    await sleep(300);
    if (isOpen()) pressEl(btn);
    return zoneNow() === n ? true : 'bấm "Khu ' + n + '" mà chưa đổi khu';
  }
  const wantZone = () => { const v = Math.floor(+((ui.zone && ui.zone.value) || 0)); return v > 0 ? v : null; };
  function go(place) {
    if (!place) return status('Không tìm thấy map đích.');
    if (!sceneOf()?.player && typeof window.__gtPW !== 'function') {
      status('Chrome thường: game chặn phím/chuột giả lập. Hãy mở bằng run.cjs để dùng tự đi; tab này vẫn xem được tuyến đường.');
      return false;
    }
    if (info(place).locked) return status(info(place).locked);
    if (!route(currentKey(), info(place).key)) return status('Chưa có tuyến hợp lệ tới map này.');
    runId++; releaseKeys(); window.__gtLastGateFailure = null;
    if (!places().length) return status('Chưa đọc được danh sách map của game. Đứng trong map ngoại giới rồi thử lại.');
    target = { ...info(place), zone: wantZone() }; portal = null; lastWalk = 0; fails = 0; lastFrom = ''; ss.set(GOALK, target.key);
    holdOthers(); sync(); render();
    status('Đang tìm đường tới ' + target.name + (target.zone ? ' · Khu ' + target.zone : '') + '...');
    return true;
  }

  // ===== giao diện =====
  const sync = () => { if (!ui.fab) return; ui.fab.classList.toggle('on', !!target); ui.stop.hidden = !target; };
  function render() {
    if (!ui.list) return;
    const q = norm(ui.q.value), cur = currentKey();
    const signature = JSON.stringify([cur, q, target?.key, places().map(info)]);
    if (signature === renderSignature) return;
    renderSignature = signature;
    const rows = places().map(info).filter(p => p.key && (!q || norm(p.name + ' ' + p.region + ' ' + p.key).includes(q)));
    ui.list.replaceChildren();
    if (!places().length) { ui.list.textContent = 'Chưa đọc được danh sách map của game (MEONO_SCENE.outer.world). Vào map ngoại giới rồi mở lại tab.'; return; }
    if (!rows.length) { ui.list.textContent = 'Không có map phù hợp.'; return; }
    for (const p of rows.slice(0, 80)) {
      const r = document.createElement('div'); r.className = 'pl';
      const t = document.createElement('div'), b = document.createElement('b'), m = document.createElement('small');
      b.textContent = p.name + (p.key === cur ? ' (đang ở đây)' : '');
      const steps = p.key !== cur && !p.locked ? route(cur, p.key) : null;
      m.textContent = p.locked || [p.region, steps ? steps.length + ' cổng' : p.key === cur ? '' : 'chưa có đường'].filter(Boolean).join(' · ');
      t.append(b, m);
      const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'b' + (target && target.key === p.key ? ' stop' : ' go');
      btn.textContent = p.locked ? 'Chưa mở' : target && target.key === p.key ? 'Đang đi' : 'Đi tới';
      btn.disabled = !!p.locked || p.key === cur || (!steps && p.key !== cur);
      btn.onclick = () => go(places().find(x => info(x).key === p.key));
      r.append(t, btn); ui.list.append(r);
    }
  }
  function build() {
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;right:12px;bottom:156px;z-index:2147483647;';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
<style>
  *{box-sizing:border-box;font-family:system-ui,sans-serif}
  .fab{background:#2b2f3a;color:#fff;border:1px solid #555;border-radius:20px;padding:8px 14px;cursor:pointer;font-size:13px}
  .fab.on{background:#1f6f43}
  .panel{display:none;width:360px;background:#1b1e27;color:#e6e6e6;border:1px solid #555;border-radius:10px;padding:10px;margin-bottom:8px;font-size:12px}
  .panel.open{display:block}
  .status{white-space:pre-wrap}
  .pl{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 0;border-bottom:1px solid #2c3446}
  .pl b{display:block} .pl small{color:#8e97ab}
  #list{max-height:380px;overflow:auto}
</style>
<div class="panel" id="p">
  <h4>🧭 Đi tới map (theo cổng, đường ngắn nhất)</h4>
  <div class="row"><input type="text" id="q" placeholder="Tìm map theo tên / vùng (không cần dấu)" style="width:230px"><button class="b stop" id="stop" hidden>■ Dừng</button></div>
  <div class="row"><label>Khu: <input type="number" id="zone" min="1" max="60" placeholder="giữ" style="width:60px"></label><button class="b" id="zgo">Đổi khu ngay</button><span id="zcur" style="color:#8e97ab"></span></div>
  <div class="status" id="st">Chọn map rồi bấm "Đi tới". Tool tự chạy qua các cổng theo đường ít cổng nhất.</div>
  <div id="list"></div>
  <div class="note">Dùng dữ liệu bản đồ thế giới và hàm chạy tới cổng của chính game. Map chưa mở khoá (thiếu cấp / nhiệm vụ) không đi được. Trong lúc đi, Nhặt + Đánh và Tự đánh tạm dừng, tới nơi tự bật lại.</div>
</div>
<button class="fab" id="fab">🧭 Đi tới map</button>`;
    const $ = id => root.getElementById(id);
    ui = { st: $('st'), list: $('list'), q: $('q'), stop: $('stop'), fab: $('fab'), zone: $('zone') };
    try { const z = localStorage.getItem('gtTravelZone'); if (z) $('zone').value = z; } catch (e) {}
    $('zone').onchange = () => { try { localStorage.setItem('gtTravelZone', $('zone').value || ''); } catch (e) {} };
    $('zgo').onclick = async () => { const n = wantZone(); if (!n) return status('Gõ số khu trước.'); status('Đang chuyển sang Khu ' + n + '...'); const r = await gotoZone(n); status(r === true ? '✅ Đang ở Khu ' + n + '.' : '⚠️ ' + r); };
    setInterval(() => { const z = zoneNow(); $('zcur').textContent = z ? ' (đang ở Khu ' + z + ')' : ''; }, 1000);
    $('q').oninput = render;
    $('stop').onclick = () => finish('Đã dừng.');
    $('fab').onclick = () => { $('p').classList.toggle('open'); render(); };
    ['keydown', 'keyup', 'keypress'].forEach(t => root.addEventListener(t, e => e.stopPropagation()));
    if (window.__gtHub) window.__gtHub.add(host); else document.body.appendChild(host);
    sync();
    setInterval(() => { hookTap(); pulse(); }, 200);
    setInterval(() => { if (!document.hidden && $('p').classList.contains('open') && host.style.display !== 'none') render(); }, 3000);
    // trang tải lại giữa đường → đi tiếp
    const g = ss.get(GOALK);
    if (g) { const t0 = Date.now(); const iv = setInterval(() => { const p = places().find(x => info(x).key === g); if (p) { clearInterval(iv); go(p); } else if (Date.now() - t0 > 20000) { clearInterval(iv); ss.del(GOALK); } }, 1000); }
  }

  window.__gtTravel = { go: key => { const p = places().find(x => info(x).key === key || norm(info(x).name) === norm(key)); return p ? go(p) !== false : false; }, stop: () => finish('Đã dừng.'), route, places: () => places().map(info),
    diagnostics: () => ({ map: currentKey(), maps: places().length, portals: mapPortals().length,
      directControl: !!sceneOf()?.player, inputBridge: typeof window.__gtPW === 'function',
      position: playerPos(), positionAge: pos.t ? Date.now() - pos.t : null, trace: window.__gtTravelTrace || null, moving: !!target, status: ui.st?.textContent || '' }) };
  if (document.body) build(); else document.addEventListener('DOMContentLoaded', build);
})();
} catch (e) { console.error("[công cụ game] phần Đi tới map lỗi:", e); }
