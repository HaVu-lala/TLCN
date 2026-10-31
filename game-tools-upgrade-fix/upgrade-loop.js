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
