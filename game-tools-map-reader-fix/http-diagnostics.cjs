function clean(message) {
  return String(message || '').replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[email]')
    .replace(/\bBearer\s+\S+/gi, '[authorization]')
    .replace(/\b(?:token|password|secret|cookie|session|csrf)["']?\s*[:=]\s*["']?[^\s,"'}]+/gi, '[redacted]')
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '[identifier]').slice(0, 500);
}
function routeInfo(raw) {
  const u = new URL(raw);
  if (u.protocol !== 'https:' || !(u.hostname === 'meono.phanvanhoanganh.com' || u.hostname.endsWith('.meono.phanvanhoanganh.com'))) return null;
  return { host: u.host, path: u.pathname.replace(/\b\d{5,}\b/g, ':id') };
}
function attach(page, write) {
  let count = 0;
  page.on('response', async response => {
    try {
      if (response.status() < 400 || count >= 100) return;
      const location = routeInfo(response.url()); if (!location) return;
      count++;
      const request = response.request();
      const row = { time: new Date().toISOString(), ...location, method: request.method(), status: response.status(), type: request.resourceType() };
      const headers = response.headers();
      if ((headers['content-type'] || '').includes('application/json') && Number(headers['content-length'] || 0) <= 65536) {
        const data = await response.json();
        if (typeof data?.message === 'string') row.message = clean(data.message);
        if (typeof data?.error === 'string') row.error = clean(data.error);
        if (data?.errors && typeof data.errors === 'object') row.errorFields = Object.keys(data.errors).slice(0, 12).map(clean);
      }
      write(row);
    } catch (_) { /* Diagnostics must not disrupt game requests. */ }
  });
  page.on('requestfailed', request => {
    try {
      if (count >= 100) return;
      const location = routeInfo(request.url()); if (!location) return;
      count++;
      write({ time: new Date().toISOString(), ...location, method: request.method(), type: request.resourceType(), networkError: clean(request.failure()?.errorText) });
    } catch (_) {}
  });
}
module.exports = { clean, routeInfo, attach };
