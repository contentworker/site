import { isSafeTokenValue } from '@contentworker/sdk/live-preview';

/**
 * The one way the runtime writes CSS custom properties from content: a `style` attribute value
 * of `--name:value` pairs, for `attrs({ style: ctx.cssVars({ '--card-accent': fields.accent }) })`.
 *
 * Every value goes through `@contentworker/sdk`'s `isSafeTokenValue` (the same check live preview
 * applies to token values), on every render, public or preview, whatever the value came from:
 * Delivery, a draft, or unsaved fields. A value that fails is dropped whole, never escaped or
 * trimmed into something else; so is a name that isn't a custom property name. Numbers are
 * written as they are. Null when nothing is left, so `attrs` writes no attribute at all.
 */
const NAME = /^--[A-Za-z][A-Za-z0-9-]{0,63}$/;

export function cssVars(vars: Record<string, unknown>): string | null {
  const out: string[] = [];
  for (const [name, raw] of Object.entries(vars)) {
    if (!NAME.test(name)) continue;
    const value = typeof raw === 'number' && Number.isFinite(raw) ? String(raw) : raw;
    if (typeof value !== 'string' || !value.trim() || !isSafeTokenValue(value)) continue;
    out.push(`${name}:${value.trim()}`);
  }
  return out.length ? out.join(';') : null;
}
