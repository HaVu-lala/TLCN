const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { clean, routeInfo, attach } = require('./http-diagnostics.cjs');
assert.deepEqual(routeInfo('https://play.meono.phanvanhoanganh.com:8443/api/test?token=private'), { host: 'play.meono.phanvanhoanganh.com:8443', path: '/api/test' });
assert.equal(routeInfo('https://example.com/'), null);
assert.ok(!clean('token=abc password=qwerty x@test.com Bearer xyz').includes('abc'));
assert.ok(!clean('token=abc password=qwerty x@test.com Bearer xyz').includes('qwerty'));
(async () => {
  const page = new EventEmitter(), rows = [];
  attach(page, row => rows.push(row));
  page.emit('response', { status: () => 422, url: () => 'https://meono.phanvanhoanganh.com/api/forge?csrf=secret',
    request: () => ({ method: () => 'POST', resourceType: () => 'fetch' }),
    headers: () => ({ 'content-type': 'application/json' }),
    json: async () => ({ message: 'Thiếu đá', token: 'not-logged', errors: { stones: ['private extra detail'] } }) });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(rows[0].message, 'Thiếu đá'); assert.equal(rows[0].status, 422);
  assert.deepEqual(rows[0].errorFields, ['stones']);
  assert.ok(!JSON.stringify(rows).includes('secret')); assert.ok(!JSON.stringify(rows).includes('not-logged'));
  console.log('PASS: game-only errors, query omission, secret redaction, status and validation-message capture');
})().catch(error => { console.error(error); process.exitCode = 1; });
