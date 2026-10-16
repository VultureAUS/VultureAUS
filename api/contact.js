'use strict';

const { createHash } = require('node:crypto');
const { sendSmtp, jetEmailSelected, jetEmailConfigured } = require('../lib/smtp');

const SERVICES = new Set([
  'Web & Software Development', 'AI & Automation', 'Business Email & Cloud',
  'Business Cyber Security', 'Technical Support', 'Something else'
]);
const MAX_BODY_BYTES = 24576;
const WINDOW_MS = 10 * 60 * 1000;
// Best-effort per-instance throttling; use Vercel Firewall for a distributed limit.
const attempts = new Map();

function reply(res, status, body) {
  return res.status(status).json(body);
}

function isConfigured() {
  if (jetEmailSelected()) return jetEmailConfigured();
  const token = process.env.POSTMARK_SERVER_TOKEN?.trim();
  return Boolean(token && token.toUpperCase() !== 'POSTMARK_API_TEST');
}

async function checkServer() {
  if (!isConfigured()) return { enabled: false, tokenValid: false };
  if (jetEmailSelected()) return { enabled: true, provider: 'JetEmail', transport: 'smtp', diagnosticNote: 'SMTP configuration is present. Authentication and delivery are not yet verified by this check.' };
  try {
    const response = await fetch('https://api.postmarkapp.com/server', {
      headers: { Accept: 'application/json', 'X-Postmark-Server-Token': process.env.POSTMARK_SERVER_TOKEN.trim() },
      signal: AbortSignal.timeout(8000)
    });
    const server = await response.json();
    if (!response.ok || !Number.isInteger(server.ID)) return { enabled: true, tokenValid: false };
    // The upstream response includes API tokens: return only these non-secret diagnostic fields.
    return { enabled: true, tokenValid: true, serverId: server.ID, deliveryType: server.DeliveryType || 'Live' };
  } catch {
    return { enabled: true, tokenValid: null, diagnosticError: 'Postmark could not be reached.' };
  }
}

function allowedOrigins() {
  const origins = new Set(['https://website-zaptech1.vercel.app']);
  for (const host of [process.env.VERCEL_URL, process.env.VERCEL_PROJECT_PRODUCTION_URL]) {
    if (host) origins.add(`https://${host}`);
  }
  for (const origin of (process.env.CONTACT_ALLOWED_ORIGINS || '').split(',')) {
    if (origin.trim()) origins.add(origin.trim());
  }
  return origins;
}

function rateLimited(req) {
  const ip = process.env.VERCEL === '1'
    ? req.headers['x-vercel-forwarded-for']
    : req.socket?.remoteAddress;
  if (typeof ip !== 'string' || !ip) return false;
  const now = Date.now();
  const key = createHash('sha256').update(ip.split(',')[0].trim()).digest('hex');
  for (const [id, entry] of attempts) {
    if (entry.expiresAt <= now) attempts.delete(id);
  }
  const entry = attempts.get(key);
  if (entry) {
    if (entry.count >= 5) return true;
    entry.count += 1;
  } else {
    if (attempts.size >= 10000) return true;
    attempts.set(key, { count: 1, expiresAt: now + WINDOW_MS });
  }
  return false;
}

module.exports = async function contact(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method === 'GET') {
    const diagnostic = new URL(req.url || '/', 'https://website-zaptech1.vercel.app').searchParams.get('check') === 'server';
    return reply(res, 200, diagnostic ? await checkServer() : { enabled: isConfigured() });
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return reply(res, 405, { error: 'Method not allowed.' });
  }
  if (!allowedOrigins().has(req.headers.origin)) {
    return reply(res, 403, { error: 'Please submit your enquiry from the Zaptech website.' });
  }
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) {
    return reply(res, 415, { error: 'Please submit the form using the website.' });
  }
  try {
    let body = req.body;
    if (Number(req.headers['content-length']) > MAX_BODY_BYTES) {
      return reply(res, 413, { error: 'Your enquiry is too long. Please shorten your message.' });
    }
    if (Buffer.isBuffer(body)) body = body.toString('utf8');
    if (typeof body === 'string') {
      if (Buffer.byteLength(body) > MAX_BODY_BYTES) return reply(res, 413, { error: 'Your enquiry is too long.' });
      try { body = JSON.parse(body); }
      catch { return reply(res, 400, { error: 'Please check your details and try again.' }); }
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return reply(res, 400, { error: 'Please check your details and try again.' });
    }
    if (Buffer.byteLength(JSON.stringify(body)) > MAX_BODY_BYTES) return reply(res, 413, { error: 'Your enquiry is too long.' });
    if (body.companyWebsite !== undefined && body.companyWebsite !== null && body.companyWebsite !== '') {
      return reply(res, 400, { error: 'Unable to submit this enquiry. Please contact us by email or phone.' });
    }
    const elapsed = Date.now() - body.startedAt;
    if (!Number.isFinite(body.startedAt) || elapsed < 1500 || elapsed > 24 * 60 * 60 * 1000) {
      return reply(res, 400, { error: 'Please take a moment to check your details, then submit again. If this page has been open all day, refresh it first.' });
    }
    const fields = {};
    for (const key of ['name', 'email', 'service', 'message']) {
      if (typeof body[key] !== 'string') return reply(res, 400, { error: 'Please complete all fields.' });
      fields[key] = body[key].trim();
    }
    if (!fields.name || fields.name.length > 120 || /[\x00-\x1f\x7f]/.test(fields.name)) {
      return reply(res, 400, { error: 'Please enter a name of up to 120 characters.' });
    }
    if (fields.email.length > 254 || !/^[^\s@<>,;:]+@[^\s@<>,;:]+\.[^\s@<>,;:]+$/.test(fields.email)) {
      return reply(res, 400, { error: 'Please enter a valid email address.' });
    }
    if (!SERVICES.has(fields.service)) return reply(res, 400, { error: 'Please select a service.' });
    if (!fields.message || fields.message.length > 5000 || fields.message.includes('\x00')) {
      return reply(res, 400, { error: 'Please enter a message of up to 5,000 characters.' });
    }
    if (!isConfigured()) return reply(res, 503, { error: 'Online enquiries are temporarily unavailable. Please email contact@zaptech.com.au or call 03 4150 7515.' });
    if (rateLimited(req)) {
      res.setHeader('Retry-After', '600');
      return reply(res, 429, { error: 'Too many enquiries in a short time. Please try again in 10 minutes, or call 03 4150 7515.' });
    }
    if (jetEmailSelected() || (process.env.POSTMARK_TRANSPORT || 'smtp').toLowerCase() === 'smtp') {
      const reference = await sendSmtp(fields);
      return reply(res, 200, { ok: true, messageId: reference });
    }
    const response = await fetch('https://api.postmarkapp.com/email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Postmark-Server-Token': process.env.POSTMARK_SERVER_TOKEN.trim()
      },
      signal: AbortSignal.timeout(10000),
      body: JSON.stringify({
        From: 'Zaptech Australia <contact@zaptech.com.au>',
        To: 'contact@zaptech.com.au',
        ReplyTo: fields.email,
        Subject: `Website enquiry — ${fields.service}`,
        TextBody: [
          'New Zaptech Australia website enquiry', '',
          `Name: ${fields.name}`, `Email: ${fields.email}`, `Service: ${fields.service}`,
          '', fields.message
        ].join('\n'),
        MessageStream: 'outbound',
        Tag: 'website-enquiry',
        TrackOpens: false,
        TrackLinks: 'None'
      })
    });
    const result = await response.json();
    // Keep provider diagnostics in private runtime logs; never log credentials or enquiry fields.
    const providerMessage = typeof result.Message === 'string' ? result.Message.trim() : '';
    const isLiveAcceptance = providerMessage === 'OK';
    console.info('postmark_send_result', JSON.stringify({
      deploymentId: process.env.VERCEL_DEPLOYMENT_ID || null,
      status: response.status,
      errorCode: Number.isInteger(result.ErrorCode) ? result.ErrorCode : null,
      providerMessage: ['OK', 'Test job accepted'].includes(providerMessage) ? providerMessage : 'Unrecognised response',
      messageId: typeof result.MessageID === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(result.MessageID) ? result.MessageID : null
    }));
    if (!response.ok || result.ErrorCode !== 0 || !isLiveAcceptance || typeof result.MessageID !== 'string' || !result.MessageID.trim()) {
      return reply(res, 502, { error: 'We could not submit your enquiry. Your details are still here. Please email contact@zaptech.com.au or call 03 4150 7515.' });
    }
    return reply(res, 200, { ok: true, messageId: result.MessageID });
  } catch (error) {
    console.warn('contact_send_failed', JSON.stringify({
      transport: jetEmailSelected() ? 'jetemail-smtp' : (process.env.POSTMARK_TRANSPORT || 'smtp').toLowerCase(),
      deploymentId: process.env.VERCEL_DEPLOYMENT_ID || null,
      code: typeof error.code === 'string' && /^[A-Z0-9_]{1,40}$/.test(error.code) ? error.code : 'SEND_FAILED',
      responseCode: Number.isInteger(error.responseCode) ? error.responseCode : null
    }));
    return reply(res, 502, { error: 'We could not confirm your submission. Please email contact@zaptech.com.au or call 03 4150 7515 before trying again.' });
  }
};
