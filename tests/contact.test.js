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
  process.env.POSTMARK_TRANSPORT = 'api';
  delete process.env.JETEMAIL_SMTP_HOST;
  delete process.env.JETEMAIL_SMTP_USERNAME;
  delete process.env.JETEMAIL_SMTP_PASSWORD;
  delete process.env.CONTACT_ALLOWED_ORIGINS;
  delete process.env.VERCEL;
  sent = [];
  global.fetch = async (url, options) => {
    sent.push({ url, options, body: JSON.parse(options.body) });
    return { ok: true, status: 200, json: async () => ({ ErrorCode: 0, Message: 'OK', MessageID: 'mock-message' }) };
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
  process.env.POSTMARK_SERVER_TOKEN = '  postmark_api_test  ';
  assert.deepEqual((await call({ method: 'GET' })).body, { enabled: false });
  assert.equal((await call()).code, 503);
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
test('accepts both Zaptech domains by default without sending invalid submissions', async () => {
  for (const origin of ['https://zaptech.com.au', 'https://www.zaptech.com.au']) {
    assert.equal((await call({ body: {}, headers: { origin } })).code, 400);
  }
  assert.equal((await call({ body: {}, headers: { origin: 'https://zaptech.com.au.attacker.example' } })).code, 403);
  assert.equal(sent.length, 0);
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

test('dry-run acceptance never reports a sent enquiry and logs no token or enquiry content', async () => {
  const originalInfo = console.info;
  const logs = [];
  console.info = (...values) => logs.push(values.join(' '));
  try {
    global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ErrorCode: 0, Message: 'Test job accepted', MessageID: 'dry-run-reference' }) });
    const response = await call();
    assert.equal(response.code, 502);
    assert.equal(response.body.ok, undefined);
    assert(logs.join('').includes('Test job accepted'));
    for (const secret of ['mock-server-token', 'Test Customer', 'customer@example.com', 'A test enquiry']) assert(!logs.join('').includes(secret));
  } finally { console.info = originalInfo; }
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

test('SMTP default reuses the secret with mandatory TLS and waits for recipient acceptance', async () => {
  const nodemailer = require('nodemailer');
  const original = nodemailer.createTransport;
  let config, mail, closed = false;
  delete process.env.POSTMARK_TRANSPORT;
  nodemailer.createTransport = options => {
    config = options;
    return { sendMail: async value => { mail = value; return { accepted: ['contact@zaptech.com.au'], rejected: [], response: '250 2.0.0 Message accepted' }; }, close: () => { closed = true; } };
  };
  try {
    const response = await call();
    assert.equal(response.code, 200);
    assert.match(response.body.messageId, /^[a-f0-9-]{36}$/);
    assert.equal(config.host, 'smtp.postmarkapp.com');
    assert.equal(config.port, 587);
    assert.equal(config.requireTLS, true);
    assert.equal(config.tls.minVersion, 'TLSv1.2');
    assert.deepEqual(config.auth, { user: 'mock-server-token', pass: 'mock-server-token' });
    assert.equal(mail.to, 'contact@zaptech.com.au');
    assert.equal(mail.replyTo, 'customer@example.com');
    assert.equal(mail.headers['X-PM-Message-Stream'], 'outbound');
    assert.equal(mail.headers['X-PM-Metadata-enquiry-reference'], response.body.messageId);
    assert.equal(mail.messageId, `<${response.body.messageId}@zaptech.com.au>`);
    assert.equal(closed, true);
    assert.equal(sent.length, 0);
  } finally { nodemailer.createTransport = original; }
});

test('SMTP rejection and timeout fail without API fallback or automatic retry', async () => {
  const nodemailer = require('nodemailer');
  const original = nodemailer.createTransport;
  process.env.POSTMARK_TRANSPORT = 'smtp';
  let attempts = 0, closed = 0;
  try {
    for (const outcome of [
      { accepted: [], rejected: ['contact@zaptech.com.au'], response: '550 rejected' },
      { accepted: ['contact@zaptech.com.au'], rejected: [], response: '451 Try later' },
      Object.assign(new Error('private credential details'), { code: 'ETIMEDOUT' })
    ]) {
      nodemailer.createTransport = () => ({ sendMail: async () => { attempts++; if (outcome instanceof Error) throw outcome; return outcome; }, close: () => { closed++; } });
      const response = await call();
      assert.equal(response.code, 502);
      assert.equal(response.body.ok, undefined);
      assert(!JSON.stringify(response.body).includes('private credential'));
    }
    assert.equal(attempts, 3);
    assert.equal(closed, 3);
    assert.equal(sent.length, 0);
  } finally { nodemailer.createTransport = original; }
});

test('JetEmail takes precedence, uses separate SMTP credentials and does not query Postmark', async () => {
  const nodemailer = require('nodemailer');
  const original = nodemailer.createTransport;
  delete process.env.POSTMARK_SERVER_TOKEN;
  process.env.JETEMAIL_SMTP_HOST = 'smtp.example.test';
  process.env.JETEMAIL_SMTP_USERNAME = 'mock-jet-user';
  process.env.JETEMAIL_SMTP_PASSWORD = 'mock-jet-secret';
  let options, message;
  nodemailer.createTransport = config => { options = config; return { sendMail: async mail => { message = mail; return { accepted: ['contact@zaptech.com.au'], rejected: [], response: '250 Accepted' }; }, close() {} }; };
  try {
    assert.deepEqual((await call({ method: 'GET' })).body, { enabled: true });
    const diagnostic = await call({ method: 'GET', url: '/api/contact?check=server' });
    assert.equal(diagnostic.body.provider, 'JetEmail');
    assert(!JSON.stringify(diagnostic.body).includes('mock-jet-secret'));
    assert.equal((await call()).code, 200);
    assert.equal(options.host, 'smtp.example.test');
    assert.deepEqual(options.auth, { user: 'mock-jet-user', pass: 'mock-jet-secret' });
    assert.equal(options.requireTLS, true);
    assert.equal(message.headers['X-PM-Message-Stream'], undefined);
    assert.equal(sent.length, 0);
  } finally { nodemailer.createTransport = original; }
});

test('incomplete JetEmail credentials disable sending rather than falling back to Postmark', async () => {
  process.env.JETEMAIL_SMTP_HOST = 'smtp.example.test';
  assert.deepEqual((await call({ method: 'GET' })).body, { enabled: false });
  assert.equal((await call()).code, 503);
  assert.equal(sent.length, 0);
});

test('diagnostics identify sandbox and invalid tokens without sending mail', async () => {
  global.fetch = async () => ({ ok: true, json: async () => ({ ID: 12, DeliveryType: 'Sandbox' }) });
  assert.equal((await call({ method: 'GET', url: '/api/contact?check=server' })).body.deliveryType, 'Sandbox');
  global.fetch = async () => ({ ok: false, json: async () => ({ ErrorCode: 10 }) });
  assert.deepEqual((await call({ method: 'GET', url: '/api/contact?check=server' })).body, { enabled: true, tokenValid: false });
  assert.equal(sent.length, 0);
});
