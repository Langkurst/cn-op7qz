# Invoice checker: design record

Third version, 10 November 2026. The first two (a warm "paper ledger", and before that a dark product page) were recognised as AI-made: italic serif headline, Instrument Serif and Geist, capital mono labels, cream paper, hairline rules, a big "$225.00 to raise", 01 and 02 in the margin, middle dots, coloured left rules, status chips, a hero and an animation on load. The list of tells is in `PERSONAL STUFF\Portfolio\AI-TELLS.md`.

This version looks like what it is: the bill approval screen in ordinary accounts software, the kind of screen accounts staff use in Xero, MYOB or an ERP. It should look clearly different from NZ Redact, which is a plain white text tool.

## Layout

- No hero. An app bar with the name, "Demo with made-up bills" and three links. The working screen starts under it.
- "Bills to pay" is a table: Supplier, Invoice number, Date, Total, Status. The toolbar above it holds New check, the two tolerances, Shortcuts and Reset. Clicking a row opens the bill.
- The open bill sits below the table: the invoice as a plain document on the left, and its check results on the right (stacked below 1152 px).
- Panels have a grey title strip with any extra detail on the right ("Sample data", "Against order 4500012904"). There is no card title with a subtitle under it.
- Below the tool: About this demo, the GST number check, and How it checks as a table.
- On a phone (390 px) the bills table, the invoice lines and the line results become stacked lists.

## Type

The operating system's own UI font: `system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`. This is how business software looks on the Windows PCs accounts staff use, and it loads instantly because nothing is downloaded. Text is 14 px, headings 14 to 20 px, weight 600. Figures are tabular so money lines up. Sentence case, normal letter-spacing, no italics, no capitals set by CSS, no mono. The page's old font folder `assets/fonts/ledger` is deleted.

## Colour

Taken from the genre. The colour values are at the top of `assets/css/invoice.css`, one set for light and one for dark.

- Light: neutral grey app (`#eef0f2`), white panels with a 1px border, near-black text (`#1c2126`).
- Dark: the same app in dark grey (`#16181b` app, `#202328` panels).
- One business blue for links, focus and the primary button.
- Status is a word in its colour with a small icon, never a filled chip: Ready to pay in green, Needs review in amber, On hold in grey. A note is grey with an "i".
- Every text and status colour is at least 4.5:1 on every surface it sits on. The lowest measured on the page is 5.26:1 in light and 5.98:1 in dark.

## Shape

1px borders, one 4px corner radius, no double or dashed rules, no coloured left rules. Only dialogs have a shadow.

## Motion

Only in response to the user: opening a different bill (its two panels fade in over 180 ms), the New check and shortcut dialogs (150 ms), and the Copied label. Nothing moves when the page loads. Reduced motion switches all of it off.

## Wording

The amount to raise is a sentence ("Raise $225.00 with the supplier before GST."). Headings are plain labels. Each item under "Needs a person" has a short heading and one or two plain sentences.

## How it is checked

- `tests/no-ai-tells.test.js` fails on any item in the "Mechanical check" list of AI-TELLS.md. It reads the page, the stylesheet it links and the scripts it loads. Its last test gives each rule a known bad example, so a rule that can no longer fail is caught. On 10 November 2026 the CSS was broken on purpose nine times (capital mono label, Instrument Serif, coloured left rule, 52 px number, cream page, animation on load, italic, 01 counter, middle dot). Every one failed the test, and the file was restored byte for byte.
- `tests/features.test.js` holds the behaviour tests (New check, paste, duplicates, supplier query, print, GST box, tolerances, shortcuts, Ko-fi line, security policy) and the design tests for this record: the font, colours and contrast, shape, layout and motion.
- Checked in headless Chrome at 390 px and 1440 px, light and dark, and with reduced motion: no horizontal scroll, no animation on load, no font files, nothing loaded from another site, every feature working, and a clean two-page printout. The screenshots are in `docs/invoice-redesign/`.
