'use strict';
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
let handler;
let sent;
const originalFetch = global.fetch;
const originalEnv = { ...process.env };
const valid = () => ({ name: 'Test Customer', email: 'customer@example.com', service: 'Business Email & Cloud', message: 'A test enquiry & a question.', companyWebsite: '', startedAt: Date.now() - 5000 });

beforeEach(() => {
  delete require.cache[require.resolve('../api/contact.js')];
  handler = require('../api/contact.js');
  process.env.POSTMARK_SERVER_TOKEN = 'mock-server-token';
  delete process.env.CONTACT_ALLOWED_ORIGINS;
  delete process.env.VERCEL;
  sent = [];
  global.fetch = async (url, options) => {
    sent.push({ url, options, body: JSON.parse(options.body) });
    return { ok: true, json: async () => ({ ErrorCode: 0, MessageID: 'mock-message' }) };
  };
});
afterEach(() => { global.fetch = originalFetch; process.env = { ...originalEnv }; });

async function call({ method = 'POST', body = valid(), headers = {}, ip = '127.0.0.1', url = '/api/contact' } = {}) {
  const response = { headers: {}, setHeader(key, value) { this.headers[key] = value; }, status(value) { this.code = value; return this; }, json(value) { this.body = value; return this; } };
  await handler({ method, body, url, headers: { origin: 'https://website-zaptech1.vercel.app', 'content-type': 'application/json', ...headers }, socket: { remoteAddress: ip } }, response);
  return response;
}

test('availability reveals no token; missing and test tokens do not enable sending', async () => {
  let response = await call({ method: 'GET' });
  assert.deepEqual(response.body, { enabled: true });
  assert.equal(response.headers['Cache-Control'], 'no-store');
  assert(!JSON.stringify(response.body).includes('mock-server-token'));
  delete process.env.POSTMARK_SERVER_TOKEN;
  assert.deepEqual((await call({ method: 'GET' })).body, { enabled: false });
  process.env.POSTMARK_SERVER_TOKEN = 'POSTMARK_API_TEST';
  assert.deepEqual((await call({ method: 'GET' })).body, { enabled: false });
  assert.equal(sent.length, 0);
});
test('sends only to Zaptech with visitor Reply-To and plain-text body', async () => {
  const body = { ...valid(), to: 'attacker@example.com', from: 'spoof@example.com', message: '<script>alert(1)</script> & question' };
  const response = await call({ body });
  assert.equal(response.code, 200);
  assert.deepEqual(response.body, { ok: true, messageId: 'mock-message' });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, 'https://api.postmarkapp.com/email');
  assert.equal(sent[0].options.headers['X-Postmark-Server-Token'], 'mock-server-token');
  assert.equal(sent[0].body.To, 'contact@zaptech.com.au');
  assert.equal(sent[0].body.From, 'Zaptech Australia <contact@zaptech.com.au>');
  assert.equal(sent[0].body.ReplyTo, 'customer@example.com');
  assert.equal(sent[0].body.MessageStream, 'outbound');
  assert.equal(sent[0].body.HtmlBody, undefined);
  assert(sent[0].body.TextBody.includes(body.message));
  assert(!JSON.stringify(response.body).includes('mock-server-token'));
});
test('accepts Vercel deployment origins and explicitly configured custom domains', async () => {
  process.env.VERCEL_URL = 'website-123.vercel.app';
  process.env.CONTACT_ALLOWED_ORIGINS = 'https://zaptech.com.au, https://www.zaptech.com.au';
  assert.equal((await call({ headers: { origin: 'https://website-123.vercel.app' } })).code, 200);
  assert.equal((await call({ headers: { origin: 'https://www.zaptech.com.au' } })).code, 200);
});
test('rejects unsupported methods, foreign origins and non-JSON requests without sending', async () => {
  assert.equal((await call({ method: 'PUT' })).code, 405);
  assert.equal((await call({ headers: { origin: 'https://attacker.example' } })).code, 403);
  assert.equal((await call({ headers: { origin: undefined } })).code, 403);
  assert.equal((await call({ headers: { 'content-type': 'application/x-www-form-urlencoded' } })).code, 415);
  assert.equal(sent.length, 0);
});
test('rejects missing fields, invalid emails, header injection and unlisted services', async () => {
  const badBodies = [
    { ...valid(), name: '' }, { ...valid(), name: 'Bad\r\nBcc: other@example.com' },
    { ...valid(), email: 'bad-address' }, { ...valid(), email: 'a@b.com\r\nBcc:c@d.com' },
    { ...valid(), service: 'Unlisted' }, { ...valid(), message: '' },
    { ...valid(), message: 'x'.repeat(5001) }, { ...valid(), email: ['a@b.com'] }, [], null
  ];
  for (const body of badBodies) assert.equal((await call({ body })).code, 400);
  assert.equal(sent.length, 0);
});
test('rejects malformed and oversized bodies', async () => {
  assert.equal((await call({ body: '{bad json' })).code, 400);
  assert.equal((await call({ headers: { 'content-length': '25000' } })).code, 413);
  assert.equal((await call({ body: { ...valid(), extra: 'x'.repeat(25000) } })).code, 413);
  assert.equal(sent.length, 0);
});
test('accepts raw JSON and Buffer bodies', async () => {
  assert.equal((await call({ body: JSON.stringify(valid()) })).code, 200);
  assert.equal((await call({ body: Buffer.from(JSON.stringify(valid())) })).code, 200);
});
test('rejects honeypot and implausible form completion times', async () => {
  for (const body of [
    { ...valid(), companyWebsite: 'spam.example' }, { ...valid(), startedAt: Date.now() },
    { ...valid(), startedAt: Date.now() + 5000 }, { ...valid(), startedAt: 'yesterday' },
    { ...valid(), startedAt: Date.now() - 90000000 }
  ]) assert.equal((await call({ body })).code, 400);
  assert.equal(sent.length, 0);
});
test('missing configuration returns an actionable error without sending', async () => {
  delete process.env.POSTMARK_SERVER_TOKEN;
  assert.equal((await call()).code, 503);
  assert.equal(sent.length, 0);
});
test('throttles repeated requests per IP without blocking a different IP', async () => {
  for (let i = 0; i < 5; i++) assert.equal((await call()).code, 200);
  const response = await call();
  assert.equal(response.code, 429);
  assert.equal(response.headers['Retry-After'], '600');
  assert.equal((await call({ ip: '127.0.0.2' })).code, 200);
  assert.equal(sent.length, 6);
});
test('provider rejection, authentication failure, timeout and malformed responses never report success', async () => {
  for (const provider of [
    async () => ({ ok: true, json: async () => ({ ErrorCode: 300 }) }),
    async () => ({ ok: true, json: async () => ({ ErrorCode: 0 }) }),
    async () => ({ ok: false, json: async () => ({ ErrorCode: 10, Message: 'mock sensitive provider detail' }) }),
    async () => { throw new Error('mock network error'); },
    async () => ({ ok: true, json: async () => { throw new SyntaxError('invalid'); } })
  ]) {
    global.fetch = provider;
    const response = await call();
    assert.notEqual(response.code, 200);
    assert.equal(response.body.ok, undefined);
    assert(!JSON.stringify(response.body).includes('mock sensitive'));
  }
});

test('server diagnostics expose only selected metadata, never upstream tokens or hooks', async () => {
  global.fetch = async (url, options) => {
    assert.equal(url, 'https://api.postmarkapp.com/server');
    assert.equal(options.headers['X-Postmark-Server-Token'], 'mock-server-token');
    return { ok: true, json: async () => ({ ID: 11146424, Name: 'Zaptech', DeliveryType: 'Live', ApiTokens: ['do-not-leak'], InboundHookUrl: 'private-hook' }) };
  };
  const response = await call({ method: 'GET', url: '/api/contact?check=server' });
  assert.deepEqual(response.body, { enabled: true, tokenValid: true, serverId: 11146424, deliveryType: 'Live' });
  assert(!JSON.stringify(response.body).includes('do-not-leak'));
  assert(!JSON.stringify(response.body).includes('private-hook'));
});

test('diagnostics identify sandbox and invalid tokens without sending mail', async () => {
  global.fetch = async () => ({ ok: true, json: async () => ({ ID: 12, DeliveryType: 'Sandbox' }) });
  assert.equal((await call({ method: 'GET', url: '/api/contact?check=server' })).body.deliveryType, 'Sandbox');
  global.fetch = async () => ({ ok: false, json: async () => ({ ErrorCode: 10 }) });
  assert.deepEqual((await call({ method: 'GET', url: '/api/contact?check=server' })).body, { enabled: true, tokenValid: false });
  assert.equal(sent.length, 0);
});
