# Christopher Nottle: portfolio

A plain static site: HTML, CSS and a little JavaScript, with no framework and no build step.

- `index.html` is the main page.
- `invoice-checker.html` is a working demo. It checks a supplier invoice against its purchase order using plain rules, on made-up sample data.
- `3d/` is a 3D version of the same page. It is drawn with three.js (MIT licence, saved in `3d/vendor/`).

The code was written by AI coding agents at my direction. I set the rules, decided what went in and checked the result.

## Checks

```bash
node --test
```

This runs 51 checks: every rule in the invoice checker, the sample data, colour contrast in both themes, image sizes and descriptions, links, and a list of things the site must never claim.

No cookies and no tracking. The pages are set to `noindex`.
