# Christopher Nottle: portfolio

A plain static site: HTML, CSS and a little JavaScript, with no framework and no build step.

- `index.html` is the main page.
- `privacy-checker.html` finds New Zealand personal details in text (IRD, NHI, bank account and more) before it goes into an AI tool, and makes a cleaned copy. It runs in the browser and cannot connect to anything.
- `3d/` is a 3D version of the same page. It is drawn with three.js (MIT licence, saved in `3d/vendor/`).

The code was written by AI coding agents at my direction. I set the rules, decided what went in and checked the result.

## Checks

```bash
node --test
```

This runs the checks: the privacy checker's rules (including 6,000 IRD and bank cases compared with python-stdnum), colour contrast in both themes, image sizes and descriptions, links, the privacy page's security policy, and a list of things the site must never claim.

No cookies and no tracking. The pages are set to `noindex`.
