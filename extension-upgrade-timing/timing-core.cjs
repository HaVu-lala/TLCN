function createUpgradeTiming() {
  const randomDelayMs = (random = Math.random) => 10000 + Math.floor(Math.max(0, Math.min(1, random())) * 5000);
  async function wait({ delay, active, onTick = () => {}, now = Date.now, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
    const end = now() + delay;
    let previous = -1;
    while (active()) {
      const remaining = end - now();
      if (remaining <= 0) return true;
      const seconds = Math.ceil(remaining / 1000);
      if (seconds !== previous) { previous = seconds; onTick(seconds); }
      await sleep(Math.min(100, remaining));
    }
    return false;
  }
  return { randomDelayMs, wait };
}
module.exports = { createUpgradeTiming };
