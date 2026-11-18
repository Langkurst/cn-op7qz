/*
  Reads a purchasing document (a purchase order, an order confirmation, a tax invoice or a delivery
  note) from the words on its pages, and returns what the invoice checker needs: what kind of
  document it is, its number, the order it refers to, the supplier, the tax number and country, the
  currency, the date, every line (code, description, quantity, unit price, amount) and the totals.

  Input is a list of words with where they sit on the page, from a PDF's text (pdf.js) or from a
  photo (Tesseract). Text and CSV files come in through fromText(). Written rules only: no AI, and
  nothing leaves the page. Pure functions, so the same code runs in the browser and in the tests.

  Loads as a browser script (window.DocReader) and as a Node module.
*/
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.DocReader = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ---------- words people use on purchasing documents, by language ----------
  // Lower case, accents kept. Matching ignores case and treats any run of spaces as one.
  var TITLES = {
    confirmation: ["order confirmation", "order acknowledgement", "order acknowledgment", "sales order acknowledgement", "sales order acknowledgment",
      "sales order confirmation", "confirmation of order", "pro forma invoice", "proforma invoice", "pro-forma invoice", "auftragsbestätigung", "auftragsbestaetigung",
      "bestellbestätigung", "confirmation de commande", "accusé de réception de commande", "confirmación de pedido", "confirmacion de pedido", "acuse de pedido",
      "conferma d'ordine", "orderbevestiging", "订单确认", "注文請書"],
    delivery: ["delivery note", "delivery docket", "packing slip", "packing list", "dispatch note", "despatch note", "goods received", "lieferschein",
      "bon de livraison", "albarán", "albaran", "nota de entrega", "documento di trasporto", "pakbon", "送货单", "納品書"],
    invoice: ["tax invoice", "invoice", "rechnung", "facture", "factura", "fattura", "factuur", "发票", "請求書", "credit note", "gutschrift", "avoir", "nota de crédito"],
    order: ["purchase order", "purchase order no", "order form", "bestellung", "bestellschein", "bon de commande", "orden de compra", "pedido de compra", "pedido",
      "ordine d'acquisto", "inkooporder", "bestelling", "采购订单", "注文書", "commande"]
  };
  var CREDIT = ["credit note", "gutschrift", "avoir", "nota de crédito", "credit memo"];

  // Column headings on the line table.
  var COLUMNS = {
    code: ["code", "item code", "item no", "item no.", "item #", "item number", "product code", "product", "part no", "part no.", "part number", "part #",
      "sku", "ref", "ref.", "reference", "article", "article no", "material", "material no", "art.-nr.", "art.-nr", "art. nr.", "artikel", "artikel-nr.",
      "artikelnummer", "artikelnr", "artikel nr", "référence", "réf", "réf.", "code article", "código", "codigo", "cód.", "referencia", "codice", "货号", "品番", "item"],
    description: ["description", "item description", "details", "particulars", "product description", "beschreibung", "bezeichnung", "artikelbezeichnung",
      "désignation", "designation", "libellé", "descripción", "descripcion", "concepto", "artículo", "articulo", "descrizione", "omschrijving", "品名", "名称", "描述"],
    qty: ["qty", "qty.", "quantity", "qty ordered", "qty shipped", "qty invoiced", "ordered", "shipped", "units", "menge", "anzahl", "anz.", "stück",
      "quantité", "qté", "qte", "quantite", "cantidad", "cant.", "cant", "uds", "unidades", "quantità", "aantal", "数量"],
    unit: ["unit price", "price", "rate", "unit cost", "price each", "each", "unit", "unit $", "price per unit", "net price", "einzelpreis", "preis", "e-preis", "stückpreis",
      "prix unitaire", "prix unit.", "prix", "p.u.", "pu", "p.u. ht", "precio", "precio unitario", "precio unit.", "prezzo", "prezzo unitario", "stukprijs", "prijs", "单价", "単価"],
    amount: ["amount", "total", "line total", "ext price", "extended", "extended price", "ext. price", "net amount", "value", "betrag", "gesamt", "gesamtpreis", "summe",
      "montant", "montant ht", "total ht", "importe", "total línea", "subtotal", "importo", "totale", "bedrag", "金额", "金額"],
    uom: ["uom", "u/m", "unit of measure", "me", "einheit", "unité", "unidad", "um", "单位", "単位"]
  };

  var LABELS = {
    docNumber: {
      invoice: ["tax invoice no", "tax invoice number", "invoice no", "invoice number", "invoice #", "invoice num", "inv no", "inv #", "inv. no", "document no", "rechnungsnummer",
        "rechnungs-nr", "rechnung nr", "rechnung-nr", "re-nr", "n° de facture", "numéro de facture", "facture n°", "facture no", "número de factura", "factura nº", "factura n°",
        "factura no", "nº factura", "nº de factura", "n° de factura", "no de factura", "numero fattura", "factuurnummer", "credit note no", "credit note number",
        "number/date", "nummer/datum", "no./date", "发票号码", "发票号", "請求書番号"],
      confirmation: ["confirmation no", "confirmation number", "acknowledgement no", "acknowledgment no", "sales order no", "sales order number", "sales order", "so no", "so #",
        "auftragsnummer", "auftrags-nr", "auftrag nr", "ab-nummer", "ab-nr", "ab nr", "auftragsbestätigung nr", "n° de confirmation", "numéro de confirmation",
        "numéro de commande client", "número de confirmación", "nº de confirmación", "n° de confirmación", "pedido de venta", "number/date"],
      order: ["purchase order no", "purchase order number", "purchase order #", "po number", "po no", "po #", "p.o. number", "p.o. no", "order number", "order no",
        "bestellnummer", "bestell-nr", "bestellung nr", "n° de commande", "numéro de commande", "bon de commande n°", "número de pedido", "pedido nº", "pedido n°", "orden de compra nº",
        "number/date", "nummer/datum", "no./date", "采购订单号"],
      delivery: ["delivery note no", "delivery no", "docket no", "packing slip no", "lieferschein-nr", "lieferscheinnummer", "n° de bon de livraison", "albarán nº"]
    },
    orderRef: ["your order no", "your order number", "your order", "your po", "your po number", "your ref", "your reference", "customer po", "customer po number", "customer order",
      "customer order no", "customer ref", "order ref", "order reference", "po number", "po no", "po #", "p.o. number", "purchase order", "purchase order no", "purchase order number",
      "order no", "order number", "ihre bestellung", "ihre bestellnummer", "ihre bestell-nr", "ihr zeichen", "bestellnummer", "bestell-nr", "votre commande", "votre référence",
      "n° de commande", "numéro de commande", "su pedido", "su referencia", "número de pedido", "pedido", "vostro ordine", "uw bestelling", "客户订单号", "订单号", "ご注文番号"],
    date: ["invoice date", "tax point", "date of issue", "issue date", "issued", "order date", "po date", "document date", "confirmation date", "date", "rechnungsdatum",
      "bestelldatum", "belegdatum", "datum", "date de facture", "date de commande", "date", "fecha de factura", "fecha de pedido", "fecha", "data", "开票日期", "日期", "発行日"],
    due: ["due date", "payment due", "due", "fällig", "zahlbar bis", "échéance", "date d'échéance", "vencimiento", "fecha de vencimiento"],
    subtotal: ["subtotal", "sub total", "sub-total", "net total", "total net", "total excl", "total excluding", "total ex gst", "total before tax", "goods total", "net amount",
      "amount excl", "zwischensumme", "nettobetrag", "netto", "summe netto", "gesamt netto", "total ht", "montant ht", "sous-total", "base imponible", "subtotal neto",
      "imponibile", "totaal excl", "小计", "货物金额", "小計"],
    tax: ["gst", "vat", "tax", "sales tax", "mwst", "ust", "umsatzsteuer", "mehrwertsteuer", "tva", "iva", "btw", "消费税", "消費税", "税额", "增值税"],
    total: ["total due", "amount due", "balance due", "grand total", "invoice total", "total incl", "total including", "total inc gst", "total incl gst", "total (nzd)", "total nzd",
      "total aud", "total payable", "amount payable", "total amount", "total", "gesamtbetrag", "rechnungsbetrag", "endbetrag", "gesamtsumme", "summe brutto", "brutto",
      "total ttc", "montant ttc", "net à payer", "total a pagar", "total factura", "importe total", "totale", "totaal", "合计", "合計", "总计", "总金额"],
    buyer: ["bill to", "billed to", "invoice to", "invoiced to", "sold to", "customer", "client", "deliver to", "ship to", "delivery address", "rechnungsempfänger",
      "rechnungsadresse", "kunde", "lieferanschrift", "lieferadresse", "facturé à", "facturer à", "client", "adresse de livraison", "facturar a", "cliente", "dirección de entrega"],
    supplier: ["supplier", "vendor", "from", "seller", "lieferant", "verkäufer", "fournisseur", "vendeur", "proveedor", "vendedor", "fornitore", "leverancier"]
  };

  var LANG_WORDS = {
    de: ["rechnung", "bestellung", "menge", "einzelpreis", "gesamt", "mwst", "ust", "datum", "lieferant", "auftragsbestätigung", "artikel", "bezeichnung", "netto", "brutto", "summe", "stück"],
    fr: ["facture", "commande", "quantité", "prix unitaire", "tva", "total ht", "total ttc", "montant", "fournisseur", "désignation", "référence", "livraison"],
    es: ["factura", "pedido", "cantidad", "precio", "iva", "importe", "proveedor", "descripción", "fecha", "cliente", "albarán"],
    it: ["fattura", "ordine", "quantità", "prezzo", "iva", "totale", "fornitore", "descrizione"],
    nl: ["factuur", "bestelling", "aantal", "prijs", "btw", "totaal", "leverancier", "omschrijving"],
    en: ["invoice", "order", "quantity", "qty", "price", "amount", "total", "gst", "vat", "supplier", "description", "date", "subtotal"]
  };

  var COMPANY_LONG = /(^|[\s,(])(ltd|limited|pty|plc|llc|inc|incorporated|co|company|corp|corporation|gmbh|sarl|sas|s\.a|s\.l|s\.r\.l|srl|s\.p\.a|b\.v|n\.v)\.?(?=$|[\s,;)·|])/i;
  var COMPANY_SHORT = /(^|[\s,(])(AG|KG|OHG|UG|SA|SL|SPA|BV|NV|OY|AB|AS|KK)\.?(?=$|[\s,;)·|])|有限公司|株式会社/;
  var COMPANY = { test: function (t) { return COMPANY_LONG.test(t) || COMPANY_SHORT.test(t); } };

  // ---------- small helpers ----------
  function lower(s) { return String(s == null ? "" : s).toLowerCase().replace(/\s+/g, " ").trim(); }
  function stripAccents(s) { return String(s).normalize ? String(s).normalize("NFD").replace(/[̀-ͯ]/g, "") : String(s); }
  function fold(s) { return stripAccents(lower(s)); }
  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
  // A label regex: the words in order, at a word start, ignoring case and accents. Spaces may be any gap.
  function labelRe(words) {
    var sorted = words.slice().sort(function (a, b) { return b.length - a.length; });
    var body = sorted.map(function (w) { return escapeRe(fold(w)).replace(/\\? /g, "\\s*"); }).join("|");
    return new RegExp("(^|[^a-z0-9])(" + body + ")(?![a-z])", "i");
  }
  var RE = {};
  Object.keys(LABELS).forEach(function (k) {
    if (Array.isArray(LABELS[k])) RE[k] = labelRe(LABELS[k]);
    else { RE[k] = {}; Object.keys(LABELS[k]).forEach(function (kk) { RE[k][kk] = labelRe(LABELS[k][kk]); }); }
  });
  var COL_RE = {};
  Object.keys(COLUMNS).forEach(function (k) { COL_RE[k] = COLUMNS[k].map(fold); });

  function median(list) {
    if (!list.length) return 0;
    var s = list.slice().sort(function (a, b) { return a - b; });
    var m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  // ---------- 1. words -> rows -> cells ----------
  /*
    items: [{ str, x, y, w, h, page }] with x, y the top-left corner of the word on its page.
    Returns rows in reading order: [{ page, y, h, cells: [{ text, x0, x1 }], text }].
  */
  function toRows(items) {
    var words = (items || []).filter(function (it) { return it && String(it.str || "").trim() !== ""; }).map(function (it) {
      return { str: String(it.str).replace(/\s+/g, " ").trim(), x: +it.x || 0, y: +it.y || 0, w: Math.max(0, +it.w || 0), h: Math.max(1, +it.h || 10), page: +it.page || 1 };
    });
    var hMed = median(words.map(function (w) { return w.h; })) || 10;
    words.sort(function (a, b) { return a.page - b.page || (a.y + a.h / 2) - (b.y + b.h / 2) || a.x - b.x; });
    var rows = [];
    words.forEach(function (w) {
      var mid = w.y + w.h / 2;
      var last = rows[rows.length - 1];
      if (last && last.page === w.page && Math.abs(last.mid - mid) <= Math.max(hMed, w.h) * 0.5) {
        last.words.push(w);
        last.mid = (last.mid * (last.words.length - 1) + mid) / last.words.length;
      } else {
        rows.push({ page: w.page, mid: mid, words: [w] });
      }
    });
    return rows.map(function (r) {
      r.words.sort(function (a, b) { return a.x - b.x; });
      var h = median(r.words.map(function (w) { return w.h; })) || hMed;
      var cells = [];
      r.words.forEach(function (w) {
        var c = cells[cells.length - 1];
        // A word joins the cell before it when the gap is no wider than about one space.
        var gap = c ? w.x - c.x1 : Infinity;
        if (c && gap <= h * 0.9) { c.text += (gap > h * 0.12 ? " " : "") + w.str; c.x1 = Math.max(c.x1, w.x + w.w); }
        else { c = { text: w.str, x0: w.x, x1: w.x + w.w, words: [] }; cells.push(c); }
        // Each word's place, for table headings that run together ("Price Quantity"). A PDF often
        // gives a phrase as one piece of text, so its words are placed by their share of letters;
        // and it may split a word into touching pieces ("I" "t" "e" "m"), which are joined again.
        var parts = w.str.split(" "), total = w.str.length || 1, at = 0;
        var touching = gap <= h * 0.12 && c.words.length > 0;
        parts.forEach(function (part, pi) {
          var x0 = w.x + w.w * at / total, x1 = w.x + w.w * (at + part.length) / total;
          if (part) {
            var lastWord = c.words[c.words.length - 1];
            if (pi === 0 && touching && lastWord) { lastWord.text += part; lastWord.x1 = x1; }
            else c.words.push({ text: part, x0: x0, x1: x1 });
          }
          at += part.length + 1;
        });
      });
      return { page: r.page, y: r.mid - h / 2, h: h, cells: cells, text: cells.map(function (c) { return c.text; }).join("  ") };
    });
  }

  // Text or CSV -> rows. Cells split on tabs, on commas outside quotes (for .csv), or on 2+ spaces.
  function textToItems(text, opts) {
    var csv = opts && opts.csv;
    var items = [];
    String(text == null ? "" : text).replace(/\r\n?/g, "\n").split("\n").forEach(function (line, i) {
      var cells;
      if (/\t/.test(line)) cells = line.split("\t");
      else if (csv) cells = splitCsv(line);
      else cells = line.split(/ {2,}/);
      var x = 0;
      cells.forEach(function (cell) {
        var t = String(cell).trim();
        if (t) items.push({ str: t, x: x, y: i * 12, w: Math.max(6, t.length * 6), h: 10, page: 1 });
        x += Math.max(60, String(cell).length * 6 + 24);
      });
    });
    return items;
  }
  function splitCsv(line) {
    var out = [], cur = "", q = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      if (q) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') q = false;
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === "," || ch === ";") { out.push(cur); cur = ""; }
      else cur += ch;
    }
    out.push(cur);
    return out;
  }

  // ---------- 2. numbers ----------
  // Which mark is the decimal point in this document: "." (1,234.56) or "," (1.234,56 and 1 234,56).
  function decimalMark(rows) {
    var dot = 0, comma = 0;
    rows.forEach(function (r) {
      var t = r.text;
      var m;
      var reComma = /(?:^|[^\d.,])\d{1,3}(?:[.\s  ]\d{3})*,\d{2}(?![\d,.])/g;
      var reDot = /(?:^|[^\d.,])\d{1,3}(?:[,\s  ]\d{3})*\.\d{2}(?![\d,.])/g;
      while ((m = reComma.exec(t))) comma++;
      while ((m = reDot.exec(t))) dot++;
    });
    return comma > dot ? "," : ".";
  }

  var CURRENCY_TOKENS = [
    ["NZD", /\bNZD\b|NZ\$/], ["AUD", /\bAUD\b|A\$|AU\$/], ["USD", /\bUSD\b|US\$/], ["CAD", /\bCAD\b|C\$/], ["SGD", /\bSGD\b|S\$/], ["HKD", /\bHKD\b|HK\$/],
    ["EUR", /\bEUR\b|€/], ["GBP", /\bGBP\b|£/], ["CHF", /\bCHF\b/], ["JPY", /\bJPY\b|円/], ["CNY", /\bCNY\b|\bRMB\b|人民币|元/], ["SEK", /\bSEK\b/], ["DKK", /\bDKK\b/], ["NOK", /\bNOK\b/]
  ];

  /*
    "1.234,56" with mark "," -> 123456 cents. Handles currency signs and codes, spaces as thousands,
    "(12.00)" and SAP's trailing minus "12.00-" as negative. NaN when it is not an amount.
  */
  function parseAmount(text, mark) {
    var t = String(text == null ? "" : text).trim();
    if (!t) return NaN;
    var negative = false;
    if (/^\(.*\)$/.test(t)) { negative = true; t = t.slice(1, -1); }
    t = t.replace(/[A-Z]{3}\b|NZ\$|A\$|AU\$|US\$|C\$|S\$|HK\$|[€£$¥円元]/g, "").trim();
    if (/-$/.test(t)) { negative = true; t = t.slice(0, -1).trim(); }
    if (/^[-−–]/.test(t)) { negative = true; t = t.slice(1).trim(); }
    t = t.replace(/[\s  ']/g, "");
    if (!t) return NaN;
    mark = mark || ".";
    // A photo can read the decimal point as a colon ("1:35"): one colon before the last two digits is taken as the mark.
    if (/^\d+:\d{2}$/.test(t)) t = t.replace(":", mark);
    var other = mark === "," ? "." : ",";
    if (mark === ".") {
      if (!/^\d{1,3}(,\d{3})*(\.\d+)?$|^\d+(\.\d+)?$/.test(t)) return NaN;
      t = t.replace(/,/g, "");
    } else {
      if (!/^\d{1,3}(\.\d{3})*(,\d+)?$|^\d+(,\d+)?$/.test(t)) return NaN;
      t = t.split(other).join("").replace(",", ".");
    }
    var v = parseFloat(t);
    if (!Number.isFinite(v)) return NaN;
    var cents = Math.round(v * 100);
    return negative ? -cents : cents;
  }
  // A quantity: "80", "2,5" (with mark ","), "1,000" (with mark "."), "12 pcs" -> 12.
  function parseQty(text, mark) {
    var t = String(text == null ? "" : text).trim().replace(/\s*(pcs|pc|ea|each|stk|stück|st|units?|uds?|u|pce|pièces?|pzas?|x)\.?$/i, "").trim();
    if (!/^[\d.,\s  ]+-?$/.test(t)) return NaN;
    var c = parseAmount(t, mark);
    return Number.isFinite(c) ? c / 100 : NaN;
  }
  // Every amount-looking token in a piece of text, left to right.
  function amountsIn(text, mark) {
    var re = mark === ","
      ? /\(?-?(?:[A-Z]{3}\s?|NZ\$|A\$|US\$|[€£$])?\s?\d{1,3}(?:[.\s  ]\d{3})*(?:,\d+)?\s?(?:[A-Z]{3}\b|€)?-?\)?/g
      : /\(?-?(?:[A-Z]{3}\s?|NZ\$|A\$|US\$|[€£$])?\s?\d{1,3}(?:[,  ]\d{3})*(?:\.\d+)?\s?(?:[A-Z]{3}\b|€)?-?\)?/g;
    var out = [], m;
    while ((m = re.exec(text))) {
      var v = parseAmount(m[0], mark);
      if (Number.isFinite(v)) out.push({ cents: v, text: m[0].trim(), index: m.index });
    }
    return out;
  }

  // ---------- 3. tax numbers, tracking numbers, dates ----------
  function nzGstValid(raw) {
    var n = String(raw).replace(/[\s-]/g, "");
    if (!/^\d{8,9}$/.test(n)) return false;
    var value = parseInt(n, 10);
    if (value < 10000000 || value > 200000000) return false;
    var digits = n.split("").map(Number);
    if (digits.length === 8) digits.unshift(0); // an 8-digit number has a leading nought
    var body = digits.slice(0, 8), given = digits[8];
    function digit(w) { var s = 0; for (var i = 0; i < 8; i++) s += w[i] * Number(body[i]); return ((-s % 11) + 11) % 11; }
    var check = digit([3, 2, 7, 6, 5, 4, 3, 2]);
    if (check === 10) check = digit([7, 4, 3, 2, 5, 2, 7, 6]);
    return check !== 10 && check === given;
  }
  function abnValid(raw) {
    var n = String(raw).replace(/\s/g, "");
    if (!/^\d{11}$/.test(n)) return false;
    var w = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19], s = 0;
    for (var i = 0; i < 11; i++) s += w[i] * (Number(n[i]) - (i === 0 ? 1 : 0));
    return s % 89 === 0;
  }
  var EU_VAT = /\b(AT|BE|BG|CY|CZ|DE|DK|EE|EL|ES|FI|FR|HR|HU|IE|IT|LT|LU|LV|MT|NL|PL|PT|RO|SE|SI|SK|XI)\s?((?:[0-9A-Z]\s?){8,12})\b/;
  var COUNTRY_OF_VAT = { EL: "GR", XI: "GB" };

  // Rows that belong to the buyer's block ("Bill to", "Deliver to" and the few rows under it), so
  // the buyer's own GST number isn't taken for the supplier's.
  function buyerRows(rows) {
    var skip = {};
    rows.forEach(function (r, i) {
      r.cells.forEach(function (c) {
        var f = fold(c.text);
        var m = f.match(RE.buyer);
        if (!m || m.index > 2) return;
        skip[i] = true;
        for (var j = i + 1; j < Math.min(rows.length, i + 6); j++) {
          if (rows[j].page !== r.page) break;
          if (rows[j].cells.some(function (cc) { return cc.x0 < c.x1 + 60 && cc.x1 > c.x0 - 10; })) skip[j] = true;
        }
      });
    });
    return skip;
  }

  function findTaxId(rows) {
    var skip = buyerRows(rows);
    var mine = rows.filter(function (r, i) { return !skip[i]; });
    function scan(list) {
      var all = list.map(function (r) { return r.text; }).join("\n");
      // NZ GST: digits near the word GST that pass the IRD check digit.
      var m, re = /(?:gst|g\.s\.t\.|ird)\s*(?:no\.?|number|#|reg(?:istration)?(?:\s*no\.?)?)?\s*[:#]?\s*(\d{2,3}[-\s]?\d{3}[-\s]?\d{3})/gi;
      while ((m = re.exec(all))) if (nzGstValid(m[1])) return { type: "nz-gst", value: m[1].replace(/\s/g, "-"), valid: true, country: "NZ" };
      re = /\babn\s*[:#]?\s*(\d{2}\s?\d{3}\s?\d{3}\s?\d{3})/gi;
      while ((m = re.exec(all))) return { type: "abn", value: m[1], valid: abnValid(m[1]), country: "AU" };
      re = /\bGB\s?(\d{3}\s?\d{4}\s?\d{2}(?:\s?\d{3})?)\b/g;
      while ((m = re.exec(all))) return { type: "gb-vat", value: "GB" + m[1].replace(/\s/g, ""), valid: true, country: "GB" };
      var lines = all.split("\n");
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        var lab = line.match(/\b(n°\s*tva(?:\s*intracom\.?)?|tva\s*intracom\.?|ust-?id(?:nr\.?)?|ust\.?-?id\.?-?nr\.?|umsatzsteuer-?id(?:entifikationsnummer)?|vat\s*(?:no\.?|number|reg(?:istration)?\.?(?:\s*no\.?)?)?|mwst-?nr\.?|iva|nif|cif|btw(?:-?nr\.?)?|p\.?\s?iva|vat\s*id|tax\s*id)\b\s*[:#.]?\s*/i);
        if (!lab) continue;
        var after = line.slice(lab.index + lab[0].length);
        var v = after.match(/^(AT|BE|BG|CY|CZ|DE|DK|EE|EL|ES|FI|FR|HR|HU|IE|IT|LT|LU|LV|MT|NL|PL|PT|RO|SE|SI|SK|XI)\s?((?:[0-9A-Z]\s?){8,12})(?=$|[^0-9A-Z])/);
        if (v && /\d{6}/.test(v[2].replace(/\s/g, ""))) return { type: "eu-vat", value: (v[1] + v[2]).replace(/\s/g, ""), valid: true, country: COUNTRY_OF_VAT[v[1]] || v[1] };
      }
      // A GST label with a number that fails the check: kept, marked not valid, so the checker can say so.
      re = /(?:gst)\s*(?:no\.?|number|#|reg(?:istration)?(?:\s*no\.?)?)?\s*[:#]?\s*(\d{2,3}[-\s]?\d{3}[-\s]?\d{3})\b/gi;
      while ((m = re.exec(all))) return { type: "nz-gst", value: m[1].replace(/\s/g, "-"), valid: false, country: "NZ" };
      return null;
    }
    return scan(mine) || null;
  }

  var TRACKING = [
    /\b1Z[0-9A-Z]{16}\b/g,                                   // UPS
    /\b[A-Z]{2}\d{9}[A-Z]{2}\b/g,                            // postal (UPU S10), e.g. NZ Post, Royal Mail
    /\b(?:tracking|track|consignment|con\.?\s*note|connote|waybill|air\s*waybill|awb|fedex|dhl|ups|courier|sendung(?:snummer)?|n°\s*de\s*suivi|seguimiento)\b[^\n\d]{0,24}(\d[\d -]{6,30}\d)/gi
  ];
  function findTracking(rows) {
    var found = [];
    rows.forEach(function (r) {
      TRACKING.forEach(function (re) {
        re.lastIndex = 0;
        var m;
        while ((m = re.exec(r.text))) {
          var v = String(m[1] || m[0]).replace(/\s+/g, "");
          if (/\d{6,}/.test(v) || /^1Z/.test(v) || /^[A-Z]{2}\d{9}[A-Z]{2}$/.test(v)) if (found.indexOf(v) < 0) found.push(v);
        }
      });
    });
    return found;
  }

  var MONTHS = {
    1: ["january", "jan", "januar", "jänner", "janvier", "janv", "enero", "ene", "gennaio", "januari"],
    2: ["february", "feb", "februar", "février", "fevrier", "févr", "febrero", "febbraio", "februari"],
    3: ["march", "mar", "märz", "maerz", "mars", "marzo", "maart"],
    4: ["april", "apr", "avril", "avr", "abril", "abr", "aprile"],
    5: ["may", "mai", "mayo", "maggio", "mei"],
    6: ["june", "jun", "juni", "juin", "junio", "giugno"],
    7: ["july", "jul", "juli", "juillet", "juil", "julio", "luglio"],
    8: ["august", "aug", "août", "aout", "agosto", "augustus"],
    9: ["september", "sep", "sept", "septembre", "septiembre", "settembre"],
    10: ["october", "oct", "oktober", "okt", "octobre", "octubre", "ottobre"],
    11: ["november", "nov", "novembre", "noviembre"],
    12: ["december", "dec", "dezember", "dez", "décembre", "decembre", "déc", "diciembre", "dic", "dicembre"]
  };
  var MONTH_LOOKUP = {};
  Object.keys(MONTHS).forEach(function (n) { MONTHS[n].forEach(function (w) { MONTH_LOOKUP[fold(w)] = +n; }); });
  function iso(y, m, d) {
    if (y < 100) y += 2000;
    if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
    return y + "-" + (m < 10 ? "0" : "") + m + "-" + (d < 10 ? "0" : "") + d;
  }
  // The first date in the text, as YYYY-MM-DD. monthFirst for American documents (11/05/2026 = 5 November).
  function parseDateText(text, monthFirst) {
    var t = fold(text);
    var m = t.match(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
    if (m) return iso(+m[1], +m[2], +m[3]);
    m = t.match(/\b(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})\b/);
    if (m) {
      var a = +m[1], b = +m[2];
      if (monthFirst && a <= 12) return iso(+m[3], a, b);
      if (a > 12) return iso(+m[3], b, a);
      return iso(+m[3], b, a);
    }
    m = t.match(/\b(\d{1,2})(?:st|nd|rd|th|er|º|°)?\.?[\s\-]*(?:de\s+)?([a-zäöüéèûôç]{3,10})\.?,?[\s\-]*(?:de\s+)?(\d{4})\b/);
    if (m && MONTH_LOOKUP[m[2]]) return iso(+m[3], MONTH_LOOKUP[m[2]], +m[1]);
    m = t.match(/\b([a-zäöüéèûôç]{3,10})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/);
    if (m && MONTH_LOOKUP[m[1]]) return iso(+m[3], MONTH_LOOKUP[m[1]], +m[2]);
    m = t.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
    if (m) return iso(+m[1], +m[2], +m[3]);
    return null;
  }

  // ---------- 4. the kind of document and its language ----------
  function detectLanguage(rows) {
    var text = " " + fold(rows.slice(0, 120).map(function (r) { return r.text; }).join(" ")) + " ";
    var best = "en", bestScore = 0;
    Object.keys(LANG_WORDS).forEach(function (lang) {
      var s = 0;
      LANG_WORDS[lang].forEach(function (w) { if (text.indexOf(" " + fold(w)) >= 0) s++; });
      if (lang === "en") s -= 1; // English words turn up in other languages' documents (Total, Code)
      if (s > bestScore) { bestScore = s; best = lang; }
    });
    return best;
  }

  /*
    The kind comes from the title: the biggest or earliest heading that names one. "Invoice" also
    turns up on orders ("Send invoices to"), so a title counts most when it starts a row near the top
    of the first page, or is set larger than the body text.
  */
  // "T A X  I N V O I C E" -> "tax invoice": a title set with spaces between its letters.
  function unspace(text) {
    var t = String(text || "").trim();
    var tokens = t.split(/\s+/);
    var singles = tokens.filter(function (x) { return x.length <= 2; }).length;
    if (tokens.length >= 4 && singles >= tokens.length * 0.6) return t.replace(/\s{2,}/g, "\u0000").replace(/\s/g, "").replace(/\u0000/g, " ");
    return t;
  }
  var YOUR = /\b(your|ihre?|votre|vos|su|sus|vostro|vostra|uw|our|unsere?|notre|nuestro)\s+$/;

  function detectKind(rows) {
    var hMed = median(rows.map(function (r) { return r.h; })) || 10;
    var first = rows.filter(function (r) { return r.page === 1; });
    var top = first.length ? first[0].y : 0;
    var bottom = first.length ? first[first.length - 1].y : 1;
    var span = Math.max(1, bottom - top);
    var scores = { confirmation: 0, delivery: 0, invoice: 0, order: 0 };
    var where = { confirmation: null, delivery: null, invoice: null, order: null };
    function look(text, r, idx, ci, cell, joined) {
      var raw = unspace(text);
      var t = fold(raw);
      ["confirmation", "delivery", "invoice", "order"].forEach(function (kind) {
        TITLES[kind].some(function (w) {
          var fw = fold(w);
          var at = t.indexOf(fw);
          if (at < 0 && raw !== text) {
            // Letter-spaced: compare with every space taken out.
            var flat = t.replace(/\s/g, ""), fwFlat = fw.replace(/\s/g, "");
            if (flat.indexOf(fwFlat) < 0) return false;
            t = fw; at = 0;
          }
          if (at < 0) return false;
          var before = at === 0 ? " " : t[at - 1], after = t[at + fw.length] || " ";
          if (/[a-z0-9]/.test(before) || /[a-z]/.test(after)) return false;
          var s = 1;
          if (at === 0) s += 1;
          if (t.length <= fw.length + 18) s += 2;
          if (r.h > hMed * 1.25) s += 3;
          if (raw !== text) s += 2;                          // letter-spaced: set as a title
          var pos = (r.y - top) / span;
          if (pos < 0.25) s += 2; else if (pos > 0.6) s -= 1;
          if (idx < 6) s += 1;
          // "Your order", "Ihre Bestellung", "Su pedido": a label for the other document's number.
          if (YOUR.test(t.slice(0, at))) s -= 7;
          // "Invoice date", "Order no.", "Rechnungsdatum": a label, not the title.
          // A label has its value elsewhere; a title often carries its number ("Rechnung Nr. RE-2026-10457").
          if (/^\s*(date|no\.?|nr\.?|number|#|datum|fecha|total|to|address|ref|n°|nº)\.?\s*:?\s*$/.test(t.slice(at + fw.length))) s -= 4;
          // A label with its value in the next cell ("Order no. | 4500012904") is not the title.
          var next = r.cells[ci + 1];
          if (!joined && next && looksLikeDocNumber(next.text) && t.length <= fw.length + 4 && r.h <= hMed * 1.25 && raw === text) s -= 3;
          if (kind === "invoice" && /invoice\s*(to|address|addr|by|must|will|should|enquir|query|queries|quoting)|invoices|send .*invoice|rechnungs(adresse|empf)|adresse de facturation|direcci[oó]n de facturaci|facturar a|factur[ée] [àa]/.test(t)) s -= 6;
          if (kind === "order" && /order\s*(no|number|#|date|ref)|purchase order\s*(no|number|#)|commande\s*n|pedido\s*n/.test(t) && t.length > fw.length + 18) s -= 2;
          if (/\b(thank|vielen dank|merci|gracias|danke|please|bitte|veuillez)\b/.test(t)) s -= 3;
          if (s > scores[kind]) { scores[kind] = s; where[kind] = { row: idx, cell: ci, x0: cell.x0, x1: cell.x1, text: raw }; }
          return true;
        });
      });
    }
    first.forEach(function (r, idx) {
      r.cells.forEach(function (c, ci) {
        look(c.text, r, idx, ci, c, false);
        // A title over two lines ("Sales Order" / "Acknowledgement").
        for (var k = 1; k <= 2 && idx < 12; k++) {
          var below = first[idx + k];
          if (!below) break;
          var under = below.cells.filter(function (b) { return b.x0 < c.x1 && b.x1 > c.x0 && Math.abs(b.x0 - c.x0) < 20; })[0];
          // Labels with their values beside them ("Nº de cliente | 43001", "Albarán | ALB-26-3310") don't join.
          var labelled = function (row, cell) { var nx = row.cells[row.cells.indexOf(cell) + 1]; return nx && looksLikeDocNumber(nx.text); };
          if (under) { if (c.text.length < 30 && under.text.length < 30 && !labelled(r, c) && !labelled(below, under)) look(c.text + " " + under.text, r, idx, ci, c, true); break; }
        }
      });
    });
    var kinds = ["confirmation", "delivery", "invoice", "order"];
    var best = null, bestScore = 1.5;
    kinds.forEach(function (k) { if (scores[k] > bestScore + (best === "confirmation" || best === "delivery" ? 0.5 : 0)) { best = k; bestScore = scores[k]; } });
    return { kind: best || "unknown", scores: scores, title: best ? where[best] : null };
  }

  // The number printed with the title: in its cell ("Rechnung Nr. RE-2026-10457"), next to it, or under it.
  function numberByTitle(rows, title) {
    if (!title) return null;
    var first = rows.filter(function (r) { return r.page === 1; });
    var r = first[title.row];
    if (!r) return null;
    var inCell = title.text.match(/(?:n[o°º]\.?|nr\.?|number|nummer|#|núm\.?)\s*[:.]?\s*([A-Z0-9][\w\-/.]{2,24})\s*$/i);
    if (inCell && /\d/.test(inCell[1])) return inCell[1];
    var right = r.cells.filter(function (c) { return c.x0 >= title.x1 - 2; })[0];
    if (right && looksLikeDocNumber(right.text) && !parseDateText(right.text)) return cleanNumber(right.text);
    for (var j = title.row + 1; j < Math.min(first.length, title.row + 3); j++) {
      var under = first[j].cells.filter(function (c) { return c.x1 > title.x0 - 10 && c.x0 < title.x1 + 10; })[0];
      if (under && looksLikeDocNumber(under.text) && !parseDateText(under.text) && !/[:]/.test(under.text)) return cleanNumber(under.text);
    }
    return null;
  }

  // ---------- 5. labelled fields ----------
  // Where a label sits, the value is the rest of its cell, the next cell on the row, or the cell under it.
  function valueAfter(rows, re, opts) {
    opts = opts || {};
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (opts.page && r.page !== opts.page) continue;
      for (var ci = 0; ci < r.cells.length; ci++) {
        var c = r.cells[ci];
        var f = fold(c.text);
        var m = f.match(re);
        if (!m) continue;
        var end = m.index + m[0].length;
        var rest = c.text.slice(end).replace(/^[\s:#.\-–=|]+/, "").replace(/^(no\.?|nr\.?|n°|nº|number|#)\s*[:.]?\s*/i, "").trim();
        if (opts.accept ? opts.accept(rest) : rest) return { text: rest, row: i, cell: ci };
        var next = r.cells[ci + 1];
        if (next && (opts.accept ? opts.accept(next.text) : next.text)) return { text: next.text.trim(), row: i, cell: ci + 1 };
        // Under the label: the next row's cell that overlaps it.
        var below = rows[i + 1];
        if (below && below.page === r.page && below.y - (r.y + r.h) < r.h * 1.6) {
          for (var bi = 0; bi < below.cells.length; bi++) {
            var b = below.cells[bi];
            if (b.x1 >= c.x0 - 4 && b.x0 <= c.x1 + 40 && (opts.accept ? opts.accept(b.text) : b.text)) return { text: b.text.trim(), row: i + 1, cell: bi };
          }
        }
      }
    }
    return null;
  }

  function looksLikeDocNumber(t) {
    var s = String(t || "").trim().split(/\s{2,}|\s(?=date|datum|fecha|dated)/i)[0].trim();
    if (!s || s.length > 30) return false;
    if (!/\d/.test(s)) return false;
    if (/^\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}$/.test(s)) return false; // a date
    if (/(^|\s)[A-Za-zÀ-ÿ]{5,}(\s|$)/.test(s) && /\s/.test(s)) return false; // a town and postcode, a phrase
    return /^[A-Z0-9][A-Z0-9 ./_\-]{1,29}$/i.test(s);
  }
  function cleanNumber(t) {
    var s = String(t || "").trim().split(/\s{2,}/)[0].trim();
    var m = s.match(/[A-Z0-9][A-Z0-9./_\-]*[A-Z0-9]|[A-Z0-9]/i);
    // Keep "INV-20418", "SO 7731" -> "SO 7731" only when the letters are a prefix.
    var two = s.match(/^([A-Z]{1,4})\s(\d[\d\-/]*)$/i);
    if (two) return two[1] + " " + two[2];
    return m ? m[0] : s;
  }

  // "Sample Beschläge GmbH · Musterstraße 12 · 70173 Stuttgart" -> "Sample Beschläge GmbH".
  function companyName(text) {
    var t = String(text || "").trim();
    var parts = t.split(/\s+[·|•]\s+|\s{2,}/);
    for (var i = 0; i < parts.length; i++) if (COMPANY.test(parts[i])) return parts[i].trim();
    return t;
  }
  function companyLine(text) {
    var t = String(text || "").trim();
    if (!t || t.length > 70) return false;
    if (/\d{3,}/.test(t) && !COMPANY.test(t)) return false;
    return COMPANY.test(t);
  }

  // The parties: the name after a supplier or buyer label, or the first company name at the top.
  function findParties(rows, kind) {
    var buyer = null, supplier = null;
    var b = valueAfter(rows, RE.buyer, { accept: companyLine });
    if (b) buyer = b.text;
    var s = valueAfter(rows, RE.supplier, { accept: companyLine });
    if (s) supplier = s.text;
    // A label on its own line: the company on a following line, in the same column.
    function under(re) {
      for (var i = 0; i < rows.length && i < 80; i++) {
        var r = rows[i];
        for (var ci = 0; ci < r.cells.length; ci++) {
          var f = fold(r.cells[ci].text);
          var m = f.match(re);
          if (!m || f.length > m[0].length + 3) continue;
          var x0 = r.cells[ci].x0;
          for (var j = i + 1; j < Math.min(rows.length, i + 4); j++) {
            var cell = rows[j].cells.filter(function (c) { return Math.abs(c.x0 - x0) < 30 || (c.x0 <= x0 + 5 && c.x1 > x0); })[0];
            if (cell && companyLine(cell.text)) return cell.text.trim();
          }
        }
      }
      return null;
    }
    if (!buyer) buyer = under(RE.buyer);
    if (!supplier) supplier = under(RE.supplier);
    // The letterhead: the first company name on page 1 that isn't the other party.
    var heads = [];
    rows.slice(0, 60).forEach(function (r) { if (r.page === 1) r.cells.forEach(function (c) { if (companyLine(companyName(c.text))) { var n = companyName(c.text); if (heads.indexOf(n) < 0) heads.push(n); } }); });
    if (buyer) buyer = companyName(buyer);
    if (supplier) supplier = companyName(supplier);
    var letterhead = heads.filter(function (h) { return h !== buyer && h !== supplier; })[0] || null;
    if (kind === "order") {
      // On a purchase order the letterhead is the buyer.
      if (!buyer) buyer = letterhead;
      if (!supplier) supplier = heads.filter(function (h) { return h !== buyer; })[0] || null;
    } else {
      if (!supplier) supplier = letterhead;
      if (!buyer) buyer = heads.filter(function (h) { return h !== supplier; })[0] || null;
    }
    // The buyer's details: the row or two under its name (an address, NZBN, GST number or phone).
    var buyerDetails = "";
    if (buyer) {
      for (var i = 0; i < rows.length && !buyerDetails; i++) {
        var cell = rows[i].cells.filter(function (c) { return c.text.trim() === buyer; })[0];
        if (!cell) continue;
        var parts = [];
        for (var j = i + 1; j < Math.min(rows.length, i + 4); j++) {
          if (rows[j].page !== rows[i].page) break;
          // A gap of more than about a line ends the address block; so does the line table's heading.
          if (rows[j].y - (rows[j - 1].y + rows[j - 1].h) > rows[j - 1].h * 1.2) break;
          if (findHeader([rows[j]], 0)) break;
          var under = rows[j].cells.filter(function (c) { return c.x0 < cell.x1 && c.x1 > cell.x0 - 8 && Math.abs(c.x0 - cell.x0) < 40; })[0];
          if (!under) break;
          var t = under.text.trim();
          if (RE.supplier.test(fold(t)) || RE.buyer.test(fold(t)) || companyLine(t) || headingKind(t)) break;
          parts.push(t);
        }
        buyerDetails = parts.join(", ");
      }
    }
    return { supplier: supplier ? companyName(supplier) : supplier, buyer: buyer ? companyName(buyer) : buyer, buyerDetails: buyerDetails };
  }

  // ---------- 6. the line table ----------
  // Headings that could be a code, a description or a line number: what's under them decides.
  var AMBIGUOUS = ["item", "items", "article", "artikel", "product", "produit", "producto", "artículo", "articulo", "articolo", "material"];
  var POSITION = ["pos", "pos.", "position", "posn", "line", "ln", "no", "no.", "nr", "nr.", "#", "lfd. nr.", "lfd.nr.", "n°", "nº", "núm.", "item no.", "línea"];
  var ALL_HEADINGS = {};
  Object.keys(COL_RE).forEach(function (k) { COL_RE[k].forEach(function (w) { if (!ALL_HEADINGS[w]) ALL_HEADINGS[w] = k; }); });
  AMBIGUOUS.forEach(function (w) { ALL_HEADINGS[fold(w)] = "item"; });
  POSITION.forEach(function (w) { if (ALL_HEADINGS[fold(w)] !== "code") ALL_HEADINGS[fold(w)] = "pos"; });
  ["order qty", "order quantity", "qty ord", "net value", "net amount", "line value", "total price", "amount excl", "montant ht", "total (excl)", "amount (excl gst)",
    "unit price excl", "price ex gst", "unit price ex gst", "price excl", "rate ex gst"].forEach(function (w) {
    ALL_HEADINGS[fold(w)] = /qty|quantity/.test(w) ? "qty" : /price|rate/.test(w) ? "unit" : "amount";
  });

  function headingKind(text) {
    var t = fold(text).replace(/[:]$/, "").trim();
    if (ALL_HEADINGS[t]) return ALL_HEADINGS[t];
    var t2 = t.replace(/\s*\(.*\)$/, "").replace(/\s+(nzd|aud|usd|eur|gbp|excl?\.?|incl?\.?|ex|inc|gst|vat|ht|ttc|netto|brutto|€|\$)\.?$/g, "").trim();
    return ALL_HEADINGS[t2] || null;
  }

  /*
    The table heading's columns, from its words. Headings can run together ("Pos. Art.-Nr.",
    "Menge Einheit", "Price Quantity"), so the longest known phrase at each word wins, and a word
    that isn't a heading belongs to the heading before it in the same cell ("Unit price (NZD)").
  */
  function headerColumns(row) {
    var words = [];
    row.cells.forEach(function (c, ci) { (c.words && c.words.length ? c.words : [{ text: c.text, x0: c.x0, x1: c.x1 }]).forEach(function (w) { words.push({ text: w.text, x0: w.x0, x1: w.x1, cell: ci }); }); });
    var cols = [], i = 0;
    while (i < words.length) {
      var hit = null;
      for (var L = Math.min(4, words.length - i); L >= 1 && !hit; L--) {
        if (words[i + L - 1].cell !== words[i].cell && L > 1) continue;
        var phrase = words.slice(i, i + L).map(function (w) { return w.text; }).join(" ");
        var k = headingKind(phrase);
        if (k) hit = { kind: k, x0: words[i].x0, x1: words[i + L - 1].x1, text: phrase, n: L, cell: words[i].cell };
      }
      if (hit) { cols.push(hit); i += hit.n; continue; }
      var w = words[i], prev = cols[cols.length - 1];
      if (prev && prev.cell === w.cell) { prev.x1 = w.x1; prev.text += " " + w.text; }
      else cols.push({ kind: "other", x0: w.x0, x1: w.x1, text: w.text, cell: w.cell });
      i++;
    }
    cols.forEach(function (c) { c.mid = (c.x0 + c.x1) / 2; });
    return cols;
  }

  // A row is the table's heading when it has a quantity heading and a price or amount heading.
  function findHeader(rows, from) {
    for (var i = from || 0; i < rows.length; i++) {
      if (rows[i].cells.length < 2 && !(rows[i].cells[0] && rows[i].cells[0].words && rows[i].cells[0].words.length >= 3)) continue;
      var cols = headerColumns(rows[i]);
      var has = function (k) { return cols.some(function (c) { return c.kind === k; }); };
      var known = cols.filter(function (c) { return c.kind !== "other"; }).length;
      if (has("qty") && (has("unit") || has("amount")) && known >= 2 && known >= cols.length - 2) return { index: i, columns: cols };
    }
    return null;
  }

  function isTotalsRow(text) {
    var f = fold(text).replace(/^(zzgl\.?|plus|add|incl\.?|inkl\.?|\+|dont|hors)\s*/, "");
    return RE.subtotal.test(f) && /^\S*\s?\S*\s?(subtotal|sub total|sub-total|net|zwischensumme|nettobetrag|total ht|montant ht|sous-total|base imponible)/.test(f) ||
      /^(total|grand total|gesamt|summe|totaal|totale|total ht|total ttc|importe total|nettobetrag|zwischensumme|sous-total|base imponible|subtotal|sub total|sub-total)\b/.test(f) ||
      /^(gst|vat|tax|mwst|ust|tva|iva|btw)\b/.test(f) || /\b(total due|amount due|balance due|carried forward|übertrag|a reporter|suma y sigue)\b/.test(f);
  }
  function isFreight(text) { return /\b(freight|shipping|delivery charge|delivery fee|postage|courier|cartage|handling|fracht|versand|porto|frais de port|transport|envío|envio|portes|spedizione)\b/i.test(fold(text)); }
  function isDiscount(text) { return /\b(discount|rebate|rabatt|nachlass|skonto|remise|descuento|bonificación|bonificacion|sconto|korting)\b/i.test(fold(text)); }
  var NOT_DESCRIPTION = /^(delivery date|deliver by|liefertermin|lieferdatum|liefertag|date de livraison|livraison le|fecha de entrega|plazo de entrega|data di consegna|your ref|ihr zeichen)\b/i;
  var CODE_LABEL = /^(sku|code|item code|product code|part no\.?|part number|mfr\.? part|art\.?-?nr\.?|artikel-?nr\.?|artikelnummer|réf\.?|ref\.?|référence|referencia|código|codigo|cod\.?)\s*[:#.]?\s*([A-Z0-9][A-Z0-9./_\-]{1,23})$/i;

  // A code looks like RUN-500, 4500-12, ABC123, 12345678 (a number with no decimal part, when there is a code column).
  function looksLikeCode(t, strict) {
    var s = String(t || "").trim();
    if (!s || s.length > 24 || /\s/.test(s)) return false;
    if (/^\d{1,3}([.,]\d{3})*[.,]\d{2}$/.test(s)) return false; // money
    if (strict) return /^[A-Z0-9][A-Z0-9./_\-]*$/i.test(s) && /\d/.test(s) && !/^\d{1,4}$/.test(s);
    return /^[A-Z0-9][A-Z0-9./_\-]*$/i.test(s) && /\d/.test(s) && /[A-Z\-]/i.test(s);
  }

  function nearestColumn(cell, columns, numeric) {
    var best = null, bestD = Infinity;
    columns.forEach(function (col) {
      var overlap = Math.min(cell.x1, col.x1) - Math.max(cell.x0, col.x0);
      // Numbers are usually right-aligned under their heading, text left-aligned.
      var d = overlap > 0 ? -overlap : numeric ? Math.min(Math.abs(cell.x1 - col.x1), Math.abs((cell.x0 + cell.x1) / 2 - col.mid)) : Math.min(Math.abs(cell.x0 - col.x0), Math.abs((cell.x0 + cell.x1) / 2 - col.mid));
      if (d < bestD) { bestD = d; best = col; }
    });
    return best;
  }

  // "40 sac", "60 Paar", "12 pcs", "80.000" -> { qty, uom }.
  function qtyWithUnit(text, mark) {
    var t = String(text || "").trim();
    var m = t.match(/^([\d.,\s  ]+?)\s*([A-Za-zÀ-ÿ]{1,10}\.?)$/);
    if (m) { var q = parseQty(m[1], mark); if (Number.isFinite(q)) return { qty: q, uom: m[2] }; }
    var q2 = parseQty(t, mark);
    return Number.isFinite(q2) ? { qty: q2, uom: null } : null;
  }
  function isNumericText(text) {
    return /\d/.test(text) && /^[(\-−]?\s?(?:[A-Z]{3}|NZ\$|A\$|US\$|[€£$])?\s?[\d.,\s  :]+-?\)?\s?(?:[A-Z]{3}|€)?$/.test(String(text).trim());
  }

  /*
    The lines, using the table heading's columns. Each body row's cells go to the nearest column. A
    column whose heading could mean several things (Item, Article, Material, No.) is decided by what's
    in it: short numbers are line numbers, single tokens with digits are codes, words are
    descriptions. A row with a quantity and a price is a line; text under it is the rest of its
    description, or its code ("SKU SCR-850Z"). The table ends at the totals. On later pages the
    heading may repeat; if it doesn't, the same columns are used.
  */
  function lines0(body) { return body.length > 0; }
  function readTable(rows, mark, tracking) {
    var header = findHeader(rows, 0);
    if (!header) return null;
    var columns = header.columns;
    var body = [];
    var ended = false;
    for (var i = header.index + 1; i < rows.length; i++) {
      var r = rows[i];
      var again = findHeader([r], 0);
      if (again) { columns = again.columns; ended = false; continue; }
      if (ended) { if (r.page !== rows[i - 1].page) ended = false; else continue; }
      var firstText = r.cells[0] ? r.cells[0].text : r.text;
      if (r.cells.some(function (c) { return !isNumericText(c.text) && c.text.length <= 30 && isTotalsRow(c.text); }) && lines0(body) ) { ended = true; continue; }
      if (isTotalsRow(firstText) || (r.cells.length <= 3 && isTotalsRow(r.cells.map(function (c) { return c.text; }).filter(function (t) { return !isNumericText(t); }).join(" ")))) { ended = true; continue; }
      if (/^(page|seite|página|pagina|page \d)\s*\d+/i.test(fold(r.text)) || /^\d+\s*(of|von|sur|de)\s*\d+$/.test(fold(r.text))) continue;
      var cellsByCol = [];
      r.cells.forEach(function (c) {
        var text = c.text.trim();
        if (tracking.some(function (t) { return text.replace(/\s+/g, "").indexOf(t) >= 0; })) return;
        var col = nearestColumn(c, columns, isNumericText(text));
        if (col) cellsByCol.push({ col: col, text: text, cell: c });
      });
      body.push({ i: i, row: r, cells: cellsByCol, columns: columns });
    }

    // What the uncertain columns hold, from the rows that carry a number in a money column.
    var seen = [];
    body.forEach(function (b) { b.columns.forEach(function (c) { if (seen.indexOf(c) < 0) seen.push(c); }); });
    seen.forEach(function (col) {
      if (["item", "pos", "code", "other"].indexOf(col.kind) < 0) return;
      var vals = [];
      body.forEach(function (b) {
        var money = b.cells.some(function (x) { return (x.col.kind === "unit" || x.col.kind === "amount") && isNumericText(x.text); });
        if (!money) return;
        b.cells.forEach(function (x) { if (x.col === col) vals.push(x.text); });
      });
      if (!vals.length) { col.use = col.kind === "code" ? "code" : col.kind === "item" ? "description" : "ignore"; return; }
      var n = vals.length;
      var pos = vals.filter(function (v) { return /^\d{1,6}\.?$/.test(v); }).length;
      var codes = vals.filter(function (v) { return looksLikeCode(v, true) || looksLikeCode(v, false); }).length;
      var wordy = vals.filter(function (v) { return v.split(/\s+/).length >= 3 || v.length >= 22; }).length;
      if (pos >= n * 0.7) col.use = "pos";
      else if (wordy >= n * 0.5) col.use = "description";
      else if (codes >= n * 0.6 || (col.kind === "code" && wordy < n * 0.3)) col.use = "code";
      else col.use = col.kind === "other" ? "other" : "description";
    });
    seen.forEach(function (col) { if (!col.use) col.use = col.kind; });
    // Two code columns: the one with letters in its codes is the item code; the other is a line number.
    var codeCols = seen.filter(function (c) { return c.use === "code"; });
    var hasDescription = seen.some(function (c) { return c.use === "description"; });
    seen.forEach(function (c) { if (c.use === "other") c.use = hasDescription ? "ignore" : "description"; });

    var lines = [];
    body.forEach(function (b) {
      var got = { code: null, description: [], qty: NaN, unit: NaN, amount: NaN, uom: null, outside: false, unreadable: null };
      b.cells.forEach(function (x) {
        var use = x.col.use, text = x.text;
        if (use === "qty") {
          var q = qtyWithUnit(text, mark);
          if (q) { got.qty = q.qty; if (q.uom) got.uom = q.uom; }
          else if (/\d/.test(text) && text.length <= 14) got.unreadable = text;
          else { got.description.push(text); got.outside = true; }
        } else if (use === "unit" || use === "amount") {
          var a = parseAmount(text, mark);
          if (Number.isFinite(a)) { if (use === "unit") got.unit = a; else got.amount = a; }
          else if (/^[a-zà-ÿ]{1,6}\.?$/i.test(text)) got.uom = text;
          else if (/\d/.test(text) && text.length <= 14) got.unreadable = text;
          else { got.description.push(text); got.outside = true; }
        } else if (use === "code") {
          if (!got.code && /^\S+$/.test(text)) got.code = text;
          else { got.description.push(text); got.outside = true; }
        } else if (use === "uom") {
          // "60 Paar" can sit under the unit heading when quantity and unit are printed together.
          var qu = /\d/.test(text) ? qtyWithUnit(text, mark) : null;
          if (qu && !Number.isFinite(got.qty)) { got.qty = qu.qty; got.uom = qu.uom; }
          else got.uom = text;
        } else if (use === "description") {
          got.description.push(text);
        } else if (use === "pos" || use === "ignore") {
          // a line number, or a column we don't use (a delivery date, a tax code)
          if (!/^\d{1,6}\.?$/.test(text) && use === "pos") got.description.push(text);
        }
      });
      var desc = got.description.join(" ").replace(/\s+/g, " ").trim();
      if (!codeCols.length && !got.code && desc) {
        var first = desc.split(" ")[0];
        if (looksLikeCode(first, false)) { got.code = first; desc = desc.slice(first.length).trim(); }
      }
      var hasMoney = Number.isFinite(got.unit) || Number.isFinite(got.amount);
      if (Number.isFinite(got.qty) && !hasMoney && got.code && got.unreadable) {
        lines.push({ code: got.code, description: desc, qty: got.qty, unitCents: NaN, amountCents: NaN, uom: got.uom, row: b.i, unreadable: true });
        return;
      }
      if (Number.isFinite(got.qty) && hasMoney) {
        if (!Number.isFinite(got.unit) && Number.isFinite(got.amount) && got.qty) got.unit = Math.round(got.amount / got.qty);
        lines.push({ code: got.code, description: desc, qty: got.qty, unitCents: got.unit, amountCents: Number.isFinite(got.amount) ? got.amount : NaN, uom: got.uom, row: b.i });
        return;
      }
      if (!Number.isFinite(got.qty) && hasMoney && (isFreight(desc) || isDiscount(desc))) {
        var amt = Number.isFinite(got.amount) ? got.amount : got.unit;
        lines.push({ code: got.code, description: desc, qty: 1, unitCents: amt, amountCents: amt, uom: null, row: b.i, type: isDiscount(desc) ? "discount" : "freight" });
        return;
      }
      if (!desc || !lines.length || hasMoney || Number.isFinite(got.qty)) return;
      // Under a line: its code ("SKU SCR-850Z"), or the rest of its description.
      var prev = lines[lines.length - 1];
      var prevRow = rows[prev.row];
      if (!prevRow || prevRow.page !== b.row.page || b.row.y - prevRow.y > prevRow.h * 2.8) return;
      var lab = desc.match(CODE_LABEL);
      if (lab) { if (!prev.code || /^\d{1,6}$/.test(prev.code)) prev.code = lab[2]; prev.row = b.i; return; }
      if (NOT_DESCRIPTION.test(fold(desc))) { prev.row = b.i; return; }
      var sentence = desc.length > 60 && /[.!?]$/.test(desc);
      if (got.outside || sentence || isTotalsRow(desc)) return;
      if (!prev.code && looksLikeCode(desc, true)) prev.code = desc;
      else prev.description = (prev.description + " " + desc).trim();
      prev.row = b.i;
    });
    return lines;
  }

  // Rows that are labels with a value ("PO number: 4500012904", "Date: 01/11/2026", "Page 1 of 2").
  function isLabelRow(text) {
    var f = fold(text);
    return RE.date.test(f) && /\d{1,2}[/.\-]\d{1,2}|\d{4}/.test(f) && !/\d[.,]\d{2}\b.*\d[.,]\d{2}\b/.test(f) ||
      /\b(page|seite|página|pagina)\s*\d+/.test(f) || RE.docNumber.order.test(f) && f.length < 50 || RE.docNumber.invoice.test(f) && f.length < 50 ||
      RE.orderRef.test(f) && f.length < 50 || /\b(bank|account|iban|swift|bsb|acct|phone|tel|fax|email|e-mail)\b/.test(f);
  }
  function readLoose(rows, mark, tracking) {
    var lines = [];
    rows.forEach(function (r, i) {
      if (isTotalsRow(r.text) || isLabelRow(r.text)) return;
      var text = r.text;
      tracking.forEach(function (t) { text = text.split(t).join(" "); });
      var nums = amountsIn(text, mark);
      if (nums.length < 2) return;
      var tail = nums.slice(-3);
      var pick = null;
      if (tail.length === 3) {
        var q = tail[0].cents / 100, u = tail[1].cents, a = tail[2].cents;
        if (q > 0 && Math.abs(Math.round(q * u) - a) <= 1) pick = { qty: q, unit: u, amount: a, at: tail[0].index };
        else {
          // price, qty, amount
          q = tail[1].cents / 100; u = tail[0].cents;
          if (q > 0 && Math.abs(Math.round(q * u) - a) <= 1) pick = { qty: q, unit: u, amount: a, at: tail[0].index };
        }
      }
      if (!pick && tail.length >= 2) {
        // Quantity then price, with no amount: the price must show its cents ("15.60").
        var qq = tail[tail.length - 2].cents / 100, uu = tail[tail.length - 1].cents;
        var priceText = tail[tail.length - 1].text;
        var sep = mark === "," ? "," : ".";
        if (Number.isInteger(qq) && qq > 0 && qq < 100000 && !/[.,]\d{2}\b/.test(tail[tail.length - 2].text) && priceText.indexOf(sep) >= 0 && /\d{2}\)?-?$/.test(priceText.replace(/[^\d)\-]+$/, ""))) pick = { qty: qq, unit: uu, amount: NaN, at: tail[tail.length - 2].index };
      }
      if (!pick) return;
      var desc = text.slice(0, pick.at).replace(/\s+/g, " ").trim();
      var code = null;
      var first = desc.split(" ")[0];
      if (looksLikeCode(first, false)) { code = first; desc = desc.slice(first.length).trim(); }
      if (!desc && !code) return;
      lines.push({ code: code, description: desc, qty: pick.qty, unitCents: pick.unit, amountCents: pick.amount, uom: null, row: i });
    });
    return lines;
  }

  // "zzgl. 19 % MwSt.", "plus GST", "TVA 20 %": words and rates around the label are allowed.
  var TOTAL_PREFIX = /^(zzgl\.?|zuzügl\.?|plus|add|less|incl\.?|inkl\.?|including|\+|dont|hors|más|mas)\s*/;
  function findTotal(rows, re, mark, from) {
    for (var i = from || 0; i < rows.length; i++) {
      var r = rows[i];
      for (var ci = 0; ci < r.cells.length; ci++) {
        var f = fold(r.cells[ci].text).replace(TOTAL_PREFIX, "").replace(/^\d{1,2}(?:[.,]\d+)?\s?%\s*/, "");
        var m = f.match(re);
        if (!m || m.index > 4) continue;
        // The amount to the right of the label on the same row (the last one, for "GST 15%  $463.29").
        var rest = r.cells.slice(ci + 1).map(function (c) { return c.text; }).join("  ");
        var own = r.cells[ci].text.replace(/\d{1,2}(?:[.,]\d+)?\s?%/g, " ");
        var afterLabel = own.slice(Math.min(own.length, own.toLowerCase().indexOf(m[2].split(" ")[0]) + m[2].length));
        var nums = amountsIn((afterLabel + "  " + rest).replace(/\d{1,2}(?:[.,]\d+)?\s?%/g, " "), mark);
        if (nums.length) return { cents: nums[nums.length - 1].cents, row: i };
        var below = rows[i + 1];
        if (below && below.page === r.page && below.cells.length <= 2) {
          var under = amountsIn(below.text, mark);
          if (under.length) return { cents: under[under.length - 1].cents, row: i + 1 };
        }
      }
    }
    return null;
  }

  function taxPercent(rows) {
    for (var i = 0; i < rows.length; i++) {
      var f = fold(rows[i].text);
      var m = f.match(/\b(gst|vat|tax|mwst|ust|tva|iva|btw)\b[^%\n]{0,20}?(\d{1,2}(?:[.,]\d+)?)\s?%/) || f.match(/(\d{1,2}(?:[.,]\d+)?)\s?%\s*(gst|vat|mwst|ust|tva|iva|btw)/);
      if (m) return parseFloat((m[2] && /\d/.test(m[2]) ? m[2] : m[1]).replace(",", "."));
    }
    return null;
  }

  // ---------- 7. putting it together ----------
  var COUNTRY_CURRENCY = { NZ: "NZD", AU: "AUD", US: "USD", GB: "GBP", DE: "EUR", FR: "EUR", ES: "EUR", IT: "EUR", NL: "EUR", AT: "EUR", BE: "EUR", IE: "EUR", CH: "CHF", JP: "JPY", CN: "CNY", CA: "CAD", SG: "SGD" };
  var CURRENCY_COUNTRY = { NZD: "NZ", AUD: "AU", USD: "US", GBP: "GB", CHF: "CH", JPY: "JP", CNY: "CN", CAD: "CA", SGD: "SG" };
  var TAX_RATES = { NZ: 15, AU: 10, GB: 20, DE: 19, FR: 20, ES: 21, IT: 22, NL: 21, AT: 20, BE: 21, IE: 23 };

  function detectCurrency(rows, country) {
    var text = rows.map(function (r) { return r.text; }).join("\n");
    var counts = {};
    CURRENCY_TOKENS.forEach(function (c) {
      var re = new RegExp(c[1].source, "g");
      var n = (text.match(re) || []).length;
      if (n) counts[c[0]] = n;
    });
    var best = null, bestN = 0;
    Object.keys(counts).forEach(function (k) { if (counts[k] > bestN) { best = k; bestN = counts[k]; } });
    if (best) return best;
    if (/\$/.test(text)) return COUNTRY_CURRENCY[country] && /D$/.test(COUNTRY_CURRENCY[country]) ? COUNTRY_CURRENCY[country] : "NZD";
    return COUNTRY_CURRENCY[country] || null;
  }

  var US_STATE = /\b(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)\s\d{5}(-\d{4})?\b/;
  function countryOfText(raw) {
    var text = fold(raw);
    if (/new zealand|aotearoa|\+64\b/.test(text)) return "NZ";
    if (/australia|\+61\b|\b(nsw|vic|qld|wa|sa|tas|act|nt)\s\d{4}\b/.test(text)) return "AU";
    if (/united kingdom|england|scotland|wales|\+44\b/.test(text)) return "GB";
    if (/deutschland|germany|\+49\b/.test(text)) return "DE";
    if (/\bfrance\b|\+33\b/.test(text)) return "FR";
    if (/españa|espana|\bspain\b|\+34\b/.test(text)) return "ES";
    if (/united states|\busa\b|\+1\b|\(\d{3}\)\s?\d{3}-\d{4}/.test(text) || US_STATE.test(raw)) return "US";
    if (/china|中国|\+86\b/.test(text)) return "CN";
    return null;
  }
  // The issuer's country: from its tax number, else from the page with the buyer's address block left out.
  function detectCountry(rows, taxId, language) {
    if (taxId && taxId.country && taxId.valid !== false) return taxId.country;
    var skip = buyerRows(rows);
    var mine = rows.filter(function (r, i) { return !skip[i]; });
    var top = countryOfText(mine.slice(0, 14).map(function (r) { return r.text; }).join(" "));
    if (top) return top;
    var any = countryOfText(mine.map(function (r) { return r.text; }).join(" "));
    if (any) return any;
    return { de: "DE", fr: "FR", es: "ES", it: "IT", nl: "NL", zh: "CN" }[language] || (taxId && taxId.country) || null;
  }

  /*
    read(items, opts) -> the document.
    opts: { name } (the file name, used as a hint only).
  */
  function read(items, opts) {
    opts = opts || {};
    var rows = toRows(items);
    var warnings = [];
    if (!rows.length) return { kind: "unknown", lines: [], warnings: ["No text was found on this file."], rows: 0 };
    var mark = decimalMark(rows);
    var language = detectLanguage(rows);
    var kindInfo = detectKind(rows);
    var kind = kindInfo.kind;
    if (kind === "unknown" && opts.name) {
      var n = fold(opts.name);
      if (/\b(inv|invoice|rechnung|facture|factura)/.test(n)) kind = "invoice";
      else if (/\b(po|purchase|order|bestell|commande|pedido)/.test(n)) kind = "order";
      else if (/\b(confirm|ack|ab\b|auftragsbest)/.test(n)) kind = "confirmation";
    }
    var tracking = findTracking(rows);
    var taxId = findTaxId(rows);
    var country = detectCountry(rows, taxId, language);
    var currency = detectCurrency(rows, country);
    var monthFirst = country === "US";

    // The document's own number, and the order it refers to.
    var number = null, orderNumber = null;
    var numRe = kind !== "unknown" && RE.docNumber[kind] ? RE.docNumber[kind] : RE.docNumber.invoice;
    var hit = valueAfter(rows, numRe, { accept: looksLikeDocNumber });
    if (hit) number = cleanNumber(hit.text);
    if (!number && kind === "order") { hit = valueAfter(rows, RE.orderRef, { accept: looksLikeDocNumber }); if (hit) number = cleanNumber(hit.text); }
    if (!number) number = numberByTitle(rows, kindInfo.title);
    if (!number) {
      // "Tax invoice INV-20418": the number right after the title.
      rows.slice(0, 40).some(function (r) {
        var m = r.text.match(/(?:invoice|order|rechnung|facture|factura|bestellung|commande|pedido|confirmation|auftragsbestätigung)\s*(?:no\.?|nr\.?|n°|nº|#|number)?\s*[:#]?\s*([A-Z]{0,5}[-/]?\d[\w\-/]{2,24})/i);
        if (m) { number = m[1]; return true; }
        return false;
      });
    }
    if (kind === "order") orderNumber = number;
    else {
      hit = valueAfter(rows, RE.orderRef, { accept: function (t) { return looksLikeDocNumber(t) && cleanNumber(t) !== number; } });
      if (hit) orderNumber = cleanNumber(hit.text);
      if (!orderNumber) {
        rows.some(function (r) {
          var m = r.text.match(/(?:for order|order|po|bestellung|commande|pedido)\s*(?:no\.?|nr\.?|n°|nº|#|number)?\s*[:#]?\s*(\d[\w\-/]{3,24})/i);
          if (m && m[1] !== number) { orderNumber = m[1]; return true; }
          return false;
        });
      }
    }

    var dateHit = valueAfter(rows, RE.date, { accept: function (t) { return !!parseDateText(t, monthFirst); } });
    var issued = dateHit ? parseDateText(dateHit.text, monthFirst) : null;
    if (!issued) rows.slice(0, 40).some(function (r) { issued = parseDateText(r.text, monthFirst); return !!issued; });
    var dueHit = valueAfter(rows, RE.due, { accept: function (t) { return !!parseDateText(t, monthFirst); } });
    var due = dueHit ? parseDateText(dueHit.text, monthFirst) : null;

    var parties = findParties(rows, kind);

    var lines = readTable(rows, mark, tracking);
    var method = "table";
    if (!lines || !lines.length) { lines = readLoose(rows, mark, tracking); method = "loose"; }

    var lastLineRow = lines.length ? lines[lines.length - 1].row : 0;
    var sub = findTotal(rows, RE.subtotal, mark, lastLineRow);
    var tax = findTotal(rows, RE.tax, mark, sub ? sub.row : lastLineRow);
    var total = findTotal(rows, RE.total, mark, tax ? tax.row : (sub ? sub.row : lastLineRow));
    if (total && sub && total.row === sub.row) total = findTotal(rows, RE.total, mark, sub.row + 1);
    var pct = taxPercent(rows);

    var out = {
      kind: kind,
      credit: CREDIT.some(function (w) { return fold(rows.slice(0, 20).map(function (r) { return r.text; }).join(" ")).indexOf(fold(w)) >= 0; }),
      language: language,
      decimalMark: mark,
      number: number,
      orderNumber: orderNumber,
      supplier: parties.supplier,
      buyer: parties.buyer,
      buyerDetails: parties.buyerDetails || "",
      taxId: taxId,
      country: country,
      currency: currency,
      taxPercent: pct != null ? pct : (country && TAX_RATES[country] != null ? TAX_RATES[country] : null),
      issued: issued,
      due: due,
      lines: lines.map(function (l) {
        var o = { code: l.code || null, description: l.description || "", qty: l.qty, unitCents: l.unitCents, amountCents: l.amountCents, uom: l.uom || null };
        if (l.type) o.type = l.type;
        if (l.unreadable) o.unreadable = true;
        return o;
      }),
      subtotalCents: sub ? sub.cents : NaN,
      taxCents: tax ? tax.cents : NaN,
      totalCents: total ? total.cents : NaN,
      tracking: tracking,
      method: method,
      warnings: warnings,
      rows: rows.length,
      kindScores: kindInfo.scores
    };
    if (out.kind === "unknown") warnings.push("Couldn't tell whether this is an order, a confirmation or an invoice.");
    if (!out.number) warnings.push("Couldn't find the document number.");
    if (!out.lines.length) warnings.push("Couldn't find any lines with a quantity and a price.");
    if (out.kind !== "order" && !out.orderNumber) warnings.push("Couldn't find which order this is for.");
    // Lines that don't add up are worth a look: qty x price should be the amount.
    out.lines.forEach(function (l) {
      if (Number.isFinite(l.amountCents) && Number.isFinite(l.unitCents) && Math.abs(Math.round(l.qty * l.unitCents) - l.amountCents) > Math.max(1, Math.abs(l.amountCents) * 0.0005) && !l.type) {
        l.mismatch = true;
      }
    });
    // When the line amounts add up to the subtotal, the amounts are right: a unit price that
    // doesn't fit its amount was misread, so it's worked out from the amount and said so.
    var amountsSum = out.lines.reduce(function (t, l) { return t + (Number.isFinite(l.amountCents) ? l.amountCents : NaN); }, 0);
    if (out.lines.length && Number.isFinite(amountsSum) && amountsSum === out.subtotalCents) {
      out.lines.forEach(function (l) {
        if (!(l.qty > 0) || l.type) return;
        var fit = l.amountCents / l.qty;
        if (Math.abs(fit - Math.round(fit)) > 0.001) return;
        if (!Number.isFinite(l.unitCents) || Math.abs(Math.round(l.qty * l.unitCents) - l.amountCents) > 1) {
          l.readAs = l.unitCents; l.unitCents = Math.round(fit); l.corrected = true; delete l.mismatch; delete l.unreadable;
          warnings.push("The price of " + (l.code || l.description) + " was worked out from its amount, because it didn't read clearly.");
        }
      });
    }
    out.lines.forEach(function (l) { if (l.unreadable) warnings.push("The price of " + (l.code || l.description) + " couldn't be read, so only its quantity was checked."); });
    if (!Number.isFinite(out.subtotalCents) && out.lines.length) {
      var sum = out.lines.reduce(function (t, l) { return t + (Number.isFinite(l.amountCents) ? l.amountCents : Math.round(l.qty * l.unitCents)); }, 0);
      if (Number.isFinite(out.totalCents) && Number.isFinite(out.taxCents) && out.totalCents - out.taxCents === sum) out.subtotalCents = sum;
    }
    return out;
  }

  function fromText(text, opts) {
    return read(textToItems(text, opts), opts);
  }

  return {
    read: read, fromText: fromText, toRows: toRows, textToItems: textToItems, findHeader: findHeader, headerColumns: headerColumns,
    parseAmount: parseAmount, parseQty: parseQty, decimalMark: decimalMark, parseDateText: parseDateText,
    nzGstValid: nzGstValid, abnValid: abnValid, findTracking: findTracking, detectKind: detectKind,
    TAX_RATES: TAX_RATES, COUNTRY_CURRENCY: COUNTRY_CURRENCY
  };
});
