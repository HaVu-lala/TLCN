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
