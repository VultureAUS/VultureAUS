'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(require.resolve('../script.js'), 'utf8');

function setup({ configured = true, success = true, networkError = false, valid = true, deferPost = false } = {}) {
  let submit;
  let release;
  const posts = [];
  const status = { hidden: true, dataset: {} };
  const button = { firstChild: { textContent: 'Send enquiry ' }, disabled: false };
  const form = { resetCount: 0, reportValidity: () => valid, querySelector: () => button,
    addEventListener: (event, fn) => { submit = fn; }, setAttribute() {}, removeAttribute() {}, reset() { this.resetCount++; } };
  const fields = { name: 'Test Customer', email: 'customer@example.com', service: 'Technical Support', message: 'Please help & thanks.', companyWebsite: '' };
  const elements = { 'contact-form': form, service: {}, 'form-status': status, 'form-note': {}, year: {} };
  const window = { location: {} };
  const fetch = async (url, options = {}) => {
    if (options.method !== 'POST') return { ok: true, json: async () => ({ enabled: configured }) };
    posts.push({ url, ...options });
    if (deferPost) await new Promise(resolve => { release = resolve; });
    if (networkError) throw new TypeError('Network unavailable');
    return { ok: success, json: async () => success ? { ok: true } : { error: 'Please check your email address.' } };
  };
  vm.runInNewContext(source, {
    document: { getElementById: id => elements[id], querySelectorAll: () => [] },
    window, Date, AbortSignal, fetch, TypeError,
    FormData: class { get(key) { return fields[key]; } }, encodeURIComponent
  });
  return { submit: () => submit({ preventDefault() {} }), posts, status, button, form, elements, window, release: () => release() };
}

test('configured form sends JSON and clears fields only after confirmed success', async () => {
  const ui = setup();
  await ui.submit();
  assert.equal(ui.posts.length, 1);
  assert.equal(ui.posts[0].url, '/api/contact');
  assert.equal(JSON.parse(ui.posts[0].body).email, 'customer@example.com');
  assert.equal(ui.form.resetCount, 1);
  assert.equal(ui.status.dataset.state, 'success');
  assert.equal(ui.button.disabled, false);
  assert.equal(ui.window.location.href, undefined);
  assert(ui.elements['form-note'].textContent.includes('will be emailed'));
});
test('provider failure preserves fields and restores the send button', async () => {
  const ui = setup({ success: false });
  await ui.submit();
  assert.equal(ui.form.resetCount, 0);
  assert.equal(ui.status.dataset.state, 'error');
  assert.equal(ui.status.textContent, 'Please check your email address.');
  assert.equal(ui.button.disabled, false);
});
test('uncertain network failures do not retry, reset fields or claim success', async () => {
  const ui = setup({ networkError: true });
  await ui.submit();
  assert.equal(ui.posts.length, 1);
  assert.equal(ui.form.resetCount, 0);
  assert.equal(ui.status.dataset.state, 'error');
  assert(ui.status.textContent.includes('could not confirm'));
});
test('double submission sends one request while the first is pending', async () => {
  const ui = setup({ deferPost: true });
  const first = ui.submit();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(ui.button.disabled, true);
  await ui.submit();
  assert.equal(ui.posts.length, 1);
  ui.release();
  await first;
  assert.equal(ui.button.disabled, false);
});
test('unconfigured deployment retains the explicit email-app fallback', async () => {
  const ui = setup({ configured: false });
  await ui.submit();
  assert.equal(ui.posts.length, 0);
  assert(ui.window.location.href.startsWith('mailto:contact@zaptech.com.au?'));
  assert(decodeURIComponent(ui.window.location.href).includes('Please help & thanks.'));
  assert(ui.status.textContent.includes('Please send it there'));
  assert.equal(ui.form.resetCount, 0);
});
test('invalid forms send nothing', async () => {
  const ui = setup({ valid: false });
  await ui.submit();
  assert.equal(ui.posts.length, 0);
  assert.equal(ui.form.resetCount, 0);
});
