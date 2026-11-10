# Christopher Nottle: portfolio

A plain static site: HTML, CSS and a little JavaScript, with no framework and no build step.

- `index.html` is the main page.
- `invoice-checker.html` is a bill review demo with made-up data. It matches each supplier invoice to its purchase order, line by line, and checks Inland Revenue's tax invoice rules.
- `privacy-checker.html` points to NZ Redact, which now has its own repository: https://github.com/Langkurst/nz-redact
- `3d/` is a 3D version of the same page. It is drawn with three.js (MIT licence, saved in `3d/vendor/`).

By Christopher Nottle.

## Checks

```bash
node --test
```

This runs the checks: the invoice checker's rules, colour contrast in both themes, image sizes and descriptions, links, the security policy on both tool pages, and a list of things the site must never claim.

No cookies and no tracking. The pages are set to `noindex`.
