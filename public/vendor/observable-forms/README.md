# Vendored: observable-forms

`markdown-it-form.js`/`form.css` copied verbatim from
[rinie/observable-forms](https://github.com/rinie/observable-forms)
at commit `2ccb5af` (2026-07-13), MIT licensed (`LICENSE` in this
directory).

Vendored rather than an npm dependency because it isn't published to npm
-- `public/screens.js` imports `markdown-it` itself from a CDN
(`markdown-it-form.js` is a markdown-it plugin, not a standalone
library). Same pattern already used for the plain markdown-it import
elsewhere in this repo: no bundler, no build step.

To update: re-fetch both files from the `main` branch and bump the
commit hash above.
