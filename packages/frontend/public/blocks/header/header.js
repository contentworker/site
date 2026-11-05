/**
 * Enhances the server-rendered header. The menu already works without JS (<details> + CSS :has); this adds
 * keyboard behaviour: Escape closes and returns focus, focus leaving the
 * nav closes it, and the menu resets when the viewport grows to desktop.
 * @param {Element} block
 */
export default function decorate(block) {
  /** @type {HTMLDetailsElement | null} */
  const menu = block.querySelector('details.nav-menu');
  const nav = block.querySelector('.nav');
  const summary = menu?.querySelector('summary');
  if (!menu || !nav || !summary) return;
  const desktop = window.matchMedia('(width >= 900px)');

  desktop.addEventListener('change', () => {
    if (desktop.matches) menu.open = false;
  });

  menu.addEventListener('toggle', () => {
    document.body.classList.toggle('nav-open', menu.open && !desktop.matches);
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && menu.open && !desktop.matches) {
      menu.open = false;
      summary.focus();
    }
  });
  nav.addEventListener('focusout', (e) => {
    const next = /** @type {Node | null} */ (/** @type {FocusEvent} */ (e).relatedTarget);
    if (!desktop.matches && !nav.contains(next)) menu.open = false;
  });
}
