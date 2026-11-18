# Christopher Nottle: portfolio

A plain static site: HTML, CSS and a little JavaScript, with no framework and no build step.

- `index.html` is the main page.
- `invoice-checker.html` is a bill review demo with made-up data. It matches each supplier invoice to its purchase order, line by line, and checks Inland Revenue's tax invoice rules. You can also drop your own purchase orders, order confirmations and invoices on it (PDF, photo or CSV) and drag one onto the other: they're read on your device and checked the same way. Nothing leaves the page.
- `privacy-checker.html` points to NZ Redact, which now has its own repository: https://github.com/Langkurst/nz-redact
- `3d/` is a 3D version of the same page. It is drawn with three.js (MIT licence, saved in `3d/vendor/`).

By Christopher Nottle.

## Checks

```bash
node --test
```

This runs the checks, including reading all 39 made-up documents in `tests/docs` (PDFs in 8 layouts, 5 languages and 5 currencies) and checking their 24 pairs. Photos need a browser, so they're scored separately with `node tests/docs/eval.cjs` (it uses Playwright); the last scores are in `tests/docs/eval-result.json`.

Reading files uses pdf.js and Tesseract.js (both Apache 2.0, kept in `assets/vendor/` with their licences). They load only when a file of their kind is dropped.

The checks also cover the invoice checker's rules, colour contrast in both themes, image sizes and descriptions, that every screenshot is stored without loss, that no clip plays until its button is pressed, links, the security policy on both tool pages, and a list of things the site must never claim.

No cookies and no tracking. The pages are set to `noindex`.
