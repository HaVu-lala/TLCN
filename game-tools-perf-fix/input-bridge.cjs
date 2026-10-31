function createBridge() {
  const states = new WeakMap();
  const allowedKeys = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Shift', 'Enter', 'Escape', 'F2', 'Space']);
  async function focusGame(page) {
    return page.evaluate(() => {
      let active = document.activeElement;
      while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
      const typing = active?.isContentEditable || active?.tagName === 'TEXTAREA' || active?.tagName === 'SELECT' ||
        (active?.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'submit', 'range'].includes(active.type));
      if (typing) return false;
      const canvas = document.querySelector('canvas.scene-canvas, .scene-canvas');
      if (!canvas) return false;
      if (canvas.tabIndex < 0 && !canvas.hasAttribute('tabindex')) canvas.tabIndex = -1;
      canvas.focus({ preventScroll: true });
      return document.activeElement === canvas;
    });
  }
  function state(page) {
    if (!states.has(page)) states.set(page, { held: new Set(), chain: Promise.resolve() });
    return states.get(page);
  }
  function send(page, action) {
    const url = new URL(page.url());
    if (url.protocol !== 'https:' || !(url.hostname === 'meono.phanvanhoanganh.com' || url.hostname.endsWith('.meono.phanvanhoanganh.com'))) return Promise.reject(Error('Input is restricted to the game'));
    if (!action || !['keydown', 'keyup', 'click', 'move'].includes(action.t)) return Promise.reject(Error('Invalid input'));
    if (['keydown', 'keyup'].includes(action.t) && !allowedKeys.has(action.key) && !/^(Key[A-Z]|Digit[0-9])$/.test(action.key || '')) return Promise.reject(Error('Unsupported key'));
    if (['click', 'move'].includes(action.t) && (!Number.isFinite(action.x) || !Number.isFinite(action.y) || action.x < 0 || action.y < 0)) return Promise.reject(Error('Invalid pointer position'));
    const s = state(page);
    const task = s.chain.then(async () => {
      if (page.isClosed()) return;
      if (action.t === 'keydown') {
        if (!(await focusGame(page))) {
          for (const key of [...s.held]) { await page.keyboard.up(key); s.held.delete(key); }
          return;
        }
        if (!s.held.has(action.key) || (action.key === 'Shift' && action.repeat === true)) {
          await page.keyboard.down(action.key); s.held.add(action.key);
        }
      }
      else if (action.t === 'keyup' && s.held.has(action.key)) { await page.keyboard.up(action.key); s.held.delete(action.key); }
      else if (action.t === 'click') await page.mouse.click(action.x, action.y);
      else if (action.t === 'move') await page.mouse.move(action.x, action.y);
    });
    s.chain = task.catch(() => {});
    return task;
  }
  async function release(page) {
    const s = state(page);
    await s.chain;
    for (const key of [...s.held]) { try { await page.keyboard.up(key); } catch {} }
    s.held.clear();
  }
  return { send, release };
}
module.exports = { createBridge };
