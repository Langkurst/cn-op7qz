# Christopher Nottle: portfolio

A plain static site: HTML, CSS and a little JavaScript, with no framework and no build step.

- `index.html` is the main page.
- `privacy-checker.html` finds New Zealand personal details in text (IRD, NHI, bank account and more) before it goes into an AI tool, and makes a redacted copy with numbered placeholders. It can put the real details back into the AI's answer. It runs in the browser and cannot connect to anything.
- `invoice-checker.html` is a bill review demo with made-up data. It matches each supplier invoice to its purchase order: price, quantity, lines, GST and totals.
- `3d/` is a 3D version of the same page. It is drawn with three.js (MIT licence, saved in `3d/vendor/`).

The code was written by AI coding agents at my direction. I set the rules, decided what went in and checked the result.

## Checks

```bash
node --test
```

This runs the checks: the privacy checker's rules (including 6,000 IRD and bank cases compared with python-stdnum), the invoice checker's rules, colour contrast in both themes, image sizes and descriptions, links, the security policy on both tool pages, and a list of things the site must never claim.

No cookies and no tracking. The pages are set to `noindex`.
