# Performance budget

The target is Lighthouse 100 in all four categories, on mobile and desktop, for every page. These
budgets keep it there as a site adds blocks. `budgets.json` is enforced by `npm run budgets` in CI.

| What                                               | Budget (gzip)                          | Why                                                                                               |
| -------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `styles/critical.css`                              | 8 KB                                   | The only render-blocking stylesheet.                                                              |
| Critical JS (`enhance.js`, `boot.js`, `shared.js`) | 10 KB                                  | Modules never block, but they compete with the LCP image.                                         |
| Deferred CSS (`deferred.css`, `fonts.css`)         | 8 KB                                   | Loaded after the first section.                                                                   |
| Idle JS                                            | 20 KB                                  | Runs 3 s after `load`; still counts toward TBT on slow phones.                                    |
| Preview JS (`live-preview.js`)                     | 4 KB                                   | Loads only on `/__preview` pages showing a draft, never on a public page.                         |
| Preview CSS (`preview.css`)                        | 1 KB                                   | Linked only by the live preview script, once the admin frames the page.                           |
| Vendored live preview SDK (`scripts/vendor/sdk/`)  | 20 KB                                  | `@contentworker/sdk/live-preview` as published (16 KB today), imported only by `live-preview.js`. |
| Each block                                         | 3 KB CSS, 4 KB JS                      | Blocks add up; a block over this needs a recorded reason.                                         |
| HTML document                                      | first 14 KB holds head + first section | One round trip to first paint.                                                                    |
| Requests before LCP                                | ≤ 5                                    | Document, critical.css, boot.js (+ enhance.js preloaded), LCP image, first-section block CSS.     |
| Third-party before `load`                          | 0                                      |                                                                                                   |

Field targets (p75): LCP ≤ 1.2 s, CLS ≤ 0.02, INP ≤ 100 ms. Lab: TBT ≤ 50 ms.

## How it's enforced

1. **Size:** `npm run budgets` (CI `verify`) fails over any number above.
2. **Lab:** `npm run lighthouse` (CI `lighthouse`) fails when any fixture page scores below 100 in
   any category, on mobile or desktop. It runs Lighthouse 13 against the real Worker with a mock
   Delivery API, one warm-up run, then the median of three runs per page.
3. **Field:** `psi.yml` runs PageSpeed Insights nightly on every sitemap URL in production and
   opens an issue on any page below 100 (needs `PSI_API_KEY` and the `SITE_LIVE` variable).

## Exceptions

Record each raised budget here: the block or file, the new number, the measurement that shows
Lighthouse still scores 100, and the date.

- **Vendored live preview SDK, 20 KB (2026-11-09).** The channel's frontend half
  (`connectPreview`, message schemas, patching, layout) as `@contentworker/sdk@0.3.0` publishes it,
  copied unminified by `scripts/embed-assets.ts`: 15,966 B gzip. It loads only on `/__preview`
  pages showing a draft, after the page has painted, so it never reaches a public page or the
  Lighthouse fixtures. The budget leaves room for SDK patch releases; a larger jump needs a look.

## Measured decisions

Record Early Hints, preconnect and font-preload experiments here (WebPageTest A/B, median of 9 runs).

_None yet._
