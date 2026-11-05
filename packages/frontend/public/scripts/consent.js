/**
 * Placeholder consent check: declined by default, so consented.js
 * (analytics, marketing tags) never loads until a real consent manager replaces this.
 * Test with ?consent=accept.
 */
function hasConsent() {
  const param = new URLSearchParams(window.location.search).get('consent');
  return param !== null && ['accept', 'true', '1', 'yes'].includes(param.toLowerCase());
}

const consented = hasConsent();
window.dispatchEvent(new CustomEvent('consent.update', { detail: { consented } }));
if (consented) import('./consented.js');
