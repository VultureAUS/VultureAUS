'use strict';

const contactForm = document.getElementById('contact-form');
const serviceSelect = document.getElementById('service');
const statusMessage = document.getElementById('form-status');
const formNote = document.getElementById('form-note');
const sendButton = contactForm.querySelector('button[type="submit"]');
const buttonLabel = sendButton.firstChild;
let startedAt = Date.now();
let directSubmissionAvailable = false;
let submitting = false;

const readiness = fetch('/api/contact', { cache: 'no-store', signal: AbortSignal.timeout(5000) })
  .then(async (response) => {
    if (!response.ok) return;
    const config = await response.json();
    directSubmissionAvailable = config.enabled === true;
    if (directSubmissionAvailable) {
      formNote.textContent = '';
      formNote.hidden = true;
    }
  }).catch(() => {});

document.querySelectorAll('[data-service]').forEach((link) => {
  link.addEventListener('click', () => {
    serviceSelect.value = link.dataset.service;
  });
});

contactForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (submitting || !contactForm.reportValidity()) return;
  submitting = true;
  sendButton.disabled = true;
  contactForm.setAttribute('aria-busy', 'true');
  buttonLabel.textContent = 'Sending enquiry ';
  statusMessage.hidden = true;
  try {
    await readiness;
    if (!directSubmissionAvailable) {
      openEmailDraft();
      return;
    }
    const data = new FormData(contactForm);
    const response = await fetch('/api/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(20000),
      body: JSON.stringify({
        name: data.get('name').trim(),
        email: data.get('email').trim(),
        service: data.get('service'),
        message: data.get('message').trim(),
        companyWebsite: data.get('companyWebsite'),
        startedAt
      })
    });
    const result = await response.json();
    if (!response.ok || result.ok !== true) {
      throw new Error(result.error || 'We could not submit your enquiry. Please try again, or email contact@zaptech.com.au.');
    }
    contactForm.reset();
    startedAt = Date.now();
    showStatus("Thank you — your enquiry has been submitted. We'll be in touch within 1–2 business days.", 'success');
  } catch (error) {
    const message = error.name === 'TimeoutError' || error.name === 'AbortError' || error instanceof TypeError
      ? 'We could not confirm your submission. Your details are still here. Please email contact@zaptech.com.au or call 03 4150 7515 before trying again.'
      : error.message;
    showStatus(message, 'error');
  } finally {
    submitting = false;
    sendButton.disabled = false;
    contactForm.removeAttribute('aria-busy');
    buttonLabel.textContent = 'Send enquiry ';
  }
});

function showStatus(message, state) {
  statusMessage.textContent = message;
  statusMessage.dataset.state = state;
  statusMessage.hidden = false;
}

function openEmailDraft() {
  const data = new FormData(contactForm);
  const subject = `Zaptech enquiry — ${data.get('service')}`;
  const body = [
    `Name: ${data.get('name').trim()}`,
    `Email: ${data.get('email').trim()}`,
    `Service: ${data.get('service')}`,
    '',
    data.get('message').trim()
  ].join('\r\n');
  const mailto = `mailto:contact@zaptech.com.au?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  window.location.href = mailto;
  showStatus('Your email app will open with your enquiry. Please send it there. If it does not open, email contact@zaptech.com.au or call 03 4150 7515.', 'info');
}

if ('IntersectionObserver' in window) {
  const homeLink = document.querySelector('.nav-home');
  const contactLink = document.querySelector('.nav-contact');
  new IntersectionObserver(([entry]) => {
    const active = entry.isIntersecting ? contactLink : homeLink;
    const inactive = entry.isIntersecting ? homeLink : contactLink;
    active.setAttribute('aria-current', 'location');
    inactive.removeAttribute('aria-current');
  }, { threshold: 0.2 }).observe(document.getElementById('contact'));
}
