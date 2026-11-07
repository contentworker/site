/**
 * Helpers shared by the Worker (server render) and the browser. No DOM, no globals at import time.
 */

/**
 * Turns a string into a class name: lowercase letters, digits and single dashes.
 * @param {string} name
 * @returns {string}
 */
export function classNameOf(name) {
  return typeof name === 'string'
    ? name
        .toLowerCase()
        .replace(/[^0-9a-z]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
    : '';
}
