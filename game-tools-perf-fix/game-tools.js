(function (root) {
  function createReader() {
    const parsed = new WeakMap();
    return response => {
      if (!parsed.has(response)) parsed.set(response, Promise.resolve().then(() => response.clone().json()));
      return parsed.get(response);
    };
  }
  function observe(response, reader, onData) {
    // Run side work separately: game fetch consumers must not await tool decoding.
    Promise.resolve().then(() => reader(response)).then(onData).catch(() => {});
    return response;
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { createReader, observe };
  else { root.__gtReadJSON = createReader(); root.__gtObserveResponse = observe; }
})(typeof window !== 'undefined' ? window : globalThis);

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

(function (root) {
  function zoneOrder(current, start, end) {
    start = Math.trunc(Number(start)); end = Math.trunc(Number(end));
    if (!(start >= 1 && end <= 60 && end >= start)) return [];
    const zones = Array.from({ length: end - start + 1 }, (_, i) => start + i);
    const at = zones.indexOf(Number(current));
    return at < 0 ? zones : zones.slice(at + 1).concat(zones.slice(0, at));
  }
  function isBoss(row, names = []) {
    if (!Array.isArray(row)) return false;
    if (names.some(name => String(name).trim().toLowerCase() === String(row[1]).trim().toLowerCase())) return true;
    return /(^|[_\s-])(boss|worldboss|world_boss)([_\s-]|$)/i.test(String(row[12] || ''));
  }
  const api = { zoneOrder, isBoss };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.__gtBossCore = api;
})(typeof window !== 'undefined' ? window : globalThis);

// Công cụ game (gộp 1 file). Mỗi phần là 1 khối độc lập, bọc try/catch để 1 phần lỗi không làm hỏng các phần khác.

// ===================== Cầu nối Playwright (thao tác thật thay cho giả lập) =====================
// Khi trang được mở bằng playwright/run.js, window.__gtPW có sẵn: mọi phím / chuột các công cụ tự tạo (dispatchEvent
// KeyboardEvent / MouseEvent / PointerEvent) được chuyển sang Playwright để trình duyệt thực hiện như người bấm thật,
// còn bản giả lập thì bỏ. Không có Playwright → chạy như cũ. Game chỉ tự phát CustomEvent / Event nên không bị ảnh hưởng.
try {
(() => {
  if (window.__gtBridge) return;
  window.__gtBridge = true;
  const pw = () => typeof window.__gtPW === 'function' ? window.__gtPW : null;
  const send = a => { try { const f = pw(); if (f) f(a).catch(() => {}); } catch (e) {} };
  const orig = EventTarget.prototype.dispatchEvent;
  const KEYS = new Set(['keydown', 'keyup', 'keypress']);
  const MOUSE = new Set(['pointerdown', 'pointerup', 'pointermove', 'mousedown', 'mouseup', 'mousemove', 'click']);
  let lastClick = { t: 0, el: null };
  const point = (e, target) => {
    if (e.clientX || e.clientY) return { x: e.clientX, y: e.clientY };
    const el = target && target.getBoundingClientRect ? target : null;
    if (!el) return null;
    const r = el.getBoundingClientRect(); return r.width ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
  };
  // phím Playwright: dùng mã phím (KeyW, Enter, ShiftLeft, F2...) để giống hệt bàn phím thật
  const keyName = e => { const c = e.code || ''; if (/^Shift/.test(c)) return 'Shift'; return c || e.key; };
  EventTarget.prototype.dispatchEvent = function (e) {
    if (!pw() || !e || e.isTrusted || !(KEYS.has(e.type) || MOUSE.has(e.type)) || !(e instanceof UIEvent)) return orig.call(this, e);
    if (KEYS.has(e.type)) {
      if (e.type === 'keydown') send({ t: 'keydown', key: keyName(e), repeat: !!e.repeat });
      else if (e.type === 'keyup') send({ t: 'keyup', key: keyName(e) });
      return true;                                   // bỏ bản giả lập
    }
    // chuột: 1 chuỗi pointerdown/mousedown/pointerup/mouseup/click → 1 cú bấm thật ở mousedown
    if (e.type === 'mousedown') {
      const p = point(e, this);
      if (p) { send({ t: 'click', x: Math.round(p.x), y: Math.round(p.y) }); lastClick = { t: Date.now(), el: this }; }
      return true;
    }
    if (e.type === 'pointermove' || e.type === 'mousemove') { const p = point(e, this); if (p && (e.clientX || e.clientY)) send({ t: 'move', x: Math.round(p.x), y: Math.round(p.y) }); return true; }
    return true;
  };
  // el.click() ngay sau chuỗi bấm giả lập (nhiều chỗ làm vậy) → đã bấm thật rồi, bỏ để khỏi bấm 2 lần
  const oClick = HTMLElement.prototype.click;
  HTMLElement.prototype.click = function () {
    if (pw() && lastClick.el === this && Date.now() - lastClick.t < 400) return;
    return oClick.call(this);          // game tự gọi .click() thì để nguyên
  };
})();
} catch (e) { console.error("[công cụ game] cầu nối Playwright lỗi:", e); }

// ===================== Khung chung (tab, phím Alt phải) (trước đây: hub.js) =====================
try {
// Khung chung: 1 nút nổi, bên trong là các tab của từng công cụ (Vứt đồ, Câu cá, Nhặt + Đánh, Săn boss).
// Mỗi công cụ vẫn tự dựng giao diện trong shadow DOM riêng rồi gọi window.__gtHub.add(host) thay vì tự gắn vào trang.
// Khung chèn thêm 1 bộ CSS chung (THEME) vào từng công cụ để mọi tab cùng một kiểu.
(() => {
  if (window.__gtHub) return;
  // fetch gốc của trình duyệt (trước khi các công cụ bọc lại): dùng cho yêu cầu không được để công cụ khác đọc nhầm (vd dò khu khác)
  window.__gtNativeFetch = window.__gtNativeFetch || window.fetch;
  window.__gtEmit = (name, detail) => { try { window.dispatchEvent(new CustomEvent('gt:' + name, { detail })); } catch (e) {} };
  // BẢNG MÃ LỆNH của game: game mã hoá tên lệnh gửi lên server (vd vị trí "p" → "m4j" / "ewf"...) và bảng này ĐỔI MỖI LẦN GAME CẬP NHẬT.
  // → đọc thẳng từ file game đang chạy: tìm {p:"…",c:"…",u:"…",k:"…",a:"…",m:"…",r:"…",i:"…"} trong các file /build/assets/*.js.
  // window.__gtCmd = { mã: tên gốc }, vd { ewf: 'p', gq3: 'k', ... }
  window.__gtCmd = window.__gtCmd || {};
  (() => {
    const seen = new Set(), RE = /\{p:"([a-z0-9]{2,8})",c:"([a-z0-9]{2,8})",u:"([a-z0-9]{2,8})",k:"([a-z0-9]{2,8})",a:"([a-z0-9]{2,8})",m:"([a-z0-9]{2,8})",r:"([a-z0-9]{2,8})",i:"([a-z0-9]{2,8})"\}/;
    const names = ['p', 'c', 'u', 'k', 'a', 'm', 'r', 'i'];
    let found = false, t0 = Date.now();
    async function scan() {
      if (found) return;
      const urls = new Set();
      try { for (const e of performance.getEntriesByType('resource')) if (/\/build\/assets\/[^/]+\.js(\?|$)/.test(e.name)) urls.add(e.name); } catch (e) {}
      try { document.querySelectorAll('script[src],link[rel=modulepreload]').forEach(s => { const u = s.src || s.href; if (/\/build\/assets\/[^/]+\.js/.test(u)) urls.add(u); }); } catch (e) {}
      for (const u of urls) {
        if (seen.has(u) || found) continue; seen.add(u);
        try {
          const txt = await (await window.__gtNativeFetch(u, { credentials: 'same-origin' })).text();
          const m = txt.match(RE);
          if (m) {
            const map = {}; names.forEach((n, i) => { map[m[i + 1]] = n; });
            window.__gtCmd = map; found = true;
            console.log('[công cụ game] đọc được bảng mã lệnh của game:', map);
            window.dispatchEvent(new CustomEvent('gt:cmdmap', { detail: map }));
          }
        } catch (e) {}
      }
      if (!found && Date.now() - t0 < 120000) setTimeout(scan, 3000);      // file chứa bảng có thể nạp muộn
    }
    if (document.readyState === 'complete') setTimeout(scan, 500); else addEventListener('load', () => setTimeout(scan, 500));
  })();
  // Gõ chữ trong ô của công cụ không được lọt phím vào game. Game nghe phím ở window (có cả giai đoạn capture) và
  // không nhận ra ô nhập nằm trong shadow DOM → gõ "g" là bật Tự đánh, "c" mở chat... Bộ nghe này gắn ở window
  // TRƯỚC game (hub.js nạp đầu tiên, lúc document_start) nên chạy trước và chặn phím đi tiếp; chữ vẫn vào ô bình thường.
  const fromToolField = e => {
    const el = e.composedPath && e.composedPath()[0];
    if (!el || !el.tagName) return false;
    const editable = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
    return editable && el.getRootNode() instanceof ShadowRoot && !!el.getRootNode().host;
  };
  for (const t of ['keydown', 'keyup', 'keypress']) window.addEventListener(t, e => { if (e.isTrusted && fromToolField(e)) e.stopImmediatePropagation(); }, true);
  const TABK = 'gtHubTab', OPENK = 'gtHubOpen', GEOK = 'gtHubGeo';
  const get = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const put = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
  const tools = [];          // { host, name, icon, label, tab, fab }
  let ui = null, pending = [];

  const TOKENS = `
    --bg:#11141b; --surface:#171b24; --card:#1d2230; --card2:#232a3a; --line:#2c3446; --line2:#3a4459;
    --text:#e9edf5; --muted:#8e97ab; --accent:#6c8cff; --accent2:#8f6cff; --green:#2fbf71; --red:#e5484d; --amber:#f2b33d;`;

  // CSS chèn vào shadow của từng công cụ: ẩn nút nổi riêng, bảng luôn mở, và giao diện chung
  const THEME = `
    :host{${TOKENS}}
    *{box-sizing:border-box;font-family:'Segoe UI',system-ui,-apple-system,sans-serif}
    .fab{display:none!important}
    .panel{display:block!important;width:auto!important;max-height:none!important;overflow:visible!important;margin:0!important;padding:0!important;
      border:0!important;border-radius:0!important;background:transparent!important;color:var(--text)!important;font-size:14px!important;line-height:1.55}
    h4{margin:2px 0 10px!important;font-size:12.5px!important;font-weight:600;color:var(--muted)}
    h5{margin:16px 0 8px!important;padding:0 0 6px!important;border:0!important;border-bottom:1px solid var(--line)!important;
      font-size:11px!important;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--accent)!important}
    .row{display:flex;flex-wrap:wrap;align-items:center;gap:8px 14px;margin:10px 0!important}
    .sub{margin-left:10px!important;padding-left:12px;border-left:2px solid var(--line2)}
    label{display:inline-flex!important;align-items:center;gap:6px!important;margin:0!important;cursor:pointer;color:var(--text)}
    input[type=checkbox]{width:16px;height:16px;margin:0;accent-color:var(--accent);cursor:pointer}
    input[type=text],input[type=number],select{background:var(--bg)!important;color:var(--text)!important;border:1px solid var(--line2)!important;
      border-radius:7px!important;padding:5px 8px!important;font-size:13px!important;outline:none;transition:border-color .15s,box-shadow .15s}
    input[type=text]:focus,input[type=number]:focus,select:focus{border-color:var(--accent)!important;box-shadow:0 0 0 3px rgba(108,140,255,.18)}
    input[type=number]{text-align:center}
    select{cursor:pointer}
    button.b{background:var(--card2)!important;color:var(--text)!important;border:1px solid var(--line2)!important;border-radius:8px!important;
      padding:7px 12px!important;margin:0!important;font-size:12.5px!important;font-weight:600;cursor:pointer;transition:transform .08s,filter .15s,background .15s}
    button.b:hover{filter:brightness(1.18)}
    button.b:active{transform:translateY(1px)}
    button.go{background:linear-gradient(135deg,#27a862,#1d8a50)!important;border-color:#2fbf71!important}
    button.stop,button.danger{background:linear-gradient(135deg,#d9434a,#a8282e)!important;border-color:#e5484d!important}
    .out,.list{background:var(--bg)!important;border:1px solid var(--line)!important;border-radius:9px!important;padding:8px 10px!important;
      font-family:Consolas,'Cascadia Mono',monospace!important;font-size:12px!important;color:#cfe0ff!important;max-height:200px!important}
    .status{margin-top:10px!important;padding:9px 11px;background:var(--card);border:1px solid var(--line);border-left:3px solid var(--accent);
      border-radius:9px;color:#cfdcff!important;font-size:12.5px}
    .note{margin-top:12px!important;color:var(--muted)!important;font-size:11.5px;line-height:1.5}
    b{color:#fff}
    details{margin:10px 0;border:1px solid var(--line);border-radius:9px;padding:6px 10px;background:var(--card)}
    summary{cursor:pointer;font-weight:600;font-size:12px;color:var(--accent);list-style:none;user-select:none}
    summary::before{content:'▸ ';display:inline-block;transition:transform .15s}
    details[open] summary{margin-bottom:6px} details[open] summary::before{transform:rotate(90deg)}
    ::-webkit-scrollbar{width:8px;height:8px} ::-webkit-scrollbar-thumb{background:var(--line2);border-radius:8px} ::-webkit-scrollbar-track{background:transparent}`;

  function build() {
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:2147483647;';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
<style>
  :host{${TOKENS}}
  *{box-sizing:border-box;font-family:'Segoe UI',system-ui,-apple-system,sans-serif}
  .fab{display:inline-flex;align-items:center;gap:8px;background:linear-gradient(135deg,#2a3247,#1c2232);color:var(--text);border:1px solid var(--line2);
    border-radius:999px;padding:9px 16px;cursor:pointer;font-size:13.5px;font-weight:600;box-shadow:0 6px 20px rgba(0,0,0,.45);transition:filter .15s}
  .fab:hover{filter:brightness(1.15)}
  .fab.on{background:linear-gradient(135deg,#239a5a,#1a7444);border-color:var(--green)}
  .fab .cnt{background:rgba(255,255,255,.18);border-radius:999px;padding:1px 8px;font-size:12px}
  .box{display:none;flex-direction:column;width:660px;height:760px;min-width:420px;min-height:280px;max-width:96vw;max-height:88vh;resize:both;overflow:hidden;
    background:var(--surface);color:var(--text);border:1px solid var(--line2);border-radius:14px;margin-bottom:10px;
    box-shadow:0 18px 50px rgba(0,0,0,.6),0 0 0 1px rgba(255,255,255,.03) inset}
  .box.open{display:flex}
  .head{display:flex;align-items:center;gap:10px;padding:12px 14px;background:linear-gradient(135deg,#1e2537,#161b27);border-bottom:1px solid var(--line);cursor:move;user-select:none}
  .logo{width:30px;height:30px;border-radius:9px;display:grid;place-items:center;font-size:16px;background:linear-gradient(135deg,var(--accent),var(--accent2))}
  .title{font-weight:700;font-size:14.5px;line-height:1.2}
  .sub{font-size:11.5px;color:var(--muted)}
  .sp{flex:1}
  .icon{width:28px;height:28px;border-radius:8px;border:1px solid var(--line2);background:var(--card);color:var(--muted);cursor:pointer;font-size:14px;display:grid;place-items:center}
  .icon:hover{color:var(--text);filter:brightness(1.2)}
  .tabs{display:grid;grid-template-columns:repeat(auto-fit,minmax(90px,1fr));gap:6px;padding:10px 12px;background:var(--bg);border-bottom:1px solid var(--line)}
  .tab{position:relative;display:flex;flex-direction:column;align-items:center;gap:2px;padding:8px 6px;border-radius:10px;border:1px solid transparent;
    background:transparent;color:var(--muted);cursor:pointer;font-size:12px;font-weight:600;transition:background .15s,color .15s}
  .tab .ic{font-size:18px;line-height:1}
  .tab:hover{background:var(--card);color:var(--text)}
  .tab.act{background:var(--card2);color:var(--text);border-color:var(--line2);box-shadow:inset 0 -2px 0 var(--accent)}
  .tab.run::after{content:'';position:absolute;top:6px;right:8px;width:8px;height:8px;border-radius:50%;background:var(--green);box-shadow:0 0 0 3px rgba(47,191,113,.25)}
  .body{flex:1;overflow:auto;padding:12px 16px 16px}
  .seg{display:flex;gap:6px;margin:0 0 12px;padding:4px;background:var(--bg);border:1px solid var(--line);border-radius:10px}
  .seg[hidden]{display:none}
  .sg{flex:1;position:relative;padding:7px 10px;border:0;border-radius:8px;background:transparent;color:var(--muted);font-size:12.5px;font-weight:600;cursor:pointer}
  .sg:hover{color:var(--text);background:var(--card)}
  .sg.act{background:var(--card2);color:var(--text);box-shadow:inset 0 -2px 0 var(--accent)}
  .sg.run::after{content:'';position:absolute;top:5px;right:7px;width:7px;height:7px;border-radius:50%;background:var(--green)}
  .tabs{grid-template-columns:repeat(5,1fr)}
  .body::-webkit-scrollbar{width:9px} .body::-webkit-scrollbar-thumb{background:var(--line2);border-radius:9px} .body::-webkit-scrollbar-track{background:transparent}
</style>
<div class="box" id="box">
  <div class="head" id="head">
    <div class="logo">🎮</div>
    <div><div class="title">Công cụ game</div><div class="sub" id="sum">Chưa có công cụ nào chạy</div></div>
    <div class="sp"></div>
    <button class="icon" id="rs" title="Về kích thước & vị trí mặc định">⤢</button>
    <button class="icon" id="mn" title="Thu nhỏ (Alt phải)">—</button>
  </div>
  <div class="tabs" id="tabs"></div>
  <div class="body" id="body"><div class="seg" id="seg" hidden></div></div>
</div>
<button class="fab" id="fab" title="Bật / tắt bảng: Alt phải">🎮 <span>Công cụ</span><span class="cnt" id="cnt" hidden></span></button>`;
    const $ = id => root.getElementById(id);
    ['keydown', 'keyup', 'keypress'].forEach(t => root.addEventListener(t, e => e.stopPropagation()));
    const setOpen = o => { $('box').classList.toggle('open', o); put(OPENK, o ? '1' : ''); };
    $('fab').onclick = () => setOpen(!$('box').classList.contains('open'));
    // phím tắt: Alt phải bật / tắt bảng công cụ (chặn luôn để trình duyệt không nhảy lên thanh menu)
    addEventListener('keydown', e => { if (e.code === 'AltRight' && !e.repeat) { e.preventDefault(); setOpen(!$('box').classList.contains('open')); } }, true);
    addEventListener('keyup', e => { if (e.code === 'AltRight') e.preventDefault(); }, true);
    $('mn').onclick = () => setOpen(false);
    if (get(OPENK)) setOpen(true);

    // vị trí (kéo ở thanh tiêu đề) + kích thước (kéo góc dưới phải), nhớ lại sau F5
    let geo = {}; try { geo = JSON.parse(get(GEOK) || '{}') || {}; } catch (e) {}
    // giao diện đã mở rộng: bỏ kích thước cũ đã lưu 1 lần để khung mới hiện đúng cỡ
    if (get('gtHubGeoV') !== '2') { delete geo.w; delete geo.h; put('gtHubGeoV', '2'); put(GEOK, JSON.stringify(geo)); }
    const clamp = () => {
      const r = host.getBoundingClientRect();
      geo.left = Math.max(0, Math.min(geo.left ?? 12, innerWidth - Math.min(r.width, 120)));
      geo.bottom = Math.max(0, Math.min(geo.bottom ?? 12, innerHeight - 60));
      host.style.left = geo.left + 'px'; host.style.bottom = geo.bottom + 'px';
    };
    const saveGeo = () => put(GEOK, JSON.stringify(geo));
    if (geo.w) $('box').style.width = geo.w + 'px';
    if (geo.h) $('box').style.height = geo.h + 'px';
    $('head').addEventListener('pointerdown', e => {
      if (e.target.closest('button')) return;
      const sx = e.clientX, sy = e.clientY, l0 = geo.left ?? 12, b0 = geo.bottom ?? 12;
      const mv = ev => { geo.left = l0 + ev.clientX - sx; geo.bottom = b0 - (ev.clientY - sy); clamp(); };
      const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); saveGeo(); };
      addEventListener('pointermove', mv); addEventListener('pointerup', up);
    });
    try {
      new ResizeObserver(() => {
        const b = $('box'); if (!b.classList.contains('open')) return;
        geo.w = Math.round(b.offsetWidth); geo.h = Math.round(b.offsetHeight); saveGeo();
      }).observe($('box'));
    } catch (e) {}
    $('rs').onclick = () => { geo = {}; $('box').style.width = ''; $('box').style.height = ''; clamp(); saveGeo(); };
    addEventListener('resize', clamp);

    document.body.appendChild(host);
    clamp();
    ui = { root, $ };
    for (const h of pending) add(h);
    pending = [];
  }

  // ===== gom công cụ thành nhóm cho gọn: mỗi nhóm 1 tab, trong nhóm có nút chuyển nhỏ giữa các công cụ =====
  const GROUPS = [
    { id: 'loot', icon: '💎', label: 'Nhặt đồ', re: /Nhặt/i },
    { id: 'fight', icon: '⚔️', label: 'Đánh & Săn boss', re: /Săn boss|Đánh/i },
    { id: 'items', icon: '🎒', label: 'Đồ đạc', re: /Vứt|Đập/i },
    { id: 'fish', icon: '🎣', label: 'Câu cá', re: /Câu cá/i },
    { id: 'travel', icon: '🧭', label: 'Đi tới map', re: /Đi tới map/i },
  ];
  const SUBK = 'gtHubSub';
  const groups = new Map();       // id → { def, tab, tools: [] }
  let curGroup = null;
  const subSel = () => { try { return JSON.parse(get(SUBK) || '{}') || {}; } catch (e) { return {}; } };
  function showGroup(id) {
    const g = groups.get(id); if (!g) return;
    curGroup = id; put(TABK, id);
    for (const [gid, x] of groups) x.tab.classList.toggle('act', gid === id);
    const want = subSel()[id], pick = g.tools.find(t => t.name === want) || g.tools[0];
    for (const t of tools) t.host.style.display = t === pick ? 'block' : 'none';
    // nút chuyển giữa các công cụ trong nhóm (chỉ khi nhóm có > 1 công cụ)
    const seg = ui.$('seg'); seg.replaceChildren(); seg.hidden = g.tools.length < 2;
    for (const t of g.tools) {
      const b = document.createElement('button'); b.className = 'sg' + (t === pick ? ' act' : '') + (t.fab && t.fab.classList.contains('on') ? ' run' : '');
      b.textContent = t.icon + ' ' + t.label;
      b.onclick = () => { const s = subSel(); s[id] = t.name; put(SUBK, JSON.stringify(s)); showGroup(id); };
      seg.appendChild(b);
    }
    ui.$('body').scrollTop = 0;
  }
  // chấm xanh trên tab nhóm + nút chung khi có công cụ đang chạy (nút nổi riêng của nó có class "on")
  function syncRun() {
    const on = tools.filter(t => t.fab && t.fab.classList.contains('on'));
    for (const g of groups.values()) g.tab.classList.toggle('run', g.tools.some(t => on.includes(t)));
    for (const b of ui.$('seg').children) { const t = tools.find(x => b.textContent === x.icon + ' ' + x.label); if (t) b.classList.toggle('run', on.includes(t)); }
    ui.$('fab').classList.toggle('on', on.length > 0);
    const c = ui.$('cnt'); c.hidden = !on.length; c.textContent = on.map(t => t.icon).join(' ');
    ui.$('sum').textContent = on.length ? 'Đang chạy: ' + on.map(t => t.label).join(', ') : 'Chưa có công cụ nào chạy';
  }

  function add(host) {
    if (!ui) { pending.push(host); return; }
    const sr = host.shadowRoot;
    const fab = sr && sr.getElementById('fab');
    const name = ((fab && fab.textContent) || 'Công cụ').trim();
    const m = name.match(/^(\S+)\s+(.*)$/), icon = m ? m[1] : '🔧', label = m ? m[2] : name;
    if (sr) { const st = document.createElement('style'); st.textContent = THEME; sr.appendChild(st); }
    host.style.cssText = 'display:none;';
    ui.$('body').appendChild(host);
    const t = { host, name, icon, label, fab };
    tools.push(t);
    const gi = GROUPS.findIndex(d => d.re.test(label));
    const def = gi >= 0 ? GROUPS[gi] : { id: 'x:' + name, icon, label };
    let g = groups.get(def.id);
    if (!g) {
      const tab = document.createElement('button');
      tab.className = 'tab'; tab.style.order = gi >= 0 ? gi : 50 + groups.size;
      const ic = document.createElement('span'); ic.className = 'ic'; ic.textContent = def.icon;
      const tx = document.createElement('span'); tx.textContent = def.label;
      tab.append(ic, tx);
      g = { def, tab, tools: [] };
      groups.set(def.id, g);
      tab.onclick = () => showGroup(def.id);
      ui.$('tabs').appendChild(tab);
    }
    g.tools.push(t);
    if (fab) new MutationObserver(syncRun).observe(fab, { attributes: true, attributeFilter: ['class'] });
    const want = get(TABK);
    if (!curGroup || want === def.id || curGroup === def.id) showGroup(want && groups.has(want) ? want : curGroup || def.id);
    syncRun();
  }

  window.__gtHub = { add };
  if (document.body) build(); else document.addEventListener('DOMContentLoaded', build);
})();
} catch (e) { console.error("[công cụ game] phần Khung chung (tab, phím Alt phải) lỗi:", e); }

// ===================== Vứt đồ + chạy nhanh (trước đây: content.js) =====================
try {
(() => {
  if (window.__vutExt) return;
  window.__vutExt = true;

  const BASE = location.origin;   // tự khớp với địa chỉ trang game đang mở (meono... hoặc play.meono...:8443)
  const KEY = 'vutExtCfg';
  const RARITY_LABEL = { thuong: 'Thường', tot: 'Tốt', hiem: 'Hiếm', cuc_pham: 'Cực phẩm', huyen_thoai: 'Huyền thoại' };
  const DEF = {
    rarities: { thuong: true, tot: true, hiem: true, cuc_pham: true, huyen_thoai: false },
    tiers: { 1: true, 2: true, 3: true, 4: true, 5: true, 6: true, 7: false },        // game hiện mới có trang bị tới bậc 7
    maxPlus: 0,
    includeJewels: true,
    keepNameRe: '',
    delay: 700,
    jitter: 400,
    autoMin: 1,
    autoOn: false,      // tự vứt đang bật: lưu lại để F5 / mở lại trình duyệt vẫn chạy tiếp, chỉ tắt khi người dùng bấm Tắt hoặc Dừng
    fullDiscard: false, // túi đầy (hoặc gần đầy) → vứt ngay theo bộ lọc, không chờ tới lượt tự vứt
    sprint: true,       // luôn nhấn Shift (chạy nhanh); null = lấy theo cài đặt cũ bên Nhặt + Đánh
    fullMargin: 3,      // coi là "gần đầy" khi còn trống ≤ chừng này ô (nếu đọc được sức chứa túi)
  };
  let cfg;
  try { cfg = { ...DEF, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; cfg.rarities = { ...DEF.rarities, ...cfg.rarities }; cfg.tiers = { ...DEF.tiers, ...cfg.tiers }; }
  catch (e) { cfg = JSON.parse(JSON.stringify(DEF)); }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (e) {} };
  // chạy nhanh trước đây nằm ở tab Nhặt + Đánh → lấy lựa chọn cũ
  if (cfg.sprint == null) { try { const o = JSON.parse(localStorage.getItem('lootExtCfg2') || '{}'); cfg.sprint = !!o.sprint; } catch (e) { cfg.sprint = false; } }

  // ===== học header từ các yêu cầu của game =====
  const origFetch = window.fetch;
  let sniffed = {};
  window.fetch = function (...a) {
    try {
      const url = String((a[0] && a[0].url) || a[0]);
      if (url.startsWith(BASE) || url.startsWith('/')) {
        const h = (a[1] && a[1].headers) || (a[0] && a[0].headers);
        if (h) {
          const o = {};
          if (Array.isArray(h)) h.forEach(([k, v]) => { o[k.toLowerCase()] = v; });
          else if (typeof h.forEach === 'function') h.forEach((v, k) => { o[k.toLowerCase()] = v; });
          else for (const k in h) o[k.toLowerCase()] = h[k];
          sniffed = { ...sniffed, ...o };
        }
      }
    } catch (e) {}
    return origFetch.apply(this, a);
  };
  // header giống hệt game khi POST (đọc từ mã nguồn game): JSON + X-Requested-With + X-CSRF-TOKEN lấy ở thẻ meta
  const csrf = () => { const m = document.querySelector('meta[name="csrf-token"]'); return (m && m.content) || (window.Laravel && window.Laravel.csrfToken) || ''; };
  // CHỈ gửi đúng các header game gửi. Không trộn header học lén từ yêu cầu cũ: trùng tên (vd x-csrf-token viết thường)
  // thì trình duyệt nối thành "mã, mã" → server báo 419 CSRF token mismatch.
  const postHeaders = () => {
    const t = csrf();
    return { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', ...(t ? { 'X-CSRF-TOKEN': t } : {}) };
  };
  // mã CSRF cũ / sai → tải lại trang hiện tại (không chuyển trang) để lấy mã mới, ghi vào thẻ meta
  async function refreshCsrf() {
    try {
      const html = await (await origFetch(location.href, { credentials: 'same-origin', headers: { Accept: 'text/html' }, cache: 'no-store' })).text();
      const m = html.match(/<meta[^>]+name=["']csrf-token["'][^>]+content=["']([^"']+)/i) || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']csrf-token/i);
      if (!m) return false;
      let el = document.querySelector('meta[name="csrf-token"]');
      if (!el) { el = document.createElement('meta'); el.name = 'csrf-token'; document.head.appendChild(el); }
      el.content = m[1];
      return true;
    } catch (e) { return false; }
  }
  const postDiscard = (url, it) => origFetch(url, { method: 'POST', credentials: 'same-origin', headers: postHeaders(), body: JSON.stringify({ item: it.id, qty: it.qty }) });
  // địa chỉ vứt đồ: game để trong cấu hình ngoại giới (MEONO_SCENE.outer.urls.discard); không có thì dùng địa chỉ cũ
  const discardUrl = () => { const s = window.MEONO_SCENE, u = s && ((s.outer && s.outer.urls && s.outer.urls.discard) || (s.urls && s.urls.discard)); return u || BASE + '/ngoai-gioi-ho-so/vut-bo'; };

  // ===== logic =====
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  let stopFlag = false, busy = false, lastErr = false, autoTimer = null, firstTimer = null;

  async function load() {
    const r = await origFetch(BASE + '/ngoai-gioi-ho-so', { credentials: 'include' });
    if (!r.ok) throw new Error('GET hành trang lỗi ' + r.status);
    const j = await r.json();
    const d = j && j.data;
    if (!d || !d.combat || !d.hero || !Array.isArray(d.hero.inventory)) throw new Error('Cấu trúc dữ liệu khác dự kiến');
    return d;
  }

  // số món trong túi và sức chứa (sức chứa: dò theo tên trường, vì chưa biết chắc game đặt tên gì)
  const CAP_RE = /^(bag|inv|inventory|tui|balo)?_?(slots?|size|cap|capacity|max|limit|max_?(slots?|bag|inv|items?))$/i;
  function bagInfo(d) {
    const count = d.hero.inventory.filter(x => !x.equipped).length;
    let cap = null, capKey = null;
    for (const src of [d.hero, d.combat, d]) {
      if (!src || typeof src !== 'object') continue;
      for (const k of Object.keys(src)) if (typeof src[k] === 'number' && src[k] >= 10 && src[k] <= 5000 && CAP_RE.test(k)) { cap = src[k]; capKey = k; break; }
      if (cap) break;
    }
    return { count, cap, capKey };
  }
  const bagText = b => 'Hành trang: ' + b.count + (b.cap ? ' / ' + b.cap + ' (' + b.capKey + ')' : ' món (chưa đọc được sức chứa túi)');

  function makePlan(d) {
    let keepRe = null;
    if (cfg.keepNameRe) { try { keepRe = new RegExp(cfg.keepNameRe, 'i'); } catch (e) {} }
    const allowed = Object.keys(cfg.rarities).filter(k => cfg.rarities[k]);
    const inv = new Map(d.hero.inventory.map(x => [x.id, x]));
    const gear = [...(d.combat.bag || []), ...(cfg.includeJewels ? (d.combat.jewels || []) : [])];
    const seen = new Set(), out = [], skipped = {};
    const skip = w => { skipped[w] = (skipped[w] || 0) + 1; };
    for (const g of gear) {
      if (seen.has(g.id)) continue;
      seen.add(g.id);
      const row = inv.get(g.id);
      if (!allowed.includes(g.rarity)) skip('giữ theo phẩm chất (' + g.rarity + ')');
      else if (g.tier == null) skip('không rõ bậc');
      else if (!cfg.tiers[g.tier]) skip('giữ theo bậc');
      else if (g.locked || (row && row.locked)) skip('đang khoá');
      else if (!row) skip('không thấy trong hành trang');
      else if (row.equipped) skip('đang mặc');
      else if ((g.plus || 0) > cfg.maxPlus) skip('đã cường hoá +N');
      else if (keepRe && keepRe.test(g.name || '')) skip('trùng tên giữ lại');
      else out.push({ id: g.id, ten: g.name, pc: g.rarity, plus: g.plus || 0, bac: g.tier, qty: row.qty || 1 });
    }
    return { out, skipped };
  }

  // ===== giao diện =====
  let ui = {};
  const say = (t, bad) => { if (ui.status) { ui.status.textContent = t; ui.status.style.color = bad ? '#ff8a80' : '#b8d8ff'; } };
  const renderList = list => {
    ui.list.innerHTML = '';
    list.forEach(it => {
      const d = document.createElement('div');
      d.textContent = `${it.ten} [${RARITY_LABEL[it.pc] || it.pc}] B${it.bac}${it.plus ? ' +' + it.plus : ''} #${it.id}`;
      ui.list.appendChild(d);
    });
  };

  async function preview() {
    if (busy) return;
    try {
      say('Đang tải hành trang...');
      const d = await load();
      const { out, skipped } = makePlan(d);
      renderList(out);
      const sk = Object.entries(skipped).map(([k, v]) => `${k}: ${v}`).join(' | ');
      say(`${bagText(bagInfo(d))}\nSẽ vứt ${out.length} món. Bỏ qua → ${sk || 'không có'}\nĐịa chỉ vứt: ${discardUrl()} · mã bảo vệ: ${csrf() ? 'có' : 'KHÔNG có'}`);
      return out;
    } catch (e) { say('Lỗi: ' + e.message, true); }
  }

  async function run(n, auto) {
    if (busy) return;
    busy = true; stopFlag = false; lastErr = false;
    let ok = 0;
    try {
      say('Đang tải hành trang...');
      let list = makePlan(await load()).out;
      if (n !== 'all') list = list.slice(0, n);
      if (auto) list = list.slice(0, 100);
      renderList(list);
      if (!list.length) { say('Không có món nào thoả điều kiện vứt.'); return; }
      if (!auto && !confirm(`Vứt ${list.length} món? Vứt xong KHÔNG lấy lại được.\nBạn đã xem kỹ danh sách chưa?`)) { say('Đã huỷ.'); return; }
      for (let i = 0; i < list.length; i++) {
        if (stopFlag) { say('Đã dừng. Vứt được ' + ok + ' món.'); break; }
        const it = list[i];
        const url = discardUrl();
        let r = await postDiscard(url, it);
        // 419: mã CSRF hết hạn / không khớp → lấy mã mới rồi thử lại 1 lần
        if (r.status === 419 && await refreshCsrf()) { say('Mã bảo vệ cũ → đã lấy mã mới, thử lại...'); r = await postDiscard(url, it); }
        let j = null; try { j = await r.json(); } catch (e) {}
        // game coi là được khi HTTP OK và không có cờ lỗi (không bắt buộc có success: true)
        const bad = !r.ok || (j && (j.success === false || j.ok === false || j.error));
        if (bad) {
          say(`Server báo lỗi khi vứt #${it.id} (${it.ten}): HTTP ${r.status} ${(j && (j.message || j.error)) || ''}\nĐịa chỉ: ${url}. Đã dừng.`, true);
          lastErr = true; return;
        }
        ok++;
        say(`Đã vứt ${ok}/${list.length}: ${it.ten}`);
        if (i === 0) {
          const d2 = await load();
          if (d2.hero.inventory.some(x => x.id === it.id)) { say(`Món #${it.id} vẫn còn sau khi vứt. Đã dừng.`, true); lastErr = true; return; }
        }
        await sleep(cfg.delay + Math.random() * cfg.jitter);
      }
      if (!stopFlag) say(`Xong. Đã vứt ${ok} món. Đóng rồi mở lại hành trang để cập nhật giao diện.`);
    } catch (e) { lastErr = true; say('Lỗi: ' + e.message, true); }
    finally { busy = false; if (ok && window.__gtEmit) window.__gtEmit('discard', { n: ok, auto: !!auto }); }
    return ok;
  }

  // ===== túi đầy → vứt ngay =====
  let lastFullRun = 0;
  async function onBagFull(reason) {
    if (!cfg.fullDiscard || busy || Date.now() - lastFullRun < 60000) return;
    lastFullRun = Date.now();
    say('🎒 Túi đầy (' + reason + ') → vứt ngay theo bộ lọc...');
    const n = await run('all', true);
    if (ui.status) ui.status.textContent += '\n(vứt vì túi đầy: ' + reason + ')';
    return n;
  }
  // tin từ công cụ khác (Nhặt đồ báo nhặt không được nhiều lần)
  addEventListener('gt:bagfull', e => onBagFull((e.detail && e.detail.reason) || 'công cụ khác báo'));
  // thông báo của game có chữ "đầy" (túi / hành trang đầy)
  const FULL_RE = /(túi|hành trang|balo|túi đồ)[^.\n]{0,20}đầy|đầy[^.\n]{0,12}(túi|hành trang|balo)/i;
  const watchToast = () => {
    try {
      new MutationObserver(ms => {
        if (!cfg.fullDiscard) return;
        for (const m of ms) for (const n of m.addedNodes) {
          const t = n.nodeType === 1 ? n.textContent : n.nodeType === 3 ? n.nodeValue : '';
          if (t && t.length < 200 && FULL_RE.test(t)) { onBagFull('game báo: ' + t.trim().slice(0, 40)); return; }
        }
      }).observe(document.body, { childList: true, subtree: true });
    } catch (e) {}
  };
  // đọc được sức chứa túi thì cứ 2 phút kiểm tra 1 lần
  setInterval(async () => {
    if (!cfg.fullDiscard || busy || document.hidden) return;
    try { const b = bagInfo(await load()); if (b.cap && b.cap - b.count <= cfg.fullMargin) onBagFull('còn ' + (b.cap - b.count) + ' ô trống'); } catch (e) {}
  }, 120000);
  window.__vut = { onBagFull, isBusy: () => busy, cfg,
    refreshSprint() { shiftTick(); },
    setSprint(enabled) { cfg.sprint = !!enabled; save(); shiftTick(); if (ui.sprint) ui.sprint.checked = cfg.sprint; }
  };

  // ===== LUÔN NHẤN SHIFT (chạy nhanh) — chạy độc lập, cả khi không nhặt / không đánh =====
  // nhấn Shift liên tục (~4 lần/giây) như người chơi đè giữ phím Shift; chỉ nhả khi đang gõ chữ hoặc tab bị ẩn
  const typingNow = () => {
    let a = document.activeElement;
    while (a?.shadowRoot?.activeElement) a = a.shadowRoot.activeElement;
    return !!a && (a.isContentEditable || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' ||
      (a.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'submit', 'range'].includes(a.type)));
  };
  const kevS = (type, repeat) => (document.querySelector('.scene-canvas') || document.body).dispatchEvent(new KeyboardEvent(type, { key: 'Shift', code: 'ShiftLeft', keyCode: 16, which: 16, shiftKey: type === 'keydown', repeat: !!repeat, bubbles: true, cancelable: true, composed: true }));
  let shiftHeld = false, virt = false, shiftRenewedAt = 0;
  function shiftTick() {
    // cách của game (như boss.js): bật thẳng cờ chạy nhanh của bộ điều khiển → không cần giả lập phím
    const inp = window.MEONO_VIEW && window.MEONO_VIEW.input;
    if (inp && typeof inp.setVirtualSprint === 'function') {
      if (cfg.sprint && !window.__gtTravelPrecision) { inp.setVirtualSprint(true); virt = true; } else if (virt) { inp.setVirtualSprint(false); virt = false; }
      if (shiftHeld) { kevS('keyup'); shiftHeld = false; }
      return;
    }
    const want = !!cfg.sprint && !window.__gtTravelPrecision && !!document.querySelector('.scene-canvas') && !typingNow() && !document.hidden;
    if (want && (!shiftHeld || Date.now() - shiftRenewedAt >= 1500)) { kevS('keydown', shiftHeld); shiftHeld = true; shiftRenewedAt = Date.now(); }          // lần đầu là nhấn mới, sau đó là "đang đè giữ"
    else if (!want && shiftHeld) { kevS('keyup'); shiftHeld = false; }
  }
  setInterval(shiftTick, 250);
  addEventListener('blur', () => { if (shiftHeld) { kevS('keyup'); shiftHeld = false; } });
  addEventListener('pagehide', () => { if (shiftHeld) { kevS('keyup'); shiftHeld = false; } });

  // firstDelay: chờ trước lượt đầu (sau F5 cần đợi game gửi yêu cầu để học header đăng nhập)
  function setAuto(on, mins, firstDelay = 0) {
    if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
    if (firstTimer) { clearTimeout(firstTimer); firstTimer = null; }
    cfg.autoOn = !!on; save();
    if (on) {
      const tick = async () => {
        if (busy) return;
        await run('all', true);
        // có lỗi thì KHÔNG tắt: giữ bật và thử lại ở lượt sau (chỉ người dùng mới tắt được)
        if (lastErr && ui.status) ui.status.textContent += '\nCó lỗi ở lượt này, sẽ thử lại sau ' + mins + ' phút.';
      };
      if (firstDelay) firstTimer = setTimeout(() => { firstTimer = null; tick(); }, firstDelay); else tick();
      autoTimer = setInterval(tick, mins * 60000);
    }
    if (ui.at) ui.at.textContent = autoTimer ? '⏹ Tắt tự vứt' : '⏱ Bật tự vứt';
    if (ui.fab) ui.fab.classList.toggle('on', !!autoTimer);
  }

  function build() {
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:2147483647;';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
<style>
  *{box-sizing:border-box;font-family:system-ui,sans-serif}
  .fab{background:#2b2f3a;color:#fff;border:1px solid #555;border-radius:20px;padding:8px 14px;cursor:pointer;font-size:13px}
  .panel{display:none;width:320px;background:#1b1e27;color:#e6e6e6;border:1px solid #555;border-radius:10px;padding:10px;margin-bottom:8px;font-size:12px}
  .panel.open{display:block}
  h4{margin:0 0 8px;font-size:13px}
  label{display:inline-flex;align-items:center;gap:4px;margin:0 8px 6px 0}
  input[type=text],input[type=number]{background:#10131a;color:#fff;border:1px solid #444;border-radius:4px;padding:3px 6px;font-size:12px}
  .row{margin:6px 0}
  button.b{background:#3a4156;color:#fff;border:0;border-radius:5px;padding:6px 9px;cursor:pointer;font-size:12px;margin:2px 3px 2px 0}
  button.danger{background:#a62b2b}
  .list{max-height:140px;overflow:auto;background:#10131a;border-radius:5px;padding:4px 6px;margin-top:6px;line-height:1.5}
  .status{margin-top:6px;color:#b8d8ff;white-space:pre-wrap}
  .note{color:#999;margin-top:6px}
</style>
<div class="panel" id="p">
  <h4>🗑 Vứt trang bị (luôn giữ đồ khoá, đang mặc, +N)</h4>
  <div class="row" id="rar"></div>
  <div class="row" id="tr">Bậc: </div>
  <div class="row"><label>Vứt món đến +<input type="number" id="mp" min="0" max="99" style="width:50px"></label>
    <label><input type="checkbox" id="jw"> gồm trang sức</label></div>
  <div class="row"><label>Giữ tên khớp (regex): <input type="text" id="kn" placeholder="vd: Phong Ma|Naginata" style="width:150px"></label></div>
  <div class="row">
    <button class="b" id="pv">① Xem trước</button>
    <button class="b danger" id="r1">② Vứt thử 1</button>
    <button class="b danger" id="ra">③ Vứt tất cả</button>
    <button class="b" id="st">Dừng</button>
  </div>
  <div class="row"><label>Tự vứt mỗi <input type="number" id="am" min="1" style="width:45px"> phút</label><button class="b danger" id="at">⏱ Bật tự vứt</button></div>
  <div class="row"><label><input type="checkbox" id="fd"> 🎒 Túi đầy → vứt ngay (theo bộ lọc trên, không hỏi lại)</label></div>
  <div class="row"><label><input type="checkbox" id="sp"> 🏃 Luôn nhấn Shift (chạy nhanh)</label></div>
  <div class="row"><label>coi là đầy khi còn trống ≤ <input type="number" id="fm" min="0" style="width:45px"> ô</label></div>
  <div class="list" id="ls"></div>
  <div class="status" id="ss">Bấm "Xem trước" trước. Chưa vứt gì cả.</div>
  <div class="note">Vứt xong không lấy lại được. Dùng tự động có thể vi phạm luật game.</div>
</div>
<button class="fab" id="fab">🗑 Vứt đồ</button>`;
    const $ = id => root.getElementById(id);
    const rar = $('rar');
    for (const k of Object.keys(RARITY_LABEL)) {
      const l = document.createElement('label');
      const c = document.createElement('input'); c.type = 'checkbox'; c.checked = !!cfg.rarities[k];
      c.onchange = () => {
        if (k === 'huyen_thoai' && c.checked && !confirm('Cho phép VỨT cả đồ huyền thoại?\nĐồ khoá, đang mặc và +N vẫn được giữ, nhưng các món huyền thoại còn lại (theo bậc đã tick) sẽ bị vứt và không lấy lại được.')) { c.checked = false; return; }
        cfg.rarities[k] = c.checked; save();
      };
      l.append(c, RARITY_LABEL[k]); rar.appendChild(l);
    }
    const tr = $('tr');
    for (let t = 1; t <= 7; t++) {
      const l = document.createElement('label');
      const c = document.createElement('input'); c.type = 'checkbox'; c.checked = !!cfg.tiers[t];
      c.onchange = () => { cfg.tiers[t] = c.checked; save(); };
      l.append(c, String(t)); tr.appendChild(l);
    }
    $('mp').value = cfg.maxPlus; $('mp').onchange = e => { cfg.maxPlus = Math.max(0, +e.target.value || 0); save(); };
    $('jw').checked = cfg.includeJewels; $('jw').onchange = e => { cfg.includeJewels = e.target.checked; save(); };
    $('kn').value = cfg.keepNameRe; $('kn').onchange = e => { cfg.keepNameRe = e.target.value.trim(); save(); };
    $('fab').onclick = () => $('p').classList.toggle('open');
    $('pv').onclick = preview;
    $('r1').onclick = () => run(1);
    $('ra').onclick = () => run('all');
    $('st').onclick = () => { stopFlag = true; setAuto(false); say('Đang dừng...'); };
    $('am').value = cfg.autoMin;
    $('am').onchange = e => { cfg.autoMin = Math.max(1, +e.target.value || 1); save(); if (autoTimer) setAuto(true, cfg.autoMin); };
    $('at').onclick = () => {
      if (autoTimer) { setAuto(false); say('Đã tắt tự vứt.'); return; }
      if (!confirm('Bật tự vứt mỗi ' + cfg.autoMin + ' phút?\nTool sẽ vứt KHÔNG hỏi lại, và đồ đã vứt không lấy lại được.\nBạn đã bấm "Xem trước" và "Vứt thử 1" chưa?')) return;
      setAuto(true, cfg.autoMin);
    };
    $('fd').checked = !!cfg.fullDiscard;
    $('fd').onchange = e => {
      if (e.target.checked && !confirm('Bật "Túi đầy → vứt ngay"?\nKhi túi đầy, tool sẽ vứt NGAY các món khớp bộ lọc mà không hỏi lại. Đồ đã vứt không lấy lại được.')) { e.target.checked = false; return; }
      cfg.fullDiscard = e.target.checked; save();
    };
    $('fm').value = cfg.fullMargin; $('fm').onchange = e => { cfg.fullMargin = Math.max(0, +e.target.value || 0); save(); };
    watchToast();
    $('sp').checked = !!cfg.sprint; $('sp').onchange = e => { cfg.sprint = e.target.checked; save(); shiftTick(); };
    // không để phím gõ trong bảng điều khiển lọt vào game
    ['keydown', 'keyup', 'keypress'].forEach(t => root.addEventListener(t, e => e.stopPropagation()));
    ui = { status: $('ss'), list: $('ls'), at: $('at'), fab: $('fab'), sprint: $('sp') };
    if (window.__gtHub) window.__gtHub.add(host); else document.body.appendChild(host);
    // lần trước đang bật tự vứt → bật lại luôn (không hỏi lại), lượt đầu chờ 8 giây cho game tải xong
    if (cfg.autoOn) { setAuto(true, cfg.autoMin, 8000); say('Tự vứt đang BẬT (giữ từ lần trước). Lượt đầu sau 8 giây, rồi mỗi ' + cfg.autoMin + ' phút. Bấm "Tắt tự vứt" để dừng.'); }
  }

  if (document.body) build(); else document.addEventListener('DOMContentLoaded', build);
})();
} catch (e) { console.error("[công cụ game] phần Vứt đồ + chạy nhanh lỗi:", e); }

// ===================== Câu cá (trước đây: fish.js) =====================
try {
(() => {
  if (window.__fishExt) return;
  window.__fishExt = true;

  let lastMsg = '';
  let running = false;

  function createBot() {
    if (window.__fishBot) window.__fishBot.stop();

    const cfg = {
      autoCast: true,
      castTries: 4,           // nhấn Enter 4 lần để quăng cần
      castGap: 500,
      startDelay: 500,
      afterCatchDelay: 800,
      recastCooldown: 1500,
      maxWait: 180000,

      reactMin: 5,
      reactMax: 15,
      minGap: 90,
      autoSell: true,
      sellCooldown: 30000,
      btnWait: 12000,
      maxFails: 4,
      debug: true,
    };

    const SK = 'fishBot_route_v1';
    const DIRS = ['up', 'down', 'left', 'right'];
    const KEYS = {
      up:    { key: 'ArrowUp',    code: 'ArrowUp',    keyCode: 38 },
      down:  { key: 'ArrowDown',  code: 'ArrowDown',  keyCode: 40 },
      left:  { key: 'ArrowLeft',  code: 'ArrowLeft',  keyCode: 37 },
      right: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
      enter: { key: 'Enter',      code: 'Enter',      keyCode: 13 },
    };
    const CODES = { ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39, Enter: 13, KeyW: 87, KeyA: 65, KeyS: 83, KeyD: 68 };
    const SKIP = '.scene-feed,.worldfeed,.scene-social,[class*="chat" i]';
    const CLICKABLE = 'button,[role="button"],.scene-farm__act,.scene-bag__close';

    const norm = t => String(t || '').split('·')[0].replace(/[\d.,]+/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

    let on = true, busy = false, recording = false, casting = false;
    let wasOpen = false, lastPressDir = null, lastP = null, lastJudge = '';
    let lastPressAt = 0;
    let count = 0, seq = [], lastRun = 0, warnedNoRoute = false, fails = 0;
    let idleSince = 0, waitSince = 0, stuckLogged = false, lastAttempt = 0, castOkAt = 0;
    let steps = [], t0 = 0;
    try { steps = JSON.parse(localStorage.getItem(SK) || '[]'); } catch (e) {}
    steps.forEach(s => { if (s.type === 'btn') s.text = norm(s.text); });

    const log = (...a) => {
      if (cfg.debug) console.log('[fishBot]', ...a);
      try { lastMsg = a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' '); } catch (e) {}
    };
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const canvas = () => document.querySelector('.scene-canvas') || document.querySelector('canvas');
    const visible = el => el && el.isConnected && el.getClientRects().length > 0;
    const getDance = () => {
      const el = document.querySelector('.fish-dance.is-open');
      return el && visible(el) ? el : null;
    };
    const typing = () => {
      const a = document.activeElement;
      return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable);
    };

    function findText(re) {
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
        acceptNode: n => re.test(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT,
      });
      let n;
      while ((n = w.nextNode())) {
        const el = n.parentElement;
        if (el && !el.closest(SKIP) && visible(el)) return el;
      }
      return null;
    }
    const isFull = () => !!findText(/đầy giỏ|giỏ đầy|túi đầy|hết chỗ/i);

    function isWaiting() {
      if (getDance()) return false;
      const hint = document.querySelector('.scene-hint');
      if (hint && visible(hint) && /buông cần|cá cắn|mũi tên/i.test(hint.textContent || '')) return true;
      if (castOkAt > 0 && Date.now() - castOkAt < cfg.maxWait) return true;
      return false;
    }

    function dispatchKey(init, hold) {
      const t = canvas() || document.body;
      t.dispatchEvent(new KeyboardEvent('keydown', init));
      setTimeout(() => t.dispatchEvent(new KeyboardEvent('keyup', init)), hold);
    }
    function fire(name, hold) {
      const k = KEYS[name];
      if (!k) return;
      dispatchKey({ ...k, which: k.keyCode, bubbles: true, cancelable: true, composed: true }, hold || (DIRS.includes(name) ? 30 : 80));
    }

    async function cast(force) {
      if (casting || typing() || busy || recording) return;
      if (cfg.autoSell && isFull()) {
        if (steps.length) { playRoute(); return; }
        if (!warnedNoRoute) { warnedNoRoute = true; log('🧺 Giỏ đầy nhưng chưa có lộ trình bán cá. Hãy ghi lộ trình trước.'); }
      }
      casting = true; lastAttempt = Date.now();
      try {
        if (!on || getDance() || typing() || busy || recording) return;
        if (!(force) && isWaiting()) return;

        log('quăng cần (Enter x' + cfg.castTries + ')');
        for (let i = 0; i < cfg.castTries; i++) {
          if (!on || getDance() || typing() || busy || recording) break;
          fire('enter', 80);
          await sleep(cfg.castGap + Math.random() * 50);
        }

        castOkAt = Date.now();
        await sleep(400);
      } finally { casting = false; }
    }

    async function clickMap(s) {
      const c = canvas();
      if (!c) return;
      const r = c.getBoundingClientRect(), x = r.left + r.width * s.x, y = r.top + r.height * s.y;
      const o = b => ({ clientX: x, clientY: y, bubbles: true, cancelable: true, composed: true, view: window, button: 0, buttons: b, pointerId: 1, pointerType: 'mouse', isPrimary: true });
      c.dispatchEvent(new PointerEvent('pointermove', o(0)));
      c.dispatchEvent(new PointerEvent('pointerdown', o(1)));
      c.dispatchEvent(new MouseEvent('mousedown', o(1)));
      await sleep(120);
      c.dispatchEvent(new PointerEvent('pointerup', o(0)));
      c.dispatchEvent(new MouseEvent('mouseup', o(0)));
      c.dispatchEvent(new MouseEvent('click', o(0)));
    }

    async function clickBtn(text) {
      const want = norm(text);
      if (!want) return false;
      for (const el of document.querySelectorAll(CLICKABLE)) {
        if (!visible(el) || el.closest(SKIP) || el.disabled) continue;
        const label = norm(el.innerText || el.title || el.getAttribute('aria-label'));
        if (label && (label === want || label.startsWith(want) || want.startsWith(label))) { el.click(); return true; }
      }
      return false;
    }

    async function playRoute() {
      if (busy || recording || !steps.length) return;
      if (Date.now() - lastRun < cfg.sellCooldown) { log('⏳ vừa đi bán xong, chưa chạy lại'); return; }
      busy = true; lastRun = Date.now(); fails = 0;
      castOkAt = 0;
      log('▶ chạy lộ trình bán cá (' + steps.length + ' bước)');
      const start = Date.now();
      let missed = 0, aborted = false;
      try {
        for (const s of steps) {
          const wait = s.t - (Date.now() - start);
          if (wait > 0) await sleep(wait);
          if (!on) { aborted = true; break; }
          if (s.type === 'key') {
            dispatchKey({ key: s.key, code: s.code, keyCode: CODES[s.code], which: CODES[s.code], bubbles: true, cancelable: true, composed: true }, s.hold || 100);
          } else if (s.type === 'click') {
            await clickMap(s);
          } else if (s.type === 'btn') {
            if (!(await clickBtn(s.text))) { missed++; log('⚠️ không thấy nút "' + s.text + '", bỏ qua'); }
          }
        }
        await sleep(1500);
      } catch (e) { log('Lỗi khi chạy lộ trình:', String(e)); }
      busy = false; idleSince = 0; lastAttempt = Date.now(); castOkAt = 0;
      log('⏹ xong lộ trình' + (missed ? ' (thiếu ' + missed + ' nút)' : ''));
      if (aborted) return;
      if (missed) {
        cfg.autoCast = false;
        log('❌ Lộ trình chưa hoàn tất. Đã tạm tắt tự quăng.');
        return;
      }
      if (isFull()) { cfg.autoSell = false; log('⚠️ Giỏ vẫn đầy sau khi bán.'); }
    }

    const off = [];
    const listen = (t, ev, fn) => { t.addEventListener(ev, fn, true); off.push(() => t.removeEventListener(ev, fn, true)); };
    const downAt = {};
    const labelOf = el => (el.innerText || el.title || el.getAttribute('aria-label') || '').trim().split('\n')[0].slice(0, 60);

    listen(window, 'pointerdown', e => {
      if (!recording || !e.isTrusted) return;
      const c = canvas(), el = e.target;
      const btn = el.closest && el.closest(CLICKABLE);
      if (btn && norm(labelOf(btn))) {
        const text = norm(labelOf(btn));
        steps.push({ t: Date.now() - t0, type: 'btn', text });
        log('ghi nút:', text);
      } else if (c && (el === c || c.contains(el))) {
        const r = c.getBoundingClientRect();
        const s = { t: Date.now() - t0, type: 'click', x: +((e.clientX - r.left) / r.width).toFixed(4), y: +((e.clientY - r.top) / r.height).toFixed(4) };
        steps.push(s);
        log('ghi bấm map:', s.x, s.y);
      }
    });
    listen(window, 'keydown', e => {
      if (!recording || !e.isTrusted || e.repeat || !CODES[e.code] || typing()) return;
      downAt[e.code] = Date.now() - t0;
    });
    listen(window, 'keyup', e => {
      if (!recording || !e.isTrusted || downAt[e.code] == null) return;
      const t = downAt[e.code]; delete downAt[e.code];
      steps.push({ t, type: 'key', code: e.code, key: e.key, hold: Math.max(50, Date.now() - t0 - t) });
      log('ghi phím:', e.code);
    });

    const origFetch = window.__origFetch || window.fetch;
    window.__origFetch = origFetch;
    window.fetch = async function (...args) {
      const res = await origFetch.apply(this, args);
      try {
        const url = String((args[0] && args[0].url) || args[0]);
        if (on && url.includes('/cau-ca/') && !res.ok) {
          let msg = '';
          try { const j = await res.clone().json(); msg = j.message || JSON.stringify(j).slice(0, 200); }
          catch (e) { try { msg = (await res.clone().text()).slice(0, 200); } catch (_) {} }
          if (!busy) log('Server từ chối (' + url.split('/cau-ca/')[1] + ' ' + res.status + '):', msg);

          if (url.includes('/cau-ca/tha-can') && res.status === 422) {
            if (/đầy|giỏ|túi|hết chỗ|full/i.test(msg)) {
              castOkAt = 0;
              if (!busy && !recording && cfg.autoSell) {
                if (steps.length) { log('🧺 Giỏ đầy → chạy lộ trình bán cá'); setTimeout(playRoute, 300); }
                else if (!warnedNoRoute) { warnedNoRoute = true; cfg.autoCast = false; log('🧺 Giỏ đầy nhưng chưa có lộ trình. Hãy ghi lộ trình bán cá.'); }
              }
            } else {
              castOkAt = 0;
              fails++;
            }
          } else if (url.includes('/cau-ca/giat-can') && res.status === 422) {
            castOkAt = 0;
          }
        }
      } catch (e) {}
      return res;
    };

    function tick() {
      if (!on || busy || recording) return;
      const now = Date.now();
      const d = getDance();

      if (d) {
        idleSince = 0; waitSince = 0; castOkAt = 0; fails = 0;
        if (!wasOpen) {
          wasOpen = true; lastPressDir = null; lastP = null; lastJudge = '';
          lastPressAt = 0; count = 0; seq = [];
          log('cá cắn câu!');
        }

        const judge = (d.querySelector('.fish-dance__judge')?.textContent || '').trim();
        if (judge && judge !== lastJudge) { if (judge !== 'HOÀN HẢO') log('game phán: ' + judge); lastJudge = judge; }

        const big = d.querySelector('.fish-dance__big');
        const r = big ? (DIRS.map(x => big.classList.contains('is-' + x) ? { dir: x, big } : null).find(Boolean) || null) : null;
        const ring = d.querySelector('.fish-dance__ring');
        const pv = ring && ring.style.getPropertyValue('--p');
        const p = pv ? parseFloat(pv) : null;

        if (!r) { lastP = p; return; }

        const sincePress = now - lastPressAt;
        const ringReset = p != null && lastP != null && Math.abs(p - lastP) > 0.15;

        let isNew = false;
        if (lastPressDir === null) {
          isNew = true;
        } else if (r.dir !== lastPressDir && sincePress > cfg.minGap) {
          isNew = true;
        } else if (r.dir === lastPressDir && (ringReset || sincePress > 350)) {
          isNew = true;
        }

        lastP = p;

        if (isNew && sincePress > cfg.minGap) {
          lastPressDir = r.dir; lastPressAt = now; lastJudge = '';
          count++; seq.push(r.dir);
          log('#' + count + ' bấm ' + r.dir);

          const delay = cfg.reactMin + Math.random() * (cfg.reactMax - cfg.reactMin);
          setTimeout(() => fire(r.dir, 30), delay);
        }
        return;
      }

      if (wasOpen) {
        wasOpen = false;
        castOkAt = 0;
        log('xong ' + count + ' nhịp: ' + seq.join(' → '));
      }

      const rawWaiting = isWaiting();
      if (rawWaiting) { if (!waitSince) waitSince = now; } else { waitSince = 0; stuckLogged = false; }
      const stuck = rawWaiting && now - waitSince > cfg.maxWait;

      if (rawWaiting && !stuck) { idleSince = 0; fails = 0; return; }

      if (stuck && !stuckLogged) { stuckLogged = true; castOkAt = 0; log('⏱ Chờ cá quá hạn, thử quăng lại'); }
      if (!idleSince) idleSince = now;
      if (!cfg.autoCast || casting) return;

      if (now - idleSince > cfg.afterCatchDelay && now - lastAttempt > cfg.recastCooldown) {
        cast(stuck);
        if (stuck) waitSince = now;
      }
    }

    const obs = new MutationObserver(tick);
    obs.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style'] });
    const timer = setInterval(tick, 8);

    window.__fishBot = {
      cfg,
      get steps() { return steps; },
      get recording() { return recording; },
      get busy() { return busy; },
      stop() {
        obs.disconnect(); clearInterval(timer); off.forEach(f => f()); on = false;
        window.fetch = origFetch;
        console.log('[fishBot] đã dừng');
      },
      castNow() { castOkAt = 0; return cast(true); },
      state() {
        return { bat: on, autoCast: cfg.autoCast, khungMuiTen: !!getDance(), dangChoCa: isWaiting(), busy, casting, recording };
      },
      record() {
        steps = []; t0 = Date.now(); recording = true;
        log('🔴 ĐANG GHI LỘ TRÌNH BÁN CÁ...');
      },
      save() {
        recording = false;
        steps.sort((a, b) => a.t - b.t);
        if (steps.length) { const base = steps[0].t; steps.forEach(s => s.t -= base); }
        try { localStorage.setItem(SK, JSON.stringify(steps)); } catch (e) {}
        warnedNoRoute = false; cfg.autoSell = true; cfg.autoCast = true;
        log('💾 đã lưu ' + steps.length + ' bước.');
      },
      sellNow() { lastRun = 0; return playRoute(); },
      clear() { steps = []; try { localStorage.removeItem(SK); } catch (e) {} log('đã xoá lộ trình'); },
    };

    log('Đã cấu hình quăng cần Enter x4. Lộ trình bán cá: ' + steps.length + ' bước');
    if (cfg.autoCast) setTimeout(() => { if (on && !getDance() && !busy && !recording && !isWaiting()) cast(); }, cfg.startDelay);
  }

  // ===== giao diện =====
  function build() {
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:120px;bottom:12px;z-index:2147483647;';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
<style>
  *{box-sizing:border-box;font-family:system-ui,sans-serif}
  .fab{background:#2b2f3a;color:#fff;border:1px solid #555;border-radius:20px;padding:8px 14px;cursor:pointer;font-size:13px}
  .fab.on{background:#1f6f43}
  .panel{display:none;width:300px;background:#1b1e27;color:#e6e6e6;border:1px solid #555;border-radius:10px;padding:10px;margin-bottom:8px;font-size:12px}
  .panel.open{display:block}
  h4{margin:0 0 8px;font-size:13px}
  label{display:inline-flex;align-items:center;gap:4px;margin:0 8px 6px 0}
  .row{margin:6px 0}
  button.b{background:#3a4156;color:#fff;border:0;border-radius:5px;padding:6px 9px;cursor:pointer;font-size:12px;margin:2px 3px 2px 0}
  button.go{background:#1f6f43}
  button.stop{background:#a62b2b}
  .status{margin-top:6px;color:#b8d8ff;white-space:pre-wrap;word-break:break-word}
  .note{color:#999;margin-top:6px}
</style>
<div class="panel" id="p">
  <h4>🎣 Bot câu cá</h4>
  <div class="row"><button class="b go" id="tg">▶ Bật bot</button><button class="b" id="cn">Quăng cần ngay</button></div>
  <div class="row"><label><input type="checkbox" id="ac" checked> Tự quăng cần</label><label><input type="checkbox" id="as" checked> Tự bán khi đầy giỏ</label></div>
  <div class="row"><b>Lộ trình bán cá</b> <span id="rs"></span><br>
    <button class="b" id="rc">🔴 Ghi</button><button class="b" id="sv">💾 Lưu</button><button class="b" id="sn">Bán thử</button><button class="b" id="cl">Xoá</button></div>
  <div class="status" id="ss">Bot đang tắt. Bấm "Bật bot" để bắt đầu.</div>
  <div class="note">Cách ghi lộ trình: bấm Ghi, tự đi bán cá bằng tay như bình thường, rồi bấm Lưu. Dùng tự động có thể vi phạm luật game.</div>
</div>
<button class="fab" id="fab">🎣 Câu cá</button>`;
    const $ = id => root.getElementById(id);
    const bot = () => window.__fishBot;
    const refresh = () => {
      const b = bot();
      $('fab').classList.toggle('on', running);
      $('tg').textContent = running ? '■ Tắt bot' : '▶ Bật bot';
      $('tg').className = 'b ' + (running ? 'stop' : 'go');
      $('rs').textContent = b ? '(' + b.steps.length + ' bước' + (b.recording ? ', đang ghi 🔴' : '') + ')' : '';
      if (!running && !b) { try { $('rs').textContent = '(' + JSON.parse(localStorage.getItem('fishBot_route_v1') || '[]').length + ' bước)'; } catch (e) {} }
      if (running && b) {
        const s = b.state();
        $('ss').textContent = (s.khungMuiTen ? '🎯 Đang bấm mũi tên' : s.dangChoCa ? '⏳ Đang chờ cá cắn' : s.busy ? '🧺 Đang đi bán cá' : s.recording ? '🔴 Đang ghi' : '… chờ quăng cần') + (lastMsg ? '\n' + lastMsg : '');
      }
    };
    $('fab').onclick = () => $('p').classList.toggle('open');
    $('tg').onclick = () => {
      if (running) { window.__fishBot.stop(); running = false; $('ss').textContent = 'Bot đã tắt.'; }
      else {
        createBot(); running = true;
        window.__fishBot.cfg.autoCast = $('ac').checked;
        window.__fishBot.cfg.autoSell = $('as').checked;
      }
      refresh();
    };
    $('ac').onchange = e => { if (bot()) bot().cfg.autoCast = e.target.checked; };
    $('as').onchange = e => { if (bot()) bot().cfg.autoSell = e.target.checked; };
    const need = fn => () => { if (!running) { $('ss').textContent = 'Hãy bật bot trước.'; return; } fn(bot()); refresh(); };
    $('cn').onclick = need(b => b.castNow());
    $('rc').onclick = need(b => b.record());
    $('sv').onclick = need(b => { b.save(); $('ac').checked = true; $('as').checked = true; });
    $('sn').onclick = need(b => b.sellNow());
    $('cl').onclick = need(b => { if (confirm('Xoá lộ trình bán cá đã lưu?')) b.clear(); });
    ['keydown', 'keyup', 'keypress'].forEach(t => root.addEventListener(t, e => e.stopPropagation()));
    if (window.__gtHub) window.__gtHub.add(host); else document.body.appendChild(host);
    refresh();
    setInterval(refresh, 1000);
  }

  if (document.body) build(); else document.addEventListener('DOMContentLoaded', build);
})();
} catch (e) { console.error("[công cụ game] phần Câu cá lỗi:", e); }

// ===================== Nhặt + Đánh (trước đây: loot.js) =====================
try {
(() => {
  if (window.__lootExt) return;
  window.__lootExt = true;

  const CK = 'lootExtCfg2';
  const RUNK = 'lootExtRun', DEATHK = 'lootExtDeath';     // sessionStorage: đang chạy (tự chạy lại sau khi tải trang) / map vừa gục
  const POSK = 'lootExtPos';                              // sessionStorage: vị trí cuối khi tool đang chạy (để biết chỗ bị đẩy ra khỏi map)
  const PORTK = 'lootExtPortals';                         // localStorage: cửa ra đã học, theo map
  const REK = 'lootExtReenter';                           // sessionStorage: đang chờ vào lại phó bản { map, t, tries, last }
  const SEQK = 'lootExtEnterSeq';                         // localStorage: các nút bấm để vào phó bản (học từ người chơi)
  const LOOPK = 'lootExtPbLoop';                          // localStorage: vòng đã học { village, steps, exit, prev, dest }
  const isDungeon = m => /^pb-/i.test(String(m || ''));
  // sửa bản học vòng làng cũ (không cần học lại tay):
  //  - chặng rời đi bằng "bấm bản đồ" (click-to-move) thì là ĐI VÀO CỔNG, không phải "vào bằng nút"; chỗ bấm cuối = cổng
  //  - chỗ tới bằng cổng rồi đi ra về lại chặng cũ = MAP ĐÁNH (bỏ khỏi danh sách chặng); chỗ bấm cuối trong đó = cổng ra
  function repairMac(m) {
    const canv = s => (s.steps || []).filter(x => x.kind === 'canvas' && x.w);
    for (const s of m.stages) {
      const last = (s.steps || [])[s.steps.length - 1];
      if (s.byBtn && last && last.kind === 'canvas') {
        s.byBtn = false;
        const c = canv(s);
        if (!s.exit && c.length) { s.exit = c[c.length - 1].w; s.prev = c.length > 1 ? c[c.length - 2].w : null; }
      }
    }
    for (let i = m.stages.length - 1; i >= 1; i--) {
      const s = m.stages[i], from = m.stages[i - 1];
      const viaGate = from.dest === s.place && !from.byBtn;
      const goesBack = s.dest && m.stages.some(x => x !== s && x.place === s.dest);
      if (viaGate && goesBack) {
        const c = canv(s);
        if (!m.fightExit && (s.exit || c.length)) m.fightExit = { exit: s.exit || c[c.length - 1].w, prev: s.exit ? s.prev : (c.length > 1 ? c[c.length - 2].w : null) };
        m.fight = m.fight || s.place;
        m.stages.splice(i, 1);
      }
    }
    m.v = 3;
    return m;
  }
  // ===== hệ (ngũ hành) =====
  // hệ của game không chỉ ngũ hành (vd có Lôi) → nhận mọi hệ trong danh sách + mọi tên hệ người dùng ghi trong "Map hợp"/"Bảng khắc"
  const unaccent = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').trim().toLowerCase();
  const EL_NAME = { kim: 'Kim', moc: 'Mộc', thuy: 'Thủy', hoa: 'Hỏa', tho: 'Thổ', loi: 'Lôi', phong: 'Phong', bang: 'Băng', quang: 'Quang', am: 'Ám', doc: 'Độc' };
  const EL_ALIAS = { metal: 'kim', wood: 'moc', water: 'thuy', fire: 'hoa', earth: 'tho', thunder: 'loi', lightning: 'loi', electric: 'loi', wind: 'phong', ice: 'bang', light: 'quang', dark: 'am', poison: 'doc' };
  const elName = e => EL_NAME[e] || (e ? e[0].toUpperCase() + e.slice(1) : '?');
  const userEls = () => new Set([...String(cfg.goodEls || '').split(/[,;\s>]+/), ...String(cfg.khac || '').split(/[,;\s>]+/)].map(unaccent).filter(Boolean));
  const elemOfWord = s => { const u = unaccent(s); const e = EL_ALIAS[u] || u; return (EL_NAME[e] || userEls().has(e)) ? e : null; };
  const ELEM_KEY = /^(he|hệ|element|elem|elements?|nguyen_?to|ngu_?hanh|thuoc_?tinh|he_?phai|attr|attribute)$/i;
  // tìm hệ theo tên trường (đi sâu 2 tầng), bỏ qua các nhánh trong skip
  function elemByKey(o, skip = [], path = '', depth = 0) {
    if (!o || typeof o !== 'object' || Array.isArray(o) || depth > 2) return null;
    for (const k of Object.keys(o)) { const v = o[k]; if (ELEM_KEY.test(k) && (typeof v === 'string' || typeof v === 'number')) { const e = elemOfWord(v); if (e) return { e, src: path + k + '=' + v }; } }
    for (const k of Object.keys(o)) { if (skip.includes(k)) continue; const r = elemByKey(o[k], skip, path + k + '.', depth + 1); if (r) return r; }
    return null;
  }
  // "Lôi > Hỏa, Thủy; Hỏa > Băng" → { loi: Set(hoa, thuy), hoa: Set(bang) }
  const parseKhac = s => {
    const o = {};
    for (const part of String(s || '').split(/[;\n]+/)) {
      const [a, b] = part.split('>'); if (!a || !b) continue;
      const k = elemOfWord(a); if (!k) continue;
      for (const t of b.split(/[,\s]+/)) { const e = elemOfWord(t); if (e) (o[k] = o[k] || new Set()).add(e); }
    }
    return o;
  };
  const goodSet = () => new Set(String(cfg.goodEls || '').split(/[,;\s]+/).map(elemOfWord).filter(Boolean));
  const baseMap = m => String(m || '').replace(/-\d+$/, '');
  const RAR = { thuong: 'Thường', tot: 'Tốt', hiem: 'Hiếm', cuc_pham: 'Cực phẩm', huyen_thoai: 'Huyền thoại' };
  const TIER_MAX = 7;          // game hiện mới có trang bị tới bậc 7
  const allTiers = v => { const o = {}; for (let t = 1; t <= TIER_MAX; t++) o[t] = v; return o; };
  const DEF = {
    // --- nhặt đồ ---
    pickOn: true,                               // nhặt đồ rơi quanh mình
    xu: true,                                   // nhặt xu
    stone: true, stoneCodes: '',                // nhặt đá; mã đá cách nhau dấu phẩy, để trống = mọi loại da_*
    gear: true,                                 // nhặt trang bị (đồ a.* w.* j.*)
    rarities: { thuong: true, tot: true, hiem: true, cuc_pham: true, huyen_thoai: true },
    tiers: allTiers(true),                      // bậc trang bị được nhặt
    other: true,                                // vật phẩm khác (thuốc, vé, nguyên liệu...)
    egg: true, eggCodes: '',                    // nhặt trứng (kể cả khi tắt "vật phẩm khác"); mã trứng thêm, cách nhau dấu phẩy
    prio: true,                                 // ưu tiên: xu > đồ (trứng / huyền thoại trước) > đá > còn lại
    always: '', ignore: '',                     // mã loại luôn nhặt / không bao giờ nhặt
    lootNoRed: true, lootRedR: 250,             // không nhặt đồ nằm cạnh quái đỏ
    lootFew: false, lootMobMax: 5, lootMobR: 200,   // chỉ nhặt khi quanh món đồ ít quái
    nearR: 600,                                 // khi TỰ ĐÁNH đang bật: đồ thường chỉ nhặt trong bán kính này (trứng/huyền thoại đi tới maxDist)
    xuFar: true,                                // xu cũng được đi xa tới maxDist như trứng/huyền thoại
    burst: true, burstN: 3, burstR: 500,        // gom nhanh: có ≥ N món trong bán kính → tạm tắt TỰ ĐÁNH để gom một mạch rồi bật lại
    neverAutoOff: true,                         // vừa nhặt vừa đánh: KHÔNG tắt Tự đánh vì việc nhặt (gom nhanh / kẹt / chế độ tắt) → luôn đánh, hút máu
    fightFirst: true, combatPickR: 150, fightHpPct: 60, dangerR: 300,   // đang bị đánh / có thủ lĩnh gần → chỉ nhặt đồ sát bên; máu dưới X% thì không nhặt, đứng đánh
    avoid: true,                                // né vật cản (tìm đường vòng)
    avoidPortal: true, portalR: 130,            // tránh cửa ra (tự học chỗ bị đẩy ra khỏi map, lưu lâu dài)
    avoidEntry: true,                           // tránh chỗ vừa xuất hiện khi vào map (thường sát cửa)
    // --- chiến đấu / né ---
    avoidRed: false, redKeep: 350, redElite: false,     // tránh xa quái máu đỏ (Trùm, Thủ lĩnh, Boss TG), cả Tinh anh
    dodgeHit: true,                                     // né vùng chiêu đỏ (đọc màu đỏ trên canvas quanh nhân vật)
    kiteRed: false, kiteMargin: 60, kiteRange: 120,     // thả diều quái đỏ: đứng ngoài tầm nó + chừa thêm
    fleeSwitch: true, fleeMaxS: 6,              // né lâu/kẹt → đi đánh quái thường khác
    kiteHit: false, kiteHitKeep: 300,           // thả diều né đánh thường: giữ cách quái đang đánh mình
    bossNear: 0, body: 26,                      // tránh sát boss (0 = tắt), kích thước thân
    crowd: false, crowdR: 200,                  // ưu tiên đánh chỗ đông quái
    nearest: false, nearestR: 700, clickTarget: true, viewScale: 1,   // luôn đánh quái gần nhất: bấm chuột chọn nó (tỉ lệ màn hình/thế giới), không được thì đi lại sát nó
    // (Đi tới map đã tách sang travel.js)                                       // 🧭 đang tự đi tới map này (qua các mũi tên đã học)
    pvp: false, pvpR: 600, pvpMinHp: 30, pvpOnly: '', pvpSkip: '',    // tự nhắm người chơi khác để đánh (kể cả khi đang đánh quái); chỉ đánh / không đánh theo tên
    zoneSwitch: false, zoneSwitchS: 3, zoneSwitchMaps: '',   // có người chơi khác trong khu quá N giây → đổi khu
    // --- chống đứng im ---
    idleOn: false, idleMin: 3, idleAuto: true, idleZone: true, idleReload: false,
    // --- phó bản ---
    reenter: false, reenterDelay: 3, reenterMax: 6,     // bị văng / gục ra khỏi phó bản → tự vào lại
    // --- vòng làng: làng → mua thẻ (NPC) → cổng → map khắc hệ; chết → lại từ đầu ---
    pbLoop: false, pbReroll: true, pbRerollMax: 30,
    pbTargets: 'lc-3',                                  // mã map cần vào (vd lc-3 = hệ Hỏa). Có giá trị thì so mã map, không cần đọc hệ
    // tự quét (không cần học): tìm NPC / cổng trên màn hình hoặc trong dữ liệu map
    clickMove: true,                                    // đi tới NPC / cổng bằng cách bấm chuột lên bản đồ (game tự tìm đường)
    pbNpcPos: null,                                     // toạ độ NPC đã ghi bằng nút "📍 Ghi vị trí NPC" { x, y, map }
    pbAuto: true, pbNpcMap: 'ng-tnam-ld', pbNpcName: 'Lạc Hầu Già', pbBuyBtns: 'Mua & vào ngay, Mua & vào',
    pbVillage: 'lc-lang', pbFightRe: '^lc-\\d+$', pbGateWords: 'Cổng, Lối vào, Lối ra, Dịch chuyển, Truyền tống',
    goodEls: 'Hỏa, Thủy',                               // hệ map muốn vào (hệ mình khắc). Có giá trị thì không cần đọc hệ nhân vật
    pbRule: 'me',                                       // khi "Map hợp" trống: 'me' = hệ mình khắc hệ map | 'safe' = chỉ cần hệ map không khắc mình
    khac: 'Lôi > Hỏa, Thủy',                            // bảng khắc: "A > B, C; D > E"
    // --- hồi sinh / tự đánh ---
    revive: false, reviveMode: 'save', reviveDelay: 1,
    backToMap: false, reviveAuto: false, keepAuto: false, sprint: false, sprintMode: 'auto',
    // --- chung ---
    autoMode: 'keep',                           // 'keep' = vừa đánh vừa nhặt | 'toggle' = tắt tự đánh khi đi nhặt rồi bật lại
    pickRun: false, fightRun: false,                    // công tắc tab 💎 Nhặt đồ / ⚔️ Đánh
    keys: 'wasd', maxDist: 1500, minHpPct: 0.3, pickKey: null,
  };
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(CK) || '{}'); } catch (e) {}
  try { const old = JSON.parse(localStorage.getItem('lootExtCfg') || '{}'); if (old.pickKey && !saved.pickKey) saved.pickKey = old.pickKey; } catch (e) {}
  const cfg = {
    ...DEF, ...saved,
    rarities: { ...DEF.rarities, ...(saved.rarities || {}) },
    tiers: { ...DEF.tiers, ...(saved.tiers || {}) },
    escalate: true, resumeDelay: 1200, reach: 42, axis: 14, pickWait: 1500, confirmMs: 2500, walkTimeout: 25000, progMs: 1800, stuckMs: 900,
    pickEvery: 250, pollMs: 3000, pollFastMs: 1500,
    cell: 24, bodyR: 14, learnTtl: 5 * 60000, replanMs: 700, retargetMs: 600, clusterR: 150, sideMs: 380,
    autoOnRe: /^(is-)?(on|active|running|enabled|engaged|armed)$/i,
    tick: 50, debug: true,
  };
  if (cfg.khac === 'kim>moc, moc>tho, tho>thuy, thuy>hoa, hoa>kim') cfg.khac = DEF.khac;
  if (cfg.portalR === 90) cfg.portalR = DEF.portalR;      // vùng cửa cũ nhỏ quá (chỗ ghi được là mép vùng kích hoạt) → mặc định mới     // bảng ngũ hành mặc định cũ → bảng mới (game có hệ Lôi)
  // các chức năng đã bỏ theo yêu cầu (ảnh): luôn tắt
  Object.assign(cfg, { fightFirst: false, lootNoRed: false, avoidRed: false, redElite: false, kiteRed: false, fleeSwitch: false, kiteHit: false, bossNear: 0, nearest: false, crowd: false, zoneSwitch: false, pickOn: true, avoid: true, avoidPortal: true });
  const store = () => {
    try {
      const o = {}; for (const k of Object.keys(DEF)) o[k] = cfg[k];
      localStorage.setItem(CK, JSON.stringify(o));
    } catch (e) {}
  };
  const ss = {
    get: k => { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { sessionStorage.setItem(k, v); } catch (e) {} },
    del: k => { try { sessionStorage.removeItem(k); } catch (e) {} },
  };
  const codes = s => new Set(String(s || '').split(',').map(x => x.trim()).filter(Boolean));
  const sets = {};
  const applySets = () => { sets.stone = codes(cfg.stoneCodes); sets.always = codes(cfg.always); sets.ignore = codes(cfg.ignore); sets.egg = codes(cfg.eggCodes); sets.zmaps = codes(cfg.zoneSwitchMaps); };
  applySets();

  const KEYSETS = {
    wasd: { up: { key: 'w', code: 'KeyW', keyCode: 87 }, down: { key: 's', code: 'KeyS', keyCode: 83 }, left: { key: 'a', code: 'KeyA', keyCode: 65 }, right: { key: 'd', code: 'KeyD', keyCode: 68 } },
    arrows: { up: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 }, down: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 }, left: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 }, right: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 } },
  };
  const SHIFT = { key: 'Shift', code: 'ShiftLeft', keyCode: 16 };

  // ===== nghe mạng ngay từ lúc trang tải (fetch + XHR + WebSocket), trước khi game kịp giữ tham chiếu gốc =====
  // bot đăng ký vào TAP.subs; mỗi tin: { via, dir: 'req'|'res'|'ws-in'|'ws-out', url, body?, json?, raw? }
  const TAP = window.__lootTap || (window.__lootTap = { subs: new Set(), n: { fetch: 0, xhr: 0, ws: 0 } });
  const emit = m => { for (const f of TAP.subs) { try { f(m); } catch (e) {} } };
  const asJson = t => { if (typeof t !== 'string' || !/^\s*[[{]/.test(t)) return null; try { return JSON.parse(t); } catch (e) { return null; } };
  if (!TAP.installed) {
    TAP.installed = true;
    const of = window.fetch;
    window.__lootOrigFetch = window.__lootOrigFetch || of;
    window.fetch = async function (...a) {
      const url = String((a[0] && a[0].url) || a[0]), body = a[1] && a[1].body;
      TAP.n.fetch++;
      emit({ via: 'fetch', dir: 'req', url, body: typeof body === 'string' ? body : null });
      const res = await of.apply(this, a);
      try { if ((res.headers.get('content-type') || '').includes('json')) window.__gtReadJSON(res).then(j => emit({ via: 'fetch', dir: 'res', url, json: j })).catch(() => {}); } catch (e) {}
      return res;
    };
    const XO = XMLHttpRequest.prototype.open, XS = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (m, u) { this.__lootUrl = String(u); return XO.apply(this, arguments); };
    XMLHttpRequest.prototype.send = function (b) {
      const url = this.__lootUrl || '';
      TAP.n.xhr++;
      emit({ via: 'xhr', dir: 'req', url, body: typeof b === 'string' ? b : null });
      this.addEventListener('load', () => {
        try { const j = this.responseType === 'json' ? this.response : (!this.responseType || this.responseType === 'text') ? asJson(this.responseText) : null; if (j) emit({ via: 'xhr', dir: 'res', url, json: j }); } catch (e) {}
      });
      return XS.apply(this, arguments);
    };
    const hookWs = ws => {
      if (ws.__lootHooked) return; ws.__lootHooked = true;
      ws.addEventListener('message', ev => { TAP.n.ws++; const raw = typeof ev.data === 'string' ? ev.data : '[nhị phân ' + (ev.data && (ev.data.byteLength || ev.data.size)) + ' byte]'; emit({ via: 'ws', dir: 'ws-in', url: ws.url, raw, json: asJson(raw) }); });
    };
    const WS = window.WebSocket;
    if (WS) {
      const WSS = WS.prototype.send;
      WS.prototype.send = function (d) { hookWs(this); emit({ via: 'ws', dir: 'ws-out', url: this.url, raw: typeof d === 'string' ? d : '[nhị phân]', json: asJson(d) }); return WSS.apply(this, arguments); };
      const P = function (...a) { const ws = new WS(...a); hookWs(ws); return ws; };
      P.prototype = WS.prototype; Object.assign(P, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
      window.WebSocket = P;
    }
  }

  let lastMsg = '', running = false;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const mapNow = () => (location.pathname.match(/\/ngoai-gioi\/([^/?#]+)/) || [])[1] || null;

  // ===== phân loại món đồ rơi =====
  // trứng: tên có "Trứng", mã chứa egg, mã bắt đầu bằng trung_ (trừ trung_cap...), hoặc mã nhập tay
  const isEgg = d => sets.egg.has(d.type) || /trứng/i.test(d.name || '') || /egg/i.test(String(d.type)) || (/^trung(_|\.|$)/i.test(String(d.type)) && !/^trung_?cap/i.test(String(d.type)));
  const kindOf = d => isEgg(d) ? 'trứng' : d.type === 'xu' ? 'xu' : /^da_/.test(d.type) ? 'đá' : /^[awj]\./.test(String(d.type)) ? 'trang bị' : 'khác';
  const tierOf = d => { const m = String(d.type).match(/\.(\d+)$/); return m ? +m[1] : null; };
  const isLegend = d => d.rar === 'huyen_thoai' && kindOf(d) === 'trang bị';
  // trọng số ưu tiên: càng lớn càng được nhặt trước, kể cả khi xa hơn
  // thứ tự nhặt: xu → đồ (trứng / huyền thoại trước đồ thường) → đá → còn lại
  const weightOf = d => { if (!cfg.prio) return 1; const k = kindOf(d); return k === 'xu' ? 12 : (k === 'trứng' || isLegend(d)) ? 7 : k === 'trang bị' ? 6 : k === 'đá' ? 3 : 1; };
  const isPrio = d => cfg.prio && weightOf(d) >= 6;
  function wanted(d) {
    if (sets.ignore.has(d.type)) return false;
    if (sets.always.has(d.type)) return true;
    switch (kindOf(d)) {
      case 'trứng': return !!cfg.egg;
      case 'xu': return !!cfg.xu;
      case 'đá': return !!cfg.stone && (!sets.stone.size || sets.stone.has(d.type));
      case 'trang bị': {
        if (!cfg.gear) return false;
        const t = tierOf(d);
        if (t != null && !cfg.tiers[t]) return false;
        if (typeof d.rar === 'string' && RAR[d.rar]) return !!cfg.rarities[d.rar];
        return Object.values(cfg.rarities).every(Boolean);      // chưa rõ phẩm chất: chỉ nhặt khi đã tick đủ mọi phẩm chất
      }
      default: return !!cfg.other;
    }
  }

  // ===== phân loại quái: [0]id [1]tên [2]lv [3]x [4]y [5]hp [6]maxhp ... [12]loại ('normal', 'elite', boss...) =====
  const mAlive = m => m && m[5] > 0;
  const mType = m => String(m[12] ?? '');
  const isBossType = m => { const t = mType(m); return t !== '' && t !== 'normal' && t !== 'elite'; };
  const isRed = m => isBossType(m) || (cfg.redElite && mType(m) === 'elite');

  // ===== dò vật cản trong dữ liệu game (định dạng chưa biết trước nên dò theo tên trường) =====
  const OBS_KEY = /obs|wall|block|coll|solid|rock|tree|prop|barrier|terrain|obstacle|vat_?can/i;
  function parseShape(o) {
    if (Array.isArray(o)) {
      if (!o.every(v => typeof v === 'number')) return null;
      if (o.length === 4) return { x: o[0], y: o[1], w: o[2], h: o[3] };
      if (o.length === 3) return { x: o[0], y: o[1], r: o[2] };
      return null;
    }
    if (o && typeof o === 'object') {
      const x = o.x ?? o.x1 ?? o.left, y = o.y ?? o.y1 ?? o.top;
      if (typeof x !== 'number' || typeof y !== 'number') return null;
      const r = o.r ?? o.radius; if (typeof r === 'number') return { x, y, r };
      const w = o.w ?? o.width ?? (typeof o.x2 === 'number' ? o.x2 - x : undefined), h = o.h ?? o.height ?? (typeof o.y2 === 'number' ? o.y2 - y : undefined);
      if (typeof w === 'number' && typeof h === 'number') return { x, y, w, h };
    }
    return null;
  }
  function scanObs(d, path = '', depth = 0, out = []) {
    if (!d || typeof d !== 'object' || depth > 3) return out;
    for (const k of Object.keys(d)) {
      const v = d[k], pth = path ? path + '.' + k : k;
      if (Array.isArray(v)) { if (v.length && OBS_KEY.test(k)) { const sh = v.map(parseShape).filter(Boolean); if (sh.length) out.push({ path: pth, shapes: sh }); } }
      else if (v && typeof v === 'object' && k !== 'packet') scanObs(v, pth, depth + 1, out);
    }
    return out;
  }
  const boundsOf = f => {
    const w = f.mw ?? f.map_w ?? f.width ?? (f.map && (f.map.w ?? f.map.width)), h = f.mh ?? f.map_h ?? f.height ?? (f.map && (f.map.h ?? f.map.height));
    return typeof w === 'number' && typeof h === 'number' && w > 100 && h > 100 ? { w, h } : null;
  };

  // ===== cửa ra =====
  // lưu theo mã map và cả mã bỏ số cuối (vd pb-chientruong-1-51 và pb-chientruong-1) để dùng lại cho lần vào sau
  const mapKeys = m => { const b = String(m).replace(/-\d+$/, ''); return b !== m ? [m, b] : [m]; };
  const readPortals = () => { try { return JSON.parse(localStorage.getItem(PORTK) || '{}') || {}; } catch (e) { return {}; } };
  const loadPortals = m => {
    const all = readPortals(), out = [];
    for (const k of mapKeys(m)) for (const a of (all[k] || [])) if (!out.some(o => Math.hypot(o.x - a[0], o.y - a[1]) < 40)) out.push({ x: a[0], y: a[1] });
    return out;
  };
  const savePortal = (m, x, y) => {
    try {
      const all = readPortals();
      for (const k of mapKeys(m)) { const l = (all[k] || []).filter(a => Math.hypot(a[0] - x, a[1] - y) > 60); l.push([Math.round(x), Math.round(y), Date.now()]); all[k] = l.slice(-10); }
      localStorage.setItem(PORTK, JSON.stringify(all));
    } catch (e) {}
  };
  const forgetPortals = m => { try { const all = readPortals(); let n = 0; for (const k of mapKeys(m)) { n += (all[k] || []).length; delete all[k]; } localStorage.setItem(PORTK, JSON.stringify(all)); return n; } catch (e) { return 0; } };
  const PORTAL_KEY = /portal|gate|exit|warp|door|tele|cong|cua_?ra|^tp$/i;
  const ptOf = o => {
    if (Array.isArray(o)) return o.length >= 2 && o.length <= 3 && o.every(v => typeof v === 'number') ? { x: o[0], y: o[1] } : null;
    if (o && typeof o === 'object' && typeof o.x === 'number' && typeof o.y === 'number') return typeof o.w === 'number' && typeof o.h === 'number' ? { x: o.x + o.w / 2, y: o.y + o.h / 2 } : { x: o.x, y: o.y };
    return null;
  };
  function scanPortals(d, path = '', depth = 0, out = []) {
    if (!d || typeof d !== 'object' || depth > 3) return out;
    for (const k of Object.keys(d)) {
      const v = d[k], pth = path ? path + '.' + k : k;
      if (Array.isArray(v)) { if (v.length && PORTAL_KEY.test(k)) for (const o of v) { const s = ptOf(o); if (s) out.push({ ...s, src: pth }); } }
      else if (v && typeof v === 'object' && k !== 'packet') { if (PORTAL_KEY.test(k)) { const s = ptOf(v); if (s) out.push({ ...s, src: pth }); } scanPortals(v, pth, depth + 1, out); }
    }
    return out;
  }

  // hàng đợi ưu tiên nhỏ cho A*
  function Heap() {
    const a = [];
    return {
      get size() { return a.length; },
      push(n) { a.push(n); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } },
      pop() {
        const top = a[0], last = a.pop();
        if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && a[l][0] < a[m][0]) m = l; if (r < a.length && a[r][0] < a[m][0]) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } }
        return top;
      },
    };
  }
  const DIRS8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

  function createBot() {
    if (window.__loot) window.__loot.stop();

    const S = { drops: new Map(), heroes: [], mobs: [], pos: null, posT: 0, hp: null, mhp: null, ms: 280, down: false, myId: null, fullT: 0 };
    const cur = { api: null, map: null, zone: null };
    const held = { up: false, down: false, left: false, right: false };
    const bad = new Map();
    const am = { off: false, busy: false, disabled: false };
    let on = true, paused = true, target = null, mode = 'idle', tStart = 0, pickAt = 0, lastKey = 0, lastActive = 0;
    let prog = { t: 0, d: Infinity }, escalated = false, lastPicked = null, picked = 0, warnedHp = false, polling = false;
    let lastUserKey = null, learning = false, learnDone = null, shiftHeld = false;
    const bornT = Date.now();
    // N = trạng thái điều hướng / né / hồi sinh
    const N = {
      map: null, obs: [], obsSrc: [], bounds: null, learned: new Map(), cache: new Map(), zones: [],
      route: null, side: null, mv: null, stuckHits: 0, stuckN: 0, lastDir: { x: 0, y: 0 }, lastRetarget: 0,
      fleeT: 0, hunt: null, crowdT: 0, crowdGoal: null, hitT: 0, shiftT: 0,
      downT: 0, reviveTry: 0, revivedT: bornT, autoAt: 0, keepT: 0,
      playersT: 0, lastZoneSw: 0, zoneBusy: false, fullKeys: '', rec: null, status: '',
      portals: [], dataPortals: [], entry: null, mapT: 0, posSaveT: 0, guardT: 0,
      actT: bornT, anchor: null, idleStep: 0, idleBusy: false, pickFails: [],
    };

    const log = (...a) => { if (cfg.debug) console.log('[loot]', ...a); try { lastMsg = a.join(' '); } catch (e) {} };
    const typing = () => { const a = document.activeElement; return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable); };
    const press = el => {
      for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) {
        const C = t.startsWith('pointer') ? PointerEvent : MouseEvent;
        el.dispatchEvent(new C(t, { bubbles: true, cancelable: true, composed: true, view: window, button: 0, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
      }
      el.click();
    };
    const deadBtns = () => [...document.querySelectorAll('.ng-dead__btn')].filter(b => b.isConnected && b.getClientRects().length > 0);
    const isDown = () => deadBtns().length > 0;
    const onUserKey = e => { if (e.isTrusted && !typing()) lastUserKey = { key: e.key, code: e.code, keyCode: e.keyCode, t: Date.now() }; };
    addEventListener('keydown', onUserKey, true);

    // ===== nút TỰ ĐÁNH =====
    const BASE = new Set(['ng-slot', 'is-auto', 'kbd-focus', 'interactive']);
    const autoBtn = () => document.querySelector('.ng-slot.is-auto');
    function autoState() {
      const b = autoBtn(); if (!b) return null;
      const ap = b.getAttribute('aria-pressed') ?? b.getAttribute('aria-checked');
      if (ap != null) return ap === 'true';
      const extra = [...b.classList].filter(c => !BASE.has(c));
      if (extra.some(c => cfg.autoOnRe.test(c))) return true;
      if (extra.length === 0) return false;
      return null;
    }
    const stName = s => s === true ? 'BẬT' : s === false ? 'TẮT' : 'không rõ';
    // bấm nút rồi chờ tới khi nút đúng trạng thái muốn (game đổi nút chậm khi máy nặng)
    // Tự đánh chỉ được bật khi: map đang đứng có quái sống, và (khi chạy vòng làng) đang ở đúng map cần vào
    function autoBlockReason() {
      if (cfg.pbLoop && cfg.fightRun && N.wrongMap && N.wrongMap === placeKey()) return 'không đúng map cần vào';
      // chỉ tin danh sách quái khi đã có dữ liệu khu MỚI của map này (sau lần đổi map gần nhất)
      if (mapNow() && S.fullT && S.fullT > (N.mapT || 0) && Date.now() - S.fullT < 15000 && !S.mobs.some(mAlive)) return 'map không có quái';
      return '';
    }
    async function setAuto(want) {
      if (am.busy) return false;
      if (want && autoBlockReason()) return false;
      am.busy = true;
      try {
        if (autoState() === want) return true;
        const b = autoBtn(); if (!b) return false;
        for (let i = 0; i < 2; i++) {
          press(b);
          const t0 = Date.now();
          while (Date.now() - t0 < 1500) { await sleep(100); if (autoState() === want) return true; }
        }
        return false;
      } finally { am.busy = false; }
    }
    async function autoOff() {
      if (am.disabled || am.off || am.busy) return;
      if (autoState() === false) return;
      if (!autoBtn()) { log('⚠️ Không thấy nút TỰ ĐÁNH, không quản lý tự đánh'); am.disabled = true; return; }
      if (await setAuto(false)) { am.off = true; log('⏸ Đã tắt TỰ ĐÁNH'); }
      else { log('⚠️ Bấm nút TỰ ĐÁNH mà nút không đổi. Ngừng quản lý tự đánh'); am.disabled = true; }
    }
    async function autoOn() {
      if (!am.off || am.busy) return;
      await setAuto(true); am.off = false; log('▶ Đã bật lại TỰ ĐÁNH');
    }

    // ===== đọc dữ liệu game =====
    const setPos = (x, y) => { S.pos = { x, y }; S.posT = Date.now(); };
    // tốc độ đi thật từ các vị trí liên tiếp trong gói dữ liệu (dùng cho tự bật chạy nhanh)
    const SPD = { last: null, samples: [] };
    function trackSpeed(x, y) {
      const now = Date.now(), L = SPD.last;
      if (L && now - L.t > 50 && now - L.t < 1500) { SPD.samples.push({ t: now, v: Math.hypot(x - L.x, y - L.y) / ((now - L.t) / 1000) }); if (SPD.samples.length > 10) SPD.samples.shift(); }
      SPD.last = { x, y, t: now };
    }
    // tốc độ hiện tại (trung bình 1,5 giây gần nhất); null = không có dữ liệu vị trí
    const curSpeedNow = () => { const now = Date.now(), l = SPD.samples.filter(s => now - s.t < 1500); return l.length >= 2 ? l.reduce((a, s) => a + s.v, 0) / l.length : (SPD.last && now - SPD.last.t < 1500 ? 0 : null); };
    const setHp = (hp, mhp) => { if (S.hp != null && hp != null && hp < S.hp) N.hitT = Date.now(); S.hp = hp; S.mhp = mhp; };
    // phát tin cho tab Thống kê / thông báo (hub.js lắng nghe qua sự kiện gt:*)
    const emitN = {};
    const gtEmit = (n, d) => { emitN[n] = (emitN[n] || 0) + 1; if (window.__gtEmit) window.__gtEmit(n, d); };
    const pickedIds = new Set();
    // món đã lướt qua (đã tới sát + bấm nhặt) nhưng chưa có xác nhận: id → { t, n lần thử }
    const tried = new Map();
    const emitPick = d => {
      if (pickedIds.has(d.id)) return;
      pickedIds.add(d.id); if (pickedIds.size > 3000) pickedIds.clear();
      tried.delete(d.id); picked++; N.actT = Date.now(); N.pickFails = [];
      log('✅ Đã nhặt ' + label(d) + ' (tổng ' + picked + ')');
      gtEmit('pick', dropInfo(d));
    };
    const triedRecent = id => { const t = tried.get(id); return !!t && Date.now() - t.t < cfg.confirmMs + 1500; };
    const dropInfo = d => ({ id: d.id, type: d.type, name: d.name, amt: d.amt, rar: d.rar, kind: kindOf(d), egg: kindOf(d) === 'trứng', legend: isLegend(d), map: mapNow(), zone: zoneUi() });
    const seenDrops = new Set();
    const seeDrop = d => {
      if (seenDrops.has(d.id)) return;
      seenDrops.add(d.id); if (seenDrops.size > 3000) seenDrops.clear();
      gtEmit('drop', dropInfo(d));
    };
    const mkDrop = (a, now) => ({ id: a[0], type: a[1], amt: a[2], x: a[3], y: a[4], owner: a[5], protect: a[6], ttl: a[7], rar: a[8], name: a[10] || '', t: now });
    const rec = (k, v) => {
      const R = N.rec; if (!R || Date.now() > R.until) return;
      const e = R.items[k] || (R.items[k] = { n: 0, samples: [] }); e.n++;
      if (e.samples.length < 3) { try { e.samples.push(JSON.stringify(v).slice(0, 400)); } catch (er) {} }
    };
    function onFull(f) {
      if (!f) return;
      const now = Date.now();
      N.fullKeys = Object.keys(f).join(','); N.lastFull = f;
      S.heroes = f.heroes || [];
      if (Array.isArray(f.mobs)) S.mobs = f.mobs;
      if (f.me) {
        if (f.me.ms) { S.ms = f.me.ms; N.msT = Date.now(); } setHp(f.me.hp, f.me.mhp); S.down = !!f.me.dn;
        const h = S.heroes.find(h => h[6] === f.me.x && h[7] === f.me.y); if (h) S.myId = h[0];
        setPos(f.me.x, f.me.y);
      }
      const b = boundsOf(f); if (b) N.bounds = b;
      if (Array.isArray(f.drops)) {
        const fresh = new Map(); for (const a of f.drops) { const d = mkDrop(a, now); fresh.set(a[0], d); seeDrop(d); }
        // món vừa lướt qua mà biến mất khỏi dữ liệu khu (không thấy tin nhặt) → coi là mình đã nhặt
        for (const [id, d] of S.drops) if (!fresh.has(id) && triedRecent(id)) emitPick(d);
        S.drops = fresh; S.fullT = now;
      }
      if (N.rec) { rec('full.keys', N.fullKeys); for (const k of Object.keys(f)) if (!['drops', 'heroes', 'mobs'].includes(k)) rec('full.' + k, f[k]); rec('full.mobs[0]', (f.mobs || [])[0]); rec('full.heroes[0]', (f.heroes || [])[0]); }
    }
    function onPacket(pk) {
      if (!pk) return;
      const now = Date.now();
      if (N.rec) rec('packet.keys', Object.keys(pk).join(','));
      for (const e of (pk.ev || [])) {
        if (N.rec) rec('ev.' + e[0], e);
        if (e[0] === 'd') { const d = mkDrop([e[1], e[2], e[3], e[4], e[5], e[6], e[7], e[8], e[9], e[10], e[11]], now); S.drops.set(e[1], d); seeDrop(d); }
        else if (e[0] === 'p') {
          const d = S.drops.get(e[1]);
          S.drops.delete(e[1]);
          // của mình: đúng id nhân vật; chưa biết id thì coi là của mình nếu món nằm sát chỗ mình đứng
          const mine = S.myId != null ? e[2] === S.myId : (triedRecent(e[1]) || !!(d && S.pos && Math.hypot(d.x - S.pos.x, d.y - S.pos.y) < 90));
          if (mine) { lastPicked = { id: e[1], t: now }; if (d) emitPick(d); }
        }
        else if (e[0] === 'dx') S.drops.delete(e[1]);
        else if (e[0] === 'k') {
          const m = S.mobs.find(m => m[0] === e[1]);
          if (m) { m[5] = 0; if (S.pos && Math.hypot(m[3] - S.pos.x, m[4] - S.pos.y) < 500) { N.actT = now; gtEmit('kill', { name: m[1], boss: isBossType(m), map: mapNow() }); } }
        }
      }
      if (N.rec) for (const k of Object.keys(pk)) if (k !== 'ev' && k !== 'me') rec('packet.' + k, pk[k]);
      if (pk.me) {
        let me = S.myId != null ? pk.me[S.myId] : null;
        if (!me && S.pos) for (const k in pk.me) if (pk.me[k].x === S.pos.x && pk.me[k].y === S.pos.y) { S.myId = +k; me = pk.me[k]; break; }
        if (me) {
          setHp(me.hp, me.mhp); if (me.ms) { S.ms = me.ms; N.msT = Date.now(); } S.down = !!me.dn;
          // vị trí của mình trong gói dữ liệu (game đi bằng lệnh "m4j" tới điểm, không gửi lệnh vị trí 'p') → cập nhật vị trí + đo tốc độ thật
          if (typeof me.x === 'number' && typeof me.y === 'number') { trackSpeed(me.x, me.y); setPos(me.x, me.y); }
        }
      }
    }
    function onData(d) {
      const found = scanObs(d);
      if (found.length) {
        const sig = found.map(f => f.path + ':' + f.shapes.length).join('|');
        if (sig !== N.obsSrc.join('|')) { N.obs = found.flatMap(f => f.shapes); N.obsSrc = found.map(f => f.path + ':' + f.shapes.length); N.cache.clear(); log('🧱 Đọc được ' + N.obs.length + ' vật cản từ dữ liệu game (' + N.obsSrc.join(', ') + ')'); }
      }
      const pts = scanPortals(d);
      if (pts.length) {
        const sig = pts.map(p => Math.round(p.x) + ',' + Math.round(p.y)).join('|');
        if (sig !== N.dataPortals.sig) { N.dataPortals = pts; N.dataPortals.sig = sig; rebuildPortals(); log('🚪 Đọc được ' + pts.length + ' cửa từ dữ liệu game (' + [...new Set(pts.map(p => p.src))].join(', ') + ')'); }
      }
      if (N.rec) for (const k of Object.keys(d)) if (k !== 'full' && k !== 'packet') rec('data.' + k, d[k]);
    }
    // vùng cửa = dữ liệu game + đã học (lưu lâu dài) + chỗ vừa vào map
    // CỔNG THẬT của map đang đứng, đọc từ cấu hình game (MEONO_SCENE.outer.map.portals). Theo mã nguồn game, mỗi cổng
    // nằm ở 1 mép bản đồ (edge N/S/W/E) tại toạ độ x (mép trên/dưới) hoặc y (mép trái/phải); vùng kích hoạt ~100×66.
    function gamePortals() {
      const m = sceneMap();
      if (!m || !Array.isArray(m.portals) || (m.key && N.map && m.key !== N.map)) return [];
      const W = Number(m.w ?? m.width), H = Number(m.h ?? m.height), out = [];
      for (const p of m.portals) {
        const e = String(p.edge || '').toUpperCase(), x = Number(p.x), y = Number(p.y);
        if (e === 'N' && Number.isFinite(x)) out.push({ x, y: 80 });
        else if (e === 'S' && Number.isFinite(x) && H) out.push({ x, y: H - 60 });
        else if (e === 'W' && Number.isFinite(y)) out.push({ x: 40, y });
        else if (e && Number.isFinite(y) && W) out.push({ x: W - 40, y });
        else if (Number.isFinite(x) && Number.isFinite(y)) out.push({ x, y });
      }
      return out;
    }
    function rebuildPortals() {
      const r = cfg.portalR, out = [];
      if (cfg.avoidPortal) {
        const gp = gamePortals(), m = sceneMap();
        N.gpKey = gp.length && m ? (m.key || N.map) : null;
        for (const g of gp) out.push({ x: g.x, y: g.y, r: Math.max(r, 160), kind: 'game', in: false });
        for (const p of N.dataPortals) out.push({ x: p.x, y: p.y, r, kind: 'data', in: false });
        if (N.map) for (const p of loadPortals(N.map)) out.push({ x: p.x, y: p.y, r, kind: 'learned', in: false });
        // mọi cổng đã biết của map này cũng là cửa phải tránh (cổng ra đã học của map đánh, điểm cuối đường đã nhớ, cổng đọc từ dữ liệu, cổng làng)
        try { for (const g of knownGates()) if (!out.some(o => Math.hypot(o.x - g.x, o.y - g.y) < 40)) out.push({ x: g.x, y: g.y, r, kind: 'learned', in: false }); } catch (e) {}
      }
      if (cfg.avoidEntry && N.entry) out.push({ x: N.entry.x, y: N.entry.y, r, kind: 'entry', in: false });
      N.portals = out; N.route = null;
    }
    const nearPortal = (x, y) => N.portals.some(z => !z.in && Math.hypot(x - z.x, y - z.y) < z.r);
    // đoạn thẳng a→b có cắt vùng cửa nào không (đi bằng bấm chuột: game đi thẳng / tự tìm đường, có thể xuyên qua cửa)
    const crossesPortal = (a, b) => N.portals.some(z => {
      if (z.kind === 'entry' || z.in) return false;
      const vx = b.x - a.x, vy = b.y - a.y, l2 = vx * vx + vy * vy || 1;
      const t = Math.max(0, Math.min(1, ((z.x - a.x) * vx + (z.y - a.y) * vy) / l2));
      return Math.hypot(a.x + vx * t - z.x, a.y + vy * t - z.y) < z.r * 1.1;
    });
    // các cổng đã biết của map đang đứng (từ vòng làng + dữ liệu); dùng để TRÁNH khi không cố ý đi vào
    function knownGates() {
      const here = placeKey(), out = [], add = g => { if (g && typeof g.x === 'number') out.push({ x: g.x, y: g.y }); };
      const mac = loadMac();
      if (mac) {
        for (const s of mac.stages) if (s.place === here && s.exit) add(s.exit);
        if (fightRe().test(here) && mac.fightExit) add(mac.fightExit.exit);
      }
      const pth = pathFor(here); if (pth && pth.length) add(pth[pth.length - 1]);
      for (const g of gateKeyPoints()) add(g);
      return out;
    }
    // bị đổi map khi tool đang chạy và không phải do gục → chỗ đứng cuối cùng là cửa ra
    // ===== BẢN ĐỒ MŨI TÊN (đường nối giữa các map) — tự học khi đi qua mũi tên lúc tool đang bật =====
    // links[from][to] = { x, y (mũi tên ở map from), ax, ay (chỗ xuất hiện ở map to), n (số lần thấy) }
    const LINKK = 'lootExtLinks';
    const loadLinks = () => { try { return JSON.parse(localStorage.getItem(LINKK) || '{}') || {}; } catch (e) { return {}; } };
    const saveLinks = L => { try { localStorage.setItem(LINKK, JSON.stringify(L)); } catch (e) {} };
    function addLink(from, to, x, y) {
      if (!from || !to || from === to) return;
      const L = loadLinks(), a = L[from] || (L[from] = {}), l = a[to];
      if (l && Math.hypot(l.x - x, l.y - y) < 250) { l.x = Math.round((l.x * l.n + x) / (l.n + 1)); l.y = Math.round((l.y * l.n + y) / (l.n + 1)); l.n++; }
      else a[to] = { ...(l || {}), x: Math.round(x), y: Math.round(y), n: 1 };
      a[to].t = Date.now();
      saveLinks(L);
      log('🧭 Học đường nối: ' + from + ' → ' + to + ' qua mũi tên (' + Math.round(x) + ',' + Math.round(y) + ')');
    }
    function setArrival(from, to, x, y) { const L = loadLinks(); if (L[from] && L[from][to]) { L[from][to].ax = Math.round(x); L[from][to].ay = Math.round(y); saveLinks(L); } }
    // đường ngắn nhất (Dijkstra): chi phí = quãng đi bộ trong từng map (từ chỗ xuất hiện tới mũi tên kế) + 300 mỗi lần qua map
    // cổng của map đang đứng (đọc từ cấu hình game) → đường nối biết ngay, không cần học; lưu lại cho các lần tính đường sau
    function linksWithScene() {
      const L = loadLinks(), here = placeKey(), ps = typeof scenePortals === 'function' ? scenePortals() : [];
      let changed = false;
      for (const p of ps) {
        if (!p.dest || p.dest === here) continue;
        const a = L[here] || (L[here] = {});
        if (!a[p.dest]) { a[p.dest] = { n: 0 }; changed = true; }
        const l = a[p.dest];
        if (p.x != null && (l.x == null || !l.n)) { l.x = Math.round(p.x); l.y = Math.round(p.y); changed = true; }
        if (p.name && l.name !== p.name) { l.name = p.name; changed = true; }
      }
      if (changed) saveLinks(L);
      return L;
    }
    function planTrip(start, startPos, goal) {
      const L = typeof scenePortals === 'function' && start === placeKey() ? linksWithScene() : loadLinks(), best = { [start]: 0 }, prev = {}, q = [{ map: start, pos: startPos, c: 0 }];
      while (q.length) {
        q.sort((a, b) => a.c - b.c);
        const cur = q.shift();
        if (cur.c > best[cur.map]) continue;
        if (cur.map === goal) break;
        for (const [to, l] of Object.entries(L[cur.map] || {})) {
          const c = cur.c + (cur.pos && l.x != null ? Math.hypot(l.x - cur.pos.x, l.y - cur.pos.y) : 600) + 300;
          if (best[to] == null || c < best[to]) { best[to] = c; prev[to] = { from: cur.map, link: l }; q.push({ map: to, pos: l.ax != null ? { x: l.ax, y: l.ay } : null, c }); }
        }
      }
      if (best[goal] == null) return null;
      const hops = [];
      for (let m = goal; m !== start; m = prev[m].from) hops.unshift({ from: prev[m].from, to: m, link: prev[m].link });
      return hops;
    }
    const knownMaps = () => { const L = typeof scenePortals === 'function' ? linksWithScene() : loadLinks(), s = new Set(); for (const [a, o] of Object.entries(L)) { s.add(a); for (const b of Object.keys(o)) s.add(b); } return [...s].sort(); };
    function checkExit(now, m) {
      let last = null; try { last = JSON.parse(ss.get(POSK) || 'null'); } catch (e) {}
      if (!last || !m || last.m === m) return;
      ss.del(POSK);
      if (now - last.t > 15000 || last.dead) return;
      if (cfg.reenter && isDungeon(last.m) && !(cfg.pbLoop && isLoopMap(last.m)) && baseMap(m) !== baseMap(last.m)) { ss.set(REK, JSON.stringify({ map: last.m, t: now, tries: 0 })); log('🔁 Bị ra khỏi phó bản ' + last.m + ' → sẽ vào lại sau ' + cfg.reenterDelay + 's'); }
      // học bản đồ mũi tên: map cũ → map mới qua mũi tên ở (x,y); chỗ xuất hiện ở map mới ghi sau khi có vị trí mới
      addLink(last.m, m, last.x, last.y); N.arriveFrom = { from: last.m, to: m };
      if (!cfg.avoidPortal) return;
      savePortal(last.m, last.x, last.y);
      gtEmit('exit', { map: last.m, x: Math.round(last.x), y: Math.round(last.y) });
      log('🚪 Bị ra khỏi ' + last.m + ' tại (' + Math.round(last.x) + ', ' + Math.round(last.y) + ') → đã nhớ là cửa ra, lần sau tránh');
    }
    const CMD = { m4j: 'p', tun: 'c', '3iz': 'u', '11t': 'k', x7c: 'a', erv: 'm', '2ys': 'r', '03x': 'i' };
    function onReq(body) {
      try {
        for (const c of (JSON.parse(body).c || [])) {
          // game mã hoá tên lệnh trước khi gửi (bảng mã lấy từ mã nguồn game): m4j = vị trí, 11t = nhặt, tun = chiêu...
          const op = (window.__gtCmd && window.__gtCmd[c[0]]) || CMD[c[0]] || c[0];
          if (op === 'p') { setPos(c[1], c[2]); N.lastMove = { x: c[1], y: c[2], f: c[3], t: Date.now() }; }
          else if (op === 'k' && learning && lastUserKey && Date.now() - lastUserKey.t < 800) {
            cfg.pickKey = { key: lastUserKey.key, code: lastUserKey.code, keyCode: lastUserKey.keyCode }; learning = false; store();
            const m = '✔ Đã học phím nhặt: ' + lastUserKey.key + ' (' + lastUserKey.code + ')'; log(m); if (learnDone) learnDone(m);
          }
        }
      } catch (e) {}
    }
    // học địa chỉ API / map / khu từ chính các yêu cầu của game (dùng được cho mọi máy chủ)
    const learn = url => {
      try {
        const u = new URL(url, location.href);
        const m = u.pathname.match(/\/ngoai-gioi\/([^/]+)\/(lenh|goi|khu|vao)/); if (!m) return;
        cur.api = u.origin; cur.map = m[1];
        const z = u.searchParams.get('zone'); if (z) cur.zone = +z;
      } catch (e) {}
    };
    let po = null;
    try { po = new PerformanceObserver(l => l.getEntries().forEach(e => learn(e.name))); po.observe({ type: 'resource', buffered: true }); } catch (e) {}
    const zoneUi = () => { const b = document.querySelector('button.scene-zone'); const m = b && (b.textContent || '').match(/Khu\s*(\d+)/); return m ? +m[1] : null; };

    const prev = window.__lootOrigFetch || window.fetch;
    // dữ liệu game có thể nằm ở {data:{full,packet}} hoặc trực tiếp {full,packet}
    const sub = m => {
      if (m.url) learn(m.url);
      if (m.dir === 'req' || m.dir === 'ws-out') {
        const b = m.body || m.raw; if (typeof b === 'string' && b.includes('"c"')) onReq(b);
        if (N.rec && m.dir === 'ws-out') rec('ws-out', m.raw);
        return;
      }
      if (N.rec) {
        let path = m.url || ''; try { path = new URL(m.url, location.href).pathname; } catch (e) {}
        rec(m.via + ' ' + path, m.json ? Object.keys(m.json).join(',') : m.raw);
        if (m.via === 'ws') rec('ws-in mẫu', m.json || m.raw);
      }
      const j = m.json; if (!j || typeof j !== 'object') return;
      const d = j.data && typeof j.data === 'object' ? j.data : (j.full || j.packet) ? j : null;
      if (!d) return;
      if (d.full) onFull(d.full);
      if (d.packet) onPacket(d.packet);
      onData(d);
    };
    TAP.subs.add(sub);

    // làm mới dữ liệu khu định kỳ (GET giống game vẫn làm); nhanh hơn khi bật né quái
    async function poll() {
      const zone = zoneUi() || cur.zone, api = cur.api || location.origin, map = cur.map || mapNow();
      if (polling || !map || !zone) return;
      polling = true;
      try {
        // địa chỉ dữ liệu khu do game cấp (MEONO_SCENE.outer.urls.full, game gọi: full + "?zone=N"); không có thì dùng địa chỉ cũ
        const o = window.MEONO_SCENE && window.MEONO_SCENE.outer, full = o && o.urls && o.urls.full;
        const url = full ? full + (full.includes('?') ? '&' : '?') + 'zone=' + zone : api + '/ngoai-gioi/' + map + '/khu?zone=' + zone;
        const r = await prev(url, { credentials: 'include', headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' } });
        N.pollInfo = r.status + ' ' + url.replace(location.origin, '');
        if (N.rec) rec('poll /khu', r.status + ' ' + (r.headers.get('content-type') || ''));
        if (r.ok) { const d = ((await r.json()) || {}).data || {}; if (d.full) onFull(d.full); onData(d); }
      } catch (e) {}
      polling = false;
    }
    let lastPoll = 0;
    const fastPoll = () => cfg.avoidRed || cfg.kiteHit || cfg.crowd || cfg.nearest || cfg.pvp || cfg.bossNear > 0 || cfg.lootNoRed || cfg.lootFew;
    const pollTimer = setInterval(() => {
      const now = Date.now();
      if (on && !paused && !document.hidden && now - lastPoll >= (fastPoll() ? cfg.pollFastMs : cfg.pollMs)) { lastPoll = now; poll(); }
    }, 250);

    // ===== phím =====
    const kev = (type, k) => (document.querySelector('.scene-canvas') || document.body).dispatchEvent(new KeyboardEvent(type, { key: k.key, code: k.code, keyCode: k.keyCode, which: k.keyCode, shiftKey: shiftHeld, bubbles: true, cancelable: true, composed: true }));
    function setHeld(want) {
      const K = KEYSETS[cfg.keys] || KEYSETS.wasd;
      for (const d of ['up', 'down', 'left', 'right']) {
        if (want[d] && !held[d]) { held[d] = true; kev('keydown', K[d]); }
        else if (!want[d] && held[d]) { held[d] = false; kev('keyup', K[d]); }
      }
    }
    const release = () => setHeld({});
    // luôn chạy nhanh: giữ Shift (gửi lại vài giây một lần phòng game bỏ trạng thái khi mất focus)
    // nút chạy nhanh trên giao diện (nếu game có, giống nút TỰ ĐÁNH): tìm theo chữ / tiêu đề / class
    const RUN_RE = /shift|chạy nhanh|chay nhanh|sprint|\brun\b|is-run|dash|tăng tốc/i;
    const runBtn = () => [...document.querySelectorAll('.ng-slot, button, [role=button]')].find(b =>
      !b.classList.contains('is-auto') && !b.closest('.panel') && b.getClientRects().length > 0 &&
      RUN_RE.test([b.textContent, b.title, b.getAttribute('aria-label'), b.getAttribute('data-key'), b.getAttribute('data-hotkey'), b.className].join(' ')));
    const slotOn = b => {
      const ap = b.getAttribute('aria-pressed') ?? b.getAttribute('aria-checked');
      if (ap != null) return ap === 'true';
      return [...b.classList].some(c => cfg.autoOnRe.test(c));
    };
    // chạy nhanh: 'btn' = có nút thì giữ nút luôn bật | 'hold' = giữ Shift (gửi 1 lần) | 'tap' = bấm Shift 1 lần (kiểu bật/tắt)
    function shiftCtl(now, want) {
      if (!want) { if (shiftHeld) { kev('keyup', SHIFT); shiftHeld = false; } return; }     // 'tap' không reset: bấm lại sẽ TẮT chạy nhanh
      if (now - N.shiftT < 2500) return;
      N.shiftT = now;
      const b = cfg.sprintMode === 'auto' || cfg.sprintMode === 'btn' ? runBtn() : null;
      if (b) {
        if (N.runBlind) return;
        if (slotOn(b)) { N.runPressed = false; return; }
        if (N.runPressed) { N.runBlind = true; log('⚠️ Bấm nút chạy nhanh mà không đọc được nút bật hay tắt → chỉ bấm 1 lần, không bấm nữa'); return; }
        press(b); N.runPressed = true; log('🏃 Bật chạy nhanh (nút: ' + ((b.textContent || b.title || '').trim().slice(0, 20)) + ')');
        return;
      }
      const m = cfg.sprintMode === 'auto' ? 'hold' : cfg.sprintMode;
      if (m === 'hold' && !shiftHeld) { shiftHeld = true; kev('keydown', SHIFT); }      // giữ, không gửi lại (gửi lại có thể bị hiểu là bấm bật/tắt)
      else if (m === 'tap' && !N.shiftTapped) { N.shiftTapped = true; kev('keydown', SHIFT); setTimeout(() => kev('keyup', SHIFT), 80); log('🏃 Bấm Shift (chạy nhanh)'); }
    }
    // đo xem cách nào làm nhân vật đi nhanh hơn
    async function testRun() {
      if (!S.pos) return 'Chưa có vị trí nhân vật, đợi vài giây rồi thử lại.';
      const K = KEYSETS[cfg.keys] || KEYSETS.wasd;
      const was = paused; paused = true; release(); shiftCtl(Date.now(), false); await autoOff(); await sleep(600);
      const walk = async (dir, ms = 700) => { const b = { ...S.pos }; kev('keydown', K[dir]); await sleep(ms); kev('keyup', K[dir]); await sleep(700); return Math.round(Math.hypot(S.pos.x - b.x, S.pos.y - b.y)); };
      const res = [];
      res.push('không Shift: ' + await walk('right') + 'px (ms=' + S.ms + ')');
      shiftHeld = true; kev('keydown', SHIFT); await sleep(100);
      res.push('giữ Shift: ' + await walk('left') + 'px (ms=' + S.ms + ')');
      kev('keyup', SHIFT); shiftHeld = false; await sleep(300);
      kev('keydown', SHIFT); await sleep(80); kev('keyup', SHIFT); await sleep(300);
      res.push('bấm Shift 1 lần: ' + await walk('right') + 'px (ms=' + S.ms + ')');
      kev('keydown', SHIFT); await sleep(80); kev('keyup', SHIFT);          // bấm lại để trả về như cũ nếu là kiểu bật/tắt
      const b = runBtn();
      await autoOn(); paused = was; N.shiftT = 0; N.shiftTapped = false;
      return res.join('\n') + '\nNút chạy nhanh trên giao diện: ' + (b ? '"' + ((b.textContent || b.title || '').trim().slice(0, 30)) + '" class=' + b.className + ' → ' + (slotOn(b) ? 'BẬT' : 'TẮT') : 'không thấy') +
        '\nCách nào đi xa hơn hẳn thì chọn cách đó ở ô "Kiểu".';
    }
    // giữ phím theo hướng (dx, dy), 8 hướng
    function steer(dx, dy, remember = true) {
      const ax = Math.abs(dx), ay = Math.abs(dy), t = 0.414, a = cfg.axis;
      setHeld({ left: dx < 0 && ax > a && ax > t * ay, right: dx > 0 && ax > a && ax > t * ay, up: dy < 0 && ay > a && ay > t * ax, down: dy > 0 && ay > a && ay > t * ax });
      if (remember) { const l = Math.hypot(dx, dy) || 1; N.lastDir = { x: dx / l, y: dy / l }; }
    }
    function curPos() {
      if (!S.pos) return null;
      const dt = Math.min((Date.now() - S.posT) / 1000, 0.5);
      const vx = (held.right ? 1 : 0) - (held.left ? 1 : 0), vy = (held.down ? 1 : 0) - (held.up ? 1 : 0);
      const v = (S.ms || 280) / (Math.hypot(vx, vy) || 1);
      return { x: S.pos.x + vx * v * dt, y: S.pos.y + vy * v * dt };
    }

    // ===== lưới vật cản + tìm đường =====
    const cellOf = p => ({ x: Math.floor(p.x / cfg.cell), y: Math.floor(p.y / cfg.cell) });
    const ckey = (x, y) => x + ',' + y;
    function staticBlocked(cx, cy) {
      const k = ckey(cx, cy);
      let b = N.cache.get(k);
      if (b !== undefined) return b;
      const c = cfg.cell, px = (cx + 0.5) * c, py = (cy + 0.5) * c, R = cfg.bodyR;
      b = !!N.bounds && (px < 0 || py < 0 || px > N.bounds.w || py > N.bounds.h);
      if (!b) for (const o of N.obs) {
        if (o.r != null ? Math.hypot(px - o.x, py - o.y) < o.r + R : (px >= o.x - R && px <= o.x + o.w + R && py >= o.y - R && py <= o.y + o.h + R)) { b = true; break; }
      }
      N.cache.set(k, b);
      return b;
    }
    function blocked(cx, cy, zones = true) {
      const e = N.learned.get(ckey(cx, cy));
      if (e && e > Date.now()) return true;
      if (staticBlocked(cx, cy)) return true;
      const c = cfg.cell, px = (cx + 0.5) * c, py = (cy + 0.5) * c;
      if (!N.pbBusy) for (const z of N.portals) if (!z.in && Math.hypot(px - z.x, py - z.y) < z.r) return true;     // cửa ra: luôn cấm (trừ khi đang đứng trong vùng, hoặc vòng làng đang cố ý đi vào cổng)
      if (zones) for (const z of N.zones) if (Math.hypot(px - z.x, py - z.y) < z.r) return true;
      return false;
    }
    const hasMapInfo = () => N.obs.length > 0 || N.learned.size > 0 || N.zones.length > 0 || N.portals.length > 0;
    function los(a, b, zones = true) {
      const c = cfg.cell, n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (c / 2)), sa = cellOf(a), sb = cellOf(b);
      for (let i = 1; i < n; i++) {
        const cx = Math.floor((a.x + (b.x - a.x) * i / n) / c), cy = Math.floor((a.y + (b.y - a.y) * i / n) / c);
        if ((cx === sa.x && cy === sa.y) || (cx === sb.x && cy === sb.y)) continue;
        if (blocked(cx, cy, zones)) return false;
      }
      return true;
    }
    function astar(p, g, zones) {
      const s = cellOf(p), e = cellOf(g);
      if (s.x === e.x && s.y === e.y) return [g];
      const pad = 25, x0 = Math.min(s.x, e.x) - pad, x1 = Math.max(s.x, e.x) + pad, y0 = Math.min(s.y, e.y) - pad, y1 = Math.max(s.y, e.y) + pad;
      const W = x1 - x0 + 1, H = y1 - y0 + 1, idx = (x, y) => (y - y0) * W + (x - x0);
      const gs = new Float32Array(W * H).fill(Infinity), from = new Int32Array(W * H).fill(-1), closed = new Uint8Array(W * H);
      const free = (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1 && ((x === s.x && y === s.y) || (x === e.x && y === e.y) || !blocked(x, y, zones));
      const hf = (x, y) => { const dx = Math.abs(x - e.x), dy = Math.abs(y - e.y); return Math.max(dx, dy) + 0.414 * Math.min(dx, dy); };
      const open = Heap();
      gs[idx(s.x, s.y)] = 0; open.push([hf(s.x, s.y), s.x, s.y]);
      for (let it = 0; open.size && it < 15000; it++) {
        const [, x, y] = open.pop(), i = idx(x, y);
        if (closed[i]) continue; closed[i] = 1;
        if (x === e.x && y === e.y) {
          const pts = []; for (let j = i; j !== -1 && j !== idx(s.x, s.y); j = from[j]) pts.push({ x: (x0 + j % W + 0.5) * cfg.cell, y: (y0 + Math.floor(j / W) + 0.5) * cfg.cell });
          pts.reverse(); pts[pts.length - 1] = { x: g.x, y: g.y };
          return pts;
        }
        for (const [dx, dy] of DIRS8) {
          const nx = x + dx, ny = y + dy;
          if (!free(nx, ny) || (dx && dy && (!free(x + dx, y) || !free(x, y + dy)))) continue;
          const ni = idx(nx, ny); if (closed[ni]) continue;
          const ng = gs[i] + (dx && dy ? 1.414 : 1);
          if (ng < gs[ni]) { gs[ni] = ng; from[ni] = i; open.push([ng + hf(nx, ny), nx, ny]); }
        }
      }
      return null;
    }
    function plan(p, g) {
      if (!cfg.avoid || !hasMapInfo() || los(p, g)) return [{ x: g.x, y: g.y }];
      return astar(p, g, true) || (N.zones.length ? astar(p, g, false) : null);   // không vòng được quanh quái đỏ thì bỏ qua vùng quái
    }
    // đi tới g theo đường vòng; trả về false nếu không có đường
    function goTo(g, key, now) {
      const p = curPos();
      if (N.side && now < N.side.until) { steer(N.side.x, N.side.y, false); return true; }
      if (!N.route || N.route.key !== key || now - N.route.t > cfg.replanMs || Math.hypot(N.route.g.x - g.x, N.route.g.y - g.y) > 40)
        N.route = { key, t: now, g: { x: g.x, y: g.y }, pts: plan(p, g) };
      const pts = N.route.pts;
      if (!pts) return false;
      while (pts.length > 1 && Math.hypot(pts[0].x - p.x, pts[0].y - p.y) < cfg.cell * 0.8) pts.shift();
      let w = pts[0];
      for (let i = Math.min(pts.length - 1, 8); i > 0; i--) if (los(p, pts[i])) { w = pts[i]; break; }
      steer(w.x - p.x, w.y - p.y);
      return true;
    }
    // ===== tường nhớ lâu dài cho các map của vòng làng (map NPC, làng, map đánh): mỗi lượt chạy biết thêm tường → đi chuẩn dần =====
    const WALLK = 'lootExtWalls';
    const loadWalls = () => { try { return JSON.parse(localStorage.getItem(WALLK) || '{}') || {}; } catch (e) { return {}; } };
    const loopPlace = m => !!m && (m === cfg.pbNpcMap || m === cfg.pbVillage || (() => { try { return new RegExp(cfg.pbFightRe || '^lc-\\d+$', 'i').test(m); } catch (e) { return false; } })());
    function addWall(pt) {
      const c = cellOf(pt), me = S.pos ? cellOf(S.pos) : null;
      if (me && c.x === me.x && c.y === me.y) return;
      const k = ckey(c.x, c.y), m = placeKey();
      if (!loopPlace(m)) { N.learned.set(k, Date.now() + cfg.learnTtl); return; }
      N.learned.set(k, Infinity);
      const all = loadWalls(), l = all[m] || (all[m] = []);
      if (!l.includes(k)) { l.push(k); if (l.length > 3000) l.shift(); try { localStorage.setItem(WALLK, JSON.stringify(all)); } catch (e) {} }
    }
    const loadWallsInto = m => { for (const k of (loadWalls()[m] || [])) N.learned.set(k, Infinity); };
    // đang giữ phím mà vị trí không đổi → ô phía trước là vật cản: ghi nhớ, né sang ngang rồi tìm đường lại
    function watchStuck(now) {
      const moving = held.up || held.down || held.left || held.right;
      if (!moving || !S.pos) { N.mv = null; return; }
      if (!N.mv) { N.mv = { t: now, x: S.pos.x, y: S.pos.y }; return; }
      if (now - N.mv.t < cfg.stuckMs) return;
      if (Math.hypot(S.pos.x - N.mv.x, S.pos.y - N.mv.y) < 12) {
        N.stuckHits++;
        const d = N.lastDir;
        if (cfg.avoid && (d.x || d.y)) {
          const me = cellOf(S.pos), c = cellOf({ x: S.pos.x + d.x * cfg.cell, y: S.pos.y + d.y * cfg.cell });
          if (c.x !== me.x || c.y !== me.y) addWall({ x: S.pos.x + d.x * cfg.cell, y: S.pos.y + d.y * cfg.cell });
        }
        const s = N.stuckHits % 2 ? 1 : -1;
        N.side = { until: now + cfg.sideMs, x: -d.y * s * 100, y: d.x * s * 100 };
        N.route = null;
      }
      N.mv = { t: now, x: S.pos.x, y: S.pos.y };
    }

    // ===== vùng nguy hiểm (quái đỏ, boss, quái đang đánh mình) =====
    function dangerZones(now) {
      const p = S.pos, out = [];
      if (!p) return out;
      for (const m of S.mobs) {
        if (!mAlive(m)) continue;
        if (cfg.avoidRed && isRed(m)) out.push({ x: m[3], y: m[4], r: (cfg.kiteRed ? cfg.kiteRange + cfg.kiteMargin : cfg.redKeep) + cfg.body / 2, path: true });
        if (cfg.bossNear > 0 && isBossType(m)) out.push({ x: m[3], y: m[4], r: cfg.bossNear + cfg.body / 2, path: true });
      }
      if (cfg.kiteHit && now - N.hitT < 1500) {
        let best = null, bd = cfg.kiteHitKeep;
        for (const m of S.mobs) { if (!mAlive(m)) continue; const d = Math.hypot(m[3] - p.x, m[4] - p.y); if (d < bd) { bd = d; best = m; } }
        if (best) out.push({ x: best[3], y: best[4], r: cfg.kiteHitKeep, path: false });
      }
      return out;
    }
    const inZones = (x, y, zones) => zones.some(z => z.path && Math.hypot(x - z.x, y - z.y) < z.r);
    function safeMob(p, zones) {
      let best = null, bd = Infinity;
      for (const m of S.mobs) {
        if (!mAlive(m) || isRed(m) || inZones(m[3], m[4], zones) || nearPortal(m[3], m[4])) continue;
        const d = Math.hypot(m[3] - p.x, m[4] - p.y); if (d < bd && d < cfg.maxDist) { bd = d; best = m; }
      }
      return best;
    }
    // ===== NÉ VÙNG CHIÊU ĐỎ (theo cách của boss.js nhưng không cần MEONO_VIEW) =====
    // Đọc điểm ảnh quanh giữa khung game (camera giữ nhân vật ở giữa), lưới ô 5px: ô có ≥ 7% điểm đỏ là vùng đỏ;
    // vùng kín bên trong viền đỏ cũng tính là nguy hiểm. Nhân vật đứng trong / sát vùng đỏ → chọn hướng gần nhất ra ô an toàn.
    const HB = { cv: null, ctx: null, err: '', until: 0, dir: null, lastScan: 0, hit: null };
    function scanRed() {
      const cv = document.querySelector('canvas.scene-canvas') || document.querySelector('.scene-canvas canvas');
      if (!cv || !(cv.width > 0)) { HB.err = 'không thấy canvas của game'; return null; }
      const rect = cv.getBoundingClientRect(); if (!rect.width) return null;
      const sx = cv.width / rect.width, sy = cv.height / rect.height, R = 260 * (cfg.viewScale || 1), CELL = 5;
      const cx = cv.width / 2, cy = cv.height / 2;
      const x0 = Math.max(0, Math.floor(cx - R * sx)), y0 = Math.max(0, Math.floor(cy - R * sy));
      const x1 = Math.min(cv.width, Math.ceil(cx + R * sx)), y1 = Math.min(cv.height, Math.ceil(cy + R * sy));
      if (x1 <= x0 || y1 <= y0) return null;
      try {
        if (!HB.cv) { HB.cv = document.createElement('canvas'); HB.ctx = HB.cv.getContext('2d', { willReadFrequently: true }); }
        const w = x1 - x0, h = y1 - y0;
        if (HB.cv.width !== w) HB.cv.width = w; if (HB.cv.height !== h) HB.cv.height = h;
        HB.ctx.drawImage(cv, x0, y0, w, h, 0, 0, w, h);
        const px = HB.ctx.getImageData(0, 0, w, h).data;
        const cpx = Math.max(1, Math.round(CELL * sx)), cpy = Math.max(1, Math.round(CELL * sy));
        const cols = Math.ceil(w / cpx), rows = Math.ceil(h / cpy), cnt = new Uint16Array(cols * rows), smp = new Uint16Array(cols * rows);
        const step = Math.max(1, Math.round(Math.min(sx, sy)));
        for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step) {
          const i = (Math.floor(y / cpy)) * cols + Math.floor(x / cpx), o = (y * w + x) * 4;
          smp[i]++;
          const r = px[o], g = px[o + 1], b = px[o + 2], a = px[o + 3];
          if (a >= 96 && r >= 105 && r > g * 1.3 && r > b * 1.2 && g < 190) cnt[i]++;
        }
        const red = new Uint8Array(cols * rows); let n = 0;
        for (let i = 0; i < red.length; i++) if (cnt[i] && cnt[i] / Math.max(1, smp[i]) >= 0.07) { red[i] = 1; n++; }
        if (n < 8) { HB.err = ''; return { none: true }; }
        // vùng không thông ra mép (bị viền đỏ bao quanh) cũng là nguy hiểm
        const out = new Uint8Array(red.length), q = new Int32Array(red.length); let t = 0;
        const add = i => { if (red[i] || out[i]) return; out[i] = 1; q[t++] = i; };
        for (let x = 0; x < cols; x++) { add(x); add((rows - 1) * cols + x); }
        for (let y = 0; y < rows; y++) { add(y * cols); add(y * cols + cols - 1); }
        for (let hd = 0; hd < t; hd++) { const i = q[hd], x = i % cols, y = (i / cols) | 0; if (x > 0) add(i - 1); if (x + 1 < cols) add(i + 1); if (y > 0) add(i - cols); if (y + 1 < rows) add(i + cols); }
        const danger = new Uint8Array(red.length); for (let i = 0; i < red.length; i++) danger[i] = red[i] || !out[i] ? 1 : 0;
        HB.err = '';
        // toạ độ lưới của nhân vật (giữa khung) và kích thước ô theo đơn vị thế giới
        return { danger, cols, rows, gx: (cx - x0) / cpx, gy: (cy - y0) / cpy, cw: cpx / sx / (cfg.viewScale || 1), ch: cpy / sy / (cfg.viewScale || 1) };
      } catch (e) { HB.err = 'không đọc được điểm ảnh canvas (' + (e && e.name) + ')'; return null; }
    }
    const inDanger = (g, wx, wy, margin) => {
      // wx, wy: lệch so với nhân vật (đơn vị thế giới)
      const mx = Math.ceil(margin / g.cw), my = Math.ceil(margin / g.ch), X = Math.floor(g.gx + wx / g.cw), Y = Math.floor(g.gy + wy / g.ch);
      for (let y = Y - my; y <= Y + my; y++) for (let x = X - mx; x <= X + mx; x++) {
        if (x < 0 || y < 0 || x >= g.cols || y >= g.rows) continue;
        if (g.danger[y * g.cols + x]) return true;
      }
      return false;
    };
    function dodgeHit(now, p) {
      if (!cfg.dodgeHit) return false;
      // đang né: giữ hướng đã chọn cho tới hết lượt
      if (HB.dir && now < HB.until) { steer(HB.dir.x * 100, HB.dir.y * 100, false); N.status = 'né vùng chiêu đỏ'; lastActive = now; return true; }
      if (now - HB.lastScan < 120) return false;
      HB.lastScan = now; HB.dir = null;
      const g = scanRed(); HB.hit = g;
      if (!g || g.none || !inDanger(g, 0, 0, 28)) return false;
      // thử 16 hướng × nhiều bước, lấy bước ngắn nhất tới chỗ an toàn (có vùng đệm), không cắt qua cửa ra
      let best = null;
      for (let dist = 40; dist <= 240 && !best; dist += 20) for (let k = 0; k < 16; k++) {
        const a = k * Math.PI / 8, dx = Math.cos(a), dy = Math.sin(a);
        if (inDanger(g, dx * dist, dy * dist, 42)) continue;
        let clear = true; for (let s = 10; s < dist; s += 10) if (inDanger(g, dx * s, dy * s, 6) && s > 30) { clear = false; break; }
        const to = { x: p.x + dx * dist, y: p.y + dy * dist };
        if (crossesPortal(p, to) || nearPortal(to.x, to.y)) continue;
        if (!best || (clear && !best.clear)) best = { dx, dy, dist, clear };
      }
      if (!best) { N.status = 'trong vùng đỏ, không thấy chỗ né'; return false; }
      HB.dir = { x: best.dx, y: best.dy }; HB.until = now + Math.min(900, 120 + best.dist * 1000 / (S.ms || 280));
      if (target && mode === 'walk') { target = null; N.route = null; }
      log('🔴 Né vùng chiêu đỏ: bước ' + best.dist);
      steer(best.dx * 100, best.dy * 100, false); N.status = 'né vùng chiêu đỏ'; lastActive = now;
      return true;
    }
    function flee(p, zones, now) {
      let fx = 0, fy = 0, inside = false;
      for (const z of zones) {
        const dx = p.x - z.x, dy = p.y - z.y, d = Math.hypot(dx, dy);
        if (d >= z.r) continue;
        inside = true;
        const k = (z.r - d) / z.r + 0.2;
        if (d < 1) fx += k; else { fx += dx / d * k; fy += dy / d * k; }
      }
      if (!inside) { N.fleeT = 0; return false; }
      if (!N.fleeT) { N.fleeT = now; log('🏃 Né quái (trong vùng nguy hiểm)'); }
      lastActive = now; N.status = 'né quái';
      if (target && mode === 'walk') { target = null; N.route = null; }
      // né lâu/kẹt → kéo hướng chạy về phía quái thường an toàn gần nhất để đánh tiếp
      if (cfg.fleeSwitch && now - N.fleeT > cfg.fleeMaxS * 1000) {
        const h = safeMob(p, zones);
        if (h) { const dx = h[3] - p.x, dy = h[4] - p.y, d = Math.hypot(dx, dy) || 1, l = Math.hypot(fx, fy) || 1; fx = fx / l + dx / d * 0.8; fy = fy / l + dy / d * 0.8; N.hunt = { id: h[0], until: now + 8000 }; N.status = 'né lâu → sang quái thường'; }
      }
      if (N.side && now < N.side.until) { steer(N.side.x, N.side.y, false); return true; }
      // chọn trong 16 hướng: hướng gần hướng chạy nhất mà phía trước không có vật cản
      const l = Math.hypot(fx, fy) || 1; let best = null, bs = -Infinity;
      for (let i = 0; i < 16; i++) {
        const a = i * Math.PI / 8, dx = Math.cos(a), dy = Math.sin(a);
        let sc = dx * fx / l + dy * fy / l;
        for (const k of [1, 2]) { const c = cellOf({ x: p.x + dx * cfg.cell * k, y: p.y + dy * cfg.cell * k }); if (blocked(c.x, c.y, false)) sc -= 1.5; }
        if (sc > bs) { bs = sc; best = { x: dx, y: dy }; }
      }
      steer(best.x * 100, best.y * 100);
      return true;
    }

    // ===== chọn món =====
    const fighting = () => cfg.autoMode === 'keep' && autoState() === true;
    function judge(d, p, now) {
      const el = now - d.t, ttl = d.ttl - el, prot = d.protect - el;
      const dist = Math.hypot(d.x - p.x, d.y - p.y), eta = dist / (S.ms || 280) * 1000;
      let lim = isPrio(d) || (cfg.xuFar && d.type === 'xu') || !fighting() ? cfg.maxDist : Math.min(cfg.nearR, cfg.maxDist);
      if (N.combat) lim = Math.min(lim, cfg.combatPickR);      // đang giao chiến: chỉ nhặt đồ sát bên, không chạy xa bỏ đánh
      let why = null;
      if ((bad.get(d.id) || 0) > now) why = 'tạm bỏ qua';
      else if (tried.has(d.id) && now - tried.get(d.id).t < cfg.confirmMs) why = 'vừa lướt qua, chờ xác nhận';
      else if (dist > lim) why = 'quá xa';
      else if (ttl < eta + 1500) why = 'sẽ hết hạn trước khi tới';
      else if (prot > 0 && S.myId != null && d.owner !== S.myId && prot > eta) why = 'đang khoá cho người khác';
      else if (cfg.lootNoRed && S.mobs.some(m => mAlive(m) && isRed(m) && Math.hypot(m[3] - d.x, m[4] - d.y) < cfg.lootRedR)) why = 'cạnh quái đỏ';
      else if (inZones(d.x, d.y, N.zones)) why = 'trong vùng né';
      else if (nearPortal(d.x, d.y)) why = 'sát cửa ra';
      else if (cfg.lootFew && S.mobs.filter(m => mAlive(m) && Math.hypot(m[3] - d.x, m[4] - d.y) < cfg.lootMobR).length > cfg.lootMobMax) why = 'quanh đó đông quái';
      return { dist, eta, ttl, prot, why };
    }
    // điểm càng nhỏ càng đi trước: quãng tới món + nửa quãng từ món đó tới món kế gần nhất (nhìn trước 1 bước để đi thành chuỗi,
    // đỡ bỏ sót món lẻ rồi phải quay lại), chia cho trọng số ưu tiên và thưởng cho cụm đồ
    function scoreOf(d, dist, list) {
      let nb = 0, nn = Infinity;
      for (const o of list) { if (o.id === d.id) continue; const k = Math.hypot(o.x - d.x, o.y - d.y); if (k < cfg.clusterR) nb++; if (k < nn) nn = k; }
      return (dist + 0.5 * (nn === Infinity ? 0 : Math.min(nn, 600)) + 30) / weightOf(d) / (1 + 0.15 * Math.min(nb, 8));
    }
    function candidates() {
      const p = curPos(), now = Date.now(); if (!p) return [];
      const out = [];
      for (const d of S.drops.values()) { if (!wanted(d)) continue; const j = judge(d, p, now); if (!j.why) out.push({ ...d, dist: j.dist }); }
      for (const c of out) c.score = scoreOf(c, c.dist, out);
      return out.sort((a, b) => a.score - b.score);
    }
    const nearbyWanted = (p, r) => { for (const d of S.drops.values()) if (wanted(d) && Math.hypot(d.x - p.x, d.y - p.y) <= r) return true; return false; };
    const label = d => (kindOf(d) === 'trứng' ? '🥚 ' : isLegend(d) ? '🟧 ' : '') + (d.name || d.type);
    function startTarget(c, now) {
      target = c; mode = 'walk'; tStart = now; prog = { t: now, d: c.dist }; escalated = false; N.stuckN = 0; N.route = null;
      log('🎯 Nhặt ' + label(c) + ' x' + c.amt + ' #' + c.id + ', cách ' + Math.round(c.dist));
    }

    // đang giao chiến: vừa mất máu (3 giây) hoặc có quái không thường (tinh anh / thủ lĩnh / boss) còn sống trong dangerR
    function inCombat(now, p) {
      if (!cfg.fightFirst || !p) return false;
      if (now - N.hitT < 3000) return true;
      return S.mobs.some(m => mAlive(m) && mType(m) !== '' && mType(m) !== 'normal' && Math.hypot(m[3] - p.x, m[4] - p.y) < cfg.dangerR);
    }
    function lootStep(now, p) {
      if (!target || (mode === 'walk' && now - N.lastRetarget > cfg.retargetMs)) {
        N.lastRetarget = now;
        const list = candidates();
        // LỘ TRÌNH: thứ tự đi qua cả đám đồ cho tổng đường ngắn nhất (trứng / huyền thoại trước) → món đầu lộ trình là món cần đi
        const best = list.length ? planTour(p, list)[0] : null;
        if (!target) {
          if (!best) return false;
          lastActive = now;
          if (cfg.autoMode === 'toggle' && !cfg.neverAutoOff && !am.disabled && !am.off) { release(); if (!am.busy) autoOff(); return true; }
          // gom nhanh: nhiều món quanh đây → tạm tắt TỰ ĐÁNH để nó không kéo nhân vật đi, gom xong tự bật lại
          if (cfg.burst && !cfg.neverAutoOff && cfg.autoMode === 'keep' && !am.disabled && !am.off && !am.busy && autoState() === true) {
            const n = list.filter(c => c.dist <= cfg.burstR).length;
            if (n >= cfg.burstN) { log('🧲 Gom nhanh ' + n + ' món quanh đây (tạm tắt TỰ ĐÁNH)'); release(); autoOff(); return true; }
          }
          if (am.busy) { release(); return true; }
          startTarget(best, now);
        } else {
          const curC = list.find(c => c.id === target.id);
          if (!curC) { log('↩ Bỏ #' + target.id + ' (không còn hợp điều kiện)'); target = null; N.route = null; release(); return false; }
          // GIỮ món đang đi (không đổi qua đổi lại vì điểm nhích chút ít); chỉ đổi khi có món QUAN TRỌNG HƠN (trứng / huyền thoại mới rơi)
          if (best && best.id !== target.id && weightOf(best) > weightOf(curC)) { log('↪ Có món quan trọng hơn: ' + label(best)); startTarget(best, now); }
        }
      }
      lastActive = now; N.status = 'đi nhặt';
      if (am.busy) { release(); return true; }

      const d = S.drops.get(target.id);
      if (!d) {
        // biến mất trước khi tới: mình nhặt (có tin 'p') thì đã đếm trong emitPick; người khác nhặt / hết hạn thì thôi
        if (lastPicked && lastPicked.id === target.id) emitPick(target);
        target = null; N.route = null; return true;
      }
      const dist = Math.hypot(d.x - p.x, d.y - p.y);
      const tapPick = () => { if (cfg.pickKey && now - lastKey > cfg.pickEvery) { lastKey = now; kev('keydown', cfg.pickKey); setTimeout(() => kev('keyup', cfg.pickKey), 60); } };

      // đi ngang qua đồ khác thì nhặt luôn
      if (nearbyWanted(p, cfg.reach * 1.3)) tapPick();
      // NHẶT LƯỚT: tới sát thì bấm nhặt rồi đi tiếp món sau ngay, không đứng chờ server xác nhận.
      // Sau confirmMs mà món vẫn còn thì nó lại thành ứng viên (thử lại); hỏng 3 lần thì bỏ 30 giây.
      if (dist <= cfg.reach) {
        lastKey = 0; tapPick();
        const tr = tried.get(d.id), n = (tr ? tr.n : 0) + 1;
        tried.set(d.id, { t: now, n });
        if (tried.size > 500) for (const [k, v] of tried) if (now - v.t > 60000) tried.delete(k);
        if (n >= 3) {
          tried.delete(d.id); bad.set(d.id, now + 30000);
          log('⚠️ Lướt qua #' + d.id + ' (' + (d.name || d.type) + ') 3 lần vẫn chưa nhặt được. Bỏ qua 30s.' + (cfg.pickKey ? '' : ' Nếu lần nào cũng vậy: bấm "Học phím nhặt".'));
          // nhặt hỏng 3 món khác nhau trong 2 phút (và có phím nhặt) → nhiều khả năng túi đầy: báo cho Vứt đồ
          N.pickFails = (N.pickFails || []).filter(t => now - t < 120000); N.pickFails.push(now);
          if (cfg.pickKey && N.pickFails.length >= 3) { N.pickFails = []; log('🎒 Nhặt hỏng liên tiếp, có thể túi đầy → báo Vứt đồ'); gtEmit('bagfull', { reason: 'nhặt hỏng 3 món liên tiếp' }); }
        }
        target = null; N.route = null; N.lastRetarget = 0;      // chọn món kế ngay ở nhịp sau (không nhả phím → đi liền mạch)
        return true;
      }
      if (now - tStart > cfg.walkTimeout) { release(); bad.set(d.id, now + 60000); target = null; log('⛔ Đi quá lâu, bỏ #' + d.id); return true; }
      if (now - prog.t > cfg.progMs) {
        if (prog.d - dist < 15) {
          N.stuckN++;
          if (N.stuckN >= 2 && cfg.escalate && !cfg.neverAutoOff && !escalated && !am.off && !am.disabled && autoState() === true) {
            escalated = true; release(); log('↪ Không tiến lại gần được (tự đánh giành điều khiển?), tạm tắt TỰ ĐÁNH cho lần nhặt này');
            autoOff(); prog = { t: now, d: dist }; return true;
          }
          if (N.stuckN >= 4) { release(); bad.set(d.id, now + 60000); target = null; log('⛔ Không tới được #' + d.id + ' (kẹt vật cản hoặc phím sai, thử "Thử phím đi")'); return true; }
        } else N.stuckN = 0;
        prog = { t: now, d: dist };
      }
      if (!lootMove(d, now)) { release(); bad.set(d.id, now + 30000); target = null; log('⛔ Không tìm được đường tới #' + d.id); }
      return true;
    }
    // đi tới món: đang trên màn hình thì BẤM CHUỘT vào món (game tự đi thẳng, mượt, tìm đường; lệnh bấm được ưu tiên hơn Tự đánh);
    // ngoài màn hình (hoặc game không đi theo bấm chuột) thì đi bằng phím như cũ
    function lootMove(d, now) {
      // đường thẳng tới món cắt qua vùng cửa → không bấm chuột (game có thể đi xuyên cửa), đi bằng phím có tìm đường vòng
      const fighting = autoState() === true;
      if ((cfg.clickMove || fighting) && !N.noClickMove && !crossesPortal(curPos() || S.pos, d)) {
        // món ngoài màn hình: đang đánh thì vẫn bấm ở mép màn hình theo hướng món (phím bị Tự đánh giành mất)
        const sc = screenOf(d.x, d.y) || (fighting ? screenToward(d) : null);
        if (sc) {
          release();
          if (N.lcId !== d.id || now - N.lcT > (fighting ? 250 : 900)) { clickAt(sc); N.lcId = d.id; N.lcT = now; }
          // bấm mà 2,5 giây nhân vật không nhúc nhích → game không đi theo bấm chuột → dùng phím
          const L = N.lcWatch;
          if (!L || L.id !== d.id || !S.pos || Math.hypot(S.pos.x - L.x, S.pos.y - L.y) > 6) N.lcWatch = S.pos ? { id: d.id, x: S.pos.x, y: S.pos.y, t: now } : null;
          else if (now - L.t > 2500 && !fighting) { N.noClickMove = true; log('… Bấm vào món mà nhân vật không đi → chuyển sang đi bằng phím'); }
          return true;
        }
      }
      return goTo(d, 't' + d.id, now);
    }
    // LỘ TRÌNH NHẶT tối ưu cho tối đa 14 món: nhóm theo mức ưu tiên (trứng → huyền thoại → còn lại),
    // trong mỗi nhóm: láng giềng gần nhất rồi gỡ chéo (2-opt) cho tổng đường ngắn nhất; món nằm sát đường đi (≤ 80px) được kéo lên nhặt luôn
    function planTour(p, list) {
      const D = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
      const pool = list.slice(0, 14);
      const tier = c => weightOf(c) >= 3 ? weightOf(c) : 0;        // nhặt hết nhóm trước rồi mới sang nhóm sau: xu → đồ → đá → còn lại
      const tiers = [...new Set(pool.map(tier))].sort((a, b) => b - a);
      let cur = p; const order = [];
      for (const tv of tiers) {
        const grp = pool.filter(c => tier(c) === tv), seq = [];
        let c0 = cur;
        // láng giềng gần nhất (xu được ưu tiên nhẹ: chia khoảng cách cho √trọng số)
        while (grp.length) { let bi = 0, bs = Infinity; grp.forEach((c, i) => { const s = D(c, c0) / Math.sqrt(weightOf(c)); if (s < bs) { bs = s; bi = i; } }); c0 = grp.splice(bi, 1)[0]; seq.push(c0); }
        // 2-opt: đảo đoạn nếu làm đường ngắn lại (đường mở, bắt đầu từ cur)
        for (let it = 0, improved = true; improved && it < 30; it++) {
          improved = false;
          for (let i = 0; i < seq.length - 1; i++) for (let j = i + 1; j < seq.length; j++) {
            const a = i === 0 ? cur : seq[i - 1], b = seq[i], c = seq[j], e = seq[j + 1];
            if (D(a, c) + (e ? D(b, e) : 0) + 0.5 < D(a, b) + (e ? D(c, e) : 0)) { seq.splice(i, j - i + 1, ...seq.slice(i, j + 1).reverse()); improved = true; }
          }
        }
        order.push(...seq); if (seq.length) cur = seq[seq.length - 1];
      }
      // kéo món nằm sát đoạn đường đang đi lên trước (nhặt trên đường, khỏi quay lại)
      const segD = (q, a, b) => { const vx = b.x - a.x, vy = b.y - a.y, l2 = vx * vx + vy * vy || 1; const t = Math.max(0, Math.min(1, ((q.x - a.x) * vx + (q.y - a.y) * vy) / l2)); return { d: Math.hypot(a.x + vx * t - q.x, a.y + vy * t - q.y), t }; };
      if (order.length > 1) {
        const first = order[0], on = order.slice(1).map(c => ({ c, s: segD(c, p, first) })).filter(x => x.s.d <= 80 && x.s.t < 1).sort((a, b) => a.s.t - b.s.t);
        if (on.length) { const ids = new Set(on.map(x => x.c.id)); return [...on.map(x => x.c), first, ...order.slice(1).filter(c => !ids.has(c.id))]; }
      }
      return order;
    }

    // ===== đi đánh: quái thường sau khi né lâu / chỗ đông quái =====
    function huntStep(now, p) {
      if (!N.hunt) return false;
      const m = S.mobs.find(m => m[0] === N.hunt.id);
      if (now > N.hunt.until || !mAlive(m) || Math.hypot(m[3] - p.x, m[4] - p.y) < 120) { N.hunt = null; return false; }
      lastActive = now; N.status = 'sang quái thường';
      if (!goTo({ x: m[3], y: m[4] }, 'h' + m[0], now)) { N.hunt = null; return false; }
      return true;
    }
    function bestCluster(p) {
      const ms = S.mobs.filter(m => mAlive(m) && !isRed(m) && !inZones(m[3], m[4], N.zones) && !nearPortal(m[3], m[4]));
      const cnt = (x, y) => ms.filter(o => Math.hypot(o[3] - x, o[4] - y) <= cfg.crowdR).length;
      let best = null, bc = 0, bd = Infinity;
      for (const m of ms) {
        const d = Math.hypot(m[3] - p.x, m[4] - p.y); if (d > cfg.maxDist) continue;
        const c = cnt(m[3], m[4]);
        if (c > bc || (c === bc && d < bd)) { best = m; bc = c; bd = d; }
      }
      return best && bc >= 2 && bc > cnt(p.x, p.y) + 1 ? { x: best[3], y: best[4], n: bc } : null;
    }
    // ===== luôn đánh quái gần nhất =====
    // khung mục tiêu của game: "Tên ... 1.234 / 5.678"
    function domTarget() {
      const el = document.querySelector('.ng-target');
      if (!el || !el.getClientRects().length) return null;
      const txt = (el.textContent || '').replace(/\s+/g, ' ').trim();
      const m = txt.match(/(\d[\d.,]*)\s*\/\s*(\d[\d.,]*)\s*$/), num = x => +String(x).replace(/[.,]/g, '');
      return { txt, name: m ? txt.slice(0, m.index).trim() : txt, cur: m ? num(m[1]) : null, max: m ? num(m[2]) : null };
    }
    // khung mục tiêu có đúng là con quái m không (theo tên + máu tối đa / máu hiện tại gần đúng)
    const isTarget = (t, m) => !!t && !!m && t.txt.includes(String(m[1])) && (t.max == null || !m[6] || t.max === m[6]) && (t.cur == null || !m[6] || Math.abs(t.cur - m[5]) / m[6] < 0.2);
    function nearestMob(p) {
      let best = null, bd = cfg.nearestR;
      for (const m of S.mobs) {
        if (!mAlive(m) || isRed(m) || nearPortal(m[3], m[4]) || inZones(m[3], m[4], N.zones)) continue;
        const d = Math.hypot(m[3] - p.x, m[4] - p.y); if (d < bd) { bd = d; best = m; }
      }
      return best;
    }
    // vị trí trên màn hình của 1 điểm trong thế giới (camera giữ nhân vật ở giữa khung game)
    function screenOf(wx, wy) {
      const cv = document.querySelector('.scene-canvas'), p = curPos();
      if (!cv || !p) return null;
      const r = cv.getBoundingClientRect(), k = cfg.viewScale || 1;
      const x = r.left + r.width / 2 + (wx - p.x) * k, y = r.top + r.height / 2 + (wy - p.y) * k;
      return x > r.left + 4 && x < r.right - 4 && y > r.top + 4 && y < r.bottom - 4 ? { x, y, cv } : null;
    }
    function clickAt(s) {
      let el = document.elementFromPoint(s.x, s.y) || s.cv;
      if (el && el.shadowRoot) el = s.cv;          // đừng bấm trúng bảng công cụ
      const o = { bubbles: true, cancelable: true, composed: true, view: window, button: 0, buttons: 1, clientX: s.x, clientY: s.y, pointerId: 1, pointerType: 'mouse', isPrimary: true };
      for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) el.dispatchEvent(new (t.startsWith('pointer') ? PointerEvent : MouseEvent)(t, o));
    }
    // ===== DÙNG HỆ MỤC TIÊU CỦA GAME (đọc từ mã nguồn game) =====
    // F2: chọn lần lượt mục tiêu trong tầm nhìn (cổng / NPC / người chơi), game hiện "Mục tiêu i/n: TÊN — bấm Enter để đi tới".
    // Enter: game TỰ ĐI TỚI mục tiêu (tự tìm đường) rồi dùng nó (vào cổng / mở NPC).  Tab: chọn quái, xếp từ gần tới xa (≤ 700).
    const GK = { F2: { key: 'F2', code: 'F2', keyCode: 113 }, Enter: { key: 'Enter', code: 'Enter', keyCode: 13 }, Tab: { key: 'Tab', code: 'Tab', keyCode: 9 } };
    const tapKey = async k => { kev('keydown', k); await sleep(40); kev('keyup', k); };
    function hintTarget() {
      try {
        const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let n = w.nextNode(), i = 0; n && i < 40000; n = w.nextNode(), i++) {
          const t = norm(n.nodeValue); if (!t || t.length > 220 || t.indexOf('ục tiêu') < 0) continue;
          const m = t.match(/Mục tiêu\s*(\d+)\s*\/\s*(\d+)\s*:\s*(.+?)(?:\s+—\s+|\s+-\s+bấm|\s*$)/);
          if (m && n.parentElement && visible(n.parentElement)) return { i: +m[1], n: +m[2], label: m[3].trim(), sig: t };
        }
      } catch (e) {}
      return null;
    }
    // bấm F2 tới khi mục tiêu khớp; trả về mục tiêu đã chọn hoặc null
    async function pickGameTarget(match) {
      let prev = (hintTarget() || {}).sig || '', total = 30;
      const seen = new Set();
      for (let k = 0; k < Math.min(total, 30); k++) {
        await tapKey(GK.F2);
        let h = null;
        for (let i = 0; i < 10; i++) { await sleep(60); h = hintTarget(); if (h && h.sig !== prev) break; }
        if (!h) return null;
        prev = h.sig; total = h.n + 1;
        if (match(h.label)) return h;
        if (seen.has(h.i)) return null;          // đã đi hết 1 vòng
        seen.add(h.i);
      }
      return null;
    }
    // chọn mục tiêu bằng F2 rồi Enter để game tự đi tới / dùng. near: toạ độ (nếu biết) để đi lại gần khi mục tiêu ngoài tầm nhìn
    async function goViaTarget(match, desc, near) {
      let h = await pickGameTarget(match);
      if (!h && near) { log('🧭 ' + desc + ' ngoài tầm nhìn → đi lại gần (' + Math.round(near.x) + ',' + Math.round(near.y) + ')'); await walkPt(near, 260, 25000); h = await pickGameTarget(match); }
      if (!h) return false;
      log('🎯 Chọn mục tiêu của game: "' + h.label + '" → Enter (game tự đi tới)');
      await tapKey(GK.Enter);
      return true;
    }
    // cấu hình map của game (window.MEONO_SCENE): danh sách cổng, cổng dẫn tới map nào, NPC
    const mapKeyOf = u => (String(u || '').match(/\/ngoai-gioi\/([^/?#]+)/) || [])[1] || null;
    function sceneMap() { const s = window.MEONO_SCENE || {}; return (s.outer && s.outer.map) || (s.outerClient && s.outerClient.map) || s.outerMap || null; }
    function scenePortals() {
      const s = window.MEONO_SCENE || {}, m = sceneMap(), urls = s.urls || {};
      if (!m || !Array.isArray(m.portals)) return [];
      return m.portals.map(p => {
        const url = urls['gate:' + p.id] || null;
        const x = typeof p.x === 'number' ? p.x : p.markerX, y = typeof p.y === 'number' ? p.y : p.markerY;
        return { id: p.id, to: p.to || mapKeyOf(url), dest: mapKeyOf(url) || p.to || null, name: String(p.name || ''), x: typeof x === 'number' ? x : null, y: typeof y === 'number' ? y : null, url };
      });
    }
    const labelMatch = name => lab => !!name && unaccent(lab).startsWith(unaccent(name));
    const sceneNpcs = () => { const s = window.MEONO_SCENE || {}, m = sceneMap(); return (m && m.npcs) || s.npcs || []; };

    const NT = { t: 0, fails: 0, pend: null, okOnce: false, walk: false };
    function nearestStep(now, p) {
      if (!cfg.nearest || autoState() === false) { NT.walk = false; return false; }
      const m = nearestMob(p);
      if (!m) { NT.walk = false; return false; }
      const dist = Math.hypot(m[3] - p.x, m[4] - p.y);
      // kiểm tra lần bấm trước
      if (NT.pend && now - NT.pend.t > 700) {
        const ok = isTarget(domTarget(), S.mobs.find(x => x[0] === NT.pend.id));
        if (ok) { NT.fails = 0; if (!NT.okOnce) { NT.okOnce = true; log('🎯 Bấm chọn quái gần nhất: chạy được'); } }
        else if (++NT.fails === 4) log('⚠️ Bấm chuột không đổi được mục tiêu (thử chỉnh "tỉ lệ" hoặc bấm "Thử chọn quái") → chuyển sang đi lại sát quái gần nhất');
        NT.pend = null;
      }
      const t = domTarget(), right = isTarget(t, m);
      // cách của game: Tab chọn quái theo thứ tự gần → xa (≤ 700), nên bấm Tab tới khi trúng con gần nhất
      if (!right && !NT.tabBusy && (NT.tabFails || 0) < 3 && now - (NT.tabT || 0) > 1200 && dist < 700) {
        NT.tabBusy = true; NT.tabT = now;
        (async () => {
          try {
            const n = S.mobs.filter(x => mAlive(x) && Math.hypot(x[3] - p.x, x[4] - p.y) < 700).length;
            for (let i = 0; i < Math.min(n + 1, 15); i++) {
              await tapKey(GK.Tab); await sleep(120);
              if (isTarget(domTarget(), S.mobs.find(x => x[0] === m[0]))) { NT.tabFails = 0; if (!NT.tabOk) { NT.tabOk = true; log('🎯 Chọn quái gần nhất bằng phím Tab: chạy được'); } return; }
            }
            if (++NT.tabFails === 3) log('⚠️ Phím Tab không chọn được quái gần nhất → dùng bấm chuột / đi lại gần');
          } finally { NT.tabBusy = false; }
        })();
        return false;
      }
      if (!right && cfg.clickTarget && NT.fails < 4 && !NT.pend && !NT.tabBusy && (NT.tabFails || 0) >= 3 && now - NT.t > 1200) {
        const s = screenOf(m[3], m[4]);
        if (s) { NT.t = now; clickAt(s); NT.pend = { id: m[0], t: now }; }
      }
      // chưa chọn được (hoặc không dùng bấm chuột) → đi lại gần để TỰ ĐÁNH tự chọn con gần nhất
      const needWalk = !right && (!cfg.clickTarget || NT.fails >= 4) && dist > 140;
      NT.walk = needWalk;
      if (!needWalk) return false;
      N.status = 'tới quái gần nhất (' + m[1] + ')';
      lastActive = now;
      return goTo({ x: m[3], y: m[4] }, 'n' + m[0], now);
    }
    async function testTarget() {
      const p = curPos(); if (!p) return 'Chưa có vị trí nhân vật.';
      const m = nearestMob(p); if (!m) return 'Không có quái thường nào trong ' + cfg.nearestR + 'px (dữ liệu quái: ' + S.mobs.length + ' con).';
      const before = domTarget(), s = screenOf(m[3], m[4]);
      if (!s) return 'Quái gần nhất ' + m[1] + ' nằm ngoài khung game theo tỉ lệ ' + cfg.viewScale + ' → giảm tỉ lệ.';
      clickAt(s); await sleep(800);
      const after = domTarget(), ok = isTarget(after, S.mobs.find(x => x[0] === m[0]));
      if (ok) { NT.fails = 0; NT.okOnce = true; }
      return 'Quái gần nhất: ' + m[1] + ' lv' + m[2] + ' cách ' + Math.round(Math.hypot(m[3] - p.x, m[4] - p.y)) + 'px · bấm tại (' + Math.round(s.x) + ', ' + Math.round(s.y) + ')' +
        '\nMục tiêu trước: ' + (before ? before.txt : '(không có khung mục tiêu)') + '\nMục tiêu sau:   ' + (after ? after.txt : '(không có khung mục tiêu)') +
        '\n→ ' + (ok ? '✔ CHỌN ĐƯỢC. Bật "Luôn đánh quái gần nhất" là dùng được.' : '✘ Chưa đổi được. Thử tỉ lệ khác (vd 0.5, 0.75, 1.5) rồi thử lại; nếu không được thì tool sẽ dùng cách đi lại sát quái.');
    }

    // ===== ĐÁNH NGƯỜI: nhắm người chơi khác gần nhất (kể cả khi đang đánh quái) =====
    // dữ liệu người chơi: [0] id, … [6] x, [7] y; tên = chữ đầu tiên trong mảng (đoán — "Thử nhắm người" để kiểm tra)
    const heroName = h => (h.find((v, i) => i > 0 && typeof v === 'string' && v.trim().length >= 2 && v.length <= 24) || '').trim();
    const nameList = s => String(s || '').split(',').map(x => norm(x).toLowerCase()).filter(Boolean);
    function pvpTargets(p) {
      const only = nameList(cfg.pvpOnly), skip = nameList(cfg.pvpSkip), out = [];
      for (const h of S.heroes) {
        const x = h[6], y = h[7];
        if (typeof x !== 'number' || typeof y !== 'number') continue;
        if (S.myId != null ? h[0] === S.myId : Math.hypot(x - p.x, y - p.y) < 5) continue;      // bỏ chính mình
        const name = heroName(h), ln = name.toLowerCase(), d = Math.hypot(x - p.x, y - p.y);
        if (d > cfg.pvpR) continue;
        if (only.length && !only.some(o => ln.includes(o))) continue;
        if (skip.some(o => ln.includes(o))) continue;
        out.push({ id: h[0], name, x, y, d });
      }
      return out.sort((a, b) => a.d - b.d);
    }
    function pvpStep(now, p) {
      if (!cfg.pvp) { N.pvpId = null; return false; }
      const hpPct = S.mhp && S.hp != null ? S.hp / S.mhp * 100 : 100;
      if (hpPct < cfg.pvpMinHp) { if (N.pvpId) { log('⚠️ Máu ' + Math.round(hpPct) + '% → thôi đánh người'); N.pvpId = null; } return false; }
      const c = pvpTargets(p)[0];
      if (!c) { N.pvpId = null; return false; }
      if (N.pvpId !== c.id) { N.pvpId = c.id; log('🎯 Nhắm người chơi ' + (c.name || '#' + c.id) + ' (cách ' + Math.round(c.d) + ')'); }
      if (target) { target = null; N.route = null; }
      lastActive = now; N.status = 'đánh người: ' + (c.name || '#' + c.id);
      if (autoState() === false && !am.busy) setAuto(true);
      // đã là mục tiêu của game (khung mục tiêu có tên người đó) → để Tự đánh lo
      const t = domTarget(), onIt = !!(t && c.name && t.txt.includes(c.name));
      if (onIt) { release(); return true; }
      // chưa chọn được: người đó trên màn hình → bấm vào; ngoài màn hình → chạy lại gần
      const sc = screenOf(c.x, c.y);
      if (sc) { release(); if (now - (N.pvpClickT || 0) > 700) { clickAt(sc); N.pvpClickT = now; } return true; }
      if (!goTo({ x: c.x, y: c.y }, 'pvp' + c.id, now)) steer(c.x - p.x, c.y - p.y);
      return true;
    }
    async function testPvp() {
      await poll();
      const p = curPos(); if (!p) return 'Chưa có vị trí nhân vật.';
      const all = S.heroes.filter(h => !(S.myId != null ? h[0] === S.myId : Math.hypot(h[6] - p.x, h[7] - p.y) < 5));
      if (!all.length) return 'Không có người chơi nào khác trong khu (dữ liệu khu: ' + S.heroes.length + ' người tính cả mình).';
      const list = all.slice(0, 6).map(h => '• ' + (heroName(h) || '(không đọc được tên)') + ' · cách ' + Math.round(Math.hypot(h[6] - p.x, h[7] - p.y)));
      const c = pvpTargets(p)[0];
      let res = '';
      if (c) {
        const before = domTarget(), sc = screenOf(c.x, c.y);
        if (sc) { clickAt(sc); await sleep(800); }
        const after = domTarget();
        res = '\nThử bấm vào ' + (c.name || '#' + c.id) + (sc ? ' tại màn hình (' + Math.round(sc.x) + ',' + Math.round(sc.y) + ')' : ' — NGOÀI màn hình') +
          '\nMục tiêu trước: ' + (before ? before.txt : '(không có)') + '\nMục tiêu sau:   ' + (after ? after.txt : '(không có)') +
          '\n→ ' + (after && c.name && after.txt.includes(c.name) ? '✔ CHỌN ĐƯỢC người chơi' : '✘ Chưa chọn được (chỉnh "tỉ lệ màn hình", hoặc map không cho đánh người)');
      } else res = '\nKhông có ai trong tầm ' + cfg.pvpR + 'px hợp danh sách tên.';
      return 'Người chơi trong khu:\n' + list.join('\n') + '\nDữ liệu mẫu 1 người: ' + JSON.stringify(all[0]).slice(0, 200) + res;
    }

    function crowdStep(now, p) {
      if (!cfg.crowd || autoState() === false) return false;
      if (now - N.crowdT > 1500) { N.crowdT = now; N.crowdGoal = bestCluster(p); }
      const g = N.crowdGoal;
      if (!g) return false;
      if (Math.hypot(g.x - p.x, g.y - p.y) < cfg.crowdR) { N.crowdGoal = null; return false; }
      N.status = 'tới chỗ đông quái (' + g.n + ')';
      if (!goTo(g, 'crowd', now)) { N.crowdGoal = null; return false; }
      return true;
    }

    // ===== gục / hồi sinh / về map =====
    function reviveBtn() {
      const bs = deadBtns(); if (!bs.length) return null;
      const re = cfg.reviveMode === 'save' ? /lưu|miễn phí|mien phi|về/i : cfg.reviveMode === 'here' ? /tại chỗ|ngay|tai cho/i : null;
      return (re && bs.find(b => re.test(b.textContent || ''))) || bs[0];
    }
    function handleDown(now) {
      if (isDown()) {
        release(); target = null; N.route = null; N.hunt = null; N.status = 'đang gục';
        if (!N.downT) { N.downT = now; const m = mapNow() || cur.map; if (m) ss.set(DEATHK, m); log('💀 Bị gục' + (m ? ' ở ' + m : '')); gtEmit('death', { map: m, zone: zoneUi() }); }
        ss.del(POSK);      // hồi sinh rồi bị chuyển map thì không phải do cửa ra
        N.pbRerolling = false; N.pbChecked = null;      // vòng làng: chết → lần sau ở làng phải mua thẻ lại
        if (am.off) am.off = false;
        if (cfg.revive && cfg.fightRun && now - N.downT > cfg.reviveDelay * 1000 && now - N.reviveTry > 2500) {
          N.reviveTry = now;
          const b = reviveBtn(); if (b) { log('✚ Bấm hồi sinh: ' + (b.textContent || '').trim()); press(b); }
        }
        return true;
      }
      if (N.downT) {
        N.downT = 0; N.revivedT = now; log('✚ Đã hồi sinh');
        if (cfg.reviveAuto) N.autoAt = now + 1500;
      }
      // về map vừa gục (cũng chạy sau khi trang tải lại do hồi sinh chuyển map)
      const dm = ss.get(DEATHK);
      if (dm && now - N.revivedT > 2500) {
        ss.del(DEATHK);
        const m = mapNow();
        // gục trong phó bản, hồi sinh ra ngoài → vào lại phó bản (theo cách đã học) thay vì mở địa chỉ map
        if (cfg.reenter && !(cfg.pbLoop && isLoopMap(dm)) && isDungeon(dm) && m && baseMap(m) !== baseMap(dm)) { ss.set(REK, JSON.stringify({ map: dm, t: now, tries: 0 })); log('🔁 Hồi sinh ngoài phó bản → sẽ vào lại ' + dm); return false; }
        if (cfg.backToMap && !(cfg.pbLoop && isLoopMap(dm)) && m && m !== dm) { ss.set(RUNK, '1'); ss.del(POSK); log('↩ Về map vừa gục: ' + dm); release(); location.href = location.origin + '/ngoai-gioi/' + dm; return true; }
      }
      if (N.autoAt && now >= N.autoAt && !am.busy) {
        N.autoAt = 0;
        if (autoState() !== true) setAuto(true).then(ok => log(ok ? '▶ Bật TỰ ĐÁNH sau hồi sinh' : '⚠️ Chưa bật được TỰ ĐÁNH sau hồi sinh'));
      }
      return false;
    }

    // ===== đổi khu khi có người chơi khác =====
    async function switchZone() {
      N.zoneBusy = true; release();
      try {
        const btn = document.querySelector('button.scene-zone');
        if (!btn) { log('⚠️ Không thấy nút chọn khu'); return; }
        const isOpen = () => document.querySelector('.scene-zone-panel.is-open');
        if (!isOpen()) { press(btn); await sleep(450); }
        const cz = zoneUi();
        const items = [...document.querySelectorAll('.scene-zone__item')].map(it => {
          const n = +((((it.querySelector('.scene-zone__n') || {}).textContent || '').match(/\d+/) || [0])[0]);
          const c = (((it.querySelector('.scene-zone__c') || {}).textContent) || '').match(/(\d+)\s*\/\s*(\d+)/);
          return { it, n, cnt: c ? +c[1] : 99, max: c ? +c[2] : 100 };
        }).filter(z => z.n && z.n !== cz && z.cnt < z.max).sort((a, b) => a.cnt - b.cnt);
        if (!items.length) { log('… Không có khu trống để đổi'); if (isOpen()) press(btn); return; }
        log('🔀 Có người chơi khác, đổi sang Khu ' + items[0].n + ' (' + items[0].cnt + ' người)');
        press(items[0].it);
        for (let i = 0; i < 30 && zoneUi() === cz; i++) await sleep(150);
        await sleep(300);
        if (isOpen()) press(btn);
        S.drops.clear(); S.mobs = []; S.heroes = []; target = null; N.route = null; N.hunt = null; N.crowdGoal = null;
      } finally { N.zoneBusy = false; N.lastZoneSw = Date.now(); N.playersT = 0; }
    }
    function maintain(now) {
      // vừa nhặt vừa đánh: Tự đánh bị tắt (không phải do tool tắt cố ý) thì bật lại
      if ((cfg.keepAuto || cfg.neverAutoOff) && !am.off && !am.busy && !N.pbBusy && now - N.keepT > 3000) {
        N.keepT = now;
        if (autoState() === false && !autoBlockReason()) { log('▶ TỰ ĐÁNH đang tắt → bật lại'); setAuto(true); }
      }
      if (cfg.zoneSwitch && !N.zoneBusy && now - N.lastZoneSw > 30000 && (!sets.zmaps.size || sets.zmaps.has(mapNow()) || sets.zmaps.has(cur.map))) {
        const others = S.heroes.filter(h => S.myId == null ? true : h[0] !== S.myId).length - (S.myId == null ? 1 : 0);
        if (others > 0) { if (!N.playersT) N.playersT = now; else if (now - N.playersT > cfg.zoneSwitchS * 1000) switchZone(); }
        else N.playersT = 0;
      }
    }

    // ===== vào lại phó bản =====
    const loadSeq = () => { try { return JSON.parse(localStorage.getItem(SEQK) || '[]') || []; } catch (e) { return []; } };
    const visible = el => el && el.isConnected && el.getClientRects().length > 0;
    const norm = s => String(s || '').replace(/\s+/g, ' ').trim();
    const describe = el => ({ tag: el.tagName.toLowerCase(), text: norm(el.textContent).slice(0, 60), cls: [...el.classList].filter(c => !/^(is-|active|hover|focus|selected|open)/.test(c)).slice(0, 4) });
    // tìm lại phần tử đã học: đúng thẻ + class + chữ; chữ có thể đổi số (vd "Vào (2/5)") nên thử thêm khớp phần đầu
    function findStep(s) {
      let list = [];
      try { list = [...document.querySelectorAll(s.tag + s.cls.map(c => '.' + CSS.escape(c)).join(''))].filter(visible); } catch (e) {}
      if (!list.length) list = [...document.querySelectorAll('button,a,[role=button]')].filter(visible);
      if (!s.text) return list[0] || null;
      const head = s.text.replace(/[\d/()]+/g, '').trim().slice(0, 14);
      return list.find(el => norm(el.textContent) === s.text) || (head && list.find(el => norm(el.textContent).replace(/[\d/()]+/g, '').trim().startsWith(head))) || null;
    }
    async function playSeq(seq) {
      for (const s of seq) {
        let el = null;
        for (let i = 0; i < 20 && !el; i++) { el = findStep(s); if (!el) await sleep(200); }
        if (!el) { log('⚠️ Không thấy nút "' + (s.text || s.tag) + '" để vào phó bản'); return false; }
        press(el); await sleep(1200);
      }
      return true;
    }
    function reenterStep(now) {
      if (!cfg.reenter) return false;
      let R = null; try { R = JSON.parse(ss.get(REK) || 'null'); } catch (e) {}
      if (!R) return false;
      const m = mapNow();
      if (m && baseMap(m) === baseMap(R.map)) { ss.del(REK); log('✅ Đã vào lại phó bản ' + m + (R.tries ? ' (lần ' + R.tries + ')' : '')); gtEmit('reenter', { map: m, tries: R.tries }); return false; }
      release(); N.status = 'chờ vào lại phó bản'; lastActive = now;
      if (N.reBusy) return true;
      if (R.tries >= cfg.reenterMax) { ss.del(REK); log('⛔ Vào lại phó bản ' + R.map + ' thất bại ' + R.tries + ' lần, thôi không thử nữa'); gtEmit('reenterfail', { map: R.map }); return false; }
      if (now - (R.last || R.t) < (R.last ? 15000 : cfg.reenterDelay * 1000)) return true;
      R.tries++; R.last = now; ss.set(REK, JSON.stringify(R));
      const seq = loadSeq();
      // có nút đã học: lần lẻ bấm nút, lần chẵn mở địa chỉ; chưa học thì luôn mở địa chỉ
      if (seq.length && R.tries % 2 === 1) {
        N.reBusy = true; log('🔁 Vào lại phó bản: bấm theo cách đã học (lần ' + R.tries + '/' + cfg.reenterMax + ')');
        playSeq(seq).finally(() => { N.reBusy = false; });
      } else {
        log('🔁 Vào lại phó bản: mở địa chỉ ' + R.map + ' (lần ' + R.tries + '/' + cfg.reenterMax + ')');
        ss.set(RUNK, '1'); ss.del(POSK);
        location.href = location.origin + '/ngoai-gioi/' + R.map;
      }
      return true;
    }
    // học: ghi các nút người chơi bấm trong 40 giây (hoặc tới khi vào được phó bản); lưu từng bước ngay để không mất khi trang tải lại
    function learnEnter() {
      const seq = []; localStorage.setItem(SEQK, '[]');
      const from = mapNow();
      const h = e => {
        if (!e.isTrusted) return;
        const el = (e.target.closest && e.target.closest('button,a,[role=button],[onclick]')) || e.target;
        if (!el || el.shadowRoot || !el.tagName || /^(CANVAS|BODY|HTML)$/.test(el.tagName)) return;
        seq.push(describe(el)); if (seq.length > 6) seq.shift();
        try { localStorage.setItem(SEQK, JSON.stringify(seq)); } catch (er) {}
      };
      addEventListener('click', h, true);
      return new Promise(res => {
        const t0 = Date.now();
        const iv = setInterval(() => {
          const m = mapNow(), done = isDungeon(m) && m !== from;
          if (done || Date.now() - t0 > 40000) {
            clearInterval(iv); removeEventListener('click', h, true);
            res(seq.length ? 'Đã học ' + seq.length + ' bước: ' + seq.map(s => '"' + (s.text || s.tag) + '"').join(' → ') + (done ? '\n✔ Đã thấy vào phó bản ' + m : '\n(chưa thấy vào phó bản trong 40 giây — nếu vào bằng cách đi vào cổng trên bản đồ thì không học được, tool sẽ dùng cách mở địa chỉ)') : 'Chưa ghi được nút nào. Hãy bấm "Học" rồi tự bấm các nút để vào phó bản.');
          }
        }, 300);
      });
    }

    // ===== VÒNG LÀNG =====
    // Ở làng: đi tới các chỗ đã học, bấm lại các nút/phím/chỗ trên bản đồ (mua thẻ ở NPC), rồi đi vào cổng.
    // Vào map: đọc hệ map + hệ mình; không khắc → đi ra cổng rồi vào lại (không mua thẻ). Chết → về làng → lại từ đầu.
    // vòng đã học: { v: 2, stages: [{ place, steps, exit, prev, byBtn, dest }], fight }
    //   mỗi chặng = 1 chỗ (vd ng-tnam-ld: bấm NPC mua thẻ → vào bằng nút; lc-lang: đi vào cổng) ; fight = map đánh cuối
    const loadMac = () => {
      let m = null; try { m = JSON.parse(localStorage.getItem(LOOPK) || 'null'); } catch (e) {}
      if (m && !m.stages && m.village) m = { v: 2, t: m.t, stages: [{ place: m.village, steps: m.steps || [], exit: m.exit, prev: m.prev, byBtn: false, dest: m.dest }], fight: m.dest };
      if (m && m.stages && !m.learning && (m.v || 0) < 3) { repairMac(m); try { localStorage.setItem(LOOPK, JSON.stringify(m)); } catch (e) {} }
      return m && m.stages && m.stages.length ? m : null;
    };
    const LINK = 'lootExtLoopIn';          // sessionStorage: đang ở map đánh vào từ chặng cuối của vòng
    // các map đã vào bằng cổng làng (tách với phó bản pb-*: phó bản dùng "tự vào lại phó bản")
    const LMK = 'lootExtLoopMaps';
    const loopMaps = () => { try { return JSON.parse(localStorage.getItem(LMK) || '[]') || []; } catch (e) { return []; } };
    const addLoopMap = m => { if (!m) return; const l = loopMaps(), b = baseMap(m); if (!l.includes(b)) { l.push(b); try { localStorage.setItem(LMK, JSON.stringify(l.slice(-30))); } catch (e) {} } };
    // map đánh của vòng: các map đã vào qua vòng, hoặc cùng kiểu mã với map đánh đã học (lc-4 → mọi lc-<số>: 8 map ngẫu nhiên)
    const isLoopMap = m => {
      if (!m) return false;
      const mac = loadMac(), b = baseMap(m);
      if (loopMaps().includes(b)) return true;
      if (!mac || !mac.fight) return false;
      if (baseMap(mac.fight) === b) return true;
      const pre = String(mac.fight).match(/^(.*?)-?\d+$/);
      return !!pre && pre[1] !== '' && new RegExp('^' + pre[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '-?\\d+$').test(m) && !mac.stages.some(s => s.place === m);
    };
    const posNow = () => S.pos && Date.now() - S.posT < 60000 ? { x: Math.round(S.pos.x), y: Math.round(S.pos.y) } : null;
    // chỗ đang đứng: mã map ngoại giới, hoặc (làng ở địa chỉ khác) toàn bộ đường dẫn trang
    const placeKey = () => mapNow() || (location.pathname.replace(/\/+$/, '') || '/');
    // HỌC NHIỀU CHẶNG: ghi liên tục qua các chỗ (ng-tnam-ld → lc-lang → map đánh...) cho tới khi bấm "Xong học"
    //   - bấm nút/phím/chỗ trên bản đồ ở chỗ nào thì ghi vào chặng của chỗ đó
    //   - rời chỗ ngay sau khi bấm nút (≤ 4 giây) → chặng đó "vào bằng nút", không có cổng
    //   - rời chỗ khi đang đi bộ → vị trí cuối = cổng
    function learnLoop(resume) {
      let mac = { v: 2, t: Date.now(), stages: [], learning: true };
      // học tiếp sau khi trang tải lại giữa chừng (vd đi vào cổng làm tải lại trang)
      if (resume) { try { const o = JSON.parse(localStorage.getItem(LOOPK) || 'null'); if (o && o.stages && o.learning) mac = o; } catch (e) {} }
      let st = null, stT = 0;
      // viaGate: chỗ này tới bằng cách đi bộ qua cổng của chặng trước (= map đánh)
      const newStage = (place, viaGate) => { st = { place, steps: [], exit: null, prev: null, byBtn: false, lastStepT: 0, viaGate: !!viaGate }; stT = Date.now(); mac.stages.push(st); };
      const here0 = placeKey(), last0 = mac.stages[mac.stages.length - 1];
      if (!last0) newStage(here0);
      else if (last0.place === here0) { st = last0; stT = Date.now(); }
      else {
        last0.dest = here0;
        last0.byBtn = !!last0.lastStepT && Date.now() - last0.lastStepT < 15000;    // tải trang mất thời gian → nới lên 15 giây
        if (last0.byBtn) { last0.exit = null; last0.prev = null; }
        newStage(here0, !last0.byBtn);
      }
      ss.set('lootExtLearning', '1');
      const save = () => { try { localStorage.setItem(LOOPK, JSON.stringify(mac)); } catch (e) {} };
      save();
      // bấm trúng khung lớn (thanh thông tin, cả bảng) thì bỏ: không phải nút
      const bigEl = el => norm(el.textContent).length > 40 || el.querySelectorAll('*').length > 25;
      const onClick = e => {
        if (!e.isTrusted || placeKey() !== st.place) return;
        const pos = posNow();
        const cv = document.querySelector('.scene-canvas');
        if (cv && (e.target === cv || cv.contains(e.target))) {
          const r = cv.getBoundingClientRect(), k = cfg.viewScale || 1;
          // bấm trên bản đồ (vd bấm NPC): có vị trí thì lưu theo toạ độ thế giới, không thì lưu theo vị trí trên khung game
          const s = { kind: 'canvas', pos, fx: (e.clientX - r.left) / r.width, fy: (e.clientY - r.top) / r.height };
          if (pos) s.w = { x: Math.round(pos.x + (e.clientX - (r.left + r.width / 2)) / k), y: Math.round(pos.y + (e.clientY - (r.top + r.height / 2)) / k) };
          st.steps.push(s);
        } else {
          const el = (e.target.closest && e.target.closest('button,a,[role=button],[onclick]')) || e.target;
          if (!el || el.shadowRoot || !el.tagName || /^(BODY|HTML)$/.test(el.tagName) || bigEl(el)) return;
          st.steps.push({ kind: 'dom', pos, el: describe(el) });
        }
        st.lastStepT = Date.now(); save(); showLearn();
      };
      const MOVE = new Set(['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift', 'control', 'alt', 'tab']);
      const onKey = e => {
        if (!e.isTrusted || e.repeat || typing() || placeKey() !== st.place || MOVE.has(String(e.key).toLowerCase())) return;
        st.steps.push({ kind: 'key', pos: posNow(), k: { key: e.key, code: e.code, keyCode: e.keyCode } }); st.lastStepT = Date.now(); save(); showLearn();
      };
      const showLearn = () => {
        if (!N.learnCb) return;
        const fightNow = st && st.viaGate;
        N.learnCb('Đang học… ' + (fightNow ? '(đã vào MAP ĐÁNH ' + st.place + ' — đi ra cổng về làng 1 lần để tool học CỔNG RA, rồi tự lưu; hoặc bấm "💾 Lưu vòng")' : '(cứ làm như bình thường tới khi vào map đánh; xong bấm "💾 Lưu vòng")') + '\n' + macText(mac) + (S.pos ? '' : '\n(chưa đọc được vị trí nhân vật — hãy đi lại vài bước)'));
      };
      addEventListener('click', onClick, true); addEventListener('keydown', onKey, true);
      N.learnStop = false;
      showLearn();
      return new Promise(res => {
        const t0 = Date.now(); let lastPoll = 0;
        const iv = setInterval(() => {
          const m = placeKey(), p = posNow();
          if (Date.now() - lastPoll > 2000) { lastPoll = Date.now(); poll(); }        // hỏi vị trí kể cả khi tool đang tắt
          // vị trí cuối cùng còn ở chỗ này = cổng; vị trí trước đó cho biết hướng đi vào cổng
          if (m === st.place && p && Date.now() - stT > 1500 && (!st.exit || Math.hypot(p.x - st.exit.x, p.y - st.exit.y) > 8)) { st.prev = st.exit; st.exit = p; save(); }
          if (m !== st.place) {
            const back = mac.stages.some(s => s.place === m);          // quay về chỗ đã có → học xong
            if (back && st.viaGate) {
              // chỗ này vào bằng CỔNG (đi bộ / bấm bản đồ) = MAP ĐÁNH; đi ra về lại làng → vị trí cuối = CỔNG RA (dùng chung cho mọi map đánh)
              st.isFight = true;
              if (st.exit) mac.fightExit = { exit: st.exit, prev: st.prev };
            } else {
              st.dest = m;
              // "vào bằng nút" chỉ khi lần bấm cuối là NÚT giao diện (vd "Mua & vào") ngay trước khi đổi chỗ;
              // bấm bản đồ để chạy tới cổng (click-to-move) thì vẫn là đi bộ qua cổng → vị trí cuối = cổng
              const lastStep = st.steps[st.steps.length - 1];
              st.byBtn = !!lastStep && lastStep.kind === 'dom' && Date.now() - st.lastStepT < 4000;
              if (st.byBtn) { st.exit = null; st.prev = null; }
            }
            if (!back) newStage(m, !st.byBtn);
            save(); showLearn();
            if (back) N.learnStop = true;
          }
          // đã vào map đánh (qua cổng) 90 giây mà không đi ra → coi như xong (chưa học được cổng ra)
          if (st.viaGate && Date.now() - stT > 90000) N.learnStop = true;
          if (N.learnStop || Date.now() - t0 > 300000) {
            clearInterval(iv); removeEventListener('click', onClick, true); removeEventListener('keydown', onKey, true);
            // chặng cuối vào bằng cổng (hoặc không bấm gì) = MAP ĐÁNH, không phải chặng cần làm
            const last = mac.stages[mac.stages.length - 1];
            if (mac.stages.length > 1 && (last.isFight || last.viaGate || !last.steps.length)) { mac.stages.pop(); mac.fight = last.place; addLoopMap(last.place); }
            for (const s of mac.stages) { delete s.lastStepT; delete s.isFight; }
            delete mac.learning; ss.del('lootExtLearning');
            save();
            res(macText(mac) + (mac.fight ? '' : '\n⚠️ Chưa thấy vào map đánh. Lần sau hãy học tới khi vào hẳn map đánh rồi mới bấm "Xong học".'));
          }
        }, 300);
      });
    }
    const stepText = s => s.kind === 'dom' ? '"' + (s.el.text || s.el.tag) + '"' : s.kind === 'key' ? 'phím ' + s.k.key : 'bấm bản đồ' + (s.w ? ' (' + s.w.x + ',' + s.w.y + ')' : ' (' + Math.round(s.fx * 100) + '%,' + Math.round(s.fy * 100) + '%)');
    const macText = mac => !mac ? 'Chưa học vòng nào.' :
      mac.stages.map((s, i) => (i + 1) + ') ' + s.place + ': ' + (s.steps.length ? s.steps.map(stepText).join(' → ') : '(không bấm gì)') +
        (s.byBtn ? ' ⇒ vào bằng nút' : s.exit ? ' ⇒ cổng (' + s.exit.x + ',' + s.exit.y + ')' : s.dest ? ' ⇒ (chưa có vị trí cổng)' : '') + (s.dest ? ' → ' + s.dest : '')).join('\n') +
      (mac.fight ? '\nMap đánh: ' + mac.fight : '') + (mac.fightExit ? '\nCổng ra trong map đánh: (' + mac.fightExit.exit.x + ',' + mac.fightExit.exit.y + ')' : '');

    // đi bộ tới điểm (dùng tìm đường); vòng lặp tick đứng ngoài trong lúc N.pbBusy
    // chỗ trên màn hình để bấm đi tới pt: pt nằm ngoài khung thì lấy điểm ở mép khung theo hướng tới pt (lệch góc rot nếu cần vòng)
    function screenToward(pt, rot = 0) {
      const cv = document.querySelector('.scene-canvas'), p = curPos();
      if (!cv || !p) return null;
      const r = cv.getBoundingClientRect(), k = cfg.viewScale || 1, cx = r.left + r.width / 2, cy = r.top + r.height / 2, pad = 50;
      let dx = (pt.x - p.x) * k, dy = (pt.y - p.y) * k;
      if (rot) { const c = Math.cos(rot), s = Math.sin(rot); [dx, dy] = [dx * c - dy * s, dx * s + dy * c]; }
      const sx = Math.abs(dx) > 1 ? (r.width / 2 - pad) / Math.abs(dx) : Infinity, sy = Math.abs(dy) > 1 ? (r.height / 2 - pad) / Math.abs(dy) : Infinity;
      const t = Math.min(1, sx, sy);
      return { x: cx + dx * t, y: cy + dy * t, cv };
    }
    // đi tới điểm: ưu tiên BẤM CHUỘT lên bản đồ (game tự tìm đường vòng qua vật cản), bấm lại tới khi tới nơi;
    // đứng yên lâu → bấm lệch sang 1 bên để vòng; bấm mà nhân vật không nhúc nhích → chuyển sang đi bằng phím (có né kẹt)
    async function walkPt(pt, reach = 40, timeout = 30000) {
      if (!pt) return false;
      const t0 = Date.now(), m0 = placeKey();
      let useKeys = !cfg.clickMove || N.noClickMove, lastClick = 0, clicks = 0, lastP = null, lastMoveT = Date.now(), movedByClick = false, side = 1;
      while (on && !paused && Date.now() - t0 < timeout) {
        if (placeKey() !== m0 || isDown()) break;
        const p = curPos(); if (!p) { await sleep(200); continue; }
        if (Math.hypot(pt.x - p.x, pt.y - p.y) <= reach) { release(); return true; }
        const now = Date.now();
        if (!lastP || Math.hypot(p.x - lastP.x, p.y - lastP.y) > 8) { if (lastP && clicks) movedByClick = true; lastP = { x: p.x, y: p.y }; lastMoveT = now; }
        trailPush(p);
        if (!useKeys) {
          const stuck = now - lastMoveT;
          // kẹt (bấm rồi mà ≥ 1,2 giây không nhúc nhích): ghi ô phía trước là TƯỜNG (nhớ lâu dài cho map của vòng) → tìm đường vòng lại
          if (stuck > 1200 && clicks && now - (N.lastWallT || 0) > 1200) {
            N.lastWallT = now;
            const aim = N.clickAim || pt, l = Math.hypot(aim.x - p.x, aim.y - p.y) || 1;
            for (const k of [1, 2]) addWall({ x: p.x + (aim.x - p.x) / l * cfg.cell * k, y: p.y + (aim.y - p.y) / l * cfg.cell * k });
            N.route = null;
          }
          if (now - lastClick > (stuck > 600 ? 500 : 1500)) {
            // đi theo đường vòng quanh tường đã biết (A*): bấm vào điểm xa nhất còn thấy thẳng trên đường
            let aim = pt;
            if (hasMapInfo()) {
              const route = plan(p, pt);
              if (route && route.length) { aim = route[0]; for (let i = Math.min(route.length - 1, 8); i > 0; i--) if (los(p, route[i])) { aim = route[i]; break; } }
            }
            // kẹt lâu (> 4 giây) mà vẫn chưa có đường: bấm lệch ±60° để thử vòng
            const rot = stuck > 4000 ? side * Math.PI / 3 : 0;
            if (rot) side = -side;
            N.clickAim = aim;
            const sc = screenToward(aim, rot);
            if (sc) { clickAt(sc); lastClick = now; clicks++; }
          }
          if (clicks >= 3 && !movedByClick && now - lastMoveT > 3500) { N.noClickMove = true; useKeys = true; log('… Bấm lên bản đồ mà nhân vật không đi → chuyển sang đi bằng phím'); }
        } else {
          watchStuck(now);                                    // kẹt → ghi vật cản, né sang ngang (vòng làng chạy ngoài tick nên phải gọi ở đây)
          if (!goTo(pt, 'pb' + pt.x + ',' + pt.y, now)) steer(pt.x - p.x, pt.y - p.y);
        }
        await sleep(cfg.tick);
      }
      release(); return false;
    }
    // đi vào cổng: tới sát rồi giữ phím đi tiếp theo hướng vào cổng cho tới khi đổi map
    // Làng Cổ (đọc từ mã nguồn game): cấu hình ngoại giới có ancient.village (đang ở làng) / ancient.inside (đang ở trong Làng Cổ).
    // Ở làng, bước vào Cổng làng thì game KHÔNG cho đi qua bình thường: kéo nhân vật về chỗ xuất hiện, gửi lệnh sortie,
    // server trả map đánh rồi mới chuyển trang. → thấy dấu hiệu đó thì đứng yên chờ, không chạy vào cổng lại.
    const lcState = () => { const s = window.MEONO_SCENE, a = s && s.outer && s.outer.ancient; return a ? (a.village ? 'village' : a.inside ? 'fight' : null) : null; };
    const sortieText = () => { try { const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); for (let n = w.nextNode(), i = 0; n && i < 20000; n = w.nextNode(), i++) if (/trời đất xoay chuyển|Bước qua Cổng làng/i.test(n.nodeValue || '')) return true; } catch (e) {} return false; };
    async function waitSortie(m0) {
      release(); log('🚪 Đã bước vào Cổng làng → chờ server chuyển sang map đánh...'); N.status = 'chờ vào map đánh (Cổng làng)';
      for (let i = 0; i < 80 && placeKey() === m0 && lcState() !== 'fight'; i++) await sleep(250);
      return placeKey() !== m0 || lcState() === 'fight';
    }
    async function enterGate(gate, from, ms = 7000) {
      const m0 = placeKey(), village = lcState() === 'village';
      const p0 = curPos();
      await walkPt(gate, 18, 30000);
      if (placeKey() !== m0) return true;
      if (village && (sortieText() || (p0 && S.pos && Math.hypot(S.pos.x - gate.x, S.pos.y - gate.y) > 150))) return waitSortie(m0);
      const p = curPos() || gate;
      let dx = gate.x - (from ? from.x : p.x), dy = gate.y - (from ? from.y : p.y);
      if (Math.hypot(dx, dy) < 5) { dx = gate.x - p.x; dy = gate.y - p.y; }
      if (Math.hypot(dx, dy) < 5) { dx = 0; dy = -1; }
      const t0 = Date.now();
      const len = Math.hypot(dx, dy) || 1;
      let lastClick = 0;
      let lastQ = null;
      while (on && !paused && Date.now() - t0 < ms && placeKey() === m0) {
        const q = curPos() || p;
        // Cổng làng: nhân vật bị kéo lùi đột ngột / game báo "trời đất xoay chuyển" → đang chờ server, đứng yên chờ
        if (village && ((lastQ && Math.hypot(q.x - lastQ.x, q.y - lastQ.y) > 150) || sortieText())) return waitSortie(m0);
        lastQ = q;
        trailPush(q);
        const far = Math.hypot(gate.x - q.x, gate.y - q.y) > 40;
        if (cfg.clickMove && !N.noClickMove) {
          // bấm vào cổng / qua cổng một chút theo hướng đi vào
          if (Date.now() - lastClick > 800) { const tgt = far ? gate : { x: gate.x + dx / len * 40, y: gate.y + dy / len * 40 }; const sc = screenToward(tgt); if (sc) clickAt(sc); lastClick = Date.now(); }
        } else if (far) steer(gate.x - q.x, gate.y - q.y); else steer(dx * 100, dy * 100);   // nhắm vào cổng nếu lệch xa, không thì đi tiếp theo hướng cũ
        await sleep(cfg.tick);
      }
      release();
      return placeKey() !== m0;
    }
    async function runStage(stg) {
      for (const s of stg.steps) {
        if (!on || paused || isDown() || placeKey() !== stg.place) return placeKey() !== stg.place;
        // bấm bản đồ (đi tới chỗ đó / bấm NPC): đi bộ tới gần đúng điểm đã bấm rồi mới bấm → vừa đi theo đường cũ, vừa bấm trúng NPC
        if (s.kind === 'canvas' && s.w) await walkPt(s.w, 60);
        else if (s.pos) await walkPt(s.pos, 45);
        if (placeKey() !== stg.place) return true;           // đi tới điểm đó đã qua cổng
        if (s.kind === 'canvas') {
          let sc = s.w ? screenOf(s.w.x, s.w.y) : null;
          const cv = document.querySelector('.scene-canvas');
          if (!sc && cv && s.fx != null) { const r = cv.getBoundingClientRect(); sc = { x: r.left + s.fx * r.width, y: r.top + s.fy * r.height, cv }; }
          if (sc) clickAt(sc); else log('⚠️ Không bấm được chỗ đã học trên bản đồ');
          // bấm bản đồ để đi (click-to-move), không có toạ độ: chờ nhân vật chạy xong (vị trí ngừng đổi) rồi mới bấm tiếp
          if (!s.w) {
            let lastT = S.posT, still = 0;
            for (let i = 0; i < 80; i++) {
              await sleep(100);
              if (placeKey() !== stg.place) return true;
              if (S.posT !== lastT) { lastT = S.posT; still = 0; } else if (++still >= 8 && i >= 15) break;
            }
          }
        }
        else if (s.kind === 'key') { kev('keydown', s.k); await sleep(80); kev('keyup', s.k); }
        else {
          let el = null; for (let i = 0; i < 20 && !el; i++) { el = findStep(s.el); if (!el) await sleep(200); }
          if (el) press(el); else log('⚠️ Không thấy nút "' + (s.el.text || s.el.tag) + '"');
        }
        await sleep(900);
      }
      if (placeKey() !== stg.place) return true;            // bấm nút xong đã sang chỗ mới
      if (stg.byBtn || !stg.exit) {
        // vào bằng nút (hoặc không biết cổng): chờ chuyển chỗ tối đa 10 giây
        for (let i = 0; i < 40 && placeKey() === stg.place; i++) await sleep(250);
        if (placeKey() !== stg.place) return true;
        log(stg.byBtn ? '⚠️ Bấm nút xong mà chưa chuyển chỗ (hết thẻ / hết tiền / nút đổi tên?)' : '⚠️ Chưa học vị trí cổng ở ' + stg.place); return false;
      }
      return enterGate(stg.exit, stg.prev);
    }
    // ----- hệ -----
    async function heroElem(force) {
      if (!force && N.heroEl && Date.now() - N.heroElT < 600000) return N.heroEl;
      try {
        const r = await (window.__gtNativeFetch || fetch)(location.origin + '/ngoai-gioi-ho-so', { credentials: 'include' });
        const d = ((await r.json()) || {}).data || {};
        const x = elemByKey(d.hero || {}, ['inventory']) || elemByKey(d.combat || {}, ['bag', 'jewels']) || (N.lastFull && N.lastFull.me && elemByKey(N.lastFull.me));
        N.heroEl = x; N.heroElT = Date.now();
        N.heroElDiag = 'chuỗi trong hero: ' + Object.entries(d.hero || {}).filter(([, v]) => typeof v === 'string' && v.length < 30).slice(0, 15).map(([k, v]) => k + '=' + v).join(', ');
      } catch (e) { N.heroElDiag = 'lỗi đọc hồ sơ: ' + e.message; }
      return N.heroEl;
    }
    function mapElem() {
      const f = N.lastFull;
      const r = f && elemByKey(f, ['me', 'heroes', 'mobs', 'drops']);
      if (r) return { ...r, how: 'dữ liệu khu' };
      // giao diện: chữ "Hệ: Hỏa", "Hệ Lôi"... ở bất kỳ đâu trên trang
      for (const c of elemTexts()) { const m = c.t.match(/hệ\s*[:\-–]?\s*([\p{L}]+)/iu), e = m && elemOfWord(m[1]); if (e) return { e, src: c.t.slice(0, 60), how: 'giao diện' }; }
      // tên map / tiêu đề khu có tên hệ (vd "Lạc Hỏa Cốc")
      for (const c of elemTexts()) if (/scene|map|title|zone|location/i.test(c.cls) && !/hero|player|char|me\b|self/i.test(c.cls) && c.e) return { e: c.e, src: c.t.slice(0, 60), how: 'tên map trên giao diện' };
      // mã map: vd ng-hoa-3, lc-loi...
      for (const tk of String(placeKey() || '').toLowerCase().split(/[-_/]/)) { const e = elemOfWord(tk); if (e) return { e, src: placeKey(), how: 'mã map' }; }
      return null;
    }
    // các đoạn chữ ngắn trên trang có tên hệ (không đọc bảng công cụ vì nó nằm trong shadow DOM)
    function elemTexts() {
      const out = [], words = /(kim|mộc|thủy|thuỷ|hỏa|hoả|thổ|lôi|phong|băng|quang|ám|độc)/iu;
      try {
        const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let n = w.nextNode(), i = 0; n && i < 20000 && out.length < 15; n = w.nextNode(), i++) {
          const t = norm(n.nodeValue); if (!t || t.length > 60 || !words.test(t)) continue;
          const p = n.parentElement; if (!p || !visible(p)) continue;
          const m = t.match(new RegExp('(?:^|[^\\p{L}])' + words.source + '(?=$|[^\\p{L}])', 'iu'));
          out.push({ t, e: m ? elemOfWord(m[1]) : null, cls: (p.className && String(p.className)) || p.tagName.toLowerCase() });
        }
      } catch (e) {}
      return out;
    }
    // map hợp: có "Map hợp" thì theo danh sách đó; không thì theo bảng khắc + hệ mình
    function goodMap(me, mp) {
      const good = goodSet();
      if (good.size) return good.has(mp);
      if (!me) return null;
      const K = parseKhac(cfg.khac);
      return cfg.pbRule === 'safe' ? !(K[mp] && K[mp].has(me)) : !!(K[me] && K[me].has(mp));
    }
    const targetSet = () => new Set(String(cfg.pbTargets || '').split(/[,;\s]+/).map(s => s.trim().toLowerCase()).filter(Boolean));
    async function checkElem(m) {
      // có "Map cần vào" → chỉ so mã map (mỗi lần qua cổng là 1 map ngẫu nhiên trong 8 map)
      const tg = targetSet();
      if (tg.size) {
        const ok = tg.has(String(m).toLowerCase()) || tg.has(baseMap(m).toLowerCase());
        N.leaveWhy = ok ? '' : m + ' không phải map cần vào (' + [...tg].join(', ') + ')';
        N.wrongMap = ok ? null : m;
        log((ok ? '✅ Vào đúng ' : '↩ ') + m + (ok ? ' → đánh' : ' không phải ' + [...tg].join(', ') + ' → ra vào lại'));
        return ok;
      }
      // không đặt 'Map cần vào' và cũng không đặt 'Map hợp' → đánh luôn map đang đứng, không ra vào lại
      if (!goodSet().size) { N.leaveWhy = ''; log('✅ Không đặt map cần vào → đánh luôn ' + m); return true; }
      const mp = mapElem(), me = goodSet().size ? null : await heroElem();
      const ok = mp ? goodMap(me && me.e, mp.e) : null;
      if (ok == null) { log('⚠️ Không đọc được hệ (map: ' + (mp ? elName(mp.e) : '?') + (goodSet().size ? '' : ', mình: ' + (me ? elName(me.e) : '?')) + ') → cứ đánh. Bấm "Xem hệ" để kiểm tra.'); N.pbRerollN = 0; return true; }
      log((ok ? '✅ ' : '↩ ') + 'Map ' + m + ' hệ ' + elName(mp.e) + (goodSet().size ? ' (map hợp: ' + [...goodSet()].map(elName).join(', ') + ')' : ', mình hệ ' + elName(me.e)) + (ok ? ' → đánh' : ' → không hợp'));
      return ok;
    }
    // ra khỏi map đánh qua cổng đã biết (đã học khi từng bị văng / tự đi ra), không có thì đi về chỗ vừa xuất hiện
    async function leaveMap() {
      const p = curPos(); if (!p) return false;
      if (cfg.pbAuto) { log('🚪 Ra cổng để vào lại'); return autoGate('fight'); }
      // ưu tiên: cổng ra học được lúc "Học 1 vòng" (dùng chung cho mọi map đánh) → cổng đã nhớ của map này → chỗ vừa xuất hiện
      const mac = loadMac(), fe = mac && mac.fightExit;
      if (fe && fe.exit) { log('🚪 Đi ra cổng (' + fe.exit.x + ',' + fe.exit.y + ') để vào lại'); return enterGate(fe.exit, fe.prev, 9000); }
      const gates = loadPortals(N.map);
      let g = gates.sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];
      if (!g && N.entry) g = N.entry;
      if (!g) { log('⚠️ Chưa biết cổng ra của map này (học lại vòng và đi ra cổng 1 lần) → cứ đánh'); return false; }
      log('🚪 Đi ra cổng (' + Math.round(g.x) + ',' + Math.round(g.y) + ') để vào lại');
      return enterGate(g, p, 9000);
    }
    // ===== TỰ QUÉT (không cần học): tìm NPC / cổng trên màn hình hoặc trong dữ liệu map =====
    const fightRe = () => { try { return new RegExp(cfg.pbFightRe || '^lc-\\d+$', 'i'); } catch (e) { return /^lc-\d+$/i; } };
    const gateRe = () => new RegExp(String(cfg.pbGateWords || 'cổng').split(/\s*,\s*/).filter(Boolean).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'i');
    // chữ đang hiện trên trang (tên NPC / chữ "Cổng" vẽ bằng chữ thật phía trên hình) → vị trí trên màn hình + toạ độ thế giới
    function findLabels(re) {
      const out = [], cv = document.querySelector('.scene-canvas'), cr = cv ? cv.getBoundingClientRect() : null, p = curPos(), k = cfg.viewScale || 1;
      try {
        const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let n = w.nextNode(), i = 0; n && i < 30000 && out.length < 20; n = w.nextNode(), i++) {
          const t = norm(n.nodeValue); if (!t || t.length > 40 || !re.test(t.normalize('NFC')) || /^đang\s/i.test(t)) continue;     // bỏ dòng trạng thái "Đang đi tới …"
          const el = n.parentElement; if (!el || !visible(el) || el.closest('button')) continue;
          const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
          const onMap = !!cr && x >= cr.left && x <= cr.right && y >= cr.top && y <= cr.bottom;
          out.push({ t, el, x, y, onMap, w: p && cr ? { x: Math.round(p.x + (x - (cr.left + cr.width / 2)) / k), y: Math.round(p.y + (y - (cr.top + cr.height / 2)) / k) } : null });
        }
      } catch (e) {}
      return out.sort((a, b) => b.onMap - a.onMap);       // chữ nằm trên khung bản đồ trước (tên trên đầu NPC / cổng)
    }
    // NPC / cổng trong dữ liệu map (nếu game có gửi): mảng có tên trường kiểu npc / portal / gate...
    function dataPoints(keyRe, nameRe) {
      const out = [], f = N.lastFull;
      const walk = (o, d, key) => {
        if (!o || typeof o !== 'object' || d > 3) return;
        if (Array.isArray(o)) {
          if (keyRe.test(key)) for (const it of o) {
            let name = '', x = null, y = null;
            if (Array.isArray(it)) { name = it.find(v => typeof v === 'string') || ''; const nums = it.filter(v => typeof v === 'number'); const i = it.findIndex(v => typeof v === 'number' && v > 10); if (i >= 0 && typeof it[i + 1] === 'number') { x = it[i]; y = it[i + 1]; } else if (nums.length >= 2) { x = nums[nums.length - 2]; y = nums[nums.length - 1]; } }
            else if (it && typeof it === 'object') { name = String(it.name || it.ten || it.title || it.n || ''); x = it.x; y = it.y; }
            if (typeof x === 'number' && typeof y === 'number' && (!nameRe || nameRe.test(norm(name)))) out.push({ name, x, y, src: key });
          }
          return;
        }
        for (const k of Object.keys(o)) if (!['mobs', 'drops', 'heroes', 'me'].includes(k)) walk(o[k], d + 1, k);
      };
      walk(f, 0, '');
      return out;
    }
    // mục BẤM ĐƯỢC có tên NPC (danh sách NPC / nhiệm vụ / bản đồ): bấm vào thì game tự đi tới NPC ("Đang đi tới …")
    function npcClickables(re) {
      const out = [];
      for (const el of document.querySelectorAll('button,a,li,[role=button],[onclick],div,span')) {
        const t = norm(el.textContent); if (!t || t.length > 50 || !re.test(t) || /^đang\s/i.test(t) || !visible(el)) continue;
        if (!(el.matches('button,a,li,[role=button],[onclick]') || getComputedStyle(el).cursor === 'pointer')) continue;
        out.push({ el, t });
      }
      return out.sort((a, b) => a.t.length - b.t.length);        // phần tử sát chữ nhất trước
    }
    const nameRe = s => new RegExp(norm(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*'), 'i');
    // nút giao diện theo chữ: đúng y hệt trước, rồi tới bắt đầu bằng chữ đó
    const btnByText = t => { const all = [...document.querySelectorAll('button,a,[role=button]')].filter(visible); return all.find(b => norm(b.textContent) === t) || all.find(b => norm(b.textContent).startsWith(t)) || null; };
    async function waitBtn(t, ms) { for (let i = 0; i < ms / 150; i++) { const b = btnByText(t); if (b) return b; await sleep(150); } return null; }
    // các đoạn chữ ngắn đang hiện khớp re (không lọc dòng trạng thái) — dùng để biết game còn "Đang đi tới …" không
    function texts2(re) {
      const out = [];
      try { const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); for (let n = w.nextNode(), i = 0; n && i < 30000 && out.length < 3; n = w.nextNode(), i++) { const t = norm(n.nodeValue); if (t && t.length < 80 && re.test(t) && n.parentElement && visible(n.parentElement)) out.push(t); } } catch (e) {}
      return out;
    }
    const clickScreen = (x, y) => { const cv = document.querySelector('.scene-canvas'); if (cv) clickAt({ x, y, cv }); };

    // NPC: tìm tên trên màn hình → đi lại gần → bấm (tên, rồi dưới tên = thân NPC) → bấm các nút mua
    async function autoNpc(m) {
      const re = nameRe(cfg.pbNpcName || 'Lạc Hầu Già'), btns = String(cfg.pbBuyBtns || '').split(/\s*,\s*/).filter(Boolean);
      const buyNow = async () => {
        let okAll = true;
        for (const t of btns) { const b = await waitBtn(t, 3000); if (!b) { if (t === btns[0]) okAll = false; continue; } press(b); await sleep(600); }
        if (!okAll) return false;
        for (let i = 0; i < 40 && placeKey() === m; i++) await sleep(250);
        return placeKey() !== m;
      };
      // hộp thoại mua đang mở sẵn → bấm luôn
      if (btns[0] && btnByText(btns[0])) { log('🎫 Hộp thoại mua đang mở → bấm mua'); if (await buyNow()) return true; }
      // cách 1: bấm mục có tên NPC → game tự đi tới NPC và mở hộp thoại; chờ nút mua hiện ra (tối đa 30 giây)
      const cl = npcClickables(re)[0];
      if (cl && btns[0]) {
        log('🔎 Bấm "' + cl.t + '" → để game tự đi tới NPC');
        press(cl.el);
        let b = null, idle = 0;
        for (let i = 0; i < 200 && !b && placeKey() === m; i++) {
          await sleep(150);
          b = btnByText(btns[0]);
          // game hết "Đang đi tới…" mà vẫn chưa có hộp thoại → thôi chờ
          const walking = texts2(/đang\s+đi\s+tới/i).length > 0;
          idle = walking ? 0 : idle + 1;
          if (i > 20 && idle > 25) break;
        }
        if (b) { if (await buyNow()) return true; }
        else log('… Bấm mục NPC mà chưa thấy nút "' + btns[0] + '" → thử bấm thẳng vào NPC');
      }
      // hộp thoại mua đã mở chưa: thấy nút / chữ "Mua & vào…"
      const buyRe = new RegExp(btns.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*')).join('|') || 'mua\\s*&\\s*vào', 'i');
      const buyEl = () => btns.map(t => btnByText(t)).find(Boolean) || textEl(buyRe);
      const pressEnter = () => {
        const t = document.activeElement && document.activeElement !== document.body ? document.activeElement : (document.querySelector('.scene-canvas') || document.body);
        for (const type of ['keydown', 'keypress', 'keyup']) t.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true, composed: true }));
      };
      // chỗ bấm NPC trong bản học cũ: có toạ độ thì dùng toạ độ, không thì vị trí trên màn hình (hồi sinh luôn đứng cùng 1 chỗ nên vẫn trúng)
      const mac = loadMac(), stg = mac && mac.stages.find(s => s.place === m), npcStep = stg && stg.steps.find(s => s.kind === 'canvas');
      const saved = cfg.pbNpcPos && (!cfg.pbNpcPos.map || cfg.pbNpcPos.map === m) ? cfg.pbNpcPos : null;
      // cách của game: F2 chọn NPC theo tên → Enter (game tự đi tới, mở hộp thoại) → nút mua / Enter
      if (await goViaTarget(lab => unaccent(lab).includes(unaccent(cfg.pbNpcName)), 'NPC ' + cfg.pbNpcName, saved)) {
        let open = false;
        for (let i = 0; i < 120 && !open && placeKey() === m; i++) { await sleep(250); open = !!buyEl(); }
        if (open) {
          for (let k = 0; k < 3 && placeKey() === m; k++) {
            const b = buyEl(); if (b) press(b); else break;
            for (let i = 0; i < 6 && placeKey() === m; i++) await sleep(150);
            if (placeKey() === m && buyEl()) { pressEnter(); for (let i = 0; i < 6 && placeKey() === m; i++) await sleep(150); }
          }
          for (let i = 0; i < 40 && placeKey() === m; i++) await sleep(250);
          if (placeKey() !== m) return true;
        } else log('… F2 + Enter tới NPC mà chưa thấy hộp thoại mua → thử cách cũ');
      }
      for (let attempt = 0; attempt < 3; attempt++) {
        if (placeKey() !== m) return true;
        let lab = saved ? null : findLabels(re)[0], how = 'chữ trên màn hình';
        let target = lab && lab.w;
        if (saved) { target = { x: saved.x, y: saved.y }; how = 'vị trí NPC đã ghi'; }
        if (!lab) { const d = dataPoints(/npc/i, re)[0]; if (d) { target = d; how = 'dữ liệu map (' + d.src + ')'; } }
        if (!target && npcStep && npcStep.w) { target = npcStep.w; how = 'bản học cũ'; }
        if (!target && !lab && !npcStep) { log('⚠️ Không thấy NPC "' + cfg.pbNpcName + '" (không có chữ trên màn hình, không có trong dữ liệu, chưa học chỗ bấm NPC).'); return false; }
        log('🔎 Bấm NPC ' + cfg.pbNpcName + ' (' + (target ? how + ' (' + target.x + ',' + target.y + ')' : 'chỗ bấm trên màn hình đã học') + ')');
        if (target) { await walkPt(target, 70, 25000); lab = findLabels(re)[0] || lab; }
        // bấm NPC (chữ tên / toạ độ / chỗ trên màn hình); không mở hộp thoại thì bấm thấp xuống (thân NPC)
        let open = false;
        // vị trí NPC đã ghi là đúng chỗ người chơi bấm → không cần bấm lệch xuống
        for (const dy of saved ? [0, 0, 20] : [0, 30, 55]) {
          const p = curPos();
          if (lab && lab.el && lab.el.isConnected) { const r = lab.el.getBoundingClientRect(); if (!dy) press(lab.el); clickScreen(r.left + r.width / 2, r.top + r.height / 2 + dy); console.log('[loot] bấm NPC theo chữ "' + lab.t + '" tại màn hình', Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2 + dy)); }
          else if (target) {
            const sc = screenOf(target.x, target.y + dy);
            console.log('[loot] bấm NPC (' + how + '): thế giới', target.x, target.y + dy, '→ màn hình', sc ? Math.round(sc.x) + ',' + Math.round(sc.y) : 'NGOÀI khung', '| nhân vật', p ? Math.round(p.x) + ',' + Math.round(p.y) : '?', '| tỉ lệ', cfg.viewScale);
            if (sc) clickAt(sc);
          }
          else if (npcStep && npcStep.fx != null) {
            const cv = document.querySelector('.scene-canvas');
            if (cv) { const r = cv.getBoundingClientRect(), x = r.left + npcStep.fx * r.width, y = r.top + npcStep.fy * r.height + dy; clickScreen(x, y); console.log('[loot] bấm NPC theo chỗ trên màn hình đã học:', Math.round(x), Math.round(y), '(' + Math.round(npcStep.fx * 100) + '%,' + Math.round(npcStep.fy * 100) + '%) | nhân vật', p ? Math.round(p.x) + ',' + Math.round(p.y) : '?'); }
          }
          for (let i = 0; i < 12 && !open; i++) { await sleep(150); open = !!buyEl(); }
          if (open) break;
        }
        if (!open) { log('⚠️ Bấm NPC mà chưa thấy hộp thoại mua (lần ' + (attempt + 1) + '/3)'); continue; }
        // mua: bấm nút "Mua & vào…" nếu đọc được, không thì Enter (như người chơi: bấm NPC rồi Enter) — chỉ Enter khi hộp thoại đang mở
        for (let k = 0; k < 3 && placeKey() === m; k++) {
          const b = buyEl();
          if (b) press(b); else break;
          for (let i = 0; i < 6 && placeKey() === m; i++) await sleep(150);
          if (placeKey() === m && buyEl()) { pressEnter(); for (let i = 0; i < 6 && placeKey() === m; i++) await sleep(150); }
        }
        for (let i = 0; i < 40 && placeKey() === m; i++) await sleep(250);
        if (placeKey() !== m) return true;
        log('⚠️ Đã bấm mua mà chưa chuyển map (hết thẻ / hết xu?)');
      }
      return false;
    }
    // phần tử (không phải bảng công cụ) có chữ khớp re — dùng khi nút của hộp thoại không phải thẻ <button>
    function textEl(re) {
      try { const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); for (let n = w.nextNode(), i = 0; n && i < 30000; n = w.nextNode(), i++) { const t = norm(n.nodeValue); if (t && t.length < 40 && re.test(t) && n.parentElement && visible(n.parentElement)) return n.parentElement.closest('button,a,[role=button],[onclick]') || n.parentElement; } } catch (e) {}
      return null;
    }
    // ===== tự tìm trường dữ liệu chứa cổng =====
    // mọi điểm (x,y) trong các mảng của dữ liệu map (trừ quái / đồ rơi / người chơi...), kèm đường dẫn trường
    function allDataPoints() {
      const out = [], f = N.lastFull;
      const pt = it => {
        if (Array.isArray(it)) { const i = it.findIndex((v, j) => typeof v === 'number' && typeof it[j + 1] === 'number' && v > 20 && it[j + 1] > 20); return i >= 0 ? { x: it[i], y: it[i + 1], at: i } : null; }
        if (it && typeof it === 'object') { const x = it.x ?? it.cx ?? it.left, y = it.y ?? it.cy ?? it.top; if (typeof x === 'number' && typeof y === 'number') return { x: x + (typeof it.w === 'number' ? it.w / 2 : 0), y: y + (typeof it.h === 'number' ? it.h / 2 : 0) }; }
        return null;
      };
      const walk = (o, path, d) => {
        if (!o || typeof o !== 'object' || d > 3) return;
        if (Array.isArray(o)) { o.forEach((it, i) => { const p = pt(it); if (p) out.push({ ...p, src: path, i }); else if (it && typeof it === 'object') walk(it, path + '[]', d + 1); }); return; }
        for (const k of Object.keys(o)) if (!['mobs', 'drops', 'heroes', 'pets', 'me', 'duels'].includes(k)) walk(o[k], path ? path + '.' + k : k, d + 1);
      };
      walk(f, '', 0);
      return out;
    }
    // trường đã nhận ra là chứa cổng (dò bằng cách so với vị trí cổng đã biết) — lưu lâu dài
    const GKK = 'lootExtGateKey';
    const gateKey = () => { try { return localStorage.getItem(GKK) || null; } catch (e) { return null; } };
    const gateKeyPoints = () => { const k = gateKey(); return k ? allDataPoints().filter(p => p.src === k).map(p => ({ ...p })) : []; };
    // so các điểm trong dữ liệu với cổng đã biết của map này (cổng làng đã học / cổng ra đã học / cổng đã nhớ); điểm nào sát (≤ 120) → trường đó là cổng
    function learnGateKey() {
      if (gateKey()) return gateKey();
      const mac = loadMac(), here = placeKey(), known = [];
      if (mac) {
        const st = mac.stages.find(s => s.place === here && s.exit); if (st) known.push(st.exit);
        if (fightRe().test(here) && mac.fightExit && mac.fightExit.exit) known.push(mac.fightExit.exit);
      }
      known.push(...loadPortals(here));
      if (!known.length) return null;
      const pts = allDataPoints(), cnt = {};
      for (const p of pts) cnt[p.src] = (cnt[p.src] || 0) + 1;
      // chỉ xét trường ít điểm (danh sách cổng thường vài cái); trường cả trăm điểm (ô nền, cỏ...) thì luôn có điểm gần cổng → bỏ
      const hit = {};
      for (const p of pts) if (cnt[p.src] <= 20) for (const g of known) if (Math.hypot(p.x - g.x, p.y - g.y) <= 120) hit[p.src] = (hit[p.src] || 0) + 1;
      const best = Object.entries(hit).sort((a, b) => b[1] - a[1])[0];
      if (best) { try { localStorage.setItem(GKK, best[0]); } catch (e) {} log('🔎 Nhận ra cổng nằm trong dữ liệu map: "' + best[0] + '" — từ giờ đọc cổng từ đây'); return best[0]; }
      return null;
    }
    // cổng gần nhất: chữ trên màn hình → dữ liệu map → cổng đã học / đã nhớ
    function findGate(kind) {
      const p = curPos(), near = list => list.sort((a, b) => p ? Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y) : 0)[0];
      learnGateKey();
      const labs = findLabels(gateRe()).filter(l => l.w && l.onMap);
      if (labs.length) { const l = near(labs.map(l => ({ ...l.w, t: l.t }))); return { x: l.x, y: l.y, how: 'chữ "' + l.t + '" trên màn hình' }; }
      const dp = [...N.dataPortals, ...dataPoints(/portal|gate|cong|warp|tele|door|exit/i), ...gateKeyPoints()];
      if (dp.length) { const g = near(dp.map(d => ({ x: d.x, y: d.y }))); return { ...g, how: 'dữ liệu map' + (dp[0].src ? ' (' + dp[0].src + ')' : '') }; }
      const mac = loadMac();
      if (kind === 'village' && mac) { const st = mac.stages.find(s => s.place === placeKey() && s.exit); if (st) return { ...st.exit, prev: st.prev, how: 'bản học cũ' }; }
      if (kind === 'fight' && mac && mac.fightExit && mac.fightExit.exit) return { ...mac.fightExit.exit, prev: mac.fightExit.prev, how: 'cổng ra đã học' };
      const lp = loadPortals(N.map); if (lp.length) return { ...near(lp), how: 'cổng đã nhớ' };
      return null;
    }
    // ===== đường đi đã ghi (nút "🧭 Ghi đường tới cổng"): mỗi chỗ 1 đường, điểm cuối = cổng. Map đánh dùng chung '#fight' =====
    const PATHK = 'lootExtPaths';
    const loadPaths = () => { try { return JSON.parse(localStorage.getItem(PATHK) || '{}') || {}; } catch (e) { return {}; } };
    const pathFor = place => { const all = loadPaths(); return all[place] || (fightRe().test(place) ? all['#fight'] : null) || null; };
    function recordPath() {
      const place = placeKey(), pts = [];
      if (!S.pos) return Promise.resolve('Chưa đọc được vị trí nhân vật — đi vài bước rồi bấm lại.');
      return new Promise(res => {
        const t0 = Date.now(); let lastPoll = 0;
        const iv = setInterval(() => {
          if (Date.now() - lastPoll > 2000) { lastPoll = Date.now(); poll(); }
          if (placeKey() !== place) {
            clearInterval(iv);
            if (pts.length < 1) return res('Chưa ghi được điểm nào (không đọc được vị trí khi đi).');
            const all = loadPaths(); all[place] = pts; if (fightRe().test(place)) all['#fight'] = pts;
            try { localStorage.setItem(PATHK, JSON.stringify(all)); } catch (e) {}
            console.log('[loot] ghi đường', place, '→', placeKey(), pts);
            return res('✔ Đã ghi đường ở ' + place + ': ' + pts.length + ' điểm, cổng ở (' + pts[pts.length - 1].x + ',' + pts[pts.length - 1].y + ') → sang ' + placeKey() + (fightRe().test(place) ? '\n(dùng chung cho mọi map đánh)' : ''));
          }
          const p = posNow();
          if (p && Date.now() - S.posT < 3000) { const l = pts[pts.length - 1]; if (!l || Math.hypot(p.x - l.x, p.y - l.y) > 100) pts.push(p); else { pts[pts.length - 1] = l.keep ? l : p; } }
          if (N.learnCb) N.learnCb('Đang ghi đường ở ' + place + ': ' + pts.length + ' điểm… (đi tới cổng và đi vào)');
          if (Date.now() - t0 > 300000) { clearInterval(iv); res('Hết 5 phút chưa thấy qua cổng.'); }
        }, 200);
      });
    }
    async function followPath(path, m0) {
      const p = curPos(); if (!p || !path || path.length < 2) return false;
      let i0 = 0, bd = Infinity;
      path.forEach((w, i) => { const d = Math.hypot(w.x - p.x, w.y - p.y); if (d < bd) { bd = d; i0 = i; } });
      log('🧭 Đi theo đường đã ghi: ' + (path.length - i0) + ' điểm → cổng');
      for (const w of path.slice(i0, -1)) { if (placeKey() !== m0) return true; await walkPt(w, 60, 20000); }
      if (placeKey() !== m0) return true;
      const g = path[path.length - 1], pv = path[path.length - 2];
      return enterGate(g, pv, 9000);
    }
    // TỰ GHI ĐƯỜNG: trong lúc đi tới cổng, lưu vết vị trí; qua được cổng thì vết đó thành đường đi cho lần sau
    const trailStart = () => { N.trail = { place: placeKey(), pts: [] }; };
    const trailPush = p => { const T = N.trail; if (!T || !p || T.place !== placeKey()) return; const l = T.pts[T.pts.length - 1]; if (!l || Math.hypot(p.x - l.x, p.y - l.y) > 90) T.pts.push({ x: Math.round(p.x), y: Math.round(p.y) }); };
    function trailSave() {
      const T = N.trail; N.trail = null;
      if (!T || T.pts.length < 2 || placeKey() === T.place) return;
      const all = loadPaths(), old = all[T.place];
      // giữ đường ngắn hơn (ít điểm hơn = ít vòng vèo)
      if (!old || T.pts.length <= old.length + 2) {
        all[T.place] = T.pts; if (fightRe().test(T.place)) all['#fight'] = T.pts;
        try { localStorage.setItem(PATHK, JSON.stringify(all)); } catch (e) {}
        log('🧭 Đã tự nhớ đường tới cổng ở ' + T.place + ' (' + T.pts.length + ' điểm) — lần sau đi thẳng');
      }
    }
    async function autoGate(kind) {
      const m0 = placeKey();
      trailStart();
      try {
        const ok = await autoGate2(kind, m0);
        if (placeKey() !== m0) trailSave();
        return ok;
      } finally { N.trail = null; }
    }
    // vị trí cổng như game tính: cổng ở 1 mép bản đồ (edge N/S/W/E) tại x hoặc y. Không có edge mà có (x,y) gần mép thì suy ra mép gần nhất.
    function gateGeo(p) {
      const m = sceneMap() || {}, W = Number(m.w ?? m.width), H = Number(m.h ?? m.height);
      let e = String(p.edge || '').toUpperCase(); const x = Number(p.x), y = Number(p.y);
      if (!e && Number.isFinite(x) && Number.isFinite(y) && W && H) {
        const d = [['N', y], ['S', H - y], ['W', x], ['E', W - x]].sort((a, b) => a[1] - b[1])[0];
        if (d[1] < 220) e = d[0];
        else return { at: { x, y }, edge: { x, y }, dir: null };
      }
      if (e === 'N' && Number.isFinite(x)) return { at: { x, y: 110 }, edge: { x, y: 8 }, dir: { x: 0, y: -1 } };
      if (e === 'S' && Number.isFinite(x) && H) return { at: { x, y: H - 110 }, edge: { x, y: H - 8 }, dir: { x: 0, y: 1 } };
      if (e === 'W' && Number.isFinite(y)) return { at: { x: 110, y }, edge: { x: 8, y }, dir: { x: -1, y: 0 } };
      if (e && Number.isFinite(y) && W) return { at: { x: W - 110, y }, edge: { x: W - 8, y }, dir: { x: 1, y: 0 } };
      return Number.isFinite(x) && Number.isFinite(y) ? { at: { x, y }, edge: { x, y }, dir: null } : null;
    }
    // chạy tới trước cổng (bấm chuột, game tự tìm đường, có lách kẹt), rồi giữ phím + bấm chuột đi thẳng vào mép cho tới khi đổi map
    async function pushIntoGate(g, m0) {
      await walkPt(g.at, 60, 30000);
      if (placeKey() !== m0) return true;
      // Theo mã nguồn game: cổng chỉ kích hoạt khi VỪA BƯỚC TỪ NGOÀI VÀO vùng cổng. Đứng sẵn trong vùng (bị quái đẩy vào,
      // xuất hiện trong vùng...) thì đi tiếp không ăn → bỏ chọn mục tiêu (Esc) + tương tác (Enter), rồi lùi ra và bước vào lại.
      const village = lcState() === 'village', t0 = Date.now(); let lastClick = 0, lastQ = null, round = 0;
      const ESC = { key: 'Escape', code: 'Escape', keyCode: 27 }, ENT = { key: 'Enter', code: 'Enter', keyCode: 13 };
      const tap = async k => { kev('keydown', k); await sleep(50); kev('keyup', k); };
      while (on && !paused && Date.now() - t0 < 25000 && placeKey() === m0) {
        // 1) đẩy vào 1,5 giây
        const tIn = Date.now();
        while (Date.now() - tIn < 1500 && placeKey() === m0) {
          const q = curPos();
          if (village && ((q && lastQ && Math.hypot(q.x - lastQ.x, q.y - lastQ.y) > 150) || sortieText())) return waitSortie(m0);
          lastQ = q;
          if (g.dir) steer(g.dir.x * 100, g.dir.y * 100); else if (q) steer(g.edge.x - q.x, g.edge.y - q.y);
          if (Date.now() - lastClick > 500) { const sc = screenToward(g.edge); if (sc) clickAt(sc); lastClick = Date.now(); }
          await sleep(cfg.tick);
        }
        if (placeKey() !== m0) break;
        round++;
        // 2) đang đứng trong vùng cổng → bỏ chọn mục tiêu rồi tương tác (Enter = vào cổng đang đứng)
        release(); await tap(ESC); await sleep(120); await tap(ENT);
        for (let i = 0; i < 10 && placeKey() === m0; i++) await sleep(100);
        if (placeKey() !== m0) break;
        // 3) lùi ra khỏi vùng cổng rồi bước vào lại (game chỉ kích hoạt khi vừa bước vào)
        log('↩ Đứng trong cổng mà chưa qua → lùi ra rồi bước vào lại (lần ' + round + ')');
        const back = g.dir ? { x: -g.dir.x, y: -g.dir.y } : null, tOut = Date.now();
        while (Date.now() - tOut < 600 + round * 150 && placeKey() === m0) {
          const q = curPos();
          if (back) steer(back.x * 100, back.y * 100); else if (q) steer(q.x - g.edge.x, q.y - g.edge.y);
          await sleep(cfg.tick);
        }
        release();
      }
      release();
      return placeKey() !== m0;
    }
    async function autoGate2(kind, m0) {
      // cổng thật của map (cấu hình game): ở làng → cổng sang map đánh; ở map đánh → cổng về làng. F2 chọn theo tên rồi Enter.
      const ps = scenePortals(), vil = cfg.pbVillage;
      const want = kind === 'fight'
        ? ps.find(p => p.dest === vil || p.to === vil) || ps.find(p => /làng|lang|về|ve /i.test(unaccent(p.name) + ' ' + p.name)) || (ps.length === 1 ? ps[0] : null)
        : ps.find(p => fightRe().test(String(p.dest || p.to || ''))) || (ps.length === 1 ? ps[0] : null);
      // cổng tính theo mép bản đồ như game (không dò F2): chạy tới trước cổng rồi giữ phím + bấm chuột đi thẳng vào mép
      const raw = want && ((sceneMap() || {}).portals || []).find(r => String(r.id) === String(want.id));
      const gg = raw && gateGeo(raw);
      if (gg) {
        log('🚪 Chạy thẳng vào cổng "' + (want.name || want.dest || '?') + '" (' + Math.round(gg.at.x) + ',' + Math.round(gg.at.y) + ')' + (kind === 'fight' && N.leaveWhy ? ' · ra vì ' + N.leaveWhy : ''));
        if (await pushIntoGate(gg, m0)) return true;
        if (placeKey() !== m0) return true;
        log('⚠️ Chưa qua được cổng "' + (want.name || '?') + '", thử cách khác');
      } else if (want) log('⚠️ Cổng "' + (want.name || '?') + '" không có vị trí trong cấu hình game: ' + JSON.stringify(raw || {}).slice(0, 120));
      else log('⚠️ Không thấy cổng ' + (kind === 'fight' ? 'về làng' : 'sang map đánh') + ' trong cấu hình map. Các cổng: ' + ps.map(p => '"' + p.name + '"→' + (p.dest || p.to || '?')).join(', '));
      // đường tự nhớ từ lần trước
      const rec = pathFor(m0);
      if (rec && rec.length >= 2) { if (await followPath(rec, m0)) return true; if (placeKey() !== m0) return true; }
      // biết đường: lúc học có bấm bản đồ nhiều lần để tới cổng → đi lần lượt qua các điểm đó (từ điểm gần nhất), game tự tìm đường giữa 2 điểm
      if (kind === 'village') {
        const mac = loadMac(), st = mac && mac.stages.find(s => s.place === m0);
        const way = st ? st.steps.filter(s => s.kind === 'canvas' && s.w).map(s => s.w) : [];
        const p = curPos();
        if (way.length > 1 && p) {
          let i0 = 0, bd = Infinity;
          way.forEach((w, i) => { const d = Math.hypot(w.x - p.x, w.y - p.y); if (d < bd) { bd = d; i0 = i; } });
          log('🧭 Đi theo đường đã học: ' + (way.length - i0) + ' điểm → cổng');
          for (const w of way.slice(i0)) { if (placeKey() !== m0) return true; await walkPt(w, 60, 20000); }
          if (placeKey() !== m0) return true;
        }
      }
      const g = findGate(kind);
      if (!g) { log('⚠️ Không thấy cổng ' + (kind === 'fight' ? 'ra ' : '') + 'trên màn hình / trong dữ liệu. Bấm "Quét màn hình" để xem tool thấy gì.'); return false; }
      log('🚪 Chạy vào cổng (' + Math.round(g.x) + ',' + Math.round(g.y) + ') — ' + g.how);
      return enterGate({ x: Math.round(g.x), y: Math.round(g.y) }, g.prev || null, 9000);
    }
    // MUA THẺ + VÀO LÀNG CỔ đúng như bảng của Lạc Hầu Già (đọc từ mã nguồn game): POST "buy" {qty:1} rồi "enter" {}
    // tới cấu hình MEONO_SCENE.outer.ancient.urls; server trả go.url (map đánh) → chuyển trang. Không cần bấm trúng NPC.
    const ancientCfg = () => { const s = window.MEONO_SCENE; return (s && s.outer && s.outer.ancient) || null; };
    const csrfTok = () => { const m = document.querySelector('meta[name="csrf-token"]'); return (m && m.content) || ''; };
    async function lcPost(url, body) {
      const r = await (window.__gtNativeFetch || fetch)(url, { method: 'POST', credentials: 'same-origin', headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'X-CSRF-TOKEN': csrfTok() }, body: JSON.stringify(body) });
      let j = null; try { j = await r.json(); } catch (e) {}
      const d = (j && j.data) || {};
      return { ok: r.ok && !(j && (j.success === false || j.error)), status: r.status, msg: (j && (j.message || j.error || d.message)) || '', go: d.go || (j && j.go) || null };
    }
    async function lcApiEnter() {
      const A = ancientCfg(), u = A && A.urls;
      if (!u || !u.enter) return null;                       // map này không có NPC Làng Cổ
      log('🎫 Vào Làng Cổ qua ' + (cfg.pbNpcName || 'Lạc Hầu Già') + ' (lệnh của game: enter)');
      let r = await lcPost(u.enter, {});
      // chưa có thẻ → mua 1 thẻ (như nút "Mua & vào ngay") rồi vào
      if (!r.ok && u.buy && /thẻ|the bai|pass/i.test(r.msg + ' ' + unaccent(r.msg))) {
        log('🎫 Chưa có thẻ (' + r.msg + ') → mua 1 thẻ rồi vào');
        const b = await lcPost(u.buy, { qty: 1 });
        if (!b.ok) { log('⛔ Không mua được thẻ: ' + (b.msg || 'HTTP ' + b.status)); return false; }
        r = await lcPost(u.enter, {});
      }
      if (!r.ok) { log('⛔ Không vào được Làng Cổ: ' + (r.msg || 'HTTP ' + r.status)); return false; }
      if (r.go && r.go.url) { ss.set(RUNK, '1'); log('✅ Vào Làng Cổ → ' + r.go.url); location.href = r.go.url; return true; }
      // không có địa chỉ chuyển: chờ game tự chuyển trang
      const m0 = placeKey(); for (let i = 0; i < 40 && placeKey() === m0; i++) await sleep(250);
      return placeKey() !== m0;
    }
    function pbAutoStage(now, m, role) {
      ss.del(LINK); release();
      N.status = 'vòng làng (tự quét): ' + (role === 'npc' ? 'tìm NPC mua thẻ' : 'tìm cổng') + ' ở ' + m;
      if (now - (N.pbLastRun || 0) < 3000) return true;
      N.pbBusy = true;
      (async () => {
        try {
          if (!S.pos || Date.now() - S.posT > 8000) await sleep(1500);
          if (am.off || autoState() === true) { await setAuto(false); am.off = false; }
          let ok;
          if (role === 'npc') { const a = await lcApiEnter(); ok = a === null ? await autoNpc(m) : a; }
          else ok = await autoGate('village');
          if (ok) { N.pbFails = 0; if (role === 'village') { ss.set(LINK, '1'); N.pbRuns = (N.pbRuns || 0) + 1; } }
          else if (++N.pbFails >= 4) { cfg.pbLoop = false; store(); log('⛔ Vòng làng: 4 lần liền không ' + (role === 'npc' ? 'mua được thẻ' : 'vào được cổng') + ' → đã tắt vòng'); gtEmit('reenterfail', { map: m }); }
          else log('⚠️ Chưa được (lần ' + N.pbFails + '/4), thử lại');
        } finally { N.pbBusy = false; N.pbLastRun = Date.now(); }
      })();
      return true;
    }
    // "Quét màn hình": tool thấy gì ở chỗ đang đứng
    function scanDiag() {
      const m = placeKey(), role = m === cfg.pbNpcMap ? 'map NPC (mua thẻ)' : m === cfg.pbVillage ? 'làng (tìm cổng)' : fightRe().test(m) ? 'map đánh' : 'không thuộc vòng';
      const labs = findLabels(nameRe(cfg.pbNpcName || 'Lạc Hầu Già'));
      const glabs = findLabels(gateRe());
      const dn = dataPoints(/npc/i), dg = [...N.dataPortals, ...dataPoints(/portal|gate|cong|warp|tele|door|exit/i)];
      const g = findGate(fightRe().test(m) ? 'fight' : 'village');
      const sp = scenePortals(), sm = sceneMap();
      return 'Chỗ đang đứng: ' + m + ' → ' + role + (S.pos ? ' · vị trí (' + Math.round(S.pos.x) + ',' + Math.round(S.pos.y) + ')' : ' · CHƯA đọc được vị trí') +
        '\nCổng theo cấu hình game (MEONO_SCENE): ' + (sp.length ? sp.map(p => '"' + p.name + '" → ' + (p.dest || p.to || '?') + (p.x != null ? ' (' + Math.round(p.x) + ',' + Math.round(p.y) + ')' : '')).join(' | ') : sm ? 'map không có cổng' : 'KHÔNG đọc được window.MEONO_SCENE') +
        (sm ? '\n  các trường cấu hình map: ' + Object.keys(sm).slice(0, 30).join(',') + (sp[0] ? '\n  mẫu 1 cổng: ' + JSON.stringify(sm.portals[0]).slice(0, 200) : '') : '') +
        '\nNPC "' + cfg.pbNpcName + '" trên màn hình: ' + (labs.length ? labs.map(l => '"' + l.t + '"' + (l.onMap ? ' trên bản đồ' : ' (ngoài bản đồ)') + (l.w ? ' (' + l.w.x + ',' + l.w.y + ')' : '')).join(' | ') : 'KHÔNG thấy') +
        '\nMục bấm được có tên NPC: ' + (npcClickables(nameRe(cfg.pbNpcName || 'Lạc Hầu Già')).slice(0, 5).map(c => '"' + c.t + '" <' + c.el.tagName.toLowerCase() + (c.el.className ? ' class="' + String(c.el.className).slice(0, 30) + '"' : '') + '>').join(' | ') || 'KHÔNG thấy (mở danh sách NPC / bản đồ / nhiệm vụ của game rồi quét lại)') +
        '\nNPC trong dữ liệu map: ' + (dn.length ? dn.slice(0, 8).map(d => (d.name || '?') + ' (' + d.x + ',' + d.y + ')').join(' | ') : 'không có') +
        '\nChữ cổng trên màn hình: ' + (glabs.length ? glabs.map(l => '"' + l.t + '"' + (l.onMap ? '' : ' (ngoài bản đồ)') + (l.w ? ' (' + l.w.x + ',' + l.w.y + ')' : '')).join(' | ') : 'KHÔNG thấy') +
        '\nCổng trong dữ liệu map: ' + (dg.length ? dg.slice(0, 8).map(d => '(' + Math.round(d.x) + ',' + Math.round(d.y) + ')').join(' ') : 'không có') +
        '\nTrường dữ liệu chứa cổng: ' + (gateKey() ? '"' + gateKey() + '" (' + gateKeyPoints().length + ' cổng ở map này: ' + gateKeyPoints().slice(0, 6).map(p => '(' + Math.round(p.x) + ',' + Math.round(p.y) + ')').join(' ') + ')' : 'chưa nhận ra') +
        (() => { const c = {}; for (const p of allDataPoints()) c[p.src] = (c[p.src] || 0) + 1; const s = Object.entries(c).map(([k, v]) => k + ':' + v).join(', '); return '\nCác mảng có toạ độ trong dữ liệu: ' + (s || 'không có'); })() +
        '\n→ Cổng tool sẽ chạy vào: ' + (g ? '(' + Math.round(g.x) + ',' + Math.round(g.y) + ') — ' + g.how : 'KHÔNG có') +
        '\nCác trường dữ liệu map: ' + (N.fullKeys || '(chưa có)') +
        // mẫu các trường chưa rõ (có thể chứa cổng / vùng nguy hiểm) — gửi mình để đọc đúng
        ['fields', 'domains', 'hazards'].map(k => { const v = N.lastFull && N.lastFull[k]; if (v == null) return ''; let s = ''; try { s = JSON.stringify(Array.isArray(v) ? v.slice(0, 3) : v).slice(0, 260); } catch (e) {} return '\n' + k + (Array.isArray(v) ? ' (' + v.length + ')' : '') + ': ' + s; }).join('');
    }

    function pbStep(now) {
      if (!cfg.pbLoop) return false;
      if (N.pbBusy) return true;
      // đang chờ vào lại PHÓ BẢN (pb-*) → để phần "tự vào lại phó bản" làm, vòng làng đứng ngoài
      if (ss.get(REK)) return false;
      const m0 = placeKey();
      if (cfg.pbAuto) {
        if (m0 === cfg.pbNpcMap) return pbAutoStage(now, m0, 'npc');
        // nhận diện bằng cờ của game trước (đúng cả khi mã map khác mẫu), rồi mới tới mã map
        const lc = lcState(), A = ancientCfg();
        if (!lc && A && A.urls && A.urls.enter) return pbAutoStage(now, m0, 'npc');
        if (lc === 'village' || m0 === cfg.pbVillage) return pbAutoStage(now, m0, 'village');
        if (lc === 'fight' || fightRe().test(m0)) { ss.set(LINK, '1'); return pbFight(now, m0); }
        // không ở chỗ nào của vòng (vd hồi sinh ở điểm lưu khác) → tự đi tới map có NPC (tab 🧭 Đi tới map)
        if (cfg.pbNpcMap && m0 !== cfg.pbNpcMap && mapNow() && window.__gtTravel && now - (N.pbTravelT || 0) > 60000) {
          N.pbTravelT = now;
          if (window.__gtTravel.go(cfg.pbNpcMap)) { log('🧭 Không ở map của vòng → tự đi tới ' + cfg.pbNpcMap + ' (NPC ' + cfg.pbNpcName + ')'); return true; }
          log('⚠️ Không tìm được đường tới ' + cfg.pbNpcMap + ' từ ' + m0);
        }
      }
      const mac = loadMac();
      if (!mac) return false;
      const m = m0;
      // đang ở 1 chặng của vòng (vd ng-tnam-ld: mua thẻ; lc-lang: vào cổng) → làm chặng đó.
      // Chết ra ng-tnam-ld thì tự mua thẻ lại; ra vào lại map đánh thì về lc-lang nên chỉ vào cổng, không mua thẻ.
      const si = mac.stages.findIndex(s => s.place === m);
      if (si >= 0) {
        ss.del(LINK);
        release(); N.status = 'vòng làng: chặng ' + (si + 1) + '/' + mac.stages.length + ' (' + m + ')';
        if (now - (N.pbLastRun || 0) < 3000) return true;
        N.pbBusy = true;
        (async () => {
          try {
            if (!S.pos || now - S.posT > 8000) { await sleep(1500); }
            const stg = mac.stages[si];
            log((si === 0 ? '🎫 ' : '🚪 ') + 'Vòng làng, chặng ' + (si + 1) + ' (' + m + '): ' + (stg.steps.length ? stg.steps.map(stepText).join(' → ') : '') + (stg.byBtn ? '' : ' → vào cổng'));
            if (am.off || autoState() === true) { await setAuto(false); am.off = false; }
            const ok = await runStage(stg);
            if (ok) {
              N.pbFails = 0;
              if (si === mac.stages.length - 1) { ss.set(LINK, '1'); addLoopMap(placeKey()); N.pbRuns = (N.pbRuns || 0) + 1; }
            }
            else if (++N.pbFails >= 3) { cfg.pbLoop = false; store(); log('⛔ Vòng làng: 3 lần liền không qua được chặng ' + (si + 1) + ' → đã tắt vòng'); gtEmit('reenterfail', { map: m }); }
            else log('⚠️ Chưa qua được chặng ' + (si + 1) + ' (lần ' + N.pbFails + '/3), thử lại');
          } finally { N.pbBusy = false; N.pbLastRun = Date.now(); }
        })();
        return true;
      }
      // map đánh: vào từ chặng cuối (cờ LINK, giữ qua F5) hoặc map đã biết là map đánh; còn lại (phó bản, map khác) không đụng
      if (!ss.get(LINK) && !isLoopMap(m)) return false;
      addLoopMap(m);
      return pbFight(now, m);
    }
    // trong map đánh: đúng map cần vào thì đánh; không thì ra cổng để vào lại
    function pbFight(now, m) {
      // trong map đánh: kiểm tra hệ 1 lần (đợi có dữ liệu khu mới)
      // so mã map thì không cần chờ dữ liệu khu; đọc hệ thì chờ có dữ liệu khu mới
      const ready = targetSet().size ? now - N.mapT > 1200 : S.fullT > N.mapT + 300 && now - N.mapT > 2500;
      if (cfg.pbReroll && N.pbChecked !== m && N.map === m && ready && now >= (N.pbRetryAt || 0)) {
        N.pbChecked = m; N.pbBusy = true;
        (async () => {
          try {
            if (await checkElem(m)) { N.pbRerollN = 0; if (autoState() === false) await setAuto(true); return; }
            if ((N.pbRerollN || 0) >= cfg.pbRerollMax) { N.wrongMap = null; log('… Đã ra vào ' + N.pbRerollN + ' lần chưa gặp map hợp → đánh luôn map này'); N.pbRerollN = 0; await setAuto(true); return; }
            N.pbRerollN = (N.pbRerollN || 0) + 1;
            await setAuto(false);
            if (await leaveMap()) { N.leaveFails = 0; return; }
            if (placeKey() !== m) { N.leaveFails = 0; return; }
            // ra cổng chưa được → thử lại sau 4 giây (trước đây chỉ thử 1 lần rồi đứng im ở map sai)
            N.leaveFails = (N.leaveFails || 0) + 1; N.pbRerollN--;
            if (N.leaveFails < 5) { log('⚠️ Chưa ra được cổng (lần ' + N.leaveFails + '/5) → thử lại'); N.pbRetryAt = Date.now() + 4000; N.pbChecked = null; }
            else { log('⛔ 5 lần không ra được cổng → đánh luôn map này'); N.leaveFails = 0; N.wrongMap = null; await setAuto(true); }
          } finally { N.pbBusy = false; }
        })();
        return true;
      }
      if (!cfg.pbReroll && N.pbChecked !== m) { N.pbChecked = m; if (autoState() === false) setAuto(true); }
      return false;
    }
    async function elemDiag() {
      const me = await heroElem(true), mp = mapElem(), good = goodSet();
      const ok = mp ? goodMap(me && me.e, mp.e) : null;
      return 'Hệ nhân vật: ' + (me ? elName(me.e) + ' (từ ' + me.src + ')' : 'không đọc được' + (good.size ? ' (không cần, đã có "Map hợp")' : '')) + '\n  ' + (N.heroElDiag || '') +
        '\nHệ map ' + mapNow() + ': ' + (mp ? elName(mp.e) + ' (' + mp.how + ': ' + mp.src + ')' : 'KHÔNG đọc được') +
        '\n  các trường dữ liệu khu: ' + (N.fullKeys || '(chưa có)') +
        '\n  chuỗi trong dữ liệu khu: ' + (N.lastFull ? Object.entries(N.lastFull).filter(([, v]) => typeof v === 'string' || typeof v === 'number').slice(0, 15).map(([k, v]) => k + '=' + String(v).slice(0, 20)).join(', ') : '(chưa có)') +
        '\n  chữ có tên hệ trên màn hình: ' + (elemTexts().map(c => '"' + c.t + '" [' + c.cls.slice(0, 30) + ']').join(' | ') || '(không thấy)') +
        '\nMap hợp: ' + (good.size ? [...good].map(elName).join(', ') : '(trống → dùng bảng khắc: ' + cfg.khac + ')') +
        (ok != null ? '\n→ ' + (ok ? '✔ map này HỢP' : '✘ map này KHÔNG hợp') : '\n→ Chưa kết luận được: gửi mình toàn bộ đoạn này, kèm hệ thật của map đang đứng (nhìn trên màn hình game).');
    }

    // ===== chống đứng im =====
    // "có hoạt động" = đi xa hơn 60px, nhặt được đồ, hoặc có quái chết gần mình. Không có trong N phút → xử lý theo bậc:
    // 1) bật lại TỰ ĐÁNH (tắt rồi bật)  2) đổi khu  3) tải lại trang (Nhặt + Đánh và Vứt đồ tự chạy lại)
    function watchIdle(now) {
      if (!cfg.idleOn || N.idleBusy) return;
      if (S.pos) {
        if (!N.anchor) N.anchor = { x: S.pos.x, y: S.pos.y };
        else if (Math.hypot(S.pos.x - N.anchor.x, S.pos.y - N.anchor.y) > 60) { N.anchor = { x: S.pos.x, y: S.pos.y }; N.actT = now; }
      }
      if (now - N.actT < 15000) N.idleStep = 0;
      if (now - N.actT < cfg.idleMin * 60000) return;
      N.actT = now;      // đếm lại từ đầu cho bậc kế tiếp
      const steps = [cfg.idleAuto && 'auto', cfg.idleZone && 'zone', cfg.idleReload && 'reload'].filter(Boolean);
      if (!steps.length) return;
      const st = steps[Math.min(N.idleStep, steps.length - 1)];
      N.idleStep++;
      gtEmit('idle', { step: st, map: mapNow() });
      if (st === 'auto') {
        log('😴 Đứng im ' + cfg.idleMin + ' phút → bật lại TỰ ĐÁNH');
        N.idleBusy = true;
        (async () => { try { if (autoState() === true) { await setAuto(false); await sleep(800); } await setAuto(true); am.off = false; } finally { N.idleBusy = false; } })();
      } else if (st === 'zone') {
        log('😴 Vẫn đứng im → đổi khu');
        if (!N.zoneBusy) switchZone();
      } else {
        log('😴 Vẫn đứng im → tải lại trang');
        ss.set(RUNK, '1'); ss.del(POSK); release();
        setTimeout(() => location.reload(), 500);
      }
    }

    // ===== vòng lặp =====
    function tick() {
      if (!on) return;
      const now = Date.now();
      if (paused || typing() || document.hidden) { release(); shiftCtl(now, false); if (am.off && now - lastActive > cfg.resumeDelay) autoOn(); return; }
      shiftCtl(now, false);            // chạy nhanh giờ do tab Vứt đồ lo (chạy cả khi không nhặt / không đánh)
      if (handleDown(now)) { N.actT = now; return; }
      if (cfg.fightRun && pbStep(now)) { N.actT = now; return; }
      if (cfg.fightRun && reenterStep(now)) { N.actT = now; return; }
      if (cfg.fightRun) watchIdle(now);
      if (N.zoneBusy) { release(); return; }
      if (!S.pos || now - S.posT > 8000) { release(); return; }
      const mp = mapNow() || cur.map;
      if (isDungeon(mp)) ss.set('lootExtLastPb', mp);
      if (mp !== N.map) {
        checkExit(now, mp);
        // vừa vào map (đổi map khi đang chạy, hoặc trang mới tải) → chờ vị trí mới để đánh dấu chỗ xuất hiện
        N.mapT = N.map !== null || performance.now() < 20000 ? now : 0;
        N.pbChecked = null; N.pbRetryAt = 0; N.leaveFails = 0;      // mỗi lần vào map (kể cả vào lại đúng map cũ) đều kiểm tra lại
        N.map = mp; N.obs = []; N.obsSrc = []; N.learned.clear(); N.cache.clear(); N.bounds = null; N.route = null;
        loadWallsInto(placeKey());               // tường đã nhớ của map này (vòng làng)
        N.dataPortals = []; N.entry = null; rebuildPortals();
      }
      // cấu hình map mới có thể nạp chậm hơn đổi địa chỉ trang → nạp lại cổng thật khi cấu hình đã đúng map
      if (cfg.avoidPortal && N.gpKey !== N.map) { const m = sceneMap(); if (m && (!m.key || m.key === N.map) && Array.isArray(m.portals) && m.portals.length) rebuildPortals(); }
      // chỗ xuất hiện sau khi qua mũi tên → điểm bắt đầu của map này trên bản đồ mũi tên
      if (N.arriveFrom && N.mapT && S.posT > N.mapT + 300) { setArrival(N.arriveFrom.from, N.arriveFrom.to, S.pos.x, S.pos.y); N.arriveFrom = null; }
      if (cfg.avoidEntry && !N.entry && N.mapT && S.posT > N.mapT + 300 && now - N.mapT < 20000) {
        N.entry = { x: S.pos.x, y: S.pos.y }; rebuildPortals(); log('🚪 Đánh dấu chỗ vào map (' + Math.round(S.pos.x) + ', ' + Math.round(S.pos.y) + ') là vùng tránh');
      }
      if (now - N.posSaveT > 300 && now - S.posT < 3000) { N.posSaveT = now; ss.set(POSK, JSON.stringify({ m: mp, x: S.pos.x, y: S.pos.y, t: now })); }
      for (const [k, t] of N.learned) if (t <= now) N.learned.delete(k);
      // map không có quái (5 giây liền) / không đúng map cần vào → tắt Tự đánh; hết lý do thì bật lại (chỉ bật lại nếu tool đã tắt)
      const blockWhy = autoBlockReason();
      if (blockWhy) {
        if (!N.noAutoSince) N.noAutoSince = now;
        if (now - N.noAutoSince > (blockWhy === 'map không có quái' ? 5000 : 0) && autoState() === true && !am.busy && !am.disabled) { log('⏸ Tắt Tự đánh: ' + blockWhy); N.autoBlocked = true; setAuto(false); }
      } else {
        N.noAutoSince = 0;
        if (N.autoBlocked && autoState() === false && !am.busy && !am.disabled) { N.autoBlocked = false; log('▶ Bật lại Tự đánh (có quái, đúng map)'); setAuto(true); }
      }
      maintain(now);
      watchStuck(now);
      const p = curPos();
      for (const z of N.portals) z.in = Math.hypot(p.x - z.x, p.y - z.y) < z.r;
      // chặn cứng: đang ở sát cửa ra (đã biết) → đi ra xa ngay, kể cả khi TỰ ĐÁNH đang kéo vào
      // hướng đang đi (từ vị trí thật ~0,4 giây trước) để biết có đang tiến về phía cửa không
      if (S.pos && (!N.velP || now - N.velP.t > 400)) { if (N.velP) N.vel = { x: (S.pos.x - N.velP.x) / ((now - N.velP.t) / 1000), y: (S.pos.y - N.velP.y) / ((now - N.velP.t) / 1000) }; N.velP = { x: S.pos.x, y: S.pos.y, t: now }; }
      const v = N.vel || { x: 0, y: 0 };
      // chặn cứng: đã ở trong vùng cửa, hoặc trong 1,4 lần bán kính mà đang đi về phía cửa → đẩy ra ngay
      const pz = cfg.avoidPortal && N.portals.find(z => {
        if (z.kind === 'entry') return false;
        const dx = z.x - p.x, dy = z.y - p.y, d = Math.hypot(dx, dy);
        if (d < z.r) return true;
        return d < z.r * 1.4 && (dx * v.x + dy * v.y) / (d || 1) > 40;       // tốc độ hướng về cửa > 40/giây
      });
      if (pz) {
        if (!N.guardT) { N.guardT = now; log('🚪 Sát / đang đi về phía cửa ra → đi ra xa'); }
        if (target) { target = null; }
        N.route = null; N.status = 'tránh cửa ra'; lastActive = now;
        const ax = p.x - pz.x || 1, ay = p.y - pz.y, al = Math.hypot(ax, ay) || 1;
        steer(ax, ay);
        // bấm chuột về hướng ngược cửa (lệnh bấm của người chơi được game ưu tiên hơn Tự đánh)
        if (cfg.clickMove && !N.noClickMove && now - (N.guardClickT || 0) > 400) { const sc = screenToward({ x: p.x + ax / al * 180, y: p.y + ay / al * 180 }); if (sc) clickAt(sc); N.guardClickT = now; }
        // Tự đánh cứ kéo vào → tạm tắt (an toàn hơn "vừa nhặt vừa đánh"); ra khỏi vùng cửa tự bật lại
        if (now - N.guardT > 600 && !am.off && !am.disabled && autoState() === true) autoOff();
        return;
      }
      N.guardT = 0;
      const zones = dangerZones(now);
      N.zones = zones.filter(z => z.path);
      if (cfg.fightRun && dodgeHit(now, p)) return;
      if (flee(p, zones, now)) return;
      if (cfg.fightRun && pvpStep(now, p)) return;            // có người chơi khác trong tầm → ưu tiên đánh người (kể cả đang đánh quái)

      const lowHp = S.mhp && S.hp != null && S.hp / S.mhp < cfg.minHpPct;
      if (lowHp) {
        if (target) { release(); target = null; }
        if (!warnedHp) { warnedHp = true; log('⚠️ Máu thấp (' + Math.round(S.hp / S.mhp * 100) + '%), dừng đi nhặt'); }
      } else warnedHp = false;

      // vừa nhặt vừa đánh: đang bị đánh / có thủ lĩnh, tinh anh, boss gần → chỉ nhặt đồ sát bên; máu thấp thì đứng đánh (hút máu), không nhặt
      N.combat = inCombat(now, p);
      const hpPct = S.mhp && S.hp != null ? S.hp / S.mhp * 100 : 100;
      const fightNow = N.combat && hpPct < cfg.fightHpPct;
      if (fightNow) {
        if (target) { target = null; N.route = null; release(); }
        N.status = 'đánh trước (máu ' + Math.round(hpPct) + '%) — chưa nhặt';
        if (!N.fightLogT || now - N.fightLogT > 10000) { N.fightLogT = now; log('⚔️ Đang bị đánh, máu ' + Math.round(hpPct) + '% → đứng đánh hút máu, tạm không nhặt'); }
      }
      if (!lowHp && !fightNow && cfg.pickRun && lootStep(now, p)) return;
      if (!cfg.pickRun && target) { target = null; release(); }
      if (huntStep(now, p)) return;
      if (nearestStep(now, p)) return;
      if (!cfg.nearest && crowdStep(now, p)) return;
      N.status = '';
      release();
      if (am.off && now - lastActive > cfg.resumeDelay) autoOn();
    }
    const timer = setInterval(tick, cfg.tick);

    window.__loot = {
      cfg,
      start() { paused = false; ss.set(RUNK, '1'); N.runT = Date.now(); picked = 0; console.log('[loot] BẮT ĐẦU'); },
      pause() { paused = true; release(); lastActive = 0; },
      stop() {
        clearInterval(timer); clearInterval(pollTimer); release(); shiftCtl(Date.now(), false); on = false; ss.del(RUNK); ss.del(POSK);
        removeEventListener('keydown', onUserKey, true);
        try { if (po) po.disconnect(); } catch (e) {}
        if (am.off) { const b = autoBtn(); if (b && autoState() !== true) press(b); am.off = false; }
        TAP.subs.delete(sub);
        console.log('[loot] đã dừng');
      },
      isPaused() { return paused; },
      busy() { return !!target || candidates().length > 0; },        // đang đi nhặt hoặc còn món nhặt được (Săn boss dựa vào đây để chờ)
      learnKey() {
        learning = true; log('Đang học phím nhặt (30 giây): đứng gần 1 món đồ rồi NHẤN PHÍM NHẶT của game.');
        return new Promise(res => { learnDone = res; setTimeout(() => { if (learning) { learning = false; res('Hết giờ, chưa học được phím nào (game có thể tự nhặt, không cần phím).'); } }, 30000); });
      },
      // xem trước đường đi tới map đích
      tripText(to) {
        const here = placeKey(), hops = planTrip(here, curPos(), to);
        if (here === to) return 'Đang ở ' + to + ' rồi.';
        return hops ? 'Đường ngắn nhất ' + here + ' → ' + to + ' (' + hops.length + ' lần qua mũi tên): ' + [here, ...hops.map(h => h.to)].join(' → ') : 'Chưa biết đường từ ' + here + ' tới ' + to + '.';
      },
      testRun, testTarget, testPvp, learnEnter, learnLoop, elemDiag, scanDiag, recordPath,
      // ghi vị trí NPC: chờ người chơi bấm vào NPC trên bản đồ (tối đa 30 giây) → lưu toạ độ thế giới của chỗ bấm
      async pickNpc() {
        await poll();
        return new Promise(res => {
          const cv = document.querySelector('.scene-canvas');
          if (!cv) return res('Không thấy khung bản đồ (.scene-canvas).');
          const done = msg => { removeEventListener('click', h, true); clearTimeout(to); res(msg); };
          const h = e => {
            if (!e.isTrusted || !(e.target === cv || cv.contains(e.target))) return;
            const p = curPos();
            if (!p) return done('Chưa đọc được vị trí nhân vật — đi vài bước rồi thử lại.');
            const r = cv.getBoundingClientRect(), k = cfg.viewScale || 1;
            const w = { x: Math.round(p.x + (e.clientX - (r.left + r.width / 2)) / k), y: Math.round(p.y + (e.clientY - (r.top + r.height / 2)) / k) };
            cfg.pbNpcPos = { x: w.x, y: w.y, map: placeKey() }; store();
            console.log('[loot] ghi vị trí NPC:', { map: placeKey(), npc: w, nhanVat: { x: Math.round(p.x), y: Math.round(p.y) }, manHinh: { x: Math.round(e.clientX), y: Math.round(e.clientY) }, khung: { left: Math.round(r.left), top: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }, tiLe: k });
            done('✔ Đã ghi vị trí NPC: (' + w.x + ',' + w.y + ') ở ' + placeKey() + ' (nhân vật lúc bấm: ' + Math.round(p.x) + ',' + Math.round(p.y) + ').\nTừ giờ tool đi tới đó rồi bấm.');
          };
          addEventListener('click', h, true);
          const to = setTimeout(() => done('Hết 30 giây, chưa thấy bấm vào bản đồ.'), 30000);
        });
      },
      onLearn(cb) { N.learnCb = cb; },
      stopLearn() { N.learnStop = true; },
      // thử vào lại phó bản gần nhất ngay (dùng để kiểm tra cách đã học)
      tryReenter(map) { const m = map || ss.get('lootExtLastPb'); if (!m) return 'Chưa biết phó bản nào (vào 1 phó bản khi tool đang chạy trước đã).'; ss.set(REK, JSON.stringify({ map: m, t: 0, tries: 0 })); return 'Sẽ vào lại ' + m + ' ngay khi tool đang chạy.'; },
      // cho tab Thống kê: tool có đang đọc được dữ liệu game không
      diag() { return { myId: S.myId, drops: S.drops.size, mobs: S.mobs.length, posAge: S.pos ? Date.now() - S.posT : null, fullAge: S.fullT ? Date.now() - S.fullT : null, emit: { ...emitN }, ms: S.ms, msT: N.msT || 0, speed: curSpeedNow(), move: N.lastMove || null }; },
      clearPortals() { const m = mapNow() || N.map; const n = m ? forgetPortals(m) : 0; N.entry = null; rebuildPortals(); return 'Đã xoá ' + n + ' cửa đã nhớ của ' + (m || '?') + ' (và vùng chỗ vào map).'; },
      clearObs() {
        const n = N.learned.size, m = placeKey(); N.learned.clear(); N.route = null;
        // xoá cả tường nhớ lâu dài và đường đã nhớ của map này (khi tool nhớ nhầm làm đi sai)
        const w = loadWalls(); delete w[m]; try { localStorage.setItem(WALLK, JSON.stringify(w)); } catch (e) {}
        const pa = loadPaths(); delete pa[m]; if (fightRe().test(m)) delete pa['#fight']; try { localStorage.setItem(PATHK, JSON.stringify(pa)); } catch (e) {}
        return 'Đã xoá ' + n + ' ô vật cản tự học, tường và đường đã nhớ của ' + m + '.';
      },
      // ghi lại dữ liệu game trong một lúc (loại sự kiện, các trường) để tìm định dạng vùng chiêu / vật cản
      async record(sec = 20) {
        N.rec = { until: Date.now() + sec * 1000, items: {} };
        const n0 = { ...TAP.n }, t0 = performance.now();
        for (let t = 0; t < sec; t += 3) { poll(); await sleep(3000); }     // tự lấy dữ liệu khu kể cả khi tool đang tắt
        const R = N.rec; N.rec = null;
        // các địa chỉ trang đã gọi trong lúc ghi (cho biết game dùng kênh nào)
        const urls = {};
        try { for (const e of performance.getEntriesByType('resource')) if (e.startTime >= t0) { let p = e.name; try { const u = new URL(e.name); p = u.host + u.pathname; } catch (er) {} urls[p + ' (' + e.initiatorType + ')'] = (urls[p + ' (' + e.initiatorType + ')'] || 0) + 1; } } catch (e) {}
        const o = {
          map: cur.map || mapNow(), khu: zoneUi() || cur.zone, api: cur.api,
          kenh: { fetch: TAP.n.fetch - n0.fetch, xhr: TAP.n.xhr - n0.xhr, ws: TAP.n.ws - n0.ws },
          urls, obstacles: N.obsSrc, fullKeys: N.fullKeys, mobs: S.mobs.slice(0, 3), heroes: S.heroes.slice(0, 2), data: R.items,
        };
        const txt = JSON.stringify(o, null, 1);
        try { await navigator.clipboard.writeText(txt); } catch (e) {}
        console.log('[loot] dữ liệu ghi được:', o);
        return txt;
      },
      // tóm tắt đồ đang rơi: loại, bậc, phẩm chất, và có nhặt hay không
      async scan() {
        await poll();
        const p = curPos(), now = Date.now(), m = {};
        for (const d of S.drops.values()) {
          const t = tierOf(d), w = wanted(d), jg = p ? judge(d, p, now) : null;
          const st = !w ? 'không nhặt (theo bộ lọc)' : !jg ? 'CHƯA CÓ VỊ TRÍ' : (jg.why || 'đi được');
          const k = kindOf(d) + ' | ' + d.type + ' | ' + (d.name || '?') + (t != null ? ' | bậc ' + t : '') + (d.rar ? ' | ' + d.rar : '') + '  →  ' + st;
          m[k] = (m[k] || 0) + 1;
        }
        const lines = Object.entries(m).map(([k, v]) => v + '× ' + k);
        const reds = S.mobs.filter(x => mAlive(x) && isRed(x)).length;
        const gate = [
          'dữ liệu khu: ' + (S.fullT ? Math.round((now - S.fullT) / 1000) + 's trước' : 'CHƯA CÓ'),
          'vị trí: ' + (S.pos ? Math.round((now - S.posT) / 1000) + 's trước' : 'CHƯA CÓ'),
          'id của tôi: ' + (S.myId != null ? S.myId : 'chưa biết'),
          'gục: ' + (isDown() ? 'CÓ' : 'không'),
          'máu: ' + (S.mhp ? Math.round(S.hp / S.mhp * 100) + '%' : '?'),
          'tạm dừng: ' + (paused ? 'CÓ' : 'không'),
        ].join(' | ');
        const head = gate + '\napi: ' + (cur.api || 'CHƯA HỌC ĐƯỢC') + ' | map: ' + (cur.map || '?') + ' | khu: ' + (zoneUi() || cur.zone || '?') +
          '\nquái sống: ' + S.mobs.filter(mAlive).length + ' (đỏ: ' + reds + ') | người chơi trong khu: ' + S.heroes.length +
          '\nvật cản từ game: ' + (N.obs.length ? N.obs.length + ' (' + N.obsSrc.join(', ') + ')' : 'không thấy') + ' | tự học: ' + N.learned.size + ' ô' +
          '\ncửa tránh: ' + (N.portals.length ? N.portals.map(z => (z.kind === 'data' ? 'game' : z.kind === 'learned' ? 'đã học' : 'chỗ vào') + ' (' + Math.round(z.x) + ',' + Math.round(z.y) + ')').join(', ') : 'chưa có');
        if (Object.keys(m).length) console.table(m);
        return head + '\n' + (lines.length ? lines.join('\n') : 'Chưa thấy đồ nào rơi trên đất (trong dữ liệu tool đọc được).');
      },
      async test() {
        if (!S.pos) return 'Chưa có vị trí nhân vật, đợi vài giây rồi thử lại.';
        const K = KEYSETS[cfg.keys];
        const was = paused; paused = true; release(); await autoOff(); await sleep(600);
        const res = [];
        for (const dir of ['right', 'left', 'down', 'up']) {
          const b = { ...S.pos }, tb = S.posT;
          kev('keydown', K[dir]); await sleep(500); kev('keyup', K[dir]); await sleep(900);
          res.push(dir + ': ' + (S.posT === tb ? 'không có vị trí mới' : 'dx=' + Math.round(S.pos.x - b.x) + ' dy=' + Math.round(S.pos.y - b.y)));
        }
        await autoOn(); paused = was;
        return res.join(' | ') + '\nĐúng khi: right dx>0, left dx<0, down dy>0, up dy<0.';
      },
      // chẩn đoán vòng làng: vì sao đang / không ra vào lại
      loopInfo() {
        if (!cfg.fightRun) return 'vòng làng: chưa bật Đánh';
        if (!cfg.pbLoop) return 'vòng làng: TẮT (tick "Chạy vòng làng" bên dưới để tự ra vào map sai)';
        const m = placeKey(), lc = lcState(), tg = [...targetSet()], A = ancientCfg();
        const ready = targetSet().size ? Date.now() - N.mapT > 1200 : S.fullT > N.mapT + 300 && Date.now() - N.mapT > 2500;
        const where = lc === 'fight' ? 'map đánh' : lc === 'village' ? 'làng' : (A && A.urls && A.urls.enter) ? 'map NPC' : fightRe().test(m) ? 'map đánh (theo mã)' : m === cfg.pbVillage ? 'làng (theo mã)' : 'ngoài vòng';
        let why = '';
        if (N.pbBusy) why = 'đang làm';
        else if (where.startsWith('map đánh')) {
          why = !cfg.pbReroll ? 'không ra vào lại (ô "Sai map → ra vào lại" đang tắt)'
            : N.wrongMap === m ? 'SAI MAP → sẽ ra cổng' + (N.pbRetryAt > Date.now() ? ' (thử lại sau ' + Math.ceil((N.pbRetryAt - Date.now()) / 1000) + 's)' : '')
            : N.pbChecked === m ? 'đúng map / đã kiểm tra'
            : N.map !== m ? 'chờ đổi map xong' : !ready ? 'chờ dữ liệu map' : 'sắp kiểm tra';
        }
        const blk = autoBlockReason();
        return 'vòng làng: ' + m + ' · ' + where + ' · cần: ' + (tg.join(', ') || (goodSet().size ? 'hệ ' + [...goodSet()].map(elName).join(', ') : 'map bất kỳ')) + (why ? ' · ' + why : '') + (blk ? ' · chặn Tự đánh: ' + blk : '');
      },
      info() {
        const n = [...S.drops.values()].filter(wanted).length, c = candidates().length;
        return (paused ? '⏸ tạm dừng' : isDown() ? '💀 đang gục' : N.status ? '▶ ' + N.status + (target ? ' #' + target.id : '') : '… chờ') +
          ' | đồ rơi: ' + S.drops.size + ' | khớp lọc: ' + n + ' | đi được: ' + c + ' | vị trí: ' + (S.pos ? Math.round((Date.now() - S.posT) / 1000) + 's' : 'CHƯA CÓ') +
          (N.pollInfo ? ' | dữ liệu khu: ' + N.pollInfo : '') + ' | mã lệnh: ' + (Object.keys(window.__gtCmd || {}).find(k => (window.__gtCmd || {})[k] === 'p') || 'chưa đọc') + ' | đã nhặt: ' + picked + (N.runT && Date.now() - N.runT > 60000 ? ' (' + (picked / ((Date.now() - N.runT) / 60000)).toFixed(1) + '/phút)' : '') +
          ' | máu ' + (S.mhp ? Math.round(S.hp / S.mhp * 100) + '%' : '?') + ' | tự đánh: ' + stName(autoState()) + (am.off ? ' (tool tắt hộ)' : '') +
          (cfg.dodgeHit && HB.err ? ' | né đỏ: ' + HB.err : '') + ' | vật cản: ' + N.obs.length + '+' + N.learned.size + ' | cửa tránh: ' + N.portals.length + (cfg.pickKey ? '' : ' | chưa có phím nhặt');
      },
    };
    log('đã nạp.');
  }

  // ===== giao diện =====
  function build() {
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:228px;bottom:12px;z-index:2147483647;';
    const root = host.attachShadow({ mode: 'open' });
    const n = (k, w = 50) => `<input type="number" data-k="${k}" min="0" style="width:${w}px">`;
    const c = (k, t) => `<label><input type="checkbox" data-k="${k}"> ${t}</label>`;
    root.innerHTML = `
<style>
  *{box-sizing:border-box;font-family:system-ui,sans-serif}
  .fab{background:#2b2f3a;color:#fff;border:1px solid #555;border-radius:20px;padding:8px 14px;cursor:pointer;font-size:13px}
  .fab.on{background:#1f6f43}
  .panel{display:none;width:370px;max-height:78vh;overflow:auto;background:#1b1e27;color:#e6e6e6;border:1px solid #555;border-radius:10px;padding:10px;margin-bottom:8px;font-size:12px}
  .panel.open{display:block}
  h4{margin:0 0 6px;font-size:13px} h5{margin:10px 0 4px;font-size:12px;color:#9fc4ff;border-top:1px solid #333;padding-top:6px}
  label{display:inline-flex;align-items:center;gap:4px;margin:0 8px 5px 0}
  select,input[type=number],input[type=text]{background:#10131a;color:#fff;border:1px solid #444;border-radius:4px;padding:3px 6px;font-size:12px}
  .row{margin:4px 0} .sub{margin-left:18px}
  button.b{background:#3a4156;color:#fff;border:0;border-radius:5px;padding:6px 9px;cursor:pointer;font-size:12px;margin:2px 3px 2px 0}
  button.go{background:#1f6f43} button.stop{background:#a62b2b}
  .out{margin-top:6px;max-height:140px;overflow:auto;background:#10131a;border-radius:5px;padding:4px 6px;white-space:pre-wrap;word-break:break-word;color:#cfe3ff;display:none;user-select:text}
  .status{margin-top:6px;color:#b8d8ff;white-space:pre-wrap;word-break:break-word}
  .note{color:#999;margin-top:6px}
</style>
<div class="panel" id="p">
  <h4>💎 Nhặt đồ</h4>
  <div class="row"><button class="b go" id="tg">▶ Bật nhặt</button><button class="b" id="sn">Xem đồ rơi</button></div>
  <div class="out" id="ot2"></div>
  <div class="status" id="ss">Đang tắt.</div>

  <h5>Nhặt đồ</h5>
  <div class="row">${c('neverAutoOff', '<b>Vừa đánh vừa nhặt</b> (Tự đánh luôn bật, tool bấm chuột dồn về phía đồ)')}</div>
  <div class="row">Nhặt: ${c('egg', '🥚 Trứng')}${c('xu', 'Xu')}${c('stone', 'Đá')}${c('gear', 'Trang bị')}${c('other', 'Khác')}</div>
  <div class="row">${c('prio', 'Ưu tiên: xu → đồ → đá')}${c('xuFar', 'Xu đi xa')}</div>
  <div class="row"><button class="b" id="pa">✅ Nhặt tất cả</button><button class="b" id="pf">Trứng + huyền thoại + xu + đá</button></div>
  <details><summary>Lọc trang bị chi tiết / mã riêng</summary>
    <div class="row">Phẩm chất:</div><div class="row" id="rr"></div>
    <div class="row">Bậc:</div><div class="row" id="tt"></div>
    <div class="row"><label>Mã trứng thêm: <input type="text" data-k="eggCodes" style="width:150px" placeholder="vd: trung_rong"></label></div>
    <div class="row"><label>Mã đá (trống = mọi loại): <input type="text" data-k="stoneCodes" style="width:110px" placeholder="da_12, da_11"></label></div>
    <div class="row"><label>Luôn nhặt: <input type="text" data-k="always" style="width:190px" placeholder="vd: hp_lon"></label></div>
    <div class="row"><label>Không nhặt: <input type="text" data-k="ignore" style="width:180px" placeholder="vd: hp_nho"></label></div>
    <div class="row">${c('lootFew', 'Chỉ nhặt khi quanh đồ ≤')}${n('lootMobMax', 40)}<label>quái · trong ${n('lootMobR')}px</label></div>
    <div class="row"><label>khoảng cách quái đỏ ${n('lootRedR')}px · cửa ra ${n('portalR', 45)}px</label>${c('avoidEntry', 'Tránh chỗ vừa vào map')}</div>
  </details>


<!--FIGHT-->
  <h5>⚔️ Đánh người</h5>
  <div class="row">${c('pvp', '<b>Tự nhắm người chơi khác</b> (kể cả đang đánh quái)')}<label>trong ${n('pvpR')}px</label></div>
  <div class="row sub"><label>thôi khi máu mình &lt; ${n('pvpMinHp', 40)}%</label><button class="b" id="tp">Thử nhắm người</button></div>
  <div class="row sub"><label>Chỉ đánh tên: <input type="text" data-k="pvpOnly" style="width:150px" placeholder="trống = mọi người"></label></div>
  <div class="row sub"><label>Không đánh tên: <input type="text" data-k="pvpSkip" style="width:150px" placeholder="vd: đồng đội, bang"></label></div>

  <h5>Vòng làng (NPC mua thẻ → cổng → map cần vào)</h5>
  <div class="row">${c('pbLoop', '<b>Chạy vòng làng</b>')}<label><b>Map cần vào:</b> <input type="text" data-k="pbTargets" style="width:80px" placeholder="vd: lc-3"></label></div>
  <div class="row sub"><label>ra vào lại tối đa ${n('pbRerollMax', 40)} lần</label><button class="b" id="pn">📍 Ghi vị trí NPC</button><span id="pnv" style="color:#8e97ab"></span></div>
  <div class="row sub" style="color:#8e97ab">Tự quét NPC & cổng, tự đi bằng bấm chuột, tự nhớ tường và đường đi. Cần bật "Tự hồi sinh" để chết xong về làng.</div>
  <details><summary>Cài đặt vòng làng / chẩn đoán</summary>
    <div class="row"><button class="b" id="sc2">Quét màn hình</button>${c('pbAuto', 'Tự quét NPC & cổng')}${c('clickMove', 'Đi bằng bấm chuột')}${c('pbReroll', 'Sai map → ra vào lại')}</div>
    <div class="row"><label>Map NPC: <input type="text" data-k="pbNpcMap" style="width:95px"></label><label>Tên NPC: <input type="text" data-k="pbNpcName" style="width:110px"></label></div>
    <div class="row"><label>Nút mua (theo thứ tự): <input type="text" data-k="pbBuyBtns" style="width:190px"></label></div>
    <div class="row"><label>Làng: <input type="text" data-k="pbVillage" style="width:80px"></label><label>Map đánh (mẫu): <input type="text" data-k="pbFightRe" style="width:90px"></label></div>
    <div class="row"><label>Chữ của cổng: <input type="text" data-k="pbGateWords" style="width:220px"></label></div>
    <div class="row"><button class="b" id="ll">① Học 1 vòng</button><button class="b" id="lc">Xoá vòng đã học</button></div>
    <div class="row" id="macv" style="color:#8e97ab"></div>
    <div class="row" style="color:#8e97ab">Chọn map theo hệ (khi để trống "Map cần vào"):</div>
    <div class="row"><label>Map hợp: <input type="text" data-k="goodEls" style="width:110px" placeholder="vd: Hỏa, Thủy"></label><button class="b" id="ed">Xem hệ</button></div>
    <div class="row"><label>Bảng khắc: <input type="text" data-k="khac" style="width:200px"></label></div>
    <div class="row"><label>Luật: <select data-k="pbRule"><option value="me">Hệ mình khắc hệ map</option><option value="safe">Chỉ cần hệ map không khắc mình</option></select></label></div>
  </details>

  <h5>Hồi sinh / đứng im</h5>
  <div class="row">${c('revive', 'Tự hồi sinh')}<select data-k="reviveMode"><option value="save">về điểm lưu (miễn phí)</option><option value="here">tại chỗ</option><option value="first">nút đầu tiên</option></select><label>sau ${n('reviveDelay', 40)}s</label></div>
  <div class="row">${c('reviveAuto', 'Hồi sinh xong bật Tự đánh')}${c('backToMap', 'Về map vừa gục')}</div>
  <div class="row">${c('idleOn', 'Đứng im quá')}${n('idleMin', 40)}<label>phút →</label>${c('idleAuto', 'bật lại Tự đánh')}${c('idleZone', 'đổi khu')}${c('idleReload', 'F5')}</div>

  <h5>Né</h5>
  <div class="row">${c('dodgeHit', '<b>Né vùng chiêu đỏ</b> (đọc màu đỏ trên màn hình quanh nhân vật)')}</div>

  <details><summary>Phó bản (pb-…) tự vào lại</summary>
    <div class="row">${c('reenter', 'Bị văng / gục ra khỏi phó bản → tự vào lại')}</div>
    <div class="row"><label>chờ ${n('reenterDelay', 40)}s · thử tối đa ${n('reenterMax', 40)} lần</label></div>
    <div class="row"><button class="b" id="le">Học cách vào phó bản</button><button class="b" id="tre">Thử vào lại ngay</button></div>
    <div class="row" id="seqv" style="color:#8e97ab"></div>
  </details>

<!--/FIGHT-->
  <details><summary>Công cụ / chẩn đoán</summary>
    <div class="row"><button class="b" id="ts">Thử phím đi</button><button class="b" id="lk">Học phím nhặt</button><button class="b" id="co">Xoá vật cản đã học (map này)</button></div>
    <div class="row"><button class="b" id="cp">Xoá cửa đã nhớ (map này)</button><button class="b" id="rc">Ghi dữ liệu game (20s)</button></div>
    <div class="row"><label>Phím đi: <select data-k="keys"><option value="wasd">WASD</option><option value="arrows">Mũi tên</option></select></label>
      <label>Dừng nhặt khi máu dưới (%): <input type="number" data-k="minHpPct" data-scale="100" min="0" max="100" style="width:50px"></label></div>
  </details>
  <div class="note">Chạy nhanh (Shift) nằm ở tab 🗑 Vứt đồ. Giữ tab game luôn hiện. Tự động hoá có thể vi phạm luật game.</div>
</div>
<button class="fab" id="fab">💎 Nhặt đồ</button>`;
    buildFight();
    var root2, host2, outId;      // var, không gán ở đây: buildFight() được gọi trước dòng này và đã gán giá trị
    function buildFight() {
      outId = 'ot2';
      host2 = document.createElement('div');
      host2.style.cssText = 'position:fixed;left:228px;bottom:60px;z-index:2147483647;';
      root2 = host2.attachShadow({ mode: 'open' });
      root2.innerHTML = '<style>' + root.querySelector('style').textContent + '</style><div class="panel" id="p2"><h4>⚔️ Đánh</h4>' +
        '<div class="row"><button class="b go" id="tg2">▶ Bật đánh</button></div><div class="out" id="ot3"></div><div class="status" id="ss2">Đang tắt.</div></div>' +
        '<button class="fab" id="fab">⚔️ Đánh</button>';
      const p2 = root2.getElementById('p2'), p1 = root.getElementById('p');
      // chuyển các nút nằm giữa <!--FIGHT--> và <!--/FIGHT-->
      let inside = false;
      for (const n of [...p1.childNodes]) {
        if (n.nodeType === 8 && n.nodeValue === 'FIGHT') { inside = true; n.remove(); continue; }
        if (n.nodeType === 8 && n.nodeValue === '/FIGHT') { inside = false; n.remove(); continue; }
        if (inside) p2.appendChild(n);
      }
      root2.getElementById('fab').onclick = () => p2.classList.toggle('open');
      root2.addEventListener('click', () => { outId = 'ot3'; }, true);
      root.addEventListener('click', () => { outId = 'ot2'; }, true);
      ['keydown', 'keyup', 'keypress'].forEach(t => root2.addEventListener(t, e => e.stopPropagation()));
    }
    const $ = id => root.getElementById(id) || (root2 && root2.getElementById(id));
    const out = t => { const o = $(outId) || $('ot2'); o.style.display = 'block'; o.textContent = t; };
    const bound = [...root.querySelectorAll('[data-k]'), ...(root2 ? root2.querySelectorAll('[data-k]') : [])];
    const syncUI = () => {
      for (const el of bound) {
        const k = el.dataset.k, sc = +(el.dataset.scale || 1);
        if (el.type === 'checkbox') el.checked = !!cfg[k];
        else if (el.type === 'number') el.value = Math.round(cfg[k] * sc * 100) / 100;
        else el.value = cfg[k] ?? '';
      }
      for (const k in rarBox) rarBox[k].checked = !!cfg.rarities[k];
      for (const t in tierBox) tierBox[t].checked = !!cfg.tiers[t];
    };
    for (const el of bound) {
      el.onchange = () => {
        const k = el.dataset.k, sc = +(el.dataset.scale || 1);
        if (el.type === 'checkbox') cfg[k] = el.checked;
        else if (el.type === 'number') { const v = +el.value; cfg[k] = Number.isFinite(v) ? Math.max(0, v) / sc : DEF[k]; if (k === 'maxDist') cfg[k] = Math.max(100, cfg[k]); if (k === 'minHpPct') cfg[k] = Math.min(1, cfg[k]); }
        else cfg[k] = el.value;
        applySets(); store();
      };
    }
    const rarBox = {}, tierBox = {};
    for (const k of Object.keys(RAR)) {
      const l = document.createElement('label'), cb = document.createElement('input'); cb.type = 'checkbox';
      cb.onchange = () => { cfg.rarities[k] = cb.checked; store(); }; l.append(cb, RAR[k]); $('rr').appendChild(l); rarBox[k] = cb;
    }
    for (let t = 1; t <= TIER_MAX; t++) {
      const l = document.createElement('label'), cb = document.createElement('input'); cb.type = 'checkbox';
      cb.onchange = () => { cfg.tiers[t] = cb.checked; store(); }; l.append(cb, String(t)); $('tt').appendChild(l); tierBox[t] = cb;
    }
    syncUI();
    $('pa').onclick = () => {
      Object.assign(cfg, { xu: true, stone: true, stoneCodes: '', gear: true, other: true, egg: true, always: '', ignore: '' });
      for (const k in RAR) cfg.rarities[k] = true; for (let t = 1; t <= TIER_MAX; t++) cfg.tiers[t] = true;
      applySets(); store(); syncUI(); out('Đã chọn nhặt TẤT CẢ (trứng, xu, mọi loại đá, mọi trang bị, vật phẩm khác).');
    };
    $('pf').onclick = () => {
      Object.assign(cfg, { xu: true, stone: true, stoneCodes: '', gear: true, other: false, egg: true, prio: true });
      for (const k in RAR) cfg.rarities[k] = k === 'huyen_thoai'; for (let t = 1; t <= TIER_MAX; t++) cfg.tiers[t] = true;
      applySets(); store(); syncUI(); out('Đã chọn: trứng, trang bị huyền thoại, xu, mọi loại đá (ưu tiên theo thứ tự đó). Không nhặt vật phẩm khác.');
    };

    const refresh = () => {
      const pk = running && !!cfg.pickRun, fg = running && !!cfg.fightRun;
      root.getElementById('fab').classList.toggle('on', pk);
      root2.getElementById('fab').classList.toggle('on', fg);
      $('tg').textContent = pk ? '■ Tắt nhặt' : '▶ Bật nhặt'; $('tg').className = 'b ' + (pk ? 'stop' : 'go');
      $('tg2').textContent = fg ? '■ Tắt đánh' : '▶ Bật đánh'; $('tg2').className = 'b ' + (fg ? 'stop' : 'go');
      const info = running && window.__loot ? window.__loot.info() + (lastMsg ? '\n' + lastMsg : '') : 'Đang tắt.';
      $('ss').textContent = pk ? info : 'Đang tắt.';
      $('ss2').textContent = fg ? info + (window.__loot && window.__loot.loopInfo ? '\n' + window.__loot.loopInfo() : '') : 'Đang tắt.';
    };
    const ensure = () => { if (!window.__loot) createBot(); return window.__loot; };
    const startRun = () => { ensure().start(); running = true; refresh(); };
    $('fab').onclick = () => $('p').classList.toggle('open');
    const applyRun = () => {
      const want = !!(cfg.pickRun || cfg.fightRun);
      if (want && !running) startRun();
      else if (!want && running) { window.__loot.stop(); window.__loot = null; running = false; }
      refresh();
    };
    $('tg').onclick = () => { cfg.pickRun = !(running && cfg.pickRun); store(); applyRun(); };
    $('tg2').onclick = () => { cfg.fightRun = !(running && cfg.fightRun); store(); applyRun(); };
    const temp = async fn => {
      const had = !!window.__loot, b = ensure();
      try { out(await fn(b)); } finally { if (!had && !running) { window.__loot.stop(); window.__loot = null; } }
    };
    $('sn').onclick = () => { out('Đang đọc danh sách đồ rơi...'); temp(async b => { await sleep(2500); return b.scan(); }); };
    $('ts').onclick = () => { out('Đang thử... nhân vật sẽ nhích 4 hướng (đợi vài giây sau khi vào khu để có vị trí).'); temp(b => b.test()); };
    $('lk').onclick = () => { out('Đang học (30 giây): đứng gần 1 món đồ rồi NHẤN PHÍM NHẶT của game.'); temp(b => b.learnKey()); };
    $('rc').onclick = () => { out('Đang ghi 20 giây... hãy đánh quái/boss bình thường để có dữ liệu chiêu.'); temp(async b => 'Đã chép vào clipboard (nếu trình duyệt cho phép). Gửi đoạn này để thêm né chiêu:\n' + await b.record(20)); };
    const showMac = () => {
      let m = null; try { m = JSON.parse(localStorage.getItem(LOOPK) || 'null'); } catch (e) {}
      if (!m) { $('macv').textContent = 'Chưa học vòng nào.'; return; }
      if (m.stages && !m.learning && (m.v || 0) < 3) { repairMac(m); try { localStorage.setItem(LOOPK, JSON.stringify(m)); } catch (e) {} }
      if (m.stages) {
        const st = s => (s.steps || []).map(x => x.kind === 'dom' ? '"' + ((x.el && x.el.text) || 'nút') + '"' : x.kind === 'key' ? 'phím ' + x.k.key : 'bấm bản đồ' + (x.w ? '' : '(màn hình)')).join(' → ') || '(không bấm)';
        $('macv').textContent = 'Đã học:\n' + m.stages.map((s, i) => (i + 1) + ') ' + s.place + ': ' + st(s) + (s.byBtn ? ' ⇒ vào bằng nút' : s.exit ? ' ⇒ cổng (' + s.exit.x + ',' + s.exit.y + ')' : '') + (s.dest ? ' → ' + s.dest : '')).join('\n') + (m.fight ? '\nMap đánh: ' + m.fight : '') +
          (m.fightExit ? '\nCổng ra trong map đánh: (' + m.fightExit.exit.x + ',' + m.fightExit.exit.y + ')' : '\n⚠️ Chưa học cổng ra trong map đánh (lúc học: vào map đánh rồi đi ra cổng về làng 1 lần)');
      } else $('macv').textContent = 'Vòng học theo kiểu cũ (1 chặng) — nên học lại.';
    };
    showMac();
    let learning = false;
    const startLearn = resume => {
      learning = true; $('ll').textContent = '💾 Lưu vòng';
      if (!resume) out('Đang học (tối đa 5 phút, lưu dần trong lúc học). Tự làm 1 lượt như bình thường:\n• ở ng-tnam-ld: bấm NPC Lạc Hầu Già → "Mua & vào ngay" → "Mua & vào"\n• ở lc-lang: đi (hoặc bấm bản đồ) vào cổng\n• vào map đánh rồi ĐI RA cổng về lc-lang 1 lần (để học cổng ra) → tool tự lưu.\nHoặc bấm "💾 Lưu vòng" bất cứ lúc nào để lưu và kết thúc.');
      temp(async b => {
        b.onLearn(t => { $('macv').textContent = t; });       // hiện tiến trình học ngay dưới nút
        const r = await b.learnLoop(resume);
        b.onLearn(null); learning = false; $('ll').textContent = '① Học 1 vòng'; showMac();
        return r;
      });
    };
    $('ll').onclick = () => { if (learning) { if (window.__loot) window.__loot.stopLearn(); } else startLearn(false); };
    // trang tải lại giữa lúc học → học tiếp
    if (ss.get('lootExtLearning')) setTimeout(() => startLearn(true), 2500);
    const showNpc = () => { $('pnv').textContent = cfg.pbNpcPos ? 'đã ghi (' + cfg.pbNpcPos.x + ',' + cfg.pbNpcPos.y + ') ở ' + cfg.pbNpcPos.map : 'chưa ghi'; };
    showNpc();
    $('pn').onclick = () => { out('Bấm vào NPC trên bản đồ trong 30 giây tới (đứng ở map có NPC, NPC đang hiện trên màn hình)...'); temp(async b => { const r = await b.pickNpc(); showNpc(); return r; }); };
    $('tp').onclick =() => { out('Đang thử nhắm người chơi gần nhất...'); temp(async b => { await sleep(800); return b.testPvp(); }); };
    $('sc2').onclick = () => { out('Đang quét...'); temp(async b => { await sleep(800); await b.scan(); return b.scanDiag(); }); };
    $('ed').onclick =() => { out('Đang đọc hệ...'); temp(async b => { await sleep(1500); return b.elemDiag(); }); };
    $('lc').onclick = () => { if (confirm('Xoá vòng làng đã học?')) { try { localStorage.removeItem(LOOPK); localStorage.removeItem('lootExtLoopMaps'); } catch (e) {} showMac(); out('Đã xoá.'); } };
    const showSeq = () => {
      let s = []; try { s = JSON.parse(localStorage.getItem(SEQK) || '[]') || []; } catch (e) {}
      $('seqv').textContent = s.length ? 'Cách vào đã học: ' + s.map(x => '"' + (x.text || x.tag) + '"').join(' → ') : 'Chưa học cách vào → dùng cách mở địa chỉ phó bản.';
    };
    showSeq();
    $('le').onclick = () => { out('Đang học (40 giây): ra ngoài phó bản rồi tự bấm các nút để VÀO phó bản như bình thường.'); temp(async b => { const r = await b.learnEnter(); showSeq(); return r; }); };
    $('tre').onclick = () => {
      if (!running) { out('Bật tool (▶ Bật) trước, rồi bấm lại "Thử vào lại ngay".'); return; }
      out(window.__loot.tryReenter());
    };
    $('cp').onclick = () => {
      const m = mapNow();
      if (!m) { out('Không đọc được mã map từ địa chỉ trang.'); return; }
      if (window.__loot) { out(window.__loot.clearPortals()); return; }
      out('Đã xoá ' + forgetPortals(m) + ' cửa đã nhớ của ' + m + '.');
    };
    $('co').onclick =() => out(window.__loot ? window.__loot.clearObs() : 'Tool đang tắt, chưa có vật cản nào được học.');
    ['keydown', 'keyup', 'keypress'].forEach(t => root.addEventListener(t, e => e.stopPropagation()));
    if (window.__gtHub) { window.__gtHub.add(host); window.__gtHub.add(host2); } else { document.body.appendChild(host); document.body.appendChild(host2); }
    refresh();
    setInterval(refresh, 1000);
    // trang tải lại khi đang chạy (vd: hồi sinh rồi về map) → tự chạy tiếp phần đang bật
    if (ss.get(RUNK) && (cfg.pickRun || cfg.fightRun)) setTimeout(() => { if (!running) { startRun(); lastMsg = 'Tự chạy lại sau khi tải trang'; refresh(); } }, 2500);
  }

  if (document.body) build(); else document.addEventListener('DOMContentLoaded', build);
})();
} catch (e) { console.error("[công cụ game] phần Nhặt + Đánh lỗi:", e); }

// ===================== Săn boss (trước đây: bt.js) =====================
try {
(() => {
  if (window.__btExt) return;
  window.__btExt = true;

  const KEY = 'btExtCfg';
  const DEFS = { cycleZones: true, zoneStart: 1, zones: 30, bossNames: [], homeZone: 1, minHpPct: 0.25, manageAuto: true, bossTimeout: 600000 };
  let EXT_SAVED = { ...DEFS };
  try { EXT_SAVED = { ...DEFS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch (e) {}
  if (EXT_SAVED.bossTimeout === 180000) EXT_SAVED.bossTimeout = 600000;     // giá trị mặc định cũ (3 phút) → mặc định mới (10 phút)
  const saveCfg = () => { try { localStorage.setItem(KEY, JSON.stringify(EXT_SAVED)); } catch (e) {} };
  const nhatKey = () => { try { return JSON.parse(localStorage.getItem('lootExtCfg2') || localStorage.getItem('lootExtCfg') || '{}').pickKey || null; } catch (e) { return null; } };
  let lastMsg = '';
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function createBot() {
    if (window.__bt) window.__bt.stop();

    const BASE = location.origin;
    const mapName = () => (location.pathname.match(/\/ngoai-gioi\/([^/?#]+)/) || [])[1] || null;

    const cfg = {
      zones: 30, homeZone: 1,            // vòng lặp khu 1 → 30 → 1; khu 1 là nơi farm quái nhỏ chờ boss
      bossRe: /boss/i,                   // khớp với trường LOẠI quái (m[12]) để nhận ra boss (dùng __bt.scan() để kiểm tra)
      bossNames: [],                     // hoặc liệt kê tên (m[1]) của boss, vd ['ten_boss']
      manageAuto: true,                  // tự tắt/bật nút TỰ ĐÁNH khi cần đi bộ
      keys: 'wasd',
      hopGap: 3500,                      // tối thiểu giữa 2 lần chuyển khu (ms)
      settleMs: 1500, dataWait: 8000, skipFull: true,
      bossRange: 220, bossLeash: 450,    // tới cách boss chừng này thì bật TỰ ĐÁNH; xa hơn leash thì đi lại gần
      bossTimeout: 600000,               // đánh 1 boss quá lâu thì bỏ qua
      lootWait: 3500, lootMax: 25000,    // chờ đồ rơi sau khi boss chết, và thời gian nhặt tối đa
      farmCheck: 2500, pollMs: 2500,
      reach: 50, axis: 14, pickWait: 2500, pickEvery: 250,
      pickKey: (window.__loot && window.__loot.cfg && window.__loot.cfg.pickKey) || (window.__nhat && window.__nhat.cfg && window.__nhat.cfg.pickKey) || null,   // phím nhặt đã học (nếu có)
      maxDist: 2000, walkTimeout: 30000, stuckMs: 2000,
      minHpPct: 0.25,                    // máu dưới mức này thì tạm dừng toàn bộ tool
      useKillEvent: false,               // chỉ bật nếu __bt.scan() báo không đọc được dữ liệu khu
      legendRe: /huyen_thoai|huyền thoại|legend/i, legendNum: null,
      autoOnRe: /^(is-)?(on|active|running|enabled|engaged|armed)$/i,
      warnDom: false,                    // true = cảnh báo khi giao diện có khung boss mà dữ liệu không có boss sống
      tick: 50, debug: true,
    };

    Object.assign(cfg, EXT_SAVED);
    if (!cfg.pickKey) cfg.pickKey = nhatKey();

    const KEYSETS = {
      wasd: { up: { key: 'w', code: 'KeyW', keyCode: 87 }, down: { key: 's', code: 'KeyS', keyCode: 83 }, left: { key: 'a', code: 'KeyA', keyCode: 65 }, right: { key: 'd', code: 'KeyD', keyCode: 68 } },
      arrows: { up: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 }, down: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 }, left: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 }, right: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 } },
    };

    const S = { mobs: [], drops: new Map(), heroes: [], pos: null, posT: 0, hp: null, mhp: null, ms: 280, down: false, myId: null, fullT: 0, fullZone: null, khuUrl: null };
    const held = { up: false, down: false, left: false, right: false };
    const bad = new Map(), seenLegend = new Set();
    const am = { disabled: false, assumed: true, initial: true, coolUntil: 0, fails: 0 };
    let lastDomWarn = 0, on = true, paused = true, hopping = false, lastHop = 0, hopFails = 0, pollFails = 0, picked = 0, kills = 0, lastPicked = null, warnedHp = false;

    const log = (...a) => { if (cfg.debug) console.log('[bt]', ...a); try { lastMsg = a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' '); } catch (e) {} };
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const typing = () => { const a = document.activeElement; return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable); };
    const press = el => {
      for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) {
        const C = t.startsWith('pointer') ? PointerEvent : MouseEvent;
        el.dispatchEvent(new C(t, { bubbles: true, cancelable: true, composed: true, view: window, button: 0, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
      }
      el.click();
    };

    // ===== khu hiện tại: đọc từ giao diện =====
    const curZone = () => {
      const b = document.querySelector('button.scene-zone');
      const m = b && (b.textContent || '').match(/Khu\s*(\d+)/);
      return m ? +m[1] : S.fullZone;
    };

    // ===== nút TỰ ĐÁNH =====
    const BASE_CLS = new Set(['ng-slot', 'is-auto', 'kbd-focus', 'interactive']);
    const autoBtn = () => document.querySelector('.ng-slot.is-auto');
    function autoState() {
      const b = autoBtn(); if (!b) return null;
      const ap = b.getAttribute('aria-pressed') ?? b.getAttribute('aria-checked');
      if (ap != null) return ap === 'true';
      const extra = [...b.classList].filter(c => !BASE_CLS.has(c));
      if (extra.some(c => cfg.autoOnRe.test(c))) return true;
      if (extra.length === 0) return false;
      return null;
    }
    const autoNow = () => { const s = autoState(); return s === null ? am.assumed : s; };
    const btnSig = () => { const b = autoBtn(); return b ? b.className + '|' + b.getAttribute('aria-pressed') + '|' + (b.textContent || '').replace(/\s+/g, ' ') : ''; };
    // Nút TỰ ĐÁNH: bật = class "is-on", tắt = không có. Bấm xong game đổi nút sau ~0,2 giây (có thể chậm hơn khi máy nặng),
    // nên chờ tới khi trạng thái ĐÚNG ý muốn thay vì chỉ so sánh nút trước/sau 0,35 giây rồi bỏ cuộc.
    async function setAuto(want) {
      if (!cfg.manageAuto || am.disabled || Date.now() < am.coolUntil || autoNow() === want) return;
      const b = autoBtn();
      if (!b) { log('⚠️ Không thấy nút TỰ ĐÁNH, ngừng quản lý tự đánh'); am.disabled = true; return; }
      for (let attempt = 0; attempt < 2; attempt++) {
        press(b);
        const t0 = Date.now();
        while (Date.now() - t0 < 1500) { await sleep(100); if (autoNow() === want) { am.assumed = want; am.fails = 0; log(want ? '▶ Bật TỰ ĐÁNH' : '⏸ Tắt TỰ ĐÁNH'); return; } }
        await sleep(500);                                           // kiểm tra lại trước khi bấm lần 2 (tránh bấm đúp khi nút đổi chậm)
        if (autoNow() === want) { am.assumed = want; am.fails = 0; log(want ? '▶ Bật TỰ ĐÁNH (nút đổi chậm)' : '⏸ Tắt TỰ ĐÁNH (nút đổi chậm)'); return; }
      }
      am.assumed = autoNow();
      am.coolUntil = Date.now() + 10000;
      if (++am.fails >= 5) { am.disabled = true; log('⚠️ Bấm nút TỰ ĐÁNH 5 đợt liền mà vẫn không đổi, ngừng quản lý tự đánh. Gõ __bt.autoInfo()'); }
      else log('⚠️ Bấm nút TỰ ĐÁNH hai lần mà chưa ' + (want ? 'bật' : 'tắt') + ' được, thử lại sau 10 giây (lần ' + am.fails + '/5)');
    }

    // ===== đọc dữ liệu game =====
    const setPos = (x, y) => { S.pos = { x, y }; S.posT = Date.now(); };
    function onFull(f) {
      if (!f) return;
      const now = Date.now();
      S.mobs = f.mobs || []; S.heroes = f.heroes || [];
      if (f.me) {
        S.ms = f.me.ms || S.ms; S.hp = f.me.hp; S.mhp = f.me.mhp; S.down = !!f.me.dn;
        const h = S.heroes.find(h => h[6] === f.me.x && h[7] === f.me.y);
        if (h) S.myId = h[0];
        setPos(f.me.x, f.me.y);
      }
      const fresh = new Map();
      for (const a of (f.drops || []))
        fresh.set(a[0], { id: a[0], type: a[1], amt: a[2], x: a[3], y: a[4], owner: a[5], protect: a[6], ttl: a[7], rar: a[8], name: a[10] || '', t: now });
      S.drops = fresh; S.fullT = now; S.fullZone = f.z;
    }
    function onPacket(pk) {
      if (!pk) return;
      const now = Date.now();
      for (const e of (pk.ev || [])) {
        if (e[0] === 'd') S.drops.set(e[1], { id: e[1], type: e[2], amt: e[3], x: e[4], y: e[5], owner: e[6], protect: e[7], ttl: e[8], rar: e[9], name: e[11] || '', t: now });
        else if (e[0] === 'p') { S.drops.delete(e[1]); if (e[2] === S.myId) lastPicked = { id: e[1], t: now }; }
        else if (e[0] === 'dx') S.drops.delete(e[1]);
        else if (e[0] === 'k' && cfg.useKillEvent) { const m = S.mobs.find(m => m[0] === e[1]); if (m) m[5] = 0; }
      }
      const me = pk.me && S.myId != null ? pk.me[S.myId] : null;
      if (me) { S.hp = me.hp; S.mhp = me.mhp; S.ms = me.ms || S.ms; S.down = !!me.dn; }
    }
    const prev = window.__btOrigFetch || window.fetch;
    window.__btOrigFetch = prev;
    const wrapped = async function (...a) {
      const url = String((a[0] && a[0].url) || a[0]);
      const body = a[1] && a[1].body;
      if (typeof body === 'string' && url.includes('/lenh')) {
        try { for (const c of (JSON.parse(body).c || [])) if (((window.__gtCmd || {})[c[0]] || c[0]) === 'p') setPos(c[1], c[2]); } catch (e) {}
      }
      const res = await prev.apply(this, a);
      try {
        if (url.includes('/khu?zone=')) {
          S.khuUrl = new URL(url, location.href).href.split('?')[0];
          window.__gtObserveResponse(res, window.__gtReadJSON, j => onFull((j.data || {}).full));
        } else if (/\/vao(\?|$)/.test(url)) {
          window.__gtObserveResponse(res, window.__gtReadJSON, j => onFull((j.data || {}).full));
        } else if (url.includes('/lenh')) {
          window.__gtObserveResponse(res, window.__gtReadJSON, j => onPacket((j.data || {}).packet));
        }
      } catch (e) {}
      return res;
    };
    window.fetch = wrapped;

    // làm mới dữ liệu khu hiện tại (GET giống game vẫn làm)
    async function poll() {
      const z = curZone(); if (!z || !mapName()) return false;
      const base = S.khuUrl || (BASE + '/ngoai-gioi/' + mapName() + '/khu');
      try {
        const r = await prev(base + '?zone=' + z, { credentials: 'include' });
        if (!r.ok) { if (pollFails++ < 2) log('⚠️ GET /khu lỗi ' + r.status + ' (' + base + ')'); return false; }
        const f = ((await r.json()).data || {}).full;
        if (f) { onFull(f); pollFails = 0; return true; }
      } catch (e) { if (pollFails++ < 2) log('⚠️ GET /khu lỗi:', e.message); }
      return false;
    }
    let polling = false;
    const pollTimer = setInterval(async () => {
      if (!on || paused || hopping || document.hidden || polling) return;
      polling = true; try { await poll(); } finally { polling = false; }
    }, cfg.pollMs);

    // ===== boss =====
    const NOT_BOSS = ['normal', 'elite'];   // loại quái KHÔNG phải boss; mọi loại khác (vd "boss") được coi là boss
    const isBoss = m => window.__gtBossCore.isBoss(m, cfg.bossNames);
    const findBoss = () => (S.fullZone === curZone() && S.mobs.find(m => isBoss(m) && m[5] > 0)) || null;

    // khung mục tiêu boss trên giao diện (chỉ dùng để đối chiếu, không dùng để quyết định)
    const domBoss = () => {
      const t = document.querySelector('.ng-target.is-boss'); if (!t) return null;
      const txt = t.textContent || '', m = txt.match(/(\d[\d.,]*)\s*\/\s*(\d[\d.,]*)\s*$/), n = x => +String(x).replace(/[.,]/g, '');
      return { text: txt.slice(0, 90), cur: m ? n(m[1]) : null, max: m ? n(m[2]) : null };
    };

    // ===== di chuyển =====
    const kev = (type, k) => (document.querySelector('.scene-canvas') || document.body).dispatchEvent(new KeyboardEvent(type, { key: k.key, code: k.code, keyCode: k.keyCode, which: k.keyCode, bubbles: true, cancelable: true, composed: true }));
    function setHeld(want) {
      const K = KEYSETS[cfg.keys] || KEYSETS.wasd;
      for (const d of ['up', 'down', 'left', 'right']) {
        if (want[d] && !held[d]) { held[d] = true; kev('keydown', K[d]); }
        else if (!want[d] && held[d]) { held[d] = false; kev('keyup', K[d]); }
      }
    }
    const release = () => setHeld({});
    function curPos() {
      if (!S.pos) return null;
      const dt = Math.min((Date.now() - S.posT) / 1000, 0.5);
      const vx = (held.right ? 1 : 0) - (held.left ? 1 : 0), vy = (held.down ? 1 : 0) - (held.up ? 1 : 0);
      const v = (S.ms || 280) / (Math.hypot(vx, vy) || 1);
      return { x: S.pos.x + vx * v * dt, y: S.pos.y + vy * v * dt };
    }
    // đi tới mục tiêu getT() = {x,y}; trả về 'ok' | 'gone' | 'timeout' | 'stuck' | 'abort'
    async function walkTo(getT, reach, timeout, abort) {
      let t0 = Date.now(); let prog = { t: t0, d: Infinity };
      while (on) {
        if (paused || (abort && abort())) { release(); return 'abort'; }
        if (lootBusy()) { release(); await sleep(150); t0 += 150; prog = { t: prog.t + 150, d: prog.d }; continue; }
        const T = getT(); if (!T) { release(); return 'gone'; }
        const p = curPos(); if (!p) { await sleep(100); continue; }
        const dx = T.x - p.x, dy = T.y - p.y, dist = Math.hypot(dx, dy), now = Date.now();
        if (dist <= reach) { release(); return 'ok'; }
        if (now - t0 > timeout) { release(); return 'timeout'; }
        if (now - prog.t > cfg.stuckMs) { if (prog.d - dist < 15) { release(); return 'stuck'; } prog = { t: now, d: dist }; }
        setHeld({ left: dx < -cfg.axis, right: dx > cfg.axis, up: dy < -cfg.axis, down: dy > cfg.axis });
        await sleep(cfg.tick);
      }
      release(); return 'abort';
    }

    // ===== nhặt đồ HUYỀN THOẠI =====
    const isLegend = d => (cfg.legendNum != null && d.rar === cfg.legendNum) || (typeof d.rar === 'string' && cfg.legendRe.test(d.rar));
    function legendCands() {
      const p = curPos(), now = Date.now(); if (!p) return [];
      const out = [];
      for (const d of S.drops.values()) {
        if (!isLegend(d)) continue;
        const el = now - d.t, ttl = d.ttl - el, prot = d.protect - el;
        const dist = Math.hypot(d.x - p.x, d.y - p.y), eta = dist / (S.ms || 280) * 1000;
        if ((bad.get(d.id) || 0) > now || dist > cfg.maxDist || ttl < eta + 1500 || (prot > 0 && d.owner !== S.myId && prot > eta)) continue;
        out.push({ ...d, dist });
      }
      return out.sort((a, b) => a.dist - b.dist);
    }
    async function pickOne(d) {
      log('💎 Đi nhặt ' + (d.name || d.type) + ' #' + d.id + ', cách ' + Math.round(d.dist));
      const r = await walkTo(() => S.drops.has(d.id) ? { x: d.x, y: d.y } : null, cfg.reach, cfg.walkTimeout);
      if (r === 'gone') { log('… #' + d.id + ' biến mất trước khi tới (có người nhặt hoặc hết hạn)'); return false; }
      if (r !== 'ok') { bad.set(d.id, Date.now() + 60000); log('⛔ Không tới được #' + d.id + ' (' + r + ')'); return false; }
      const t0 = Date.now(); let last = 0;
      while (on && !paused && Date.now() - t0 < cfg.pickWait) {
        if (!S.drops.has(d.id)) return true;
        if (cfg.pickKey && Date.now() - last > cfg.pickEvery) { last = Date.now(); kev('keydown', cfg.pickKey); setTimeout(() => kev('keyup', cfg.pickKey), 60); }
        await sleep(100);
      }
      if (!S.drops.has(d.id)) return true;
      bad.set(d.id, Date.now() + 30000);
      log('⚠️ Tới sát #' + d.id + ' nhưng chưa nhặt được' + (cfg.pickKey ? '' : ' (chưa có phím nhặt: __bt.cfg.pickKey = {key:" ",code:"Space",keyCode:32})'));
      return false;
    }
    async function lootAll(maxMs) {
      const t0 = Date.now(); let any = false;
      while (on && !paused && Date.now() - t0 < maxMs) {
        const c = legendCands()[0]; if (!c) break;
        if (!any) { any = true; await setAuto(false); }
        if (await pickOne(c)) { picked++; log('✅ Đã nhặt ' + (c.name || c.type) + ' (tổng ' + picked + ')'); }
      }
      return any;
    }

    // ===== chuyển khu bằng giao diện (giống người chơi bấm nút chọn khu) =====
    async function gotoZone(n) {
      if (curZone() === n) return true;
      const isOpen = () => document.querySelector('.scene-zone-panel.is-open');
      const btn = document.querySelector('button.scene-zone');
      if (!btn) { log('⚠️ Không thấy nút chọn khu'); return false; }
      if (!isOpen()) { press(btn); await sleep(450); }
      const it = [...document.querySelectorAll('.scene-zone__item')].find(x => ((x.querySelector('.scene-zone__n') || {}).textContent || '').trim() === 'Khu ' + n);
      if (!it) { log('⚠️ Không thấy ô "Khu ' + n + '" trong bảng chọn khu'); if (isOpen()) press(btn); return 'missing'; }
      const c = (((it.querySelector('.scene-zone__c') || {}).textContent) || '').match(/(\d+)\s*\/\s*(\d+)/);
      if (cfg.skipFull && c && +c[1] >= +c[2]) { log('… Khu ' + n + ' đầy (' + c[0] + '), bỏ qua'); if (isOpen()) press(btn); return 'full'; }
      press(it);
      for (let i = 0; i < 30 && curZone() !== n; i++) await sleep(150);
      await sleep(300);
      if (isOpen()) { press(btn); await sleep(300); }
      if (curZone() !== n) { log('⚠️ Bấm "Khu ' + n + '" nhưng chưa đổi khu'); return false; }
      return true;
    }
    async function waitData(zone, since) {
      const t0 = Date.now();
      while (Date.now() - t0 < cfg.dataWait) { if (S.fullZone === zone && S.fullT >= since) return true; await sleep(150); }
      return poll();
    }
    async function hop() {
      hopping = true;
      try {
        release();
        if (lootActive()) await waitLootIdle(cfg.lootMax);
        const z = curZone() || cfg.homeZone;
        // tab "Boss các khu" đang bật và biết khu có boss sống → đi thẳng tới đó
        const bw = watchZone();
        if (bw && bw >= cfg.zoneStart && bw <= cfg.zones && bw !== z) {
          const gap = cfg.hopGap - (Date.now() - lastHop); if (gap > 0) await sleep(gap);
          const since = Date.now();
          const r = await gotoZone(bw);
          lastHop = Date.now();
          if (r === true) { hopFails = 0; log('📡 Dò boss báo khu ' + bw + ' có boss → đã sang'); await waitData(bw, since); await sleep(cfg.settleMs); return bw; }
        }
        for (const tz of window.__gtBossCore.zoneOrder(z, cfg.zoneStart, cfg.zones)) {
          if (!on || paused) return null;
          const gap = cfg.hopGap - (Date.now() - lastHop); if (gap > 0) await sleep(gap);
          const since = Date.now();
          if (!on || paused) return null;
          const r = await gotoZone(tz);
          lastHop = Date.now();
          if (r === true) { hopFails = 0; log('➡️ Đã vào khu ' + tz); await waitData(tz, since); await sleep(cfg.settleMs); return tz; }
          if (r !== 'full' && r !== 'missing') break;
        }
        if (++hopFails >= 3) { paused = true; log('⛔ Chuyển khu lỗi 3 lần liên tiếp, đã tạm dừng. Gõ __bt.hopInfo() và gửi mình kết quả.'); }
        return null;
      } finally { hopping = false; }
    }

    // ===== đánh boss =====
    // tool Nhặt đồ (loot.js) được ưu tiên: khi nó còn việc thì Săn boss đứng chờ
    const lootActive = () => !!(window.__loot && typeof window.__loot.isPaused === 'function' && !window.__loot.isPaused());
    const lootBusy = () => lootActive() && typeof window.__loot.busy === 'function' && window.__loot.busy();
    async function waitLootIdle(maxMs) {
      const t0 = Date.now(); let idleSince = 0;
      while (on && !paused && Date.now() - t0 < maxMs) {
        if (lootBusy()) idleSince = 0; else { if (!idleSince) idleSince = Date.now(); if (Date.now() - idleSince > 1500) return true; }
        await sleep(250);
      }
      return false;
    }
    // gục = màn hình hồi sinh (ng-dead__btn) đang hiện; dữ liệu 'dn' không tự trở về false sau khi hồi sinh
    const isDown = () => [...document.querySelectorAll('.ng-dead__btn')].some(b => b.isConnected && b.getClientRects().length > 0);
    const lowHp = () => S.mhp && S.hp != null && S.hp / S.mhp < cfg.minHpPct;
    async function fightBoss(boss) {
      const id = boss[0], zone0 = curZone(); let t0 = Date.now();
      const bm = () => S.mobs.find(m => m[0] === id);
      log('⚔️ Boss ' + boss[1] + ' lv' + boss[2] + ' tại (' + boss[3] + ',' + boss[4] + '), khu ' + zone0);
      let tried = false;
      while (on) {
        if (paused) { release(); return 'abort'; }
        if (lootBusy()) { release(); await sleep(200); t0 += 200; continue; }
        if (curZone() !== zone0) { release(); return 'left'; }
        const m = bm();
        if (!m || m[5] <= 0) { release(); log('☠️ Boss đã hết (chết hoặc biến mất)'); return 'dead'; }
        if (isDown()) { release(); return 'down'; }
        if (lowHp()) { release(); return 'lowhp'; }
        if (Date.now() - t0 > cfg.bossTimeout) { release(); log('⏱ Đánh boss quá lâu, bỏ qua'); return 'timeout'; }
        const p = curPos(), dist = p ? Math.hypot(m[3] - p.x, m[4] - p.y) : Infinity;
        if (!tried || dist > cfg.bossLeash) {
          tried = true;
          await setAuto(false);
          const r = await walkTo(() => { const x = bm(); return x && x[5] > 0 ? { x: x[3], y: x[4] } : null; }, cfg.bossRange, 20000);
          if (r !== 'ok' && r !== 'gone') log('… chưa tiến sát được boss (' + r + '), để TỰ ĐÁNH lo');
        }
        await setAuto(true);
        await sleep(700);
      }
      return 'abort';
    }

    // ===== farm quái nhỏ ở khu nhà, chờ boss xuất hiện =====
    const watchZone = () => { try { return (window.__bossWatch && window.__bossWatch.bestZone(curZone())) || null; } catch (e) { return null; } };
    async function farm() {
      await setAuto(true);
      log('🌾 Khu ' + cfg.homeZone + ' chưa có boss, farm quái nhỏ (TỰ ĐÁNH) cho tới khi boss xuất hiện');
      while (on && !paused) {
        if (findBoss()) return 'boss';
        if (watchZone()) return 'watch';         // khu khác có boss sống → rời khu nhà
        if (curZone() !== cfg.homeZone) return 'moved';
        if (isDown() || lowHp()) return 'bad';
        if (!lootActive() && legendCands().length) { await lootAll(cfg.lootMax); await setAuto(true); }
        await sleep(cfg.farmCheck);
      }
    }

    // ===== vòng lặp chính =====
    async function main() {
      while (on) {
        await sleep(250);
        try {
          if (paused || typing() || document.hidden || window.__gtTravel?.diagnostics().moving) { release(); continue; }
          if (lootBusy()) { release(); continue; }                       // Nhặt đồ đang làm việc: đứng chờ
          for (const d of S.drops.values()) if (isLegend(d) && !seenLegend.has(d.id)) { seenLegend.add(d.id); log('💎 Thấy đồ huyền thoại: ' + (d.name || d.type) + ' #' + d.id); }
          if (isDown()) { release(); if (!warnedHp) { warnedHp = true; log('💀 Nhân vật đang gục, chờ'); } continue; }
          if (lowHp()) { release(); paused = true; log('⚠️ Máu thấp (' + Math.round(S.hp / S.mhp * 100) + '%), ĐÃ TẠM DỪNG tool. Gõ __bt.resume() khi ổn.'); await setAuto(am.initial); continue; }
          warnedHp = false;
          const z = curZone(); if (!z) continue;
          if (S.fullZone !== z) { if (!(await poll())) await waitData(z, 0); continue; }
          const boss = findBoss();
          if (!boss && cfg.warnDom) {
            const db = domBoss();
            if (db && db.cur > 0 && Date.now() - lastDomWarn > 15000) {
              lastDomWarn = Date.now();
              log('⚠️ Giao diện có khung boss (' + db.text + ') nhưng dữ liệu khu không có boss sống. Mục boss trong dữ liệu: ' + JSON.stringify(S.mobs.filter(isBoss)));
            }
          }
          if (boss) {
            const r = await fightBoss(boss);
            if (r === 'dead') {
              kills++; log('🏆 Đã hạ boss khu ' + z + ' (tổng ' + kills + '). Chờ đồ rơi...');
              if (lootActive()) { await sleep(cfg.lootWait); await waitLootIdle(cfg.lootMax); }       // Nhặt đồ đang bật: nó nhặt, mình chờ
              else { await setAuto(false); await sleep(cfg.lootWait); await lootAll(cfg.lootMax); }
            }
            if (paused || !on || r === 'down' || r === 'lowhp' || r === 'left') continue;
            await hop(); continue;
          }
          if (!cfg.cycleZones && z === cfg.homeZone && !watchZone()) { await farm(); continue; }
          await hop();
        } catch (e) { log('Lỗi vòng lặp:', e && e.message || e); await sleep(1000); }
      }
    }
    main();

    // ===== lệnh điều khiển =====
    window.__bt = {
      cfg,
      start() { if (typeof window.__gtPW !== 'function' && !window.MEONO_VIEW) { log('Cần mở bằng bản thử để game nhận phím/chuột.'); return; } paused = false; am.initial = autoNow(); console.log('[bt] BẮT ĐẦU. Dừng tạm: __bt.pause() | dừng hẳn: __bt.stop()'); },
      pause() { paused = true; release(); setAuto(am.initial); console.log('[bt] tạm dừng (TỰ ĐÁNH được trả về trạng thái ban đầu)'); },
      resume() { paused = false; console.log('[bt] chạy tiếp'); },
      stop() {
        on = false; paused = true; clearInterval(pollTimer); release(); setAuto(am.initial);
        if (window.fetch === wrapped) window.fetch = prev;
        console.log('[bt] đã dừng');
      },
      // kiểm tra dữ liệu: boss có được nhận ra không, GET /khu có chạy không, loại quái và đồ rơi
      async scan() {
        const ok = await poll();
        const age = S.fullT ? Math.round((Date.now() - S.fullT) / 1000) : null;
        const head = 'map=' + mapName() + ' | khu (giao diện)=' + curZone() + ' | khu của dữ liệu=' + S.fullZone + ' | GET /khu: ' + (ok ? 'OK' : 'LỖI/không có') + ' | dữ liệu cũ ' + age + 's';
        const m = {};
        for (const x of S.mobs) {
          const k = x[1] + ' | loại=' + JSON.stringify(x[12]) + ' | lv' + x[2] + (x[5] > 0 ? '' : ' | hp=0');
          const e = m[k] || (m[k] = { so_luong: 0, maxhp: 0, boss: isBoss(x) ? 'CÓ' : '' });
          e.so_luong++; e.maxhp = Math.max(e.maxhp, x[6] || 0);
        }
        console.table(m);
        const b = findBoss();
        const bossRows = S.mobs.filter(isBoss).map(x => x[1] + ' lv' + x[2] + ' hp ' + x[5] + '/' + x[6] + ' trạng thái=' + x[7] + ' (' + x[8] + ',' + x[9] + ')' + (x[5] > 0 ? ' SỐNG' : ' hp=0'));
        const db = domBoss();
        const lines = Object.entries(m).slice(0, 12).map(([k, v]) => v.so_luong + '× ' + k + ' | maxhp ' + v.maxhp + (v.boss ? '  ← BOSS' : ''));
        const text = head + '\n' +
          (b ? '✔ Boss SỐNG: ' + b[1] + ' lv' + b[2] + ' hp ' + b[5] + '/' + b[6] : '✘ Không có boss sống trong dữ liệu khu.') + '\n' +
          (bossRows.length ? 'Mục boss trong dữ liệu: ' + bossRows.join(' ; ') : 'Không có mục boss nào trong dữ liệu.') + '\n' +
          (db ? 'Khung boss trên giao diện: ' + db.text : 'Giao diện không có khung boss.') + '\n' + lines.join('\n');
        console.log('[bt]\n' + text);
        const dr = {};
        for (const d of S.drops.values()) { const k = d.type + ' | ' + (d.name || '?') + ' | hiếm=' + JSON.stringify(d.rar) + (isLegend(d) ? ' ✔' : ''); dr[k] = (dr[k] || 0) + 1; }
        if (Object.keys(dr).length) console.table(dr);
        return { poll: ok, boss: !!b, text };
      },
      async goto(n) { hopping = true; try { const since = Date.now(); const r = await gotoZone(n); if (r === true) await waitData(n, since); console.log('[bt] goto ' + n + ' →', r, '| khu hiện tại:', curZone()); return r; } finally { hopping = false; } },
      setKey(key, code, keyCode) { cfg.pickKey = { key, code, keyCode }; console.log('[bt] đã đặt phím nhặt:', key); },
      autoInfo() { const b = autoBtn(); console.log(b ? b.outerHTML : 'Không thấy nút TỰ ĐÁNH'); console.log('trạng thái đoán:', autoState(), '| giả định:', am.assumed, '| ngừng quản lý:', am.disabled); },
      hopInfo() { const p = document.querySelector('.scene-zone-panel'); console.log(document.querySelector('button.scene-zone') ? document.querySelector('button.scene-zone').outerHTML : 'Không thấy button.scene-zone'); console.log(p ? p.outerHTML.slice(0, 1500) : 'bảng chọn khu đang đóng'); },
      info() {
        return (paused ? '⏸ tạm dừng' : '▶ đang chạy') + ' | khu ' + curZone() + ' | boss: ' + (findBoss() ? 'có' : 'chưa') +
          ' | máu ' + (S.mhp ? Math.round(S.hp / S.mhp * 100) + '%' : '?') + ' | đã hạ ' + kills + ' | nhặt ' + picked +
          ' | tự đánh: ' + (autoNow() ? 'bật' : 'tắt') + (cfg.pickKey ? '' : ' | ⚠ chưa có phím nhặt');
      },
      isPaused() { return paused; },
      state() {
        const s = { bat: on, tamDung: paused, khu: curZone(), duLieuKhu: S.fullZone, boss: !!findBoss(), mau: S.mhp ? Math.round(S.hp / S.mhp * 100) + '%' : null,
                    daHaBoss: kills, daNhat: picked, tuDanh: autoNow(), phimNhat: cfg.pickKey && cfg.pickKey.key };
        console.log('[bt] trạng thái:', s); return s;
      },
    };
  }

  // ===== giao diện =====
  function build() {
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:352px;bottom:12px;z-index:2147483647;';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
<style>
  *{box-sizing:border-box;font-family:system-ui,sans-serif}
  .fab{background:#2b2f3a;color:#fff;border:1px solid #555;border-radius:20px;padding:8px 14px;cursor:pointer;font-size:13px}
  .fab.on{background:#1f6f43}
  .panel{display:none;width:340px;background:#1b1e27;color:#e6e6e6;border:1px solid #555;border-radius:10px;padding:10px;margin-bottom:8px;font-size:12px}
  .panel.open{display:block}
  h4{margin:0 0 8px;font-size:13px}
  label{display:inline-flex;align-items:center;gap:4px;margin:0 8px 6px 0}
  input[type=text],input[type=number]{background:#10131a;color:#fff;border:1px solid #444;border-radius:4px;padding:3px 6px;font-size:12px}
  .row{margin:6px 0}
  button.b{background:#3a4156;color:#fff;border:0;border-radius:5px;padding:6px 9px;cursor:pointer;font-size:12px;margin:2px 3px 2px 0}
  button.go{background:#1f6f43} button.stop{background:#a62b2b}
  .out{margin-top:6px;max-height:130px;overflow:auto;background:#10131a;border-radius:5px;padding:4px 6px;white-space:pre-wrap;word-break:break-word;color:#cfe3ff;display:none}
  .status{margin-top:6px;color:#b8d8ff;white-space:pre-wrap;word-break:break-word}
  .note{color:#999;margin-top:6px}
</style>
<div class="panel" id="p">
  <h4>⚔️ Săn boss theo khu 1 → 30 (+ nhặt huyền thoại)</h4>
  <div class="row"><button class="b" id="sc">🔍 Quét boss</button><button class="b go" id="tg">▶ Chạy</button><button class="b stop" id="st">■ Tắt hẳn</button></div>
  <div class="row"><label><input type="checkbox" id="cycle"> Tự đổi khu khi hết boss</label></div>
  <div class="row"><label><input type="checkbox" id="sprint"> Giữ Shift chạy nhanh</label></div>
  <div class="row"><label>Từ khu <input type="number" id="zs" min="1" max="60" style="width:50px"></label><label>đến <input type="number" id="ze" min="1" max="60" style="width:50px"></label></div>
  <div class="row"><label>Khu nhà (farm chờ boss): <input type="number" id="hz" min="1" max="30" style="width:50px"></label></div>
  <div class="row"><label>Tên boss (cách nhau dấu phẩy): <input type="text" id="bn" placeholder="để trống = tự nhận theo loại" style="width:170px"></label></div>
  <div class="row"><label>Tạm dừng khi máu dưới (%): <input type="number" id="hp" min="0" max="100" style="width:55px"></label>
    <label><input type="checkbox" id="ma"> Tự tắt/bật TỰ ĐÁNH</label></div>
  <div class="row"><label>Tối đa mỗi boss (giây): <input type="number" id="bto" min="30" style="width:65px"></label></div>
  <div class="row"><label>Thử chuyển khu: <input type="number" id="gz" min="1" max="30" value="2" style="width:50px"></label><button class="b" id="gb">Đi</button></div>
  <div class="out" id="ot"></div>
  <div class="status" id="ss">Chưa chạy. Đứng ở khu có boss rồi bấm "Quét boss" trước.</div>
  <div class="note">Giữ tab game luôn hiện, đừng treo mà không nhìn: khu có PK và quái mạnh. Tự động hoá có thể vi phạm luật game.</div>
</div>
<button class="fab" id="fab">⚔️ Săn boss</button>`;
    const $ = id => root.getElementById(id);
    const out = t => { $('ot').style.display = 'block'; $('ot').textContent = t; };
    const bot = () => window.__bt || null;
    const ensure = () => { if (!window.__bt) createBot(); return window.__bt; };
    $('hz').value = EXT_SAVED.homeZone; $('bn').value = (EXT_SAVED.bossNames || []).join(', ');
    $('hp').value = Math.round(EXT_SAVED.minHpPct * 100); $('ma').checked = !!EXT_SAVED.manageAuto; $('bto').value = Math.round((EXT_SAVED.bossTimeout || 600000) / 1000);
    $('cycle').checked = !!EXT_SAVED.cycleZones;
    $('sprint').checked = !!window.__vut?.cfg.sprint;
    $('sprint').onchange = e => window.__vut?.setSprint(e.target.checked);
    $('zs').value = EXT_SAVED.zoneStart; $('ze').value = EXT_SAVED.zones;
    const apply = () => { if (bot()) Object.assign(bot().cfg, EXT_SAVED); saveCfg(); };
    $('cycle').onchange = e => { EXT_SAVED.cycleZones = e.target.checked; apply(); };
    const saveRange = () => {
      const a = Math.max(1, Math.min(60, Math.trunc(+$('zs').value || 1)));
      const b = Math.max(a, Math.min(60, Math.trunc(+$('ze').value || a)));
      EXT_SAVED.zoneStart = a; EXT_SAVED.zones = b;
      $('zs').value = a; $('ze').value = b; apply();
    };
    $('zs').onchange = saveRange; $('ze').onchange = saveRange;
    $('hz').onchange = e => { EXT_SAVED.homeZone = Math.min(30, Math.max(1, +e.target.value || 1)); apply(); };
    $('bn').onchange = e => { EXT_SAVED.bossNames = e.target.value.split(',').map(s => s.trim()).filter(Boolean); apply(); };
    $('hp').onchange = e => { EXT_SAVED.minHpPct = Math.min(1, Math.max(0, (+e.target.value || 0) / 100)); apply(); };
    $('bto').onchange = e => { EXT_SAVED.bossTimeout = Math.max(30, +e.target.value || 600) * 1000; apply(); };
    $('ma').onchange = e => { EXT_SAVED.manageAuto = e.target.checked; apply(); };
    const refresh = () => {
      const b = bot(), running = !!b && !b.isPaused();
      $('fab').classList.toggle('on', running);
      $('tg').textContent = running ? '⏸ Tạm dừng' : '▶ Chạy';
      $('tg').className = 'b ' + (running ? 'stop' : 'go');
      if (b) $('ss').textContent = b.info() + (lastMsg ? '\n' + lastMsg : '');
    };
    $('fab').onclick = () => $('p').classList.toggle('open');
    $('sc').onclick = async () => { out('Đang quét...'); try { out((await ensure().scan()).text); } catch (e) { out('Lỗi: ' + e.message); } refresh(); };
    $('tg').onclick = () => {
      const b = ensure();
      if (b.isPaused()) b.start(); else b.pause();
      refresh();
    };
    $('st').onclick = () => { if (bot()) { bot().stop(); window.__bt = null; } $('ss').textContent = 'Đã tắt hẳn (TỰ ĐÁNH được trả về trạng thái ban đầu).'; refresh(); };
    $('gb').onclick = async () => { const n = +$('gz').value; if (!(n >= 1 && n <= 30)) return; out('Đang chuyển sang khu ' + n + '...'); const r = await ensure().goto(n); out('Kết quả: ' + r + ' | khu hiện tại: ' + (document.querySelector('button.scene-zone') || {}).textContent); refresh(); };
    ['keydown', 'keyup', 'keypress'].forEach(t => root.addEventListener(t, e => e.stopPropagation()));
    if (window.__gtHub) window.__gtHub.add(host); else document.body.appendChild(host);
    refresh();
    setInterval(refresh, 1000);
  }

  if (document.body) build(); else document.addEventListener('DOMContentLoaded', build);
})();
} catch (e) { console.error("[công cụ game] phần Săn boss lỗi:", e); }

// ===================== Đập đồ (trước đây: upgrade.js) =====================
try {
// Đập đồ (nâng cấp trang bị) trên bảng nâng cấp của game, bấm như người chơi:
// mỗi lượt: đọc cấp → "Tự chọn đá" → tick Linh thạch / Hộ thạch nếu còn → kiểm tra xác suất → "Nâng cấp +N" → chờ kết quả.
// Dừng khi: tới cấp tối đa, hết đá bảo hộ (Linh thạch & Hộ thạch đều không dùng được), xác suất 0%, thiếu xu, bảng bị đóng, hoặc bấm Tắt.
(() => {
  if (window.__gtUpgradeExt) return;
  window.__gtUpgradeExt = true;

  const CK = 'gtUpgradeCfg';
  // safeLv: cấp mà đập hỏng không rớt cấp (game không hiện ô Hộ thạch): +1..+5 và các mốc +8, +12
  const DEF = { maxLv: 16, safeLv: '1-5, 8, 12', useLinh: true, useHo: true, hoSo: true, hoTrung: true, hoCao: true, hoOrder: 'cheap', stopNoProtect: true, delay: 300, maxTries: 500 };
  const HO_TIERS = [{ k: 'so', cfg: 'hoSo', name: 'sơ cấp', re: 'sơ' }, { k: 'trung', cfg: 'hoTrung', name: 'trung cấp', re: 'trung' }, { k: 'cao', cfg: 'hoCao', name: 'cao cấp', re: 'cao' }];
  let cfg = { ...DEF }; try { cfg = { ...DEF, ...JSON.parse(localStorage.getItem(CK) || '{}') }; } catch (e) {}
  if (cfg.delay === 1200) cfg.delay = DEF.delay;          // mặc định cũ (chậm) → mặc định mới
  const save = () => { try { localStorage.setItem(CK, JSON.stringify(cfg)); } catch (e) {} };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  // gom về 1 kiểu mã hoá chữ có dấu (NFC): "ộ" có thể được lưu kiểu tổ hợp, regex trong code là kiểu dựng sẵn
  const norm = s => String(s || '').normalize('NFC').replace(/\s+/g, ' ').trim();
  const unaccent = s => norm(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
  const visible = el => el && el.isConnected && el.getClientRects().length > 0;
  const press = el => {
    for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) {
      const C = t.startsWith('pointer') ? PointerEvent : MouseEvent;
      el.dispatchEvent(new C(t, { bubbles: true, cancelable: true, composed: true, view: window, button: 0, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
    }
    el.click();
  };

  // ===== đọc bảng nâng cấp của game (theo chữ trên giao diện, vì không biết tên class) =====
  const buttons = () => [...document.querySelectorAll('button,[role=button],a')].filter(visible);
  // có thể có nhiều nút "Nâng cấp +N" (nút ẩn / của bảng khác): lấy nút đang nằm trong màn hình, không khoá, to nhất
  const inView = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth && getComputedStyle(el).visibility !== 'hidden'; };
  const upBtn = () => (upBtnCache = buttons().filter(b => /^nâng cấp\s*\+\s*\d+/i.test(norm(b.textContent)) && inView(b))
    .sort((a, b) => (isDisabled(a) - isDisabled(b)) || (b.offsetWidth * b.offsetHeight - a.offsetWidth * a.offsetHeight))[0] || null);
  const autoBtn = () => buttons().find(b => /^tự chọn đá$/i.test(norm(b.textContent)));
  const isDisabled = el => !!el && (el.disabled || el.getAttribute('aria-disabled') === 'true' || /\bdisabled\b|is-disabled/.test(String(el.className)));
  // khung bảng nâng cấp: đi lên từ nút "Nâng cấp +N" tới khung đủ lớn có chữ "Xác suất" — chỉ đọc trong khung này cho nhanh
  let ROOT = null;
  function root() {
    if (ROOT && ROOT.isConnected && ROOT.contains(upBtnCache)) return ROOT;
    const b = upBtnCache && upBtnCache.isConnected ? upBtnCache : null;
    ROOT = null;
    for (let e = b; e && e !== document.body; e = e.parentElement) {
      const r = e.getBoundingClientRect();
      if (r.height >= 250 && r.width >= 400 && /xac\s*suat/.test(unaccent(e.textContent).slice(0, 5000))) { ROOT = e; break; }
    }
    return ROOT || document.body;
  }
  let upBtnCache = null, resScope = 'root';
  // các đoạn chữ ngắn đang hiện (bỏ qua bảng công cụ vì nằm trong shadow DOM)
  function texts(re, max = 60, scope = root()) {
    const out = [];
    const w = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(), i = 0; n && i < 30000; n = w.nextNode(), i++) {
      const t = norm(n.nodeValue); if (!t || t.length > max || !re.test(t)) continue;
      if (n.parentElement && visible(n.parentElement)) out.push({ t, el: n.parentElement });
    }
    return out;
  }
  // "Xác suất thành công: 0% (trần 29%)": so chữ KHÔNG DẤU trên cả dòng (số % có thể nằm trong thẻ riêng, dấu có thể mã hoá khác)
  function readRate() {
    let best = null;
    for (const el of root().querySelectorAll('div,li,p,span,td,label')) {
      const raw = el.textContent; if (!raw || raw.length > 160) continue;
      const m = unaccent(raw).match(/xac\s*suat\s*thanh\s*cong\s*:?\s*(\d+(?:[.,]\d+)?)\s*%/);
      if (m && visible(el) && (!best || raw.length < best.len)) best = { v: +m[1].replace(',', '.'), len: raw.length };
    }
    return best ? best.v : NaN;
  }
  // chữ của cả dòng chứa phần tử (đi lên tới khi dòng đủ dài nhưng chưa quá 160 ký tự)
  function lineText(el) {
    let e = el, t = norm(e.textContent);
    for (let i = 0; i < 3 && e.parentElement; i++) { const p = norm(e.parentElement.textContent); if (p.length > 160) break; e = e.parentElement; t = p; }
    return t;
  }
  // ô chọn đá (Linh thạch / Hộ thạch): tìm dòng có chữ đó, rồi tìm ô tick trong dòng
  function stoneBox(word, cur, key) {
    // ưu tiên dòng có "(còn N)" — tránh nhầm với dòng kết quả kiểu "Thất bại — Hộ thạch giữ nguyên +13"
    const hit = texts(new RegExp(word + '.*còn', 'i'), 80)[0] || texts(new RegExp(word, 'i'), 80).find(x => !/thất bại|thành công|giữ nguyên/i.test(x.t));
    if (!hit) return null;
    return boxOf(hit, word, cur, key);
  }
  // ô tick của 1 dòng: chọn ô CÙNG HÀNG với chữ (lệch dọc ≤ 14px) và gần chữ nhất — tránh lấy nhầm ô của dòng khác khi 2 dòng chung 1 khung
  const CHECK_SEL = 'input[type=checkbox],[role=checkbox],[class*="check"]';
  function nearestBox(el) {
    const r = el.getBoundingClientRect(), cy = r.top + r.height / 2;
    let best = null, bd = Infinity;
    for (const b of document.querySelectorAll(CHECK_SEL)) {
      if (!visible(b) || b.querySelector(CHECK_SEL)) continue;          // bỏ khung bọc ngoài chứa ô khác
      const q = b.getBoundingClientRect(); if (q.width > 60 || q.height > 60) continue;
      const dy = Math.abs(q.top + q.height / 2 - cy); if (dy > 14) continue;
      const dx = q.right <= r.left ? r.left - q.right : q.left >= r.right ? q.left - r.right : 0;
      const d = dx + dy * 3; if (d < bd && dx < 120) { bd = d; best = b; }
    }
    return best;
  }
  // dò theo vị trí: từ mép trái chữ đi sang trái trên cùng hàng, gặp ô vuông nhỏ (8–28px) đầu tiên thì đó là ô tick tự vẽ
  function boxLeftOf(el) {
    const r = el.getBoundingClientRect(), cy = r.top + r.height / 2;
    for (let x = r.left - 2; x > r.left - 60; x -= 2) {
      for (const e of document.elementsFromPoint(x, cy)) {
        if (e.shadowRoot || e === document.body || e === document.documentElement) continue;
        const q = e.getBoundingClientRect();
        if (q.width >= 8 && q.width <= 28 && q.height >= 8 && q.height <= 28 && Math.abs(q.width - q.height) <= 6 && !norm(e.textContent)) return e;
      }
    }
    return null;
  }
  // hình dạng 1 ô (để so trước/sau khi bấm, và so với hình lúc "đã tick" đã nhớ)
  const lookOf = b => { if (!b) return ''; const cs = getComputedStyle(b); return b.outerHTML + '|' + cs.backgroundColor + '|' + cs.borderColor + '|' + cs.backgroundImage; };
  const tickedLook = {};          // key ('linh' / 'so' / 'trung' / 'cao') → hình của ô khi đang tick
  // ô đang tick: input.checked / aria-checked / class kiểu checked / dấu ✓; ô tự vẽ không có dấu hiệu → so với hình "đã tick" đã nhớ
  function boxChecked(b, key) {
    if (b.checked !== undefined) return !!b.checked;
    if (b.hasAttribute('aria-checked')) return b.getAttribute('aria-checked') === 'true';
    // class kiểu "set-box on" / "set-box--on" / "is-checked" / "ticked"... (ô chưa tick của game chỉ là "set-box")
    if (/(^|[\s_-])(on|checked|is-checked|is-on|active|selected|ticked?|chon)(?=$|[\s_-])/i.test(String(b.className)) || /[✓✔]/.test(b.textContent || '')) return true;
    return !!(key && tickedLook[key] && lookOf(b) === tickedLook[key]);
  }
  // ô <input type=checkbox> của dòng (kể cả khi bị ẩn sau ô vuông tự vẽ): trong nhãn, hoặc là ô duy nhất của dòng
  function hiddenInput(el) {
    let r = el.closest('label') || el.parentElement;
    for (let i = 0; i < 3 && r; i++, r = r.parentElement) {
      const c = r.querySelectorAll('input[type=checkbox]');
      if (c.length === 1) return c[0];
      if (c.length > 1) return null;
    }
    return null;
  }
  function boxOf(hit, word, cur, key) {
    const inp = hiddenInput(hit.el);
    let box = inp || nearestBox(hit.el) || boxLeftOf(hit.el), row =box ? (box.closest('label') || hit.el.closest('label') || hit.el.parentElement) : hit.el;
    // dòng chứa cả ô lẫn chữ (để đọc "(còn N)", "không dùng được")
    while (row && row.parentElement && box && !row.contains(box)) row = row.parentElement;
    if (!box) { row = hit.el; for (let i = 0; i < 3 && row && !box; i++) { const c = row.querySelectorAll(CHECK_SEL); if (c.length === 1) box = c[0]; else row = row.parentElement; } }
    // chỉ đọc chữ của đúng dòng này (nhãn chứa chữ), không đọc cả khung lớn có dòng khác
    let textRow = hit.el.closest('label') || hit.el.parentElement || hit.el;
    if (!/còn/i.test(norm(textRow.textContent)) && textRow.parentElement && norm(textRow.parentElement.textContent).length < 200) textRow = textRow.parentElement;
    if (norm(textRow.textContent).length > 200) textRow = hit.el;
    row = textRow.contains(box) ? textRow : row;
    const rowText = norm(textRow.textContent);
    const m = rowText.match(new RegExp(word + '[^(]*\\(\\s*còn\\s*([\\d.,]+)', 'i'));
    const count = m ? +m[1].replace(/[.,]/g, '') : null;
    // ô input bị ẩn thì bấm vào nhãn (bấm nhãn = bấm ô), còn không thì bấm thẳng ô
    const target = box && !visible(box) ? (box.closest('label') || hit.el.closest('label') || hit.el) : (box || row || hit.el);
    const checked = box ? boxChecked(box, key) : null;
    // bị khoá: ô bị disable, hoặc dòng ghi "từ +12 trở lên không dùng được" và món đã từ +12 trở lên
    const lim = rowText.match(/từ\s*\+\s*(\d+)\s*trở lên không dùng/i);
    const disabled = isDisabled(box) || isDisabled(textRow) || (lim && cur != null && cur >= +lim[1]);
    // "bảo hộ tới +16" → chỉ bảo hộ được khi đập lên tới cấp đó
    const upTo = rowText.match(/bảo hộ (?:tới|đến)\s*\+\s*(\d+)/i);
    return { key, box: target, real: box, label: hit.el, checked: !!checked, count, disabled, upTo: upTo ? +upTo[1] : null, lim: lim ? +lim[1] : null, text: rowText.slice(0, 80) };
  }
  // các loại Hộ thạch đang hiện trên bảng: sơ / trung / cao cấp (mỗi loại 1 dòng)
  function hoBoxes(cur) {
    const out = [];
    for (const t of HO_TIERS) {
      const word = 'Hộ thạch\\s*' + t.re + '\\s*cấp';
      // chữ "(còn N)" có thể nằm trong thẻ riêng → thử cả đoạn chỉ có tên loại (bỏ dòng kết quả "Thất bại — Hộ thạch…")
      const hit = texts(new RegExp(word + '.*còn', 'i'), 80)[0] || texts(new RegExp(word, 'i'), 80).find(x => !/thất bại|thành công|giữ nguyên/i.test(x.t));
      if (hit) out.push({ ...boxOf(hit, word, cur, t.k), tier: t });
    }
    // không có chữ sơ/trung/cao (giao diện cũ) → dòng "Hộ thạch (còn N)"
    if (!out.length) { const b = stoneBox('Hộ thạch', cur, 'ho'); if (b) out.push({ ...b, tier: { k: 'cao', cfg: 'hoCao', name: '' } }); }
    return out;
  }
  function readState() {
    const b = upBtn();
    const next = b ? +(norm(b.textContent).match(/\+\s*(\d+)/) || [])[1] : null;
    const rate = readRate();
    // dòng kết quả có thể nằm ngoài khung bảng → tìm trong khung trước, không thấy thì tìm cả trang (nhớ lại chỗ tìm thấy)
    const RES_RE = /^(thất bại|thành công|nâng cấp thành công|không đủ|thiếu)/i;
    let res = texts(RES_RE, 120, resScope === 'doc' ? document.body : root()).map(x => x.t);
    if (!res.length && resScope !== 'doc') { res = texts(RES_RE, 120, document.body).map(x => x.t); if (res.length) resScope = 'doc'; }
    const cur = next != null ? next - 1 : null;
    return { btn: b, next, cur, rate, result: res[res.length - 1] || '', linh: stoneBox('Linh thạch', cur, 'linh'), hos: hoBoxes(cur) };
  }

  // "1-5, 8, 12" → cấp hiện tại có nằm trong đó không
  const inSafe = lv => lv != null && String(cfg.safeLv || '').replace(/\s*-\s*/g, '-').split(/[,;\s]+/).some(p => {
    const m = p.match(/^(\d+)\s*-\s*(\d+)$/); if (m) return lv >= +m[1] && lv <= +m[2];
    return p !== '' && +p === lv;
  });

  // ===== vòng đập =====
  let running = false, ui = {}, stat = { tries: 0, ok: 0, fail: 0, start: 0 }, lastLog = '';
  const say = t => { lastLog = t; if (ui.st) ui.st.textContent = t; console.log('[đập đồ]', t); };
  const stop = why => { running = false; say('⏹ Dừng: ' + why + '\n' + summary()); sync(); };
  const summary = () => 'Đã đập ' + stat.tries + ' lần · thành công ' + stat.ok + ' · thất bại ' + stat.fail;
  // bấm ô tick ĐÚNG 1 LẦN rồi chờ game cập nhật (tối đa ~1,2 giây). KHÔNG bấm lần 2: game cập nhật chậm,
  // bấm thêm lần nữa sẽ bỏ tick (đã từng làm mất Hộ thạch → rớt cấp). Trả về true nếu thấy ô đã đúng trạng thái.
  async function setBox(sb, want) {
    if (!sb || sb.disabled) return false;
    if (sb.checked === want) return true;
    const now = () => sb.real && sb.real.isConnected ? boxChecked(sb.real, sb.key) : null;
    const before = lookOf(sb.real);
    press(sb.box);
    for (let i = 0; i < 20; i++) {
      await sleep(60);
      const after = sb.real && sb.real.isConnected ? lookOf(sb.real) : before;
      if (sb.real && after !== before) {
        // ô tự vẽ: hình đổi = đã đổi trạng thái → nhớ hình lúc "đã tick" để các lượt sau biết ô đang tick hay chưa
        if (sb.key) { if (want) tickedLook[sb.key] = after; else if (!tickedLook[sb.key]) tickedLook[sb.key] = before; }
        return true;
      }
      if (now() === want) return true;
    }
    return false;
  }
  // dòng "Hỏng: rớt về +8 (mốc …)" của game: còn chữ "rớt về" = đập hỏng sẽ rớt cấp (chưa được bảo hộ)
  function readFail() {
    let best = null;
    for (const el of root().querySelectorAll('div,li,p,span,td')) {
      const raw = el.textContent; if (!raw || raw.length > 160) continue;
      // "hỏng:" (không dấu: "hong:") — chặn chữ "không" (cũng chứa "hong") bằng ranh giới chữ
      const u = unaccent(raw), m = u.match(/(?:^|[^a-z])hong\s*:\s*(.*)$/);
      if (m && visible(el) && (!best || raw.length < best.len)) best = { len: raw.length, text: norm(raw).slice(0, 80), drop: /rot\s*(ve|xuong)/.test(m[1]) && !/khong\s*rot/.test(m[1]), dropTo: +((m[1].match(/rot\s*(?:ve|xuong)\s*\+?\s*(\d+)/) || [])[1]) || null };
    }
    return best;
  }
  async function loop() {
    stat = { tries: 0, ok: 0, fail: 0, start: Date.now() };
    while (running) {
      let s = readState();
      if (!s.btn) return stop('không thấy bảng nâng cấp (nút "Nâng cấp +N"). Mở bảng nâng cấp và chọn món trước.');
      if (s.cur != null && s.cur >= cfg.maxLv) return stop('món đã đạt +' + s.cur + ' (tối đa +' + cfg.maxLv + ').');
      if (stat.tries >= cfg.maxTries) return stop('đã đập ' + stat.tries + ' lần (giới hạn).');
      // 1) tự chọn đá
      const ab = autoBtn();
      // bấm "Tự chọn đá" rồi đi tiếp ngay khi xác suất > 0% (tối đa chờ 0,8 giây)
      if (ab && !isDisabled(ab)) { press(ab); for (let i = 0; i < 16; i++) { await sleep(50); if (readRate() > 0) break; } }
      // 2) đá bảo hộ: còn thì tick, hết / bị khoá thì bỏ
      s = readState();
      let linhOk = cfg.useLinh && s.linh && !s.linh.disabled && (s.linh.count == null || s.linh.count > 0);
      if (s.linh) {
        const done = await setBox(s.linh, !!linhOk);
        if (linhOk && !done) { linhOk = false; say('⚠️ Bấm ô Linh thạch mà ô không được tick — bấm "Kiểm tra bảng" rồi gửi mình kết quả.\n' + summary()); }
      }
      const linhTxt = !s.linh ? 'Linh thạch: không thấy' : !cfg.useLinh ? 'Linh thạch: tắt' : s.linh.disabled ? 'Linh thạch: khoá' + (s.linh.lim ? ' từ +' + s.linh.lim : '') : s.linh.count === 0 ? 'Linh thạch: hết' : linhOk ? 'Linh thạch ✔' : 'Linh thạch: không tick được';
      // cấp an toàn (đập hỏng không rớt): không cần / không dùng Hộ thạch; game cũng không hiện ô Hộ thạch ở các cấp này
      const safe = inSafe(s.cur) || !s.hos.length;
      // hộ thạch: chọn đúng 1 loại dùng được theo thứ tự (rẻ trước: sơ → trung → cao), bỏ tick các loại còn lại
      const usable = h => !safe && cfg.useHo && cfg[h.tier.cfg] !== false && !h.disabled && (h.count == null || h.count > 0) && (h.upTo == null || s.next == null || s.next <= h.upTo);
      const order = cfg.hoOrder === 'best' ? ['cao', 'trung', 'so'] : ['so', 'trung', 'cao'];
      const pick = [...s.hos].sort((a, b) => order.indexOf(a.tier.k) - order.indexOf(b.tier.k)).find(usable) || null;
      for (const h of s.hos) if (h !== pick) await setBox(h, false);
      if (pick) await setBox(pick, true);
      const hoOk = !!pick;
      const hoTxt = s.hos.length ? s.hos.map(h => (h.tier.name || 'Hộ thạch') + ' còn ' + h.count + (h.disabled ? ' (khoá)' : '') + (h.upTo ? ' (tới +' + h.upTo + ')' : '')).join(', ') : 'không thấy';
      // chỉ Hộ thạch mới chống rớt cấp; Linh thạch chỉ tăng tỉ lệ (+10%) nên không tính là bảo hộ
      if (cfg.stopNoProtect && !safe && !hoOk) return stop('hết Hộ thạch dùng được cho +' + s.cur + ' → +' + s.next + ' (Hộ thạch: ' + hoTxt + '). Đập tiếp có thể rớt cấp.');
      s.hoPick = pick; s.safe = safe; s.linhTxt = linhTxt;
      // 3) xác suất
      const hoPick = s.hoPick, safeNow = s.safe, linhNow = s.linhTxt;
      s = readState();
      if (s.rate === 0) return stop('xác suất thành công 0% (không đủ đá trong kệ?).');
      if (isDisabled(s.btn)) return stop('nút "Nâng cấp" đang bị khoá (thiếu xu / thiếu đá?).');
      // CHỐT CHẶN chống rớt cấp: ở cấp có thể rớt, chỉ đập khi game xác nhận đã được bảo hộ
      if (!safeNow) {
        // "rớt về +8" khi đang +8 = không mất gì → không tính là rớt
        const loses = f => f && f.drop && (f.dropTo == null || s.cur == null || f.dropTo < s.cur);
        let f = readFail();
        // còn báo "sẽ rớt" → chờ game cập nhật sau khi tick (tối đa 0,6 giây); đã an toàn thì đi tiếp ngay
        for (let i = 0; i < 10 && loses(f); i++) { await sleep(60); f = readFail(); }
        if (loses(f) && hoPick) {
          // có thể lần bấm trước chưa ăn → bấm ô Hộ thạch thêm 1 lần, chờ lâu rồi đọc lại
          const h = readState().hos.find(x => x.tier.k === hoPick.tier.k);
          if (h) { press(h.box); await sleep(1200); f = readFail(); }
        }
        if (loses(f)) return stop('Hộ thạch CHƯA được tick (bảng vẫn ghi "' + f.text + '") → KHÔNG đập để tránh rớt cấp. Tick tay ô Hộ thạch xem bảng đổi thành gì rồi gửi mình.');
        if (!f) {
          const h = hoPick && readState().hos.find(x => x.tier.k === hoPick.tier.k);
          if (!h || !h.checked) return stop('không đọc được dòng "Hỏng: …" và không chắc Hộ thạch đã tick → KHÔNG đập để tránh rớt cấp.');
        }
      }
      // 4) đập
      const before = s.result, lv0 = s.cur;
      say('⚒️ Đập +' + s.cur + ' → +' + s.next + (isNaN(s.rate) ? '' : ' (xác suất ' + s.rate + '%)') + ' · ' + linhNow + (hoPick ? ' · Hộ thạch ' + (hoPick.tier.name || '') : '') + (safeNow ? ' · cấp an toàn (hỏng không rớt)' : '') + '\n' + summary());
      // 5) chờ kết quả. Thất bại liên tiếp thì game hiện Y HỆT câu cũ ("… vẫn +8") và cấp không đổi →
      //    ngoài "chữ đổi / cấp đổi" còn nhận: server trả lời sau lúc bấm (nghe mạng), hoặc đá trong lò bị dùng hết (xác suất về 0%)
      let netAt = 0;
      const tap = window.__lootTap;
      const sub = m => { if ((m.dir === 'res' || m.dir === 'ws-in') && !/\/ngoai-gioi\/[^/]+\/(lenh|goi|khu|vao)\b/.test(m.url || '')) netAt = netAt || Date.now(); };
      if (tap && tap.subs) tap.subs.add(sub);
      const rate0 = s.rate;
      press(s.btn);
      let r = null, how = '';
      try {
        for (let i = 0; i < 100; i++) {
          await sleep(60);
          const n = readState();
          if ((n.result && n.result !== before) || (n.cur != null && n.cur !== lv0)) { r = n; how = 'chữ/cấp đổi'; break; }
          if (rate0 > 0 && n.rate === 0) { await sleep(120); r = readState(); how = 'đá đã dùng'; break; }
          if (netAt && Date.now() - netAt > 250) { r = readState(); how = 'server trả lời'; break; }
        }
      } finally { if (tap && tap.subs) tap.subs.delete(sub); }
      stat.tries++;
      if (!r) { say('… Không thấy kết quả sau 6 giây, đọc lại\n' + summary()); await sleep(1000); r = readState(); }
      const txt = r.result || '';
      if (/không đủ|thiếu/i.test(txt)) return stop('game báo: ' + txt);
      if (r.cur != null && lv0 != null && r.cur > lv0 || /thành công/i.test(txt)) { stat.ok++; say('✅ Lên +' + r.cur + (txt ? ' — ' + txt : '') + '\n' + summary()); if (window.__gtEmit) window.__gtEmit('upgrade', { ok: true, lv: r.cur }); }
      else { stat.fail++; say('✖ ' + (txt || 'Thất bại') + '\n' + summary()); if (window.__gtEmit) window.__gtEmit('upgrade', { ok: false, lv: r.cur }); }
      await sleep(cfg.delay + Math.random() * 150);
    }
  }
  function check() {
    const s = readState();
    return 'Nút nâng cấp: ' + (s.btn ? '"' + norm(s.btn.textContent) + '"' + (isDisabled(s.btn) ? ' (đang khoá)' : '') : 'KHÔNG thấy') +
      '\nCấp hiện tại: ' + (s.cur != null ? '+' + s.cur : '?') + ' · tối đa đặt: +' + cfg.maxLv + (inSafe(s.cur) || !s.hos.length ? ' · cấp an toàn (không cần Hộ thạch)' : '') +
      '\nNút "Tự chọn đá": ' + (autoBtn() ? 'có' : 'KHÔNG thấy') +
      '\nLinh thạch: ' + (s.linh ? 'còn ' + s.linh.count + (s.linh.disabled ? ' · KHÔNG dùng được' + (s.linh.lim ? ' (từ +' + s.linh.lim + ')' : '') : '') + ' · ' + (s.linh.checked ? 'đang tick' : 'chưa tick') +
        ' · ô tick: ' + (s.linh.real ? '<' + s.linh.real.tagName.toLowerCase() + (s.linh.real.className ? ' class="' + String(s.linh.real.className).slice(0, 40) + '"' : '') + '>' : 'KHÔNG tìm thấy (sẽ bấm vào chữ)') : 'không thấy') +
      '\nHộ thạch: ' + (s.hos.length ? s.hos.map(h => '\n  • ' + (h.tier.name || '(không rõ loại)') + ': còn ' + h.count + (h.upTo ? ' · bảo hộ tới +' + h.upTo : '') + (h.disabled ? ' · KHÔNG dùng được' : '') + ' · ' + (h.checked ? 'đang tick' : 'chưa tick') +
        ' · ô tick: ' + (h.real ? '<' + h.real.tagName.toLowerCase() + ' class="' + String(h.real.className).slice(0, 40) + '">' : 'KHÔNG tìm thấy')).join('') : 'không thấy') +
      (() => { const f = readFail(); if (!f) return '\nDòng "Hỏng": KHÔNG đọc được → ở cấp có thể rớt tool sẽ không đập';
        const lose = f.drop && (f.dropTo == null || s.cur == null || f.dropTo < s.cur);
        return '\nDòng "Hỏng": "' + f.text + '" → ' + (lose ? '⚠️ SẼ RỚT nếu hỏng (tool sẽ không đập khi thấy dòng này)' : '✔ không mất cấp'); })() +
      '\nXác suất: ' + (isNaN(s.rate) ? '?' : s.rate + '%') + '\nKết quả gần nhất: ' + (s.result || '(chưa có)');
  }

  // ===== giao diện =====
  const sync = () => { if (!ui.tg) return; ui.tg.textContent = running ? '■ Dừng' : '▶ Bắt đầu đập'; ui.tg.className = 'b ' + (running ? 'stop' : 'go'); ui.fab.classList.toggle('on', running); };
  function build() {
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;right:12px;bottom:108px;z-index:2147483647;';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
<style>
  *{box-sizing:border-box;font-family:system-ui,sans-serif}
  .fab{background:#2b2f3a;color:#fff;border:1px solid #555;border-radius:20px;padding:8px 14px;cursor:pointer;font-size:13px}
  .fab.on{background:#1f6f43}
  .panel{display:none;width:340px;background:#1b1e27;color:#e6e6e6;border:1px solid #555;border-radius:10px;padding:10px;margin-bottom:8px;font-size:12px}
  .panel.open{display:block}
  .status{white-space:pre-wrap}
</style>
<div class="panel" id="p">
  <h4>⚒️ Đập đồ (dùng bảng nâng cấp của game)</h4>
  <div class="row"><button class="b go" id="tg">▶ Bắt đầu đập</button><button class="b" id="ck">Kiểm tra bảng</button></div>
  <div class="row"><label>Dừng khi đạt + <input type="number" id="mx" min="1" max="30" style="width:50px"></label></div>
  <div class="row"><label><input type="checkbox" id="ul"> Dùng Linh thạch khi còn</label><label><input type="checkbox" id="uh"> Dùng Hộ thạch khi còn</label></div>
  <div class="row" style="margin-left:18px"><label><input type="checkbox" id="h1"> sơ cấp</label><label><input type="checkbox" id="h2"> trung cấp</label><label><input type="checkbox" id="h3"> cao cấp</label></div>
  <div class="row" style="margin-left:18px"><label>Thứ tự: <select id="ho"><option value="cheap">Rẻ trước (sơ → trung → cao)</option><option value="best">Tốt trước (cao → trung → sơ)</option></select></label></div>
  <div class="row"><label><input type="checkbox" id="sp"> Hết Hộ thạch (ở cấp có thể rớt) thì dừng</label></div>
  <div class="row"><label>Cấp an toàn (hỏng không rớt): <input type="text" id="sl" style="width:100px" placeholder="1-5, 8, 12"></label></div>
  <div class="row"><label>Nghỉ giữa 2 lần <input type="number" id="dl" min="100" step="50" style="width:65px"> ms</label><label>tối đa <input type="number" id="mt" min="1" style="width:60px"> lần</label></div>
  <div class="status" id="st">Mở bảng nâng cấp của game, chọn món cần đập, rồi bấm "Bắt đầu đập".</div>
  <div class="note">Tool bấm "Tự chọn đá" trước mỗi lần đập, tick Linh thạch nếu còn (tăng tỉ lệ; game khoá từ +12) và 1 loại Hộ thạch (chống rớt cấp) khi ở cấp có thể rớt. Dừng khi tới cấp tối đa, hết Hộ thạch ở cấp có thể rớt, xác suất 0%, thiếu xu, hoặc bảng bị đóng. Đập đồ tốn xu và đá, không hoàn lại được.</div>
</div>
<button class="fab" id="fab">⚒️ Đập đồ</button>`;
    const $ = id => root.getElementById(id);
    ui = { tg: $('tg'), st: $('st'), fab: $('fab') };
    $('mx').value = cfg.maxLv; $('mx').onchange = e => { cfg.maxLv = Math.max(1, +e.target.value || 16); save(); };
    $('ul').checked = cfg.useLinh; $('ul').onchange = e => { cfg.useLinh = e.target.checked; save(); };
    $('uh').checked = cfg.useHo; $('uh').onchange = e => { cfg.useHo = e.target.checked; save(); };
    for (const [id, k] of [['h1', 'hoSo'], ['h2', 'hoTrung'], ['h3', 'hoCao']]) { $(id).checked = cfg[k] !== false; $(id).onchange = e => { cfg[k] = e.target.checked; save(); }; }
    $('ho').value = cfg.hoOrder; $('ho').onchange = e => { cfg.hoOrder = e.target.value; save(); };
    $('sl').value = cfg.safeLv; $('sl').onchange = e => { cfg.safeLv = e.target.value; save(); };
    $('sp').checked = cfg.stopNoProtect; $('sp').onchange = e => { cfg.stopNoProtect = e.target.checked; save(); };
    $('dl').value = cfg.delay; $('dl').onchange = e => { cfg.delay = Math.max(100, +e.target.value || DEF.delay); save(); };
    $('mt').value = cfg.maxTries; $('mt').onchange = e => { cfg.maxTries = Math.max(1, +e.target.value || 500); save(); };
    $('tg').onclick = () => {
      if (running) { running = false; say('Đang dừng sau lần đập hiện tại...'); sync(); return; }
      if (!upBtn()) { say('Không thấy nút "Nâng cấp +N". Mở bảng nâng cấp của game và chọn món trước.'); return; }
      running = true; sync(); loop().catch(e => stop('lỗi: ' + e.message));
    };
    $('ck').onclick = () => say(check());
    $('fab').onclick = () => $('p').classList.toggle('open');
    ['keydown', 'keyup', 'keypress'].forEach(t => root.addEventListener(t, e => e.stopPropagation()));
    if (window.__gtHub) window.__gtHub.add(host); else document.body.appendChild(host);
    sync();
  }

  window.__gtUpgrade = { check, readState, stop: () => { running = false; } };
  if (document.body) build(); else document.addEventListener('DOMContentLoaded', build);
})();
} catch (e) { console.error("[công cụ game] phần Đập đồ lỗi:", e); }

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
  const status = t => { if (ui.st && ui.st.textContent !== t) ui.st.textContent = t; };

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
      // game mã hoá tên lệnh: "m4j" = vị trí nhân vật
      if (m.dir === 'req' && typeof m.body === 'string' && m.body.includes('"c"')) { for (const c of (JSON.parse(m.body).c || [])) if (((window.__gtCmd && window.__gtCmd[c[0]]) === 'p' || c[0] === 'm4j' || c[0] === 'p') && typeof c[1] === 'number') { pos.p = { x: c[1], y: c[2] }; pos.t = Date.now(); } }
      else if (m.dir === 'res' && m.json && m.json.data && m.json.data.full && m.json.data.full.me && typeof m.json.data.full.me.x === 'number') { pos.p = { x: m.json.data.full.me.x, y: m.json.data.full.me.y }; pos.t = Date.now(); }
    } catch (e) {}
  }
  const hookTap = () => { if (!hookTap.done && window.__lootTap && window.__lootTap.subs) { window.__lootTap.subs.add(tapMsg); hookTap.done = true; } };
  const playerPos = () => { const s = sceneOf(); return s && s.player ? { x: s.player.x, y: s.player.y } : pos.p; };
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
    const t0 = Date.now(); let progress = null, dodges = 0;
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
        const step = approach.update(now, me);
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
      position: playerPos(), moving: !!target, status: ui.st?.textContent || '' }) };
  if (document.body) build(); else document.addEventListener('DOMContentLoaded', build);
})();
} catch (e) { console.error("[công cụ game] phần Đi tới map lỗi:", e); }
