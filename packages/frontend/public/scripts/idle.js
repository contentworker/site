/**
 * The idle phase: anything that must not affect LCP, INP or TBT. Loaded 3 s after `load`.
 * Consent gates everything that tracks; add first-party, non-tracking work below it.
 */
import './consent.js';
