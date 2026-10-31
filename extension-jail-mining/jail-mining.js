(function (root) {
  'use strict';
  const normalizeLabel = text => String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  function isMiningLabel(text) {
    const label = normalizeLabel(text);
    return /^dap da(?:\s|$)/.test(label);
  }
  function findMiningButton(doc) {
    const candidates = [...doc.querySelectorAll('button,[role="button"],input[type="button"],input[type="submit"]')];
    const matches = candidates.filter(button => button.isConnected && button.getClientRects().length &&
      [button.innerText, button.textContent, button.value, button.getAttribute('aria-label'), button.title].some(isMiningLabel));
    return matches.find(button => button.closest('.tn-jail,[class*="jail"],[class*="prison"]')) || matches[0] || null;
  }
  function createMiner(options) {
    const now = options.now || Date.now, random = options.random || Math.random;
    const every = options.setInterval || setInterval, cancel = options.clearInterval || clearInterval;
    let running = false, timer = null, epoch = 0, nextAt = 0, attempts = 0, busy = false;
    const tell = text => options.status?.(text);
    const delay = () => 10000 + Math.floor(Math.max(0, Math.min(1, random())) * 5000);
    function stop(reason = 'Đã dừng.') { running = false; epoch++; if (timer !== null) cancel(timer); timer = null; tell(reason); }
    async function tick() {
      if (!running || busy) return;
      const button = options.find();
      if (!button) return stop('Không thấy nút Đập đá trong bảng nhà tù. Đã dừng.');
      const left = Math.ceil((nextAt - now()) / 1000);
      if (left > 0) { tell('⏳ Lần bấm tiếp theo sau ' + left + ' giây · đã gửi ' + attempts + ' lần.'); return; }
      if (button.disabled || button.getAttribute?.('aria-disabled') === 'true') {
        if (now() - nextAt > 15000) stop('Nút Đập đá vẫn bị khóa; kiểm tra thông báo game.');
        else tell('Nút đang bị khóa, chờ game cho phép.');
        return;
      }
      const token = epoch; busy = true;
      try {
        await options.click(button);
        if (!running || token !== epoch) return;
        attempts++; nextAt = now() + delay();
        tell('Đã gửi lần bấm ' + attempts + '. Chờ 10–15 giây; kết quả do game xác nhận.');
      } catch (error) { if (token === epoch) stop('Dừng: ' + error.message); }
      finally { busy = false; }
    }
    return {
      start() {
        if (running || busy) return false;
        if (!options.find()) { tell('Mở bảng nhà tù có nút Đập đá trước.'); return false; }
        epoch++; attempts = 0; running = true; nextAt = now() + delay();
        timer = every(() => { tick().catch(error => stop(error.message)); }, 250);
        tell('Đã bật. Lần đầu sau 10–15 giây.'); return true;
      }, stop, state: () => ({ running, attempts, nextAt, busy }),
    };
  }
  if (typeof module !== 'undefined' && module.exports) { module.exports = { createMiner, normalizeLabel, isMiningLabel, findMiningButton }; return; }
  if (root.__gtJailMining) return;
  function build() {
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;right:12px;bottom:200px;z-index:2147483647';
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<style>*{font-family:system-ui;box-sizing:border-box}.panel{display:none;width:330px;padding:12px;background:#1b1e27;color:#eee;border:1px solid #555;border-radius:10px}.panel.open{display:block}button{padding:7px 12px;cursor:pointer}.status{white-space:pre-wrap;margin:10px 0}.note{font-size:12px;color:#aaa}.fab{border-radius:20px;padding:8px 14px}.fab.on{background:#1f6f43;color:white}</style>
      <div class="panel" id="p"><h4>⛏ Đập đá trong tù</h4><p>Mỗi lần cách nhau ngẫu nhiên 10–15 giây.</p>
      <button id="start">▶ Bắt đầu</button> <button id="stop">■ Dừng</button>
      <div id="status" class="status">Mở bảng nhà tù của game rồi bấm Bắt đầu.</div>
      <p class="note">Chỉ bấm nút Đập đá có sẵn. Nếu game ghi “không bớt án”, công cụ không thay đổi điều đó. Không tự bấm Làm giấy ra tù.</p></div>
      <button class="fab" id="fab">⛏ Đập đá trong tù</button>`;
    const $ = id => shadow.getElementById(id);
    let lastStatus = '';
    const find = () => findMiningButton(document);
    const miner = createMiner({ find,
      status: text => { if (text !== lastStatus) { lastStatus = text; $('status').textContent = text; } $('fab').classList.toggle('on', !!root.__gtJailMining?.state().running); },
      click: async button => {
        if (document.hidden) throw Error('Tab game đang ẩn. Hiện lại tab rồi bật tiếp.');
        if (typeof root.__gtPW === 'function') {
          const r = button.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
          const top = document.elementFromPoint(x, y);
          if (!top || !(top === button || button.contains(top))) throw Error('Nút bị che hoặc ngoài màn hình.');
          await root.__gtPW({ t: 'click', x, y });
        } else button.click();
      },
    });
    root.__gtJailMining = miner;
    $('start').onclick = () => miner.start(); $('stop').onclick = () => miner.stop();
    $('fab').onclick = () => $('p').classList.toggle('open');
    root.addEventListener('pagehide', () => miner.stop());
    if (root.__gtHub) root.__gtHub.add(host); else document.body.appendChild(host);
  }
  if (document.body) build(); else document.addEventListener('DOMContentLoaded', build, { once: true });
})(typeof window !== 'undefined' ? window : globalThis);
