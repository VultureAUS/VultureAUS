'use strict';

const contactForm = document.getElementById('contact-form');
const serviceSelect = document.getElementById('service');
const statusMessage = document.getElementById('form-status');

document.getElementById('year').textContent = new Date().getFullYear();

document.querySelectorAll('[data-service]').forEach((link) => {
  link.addEventListener('click', () => {
    serviceSelect.value = link.dataset.service;
  });
});

contactForm.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!contactForm.reportValidity()) return;
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
  statusMessage.hidden = false;
  statusMessage.textContent = 'Your email app will open with your enquiry. Please send it there. If it does not open, email contact@zaptech.com.au or call 03 4150 7515.';
});

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
