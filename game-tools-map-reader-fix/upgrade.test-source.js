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
  const autoBtn = () => [...root().querySelectorAll('button,[role=button],a')].filter(visible).find(b => /^tự chọn đá$/i.test(norm(b.textContent)));
  const isDisabled = el => !!el && (el.disabled || el.getAttribute('aria-disabled') === 'true' || /\bdisabled\b|is-disabled/.test(String(el.className)));
  // khung bảng nâng cấp: đi lên từ nút "Nâng cấp +N" tới khung đủ lớn có chữ "Xác suất" — chỉ đọc trong khung này cho nhanh
  let ROOT = null;
  function root() {
    if (ROOT && ROOT.isConnected && ROOT.contains(upBtnCache)) return ROOT;
    const b = upBtnCache && upBtnCache.isConnected ? upBtnCache : null;
    ROOT = b?.closest('.ng-forge2') || null;
    if (ROOT) return ROOT;
    for (let e = b; e && e !== document.body; e = e.parentElement) {
      const r = e.getBoundingClientRect();
      if (r.height >= 250 && r.width >= 180 && /xac\s*suat/.test(unaccent(e.textContent).slice(0, 5000))) { ROOT = e; break; }
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
    let box = hit.el.closest('[role=switch],[role=checkbox]') || inp || nearestBox(hit.el) || boxLeftOf(hit.el), row =box ? (box.closest('label') || hit.el.closest('label') || hit.el.parentElement) : hit.el;
    // dòng chứa cả ô lẫn chữ (để đọc "(còn N)", "không dùng được")
    while (row && row.parentElement && box && !row.contains(box)) row = row.parentElement;
    if (!box) { row = hit.el; for (let i = 0; i < 3 && row && !box; i++) { const c = row.querySelectorAll(CHECK_SEL); if (c.length === 1) box = c[0]; else row = row.parentElement; } }
    // chỉ đọc chữ của đúng dòng này (nhãn chứa chữ), không đọc cả khung lớn có dòng khác
    let textRow = hit.el.closest('[role=switch],[role=checkbox],label') || hit.el.parentElement || hit.el;
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
  let upgradeRunId = 0, loopBusy = false;
  let running = false, ui = {}, stat = { tries: 0, ok: 0, fail: 0, start: 0 }, lastLog = '';
  const say = t => { lastLog = t; if (ui.st) ui.st.textContent = t; console.log('[đập đồ]', t); };
  const stop = why => { running = false; upgradeRunId++; say('⏹ Dừng: ' + why + '\n' + summary()); sync(); };
  const summary = () => 'Đã đập ' + stat.tries + ' lần · thành công ' + stat.ok + ' · thất bại ' + stat.fail;
  // bấm ô tick ĐÚNG 1 LẦN rồi chờ game cập nhật (tối đa ~1,2 giây). KHÔNG bấm lần 2: game cập nhật chậm,
  // bấm thêm lần nữa sẽ bỏ tick (đã từng làm mất Hộ thạch → rớt cấp). Trả về true nếu thấy ô đã đúng trạng thái.
  async function setBox(sb, want) {
    if (!sb) return false;
    const token = upgradeRunId;
    const fresh = () => sb.key === 'linh' ? readState().linh : readState().hos.find(h => h.key === sb.key);
    let current = fresh();
    if (!current || current.disabled) return !want && current?.checked === false;
    if (current.checked === want) return true;
    press(current.box); // exactly once; never blindly toggle it again
    const until = Date.now() + 3500;
    while (Date.now() < until && token === upgradeRunId) {
      await sleep(100);
      current = fresh();
      if (current?.checked === want) return true;
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
    if (loopBusy) return;
    loopBusy = true;
    const token = ++upgradeRunId;
    const active = () => running && token === upgradeRunId;
    const dropRisk = (f, level) => f && f.drop && (f.dropTo == null || f.dropTo < level);
    const waitState = async (predicate, timeout = 3500) => {
      const until = Date.now() + timeout;
      while (active() && Date.now() < until) {
        const state = readState();
        if (predicate(state)) return state;
        await sleep(100);
      }
      return null;
    };
    stat = { tries: 0, ok: 0, fail: 0, start: Date.now() };
    try {
      while (active()) {
        let s = await waitState(n => n.btn);
        if (!active()) return;
        if (!s) return stop('bảng nâng cấp chưa sẵn sàng sau 3,5 giây. Kiểm tra món, đá và xu.');
        if (!Number.isFinite(s.cur)) return stop('không đọc được cấp trang bị; chưa bấm nâng cấp.');
        if (s.cur >= cfg.maxLv) return stop('đã đạt +' + s.cur + '.');
        if (stat.tries >= cfg.maxTries) return stop('đã đạt giới hạn số lần đập.');
        const level = s.cur;
        const ab = autoBtn();
        if (ab && !isDisabled(ab)) { press(ab); await sleep(180); }
        if (!active()) return;
        s = readState();
        if (s.cur !== level) return stop('cấp hoặc món đang chọn đã thay đổi trong lúc chuẩn bị.');
        const linhWant = !!(cfg.useLinh && s.linh && !s.linh.disabled && (s.linh.count == null || s.linh.count > 0));
        if (s.linh && !(await setBox(s.linh, linhWant))) {
          if (!active()) return;
          return stop('chưa xác nhận được trạng thái Linh thạch sau khi bảng cập nhật.');
        }
        if (!active()) return;
        let f = readFail();
        if (!f) return stop('không đọc được dòng Hỏng; chưa bấm để tránh mất cấp ngoài ý muốn.');
        s = readState();
        const risk = dropRisk(f, s.cur);
        const order = cfg.hoOrder === 'best' ? ['cao', 'trung', 'so'] : ['so', 'trung', 'cao'];
        const pick = risk && cfg.useHo ? [...s.hos].sort((a, b) => order.indexOf(a.tier.k) - order.indexOf(b.tier.k))
          .find(h => cfg[h.tier.cfg] !== false && !h.disabled && (h.count == null || h.count > 0) && (h.upTo == null || s.next <= h.upTo)) : null;
        // Preserve a guard that is already selected; turning it off to infer risk is unsafe.
        const selected = s.hos.find(h => h.checked && !h.disabled);
        const chosen = pick || selected;
        if (risk && cfg.stopNoProtect && !chosen) return stop('không còn Hộ thạch phù hợp; đập tiếp có thể rớt cấp.');
        if (chosen) {
          if (!(await setBox(chosen, true))) {
            if (!active()) return;
            return stop('chưa xác nhận được Hộ thạch đã bật; chưa nâng cấp.');
          }
        }
        if (!active()) return;
        s = await waitState(n => n.btn && n.cur === level && !isDisabled(n.btn) && Number.isFinite(n.rate) && n.rate > 0);
        if (!active()) return;
        if (!s) return stop('nút nâng cấp hoặc xác suất chưa sẵn sàng; kiểm tra đá, xu và kết nối.');
        f = readFail();
        const checkedGuard = chosen && s.hos.find(h => h.tier.k === chosen.tier.k)?.checked;
        if (!f || (cfg.stopNoProtect && dropRisk(f, s.cur))) return stop('bảng chưa xác nhận chống rớt cấp. Không bấm nâng cấp.');
        if (chosen && !checkedGuard) return stop('Hộ thạch chưa được bật trong bảng mới. Không bấm nâng cấp.');
        const before = s.result, levelBefore = s.cur, rateBefore = s.rate;
        let requestUrl = null, forge = null;
        const tap = window.__lootTap;
        const sub = m => {
          if (m.dir === 'req' && typeof m.body === 'string' && m.body.includes('forge_upgrade')) requestUrl = m.url;
          if (m.dir === 'res' && requestUrl && m.url === requestUrl) forge = m.json?.data?.forge || m.json?.forge || null;
        };
        tap?.subs?.add(sub);
        let result = null;
        try {
          if (!active()) return;
          say('⚒️ Đập +' + s.cur + ' → +' + s.next + ' · ' + s.rate + '%\n' + summary());
          press(s.btn);
          const until = Date.now() + 12000;
          while (active() && Date.now() < until) {
            await sleep(120);
            const n = readState();
            const changed = (n.result && n.result !== before) || (Number.isFinite(n.cur) && n.cur !== levelBefore);
            const consumed = rateBefore > 0 && n.rate === 0;
            if (forge || changed || consumed) { result = n; break; }
          }
        } finally { tap?.subs?.delete(sub); }
        if (!active()) return;
        if (!result) return stop('chưa xác nhận được kết quả sau 12 giây. Đã dừng, không tự bấm lại để tránh tiêu thêm nguyên liệu.');
        stat.tries++;
        if (/không đủ|thiếu/i.test(result.result) && result.result !== before) return stop('game báo: ' + result.result);
        const success = typeof forge?.ok === 'boolean' ? forge.ok : result.cur > levelBefore;
        if (success) stat.ok++; else stat.fail++;
        say((success ? '✅ Thành công' : '✖ Thất bại') + ' · hiện tại +' + result.cur + '\n' + summary());
        if (window.__gtEmit) window.__gtEmit('upgrade', { ok: success, lv: result.cur });
        await sleep(Math.max(300, Number(cfg.delay) || 300));
      }
    } finally { loopBusy = false; if (token === upgradeRunId) { running = false; sync(); } }
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
      if (running) { running = false; upgradeRunId++; say('Đang dừng sau lần đập hiện tại...'); sync(); return; }
      if (!upBtn()) { say('Không thấy nút "Nâng cấp +N". Mở bảng nâng cấp của game và chọn món trước.'); return; }
      if (loopBusy) { say('Đang chờ lượt trước dừng.'); return; }
      running = true; sync(); loop().catch(e => stop('lỗi: ' + e.message));
    };
    $('ck').onclick = () => say(check());
    $('fab').onclick = () => $('p').classList.toggle('open');
    ['keydown', 'keyup', 'keypress'].forEach(t => root.addEventListener(t, e => e.stopPropagation()));
    if (window.__gtHub) window.__gtHub.add(host); else document.body.appendChild(host);
    sync();
  }

  window.__gtUpgrade = { check, readState, stop: () => stop('người dùng dừng') };
  if (document.body) build(); else document.addEventListener('DOMContentLoaded', build);
})();
} catch (e) { console.error("[công cụ game] phần Đập đồ lỗi:", e); }

