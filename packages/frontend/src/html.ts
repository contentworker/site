/**
 * Safe HTML building. Every interpolated value is escaped unless it is already a `Safe` (the
 * output of `html` or `raw`). Content from the CMS is data, never markup.
 */

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** @param {unknown} value */
export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);
}

export class Safe {
  readonly value: string;
  constructor(value: string) {
    this.value = value;
  }

  toString() {
    return this.value;
  }
}

/** Marks a string as trusted markup. Use only for markup this codebase produced. */
export const raw = (value: string): Safe => new Safe(value);

/** @param {unknown} value */
function interpolate(value: unknown): string {
  if (value == null || value === false) return '';
  if (value instanceof Safe) return value.value;
  if (Array.isArray(value)) return value.map(interpolate).join('');
  return escapeHtml(value);
}

/**
 * Tagged template: html`<p>${text}</p>`. Arrays are joined, null/undefined/false render nothing.
 * @returns {Safe}
 */
export function html(strings: TemplateStringsArray, ...values: unknown[]): Safe {
  let out = strings[0] ?? '';
  for (let i = 0; i < values.length; i += 1) out += interpolate(values[i]) + (strings[i + 1] ?? '');
  return new Safe(out);
}

/** An attribute list from an object; `true` renders a bare attribute, null/false skips it. */
export function attrs(map: Record<string, string | number | boolean | null | undefined>): Safe {
  return raw(
    Object.entries(map)
      .filter(([, v]) => v != null && v !== false)
      .map(([k, v]) => (v === true ? ` ${k}` : ` ${k}="${escapeHtml(v)}"`))
      .join(''),
  );
}

/** JSON for an inline <script type="application/ld+json">: `<` can never close the element. */
export function jsonForScript(value: unknown): Safe {
  return raw(JSON.stringify(value).replace(/</g, '\\u003c'));
}
