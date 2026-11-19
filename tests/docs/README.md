# Purchasing documents test set

Made-up purchase orders, order confirmations and invoices for measuring a document reader. Every company, person, address, tax number, bank account and price is invented.

- Regenerate: `node tests/docs/make.cjs` (needs Playwright with Chromium; about 20 seconds). It writes `out/` and `truth.json`, then checks every PDF's text against the labels if `pdftotext` is installed. `--labels-only` writes just `truth.json`; `--check` re-checks the existing `out/`.
- The seed is fixed, so `truth.json` is identical on every run. The PDF and image bytes can differ slightly (creation dates, photo noise).
- `out/` holds 39 PDFs with a real text layer. Each document except one also has a clean PNG and a phone-style JPEG photo (rotated 0.5 to 2.5 degrees, blurred, relit and noisy). Two-page documents have one PNG and one photo per page. The Chinese invoice is a PDF only.
- Coverage: 15 purchase orders, 5 confirmations and 19 invoices, using 8 layouts (L1 to L8). The text is in English (NZ, AU, UK, US), German, French, Spanish and Chinese, the currencies are NZD, AUD, USD, EUR and GBP, and GST, VAT, MwSt, TVA and IVA numbers all pass their check digits.
- Noise that is not a line item: courier tracking numbers (UPS, FedEx, DHL waybills, NZ Post), phone and bank numbers, dates, page numbers, ERP item numbers, Pos. columns, carried-forward rows, Skonto and terms text.
- `truth.json` has `docs` (one label set per PDF) and `pairs` (24 related documents with every difference listed: price-higher, qty-over, qty-under, extra-line, missing-line, code-differs, gst-wrong, totals-wrong, currency-differs, or none).
- Money is a decimal string with a dot. `unit` is the unit price. `taxId` is the tax number of the party that issued the document, as printed. A discount line has `qty` and `unit` set to null. Where a layout prints no amount column, `amount` is qty x unit.
- Each document's `notes` field says what is tricky about it.
