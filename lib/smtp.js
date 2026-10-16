'use strict';
const nodemailer = require('nodemailer');
const { randomUUID } = require('node:crypto');

function jetEmailSelected() {
  return ['JETEMAIL_SMTP_HOST', 'JETEMAIL_SMTP_USERNAME', 'JETEMAIL_SMTP_PASSWORD'].some(key => Boolean(process.env[key]));
}

function jetEmailConfigured() {
  return Boolean(process.env.JETEMAIL_SMTP_HOST?.trim() && process.env.JETEMAIL_SMTP_USERNAME?.trim() && process.env.JETEMAIL_SMTP_PASSWORD);
}

async function sendSmtp(fields) {
  const jetEmail = jetEmailSelected();
  const token = process.env.POSTMARK_SERVER_TOKEN?.trim();
  const transport = nodemailer.createTransport({
    host: jetEmail ? process.env.JETEMAIL_SMTP_HOST.trim() : 'smtp.postmarkapp.com',
    port: 587,
    secure: false,
    requireTLS: true,
    tls: { minVersion: 'TLSv1.2' },
    auth: jetEmail ? { user: process.env.JETEMAIL_SMTP_USERNAME.trim(), pass: process.env.JETEMAIL_SMTP_PASSWORD } : { user: token, pass: token },
    connectionTimeout: 5000,
    greetingTimeout: 5000,
    socketTimeout: 10000,
    logger: false,
    debug: false
  });
  // This is our enquiry reference, not Postmark's REST MessageID.
  const reference = randomUUID();
  try {
    const info = await transport.sendMail({
      from: 'Zaptech Australia <contact@zaptech.com.au>',
      to: 'contact@zaptech.com.au',
      replyTo: fields.email,
      subject: `Website enquiry — ${fields.service}`,
      text: ['New Zaptech Australia website enquiry', '', `Reference: ${reference}`,
        `Name: ${fields.name}`, `Email: ${fields.email}`, `Service: ${fields.service}`, '', fields.message].join('\n'),
      messageId: `<${reference}@zaptech.com.au>`,
      headers: jetEmail ? { 'X-Enquiry-Reference': reference } : { 'X-PM-Message-Stream': 'outbound', 'X-PM-Tag': 'website-enquiry',
        'X-PM-Metadata-enquiry-reference': reference, 'X-PM-KeepID': 'true',
        'X-PM-TrackOpens': 'false', 'X-PM-TrackLinks': 'None' },
      disableFileAccess: true,
      disableUrlAccess: true
    });
    const accepted = info.accepted?.some(address => typeof address === 'string' && address.toLowerCase() === 'contact@zaptech.com.au');
    if (!accepted || info.rejected?.length || !/^250(?:[ -]|$)/.test(info.response || '')) {
      const error = new Error('SMTP did not confirm acceptance');
      error.code = 'SMTP_NOT_ACCEPTED';
      throw error;
    }
    console.info(jetEmail ? 'jetemail_smtp_result' : 'postmark_smtp_result', JSON.stringify({
      deploymentId: process.env.VERCEL_DEPLOYMENT_ID || null,
      status: 'accepted', responseCode: 250, reference
    }));
    return reference;
  } finally { transport.close(); }
}

module.exports = { sendSmtp, jetEmailSelected, jetEmailConfigured };
