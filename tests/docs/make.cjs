#!/usr/bin/env node
// Builds a labelled set of made-up purchasing documents (purchase orders, order confirmations,
// tax invoices) for measuring a document reader.
//
//   node tests/docs/make.cjs                 render everything, write out/ and truth.json, then check
//   node tests/docs/make.cjs --labels-only   write truth.json only (fast; for checking determinism)
//   node tests/docs/make.cjs --check         re-check the existing out/ PDFs against the labels
//   node tests/docs/make.cjs --html po-01 x.html   write one document's HTML (for debugging a layout)
//
// The check reads each PDF's text layer with pdftotext (poppler-utils) when it is installed.
//
// Every name, address, number and price is invented. All randomness comes from one seeded PRNG,
// so the labels are identical on every run. The PDF and image bytes can differ slightly between
// runs (creation dates, image noise), the labels never do.
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { spawnSync } = require('child_process');

const ROOT = __dirname;
const OUT = path.join(ROOT, 'out');
const TRUTH = path.join(ROOT, 'truth.json');
const SEED = 20261118;
const SCALE = 1.25;            // screenshot device scale factor (A4 page = 992 x 1400 px)
const PHOTO_WIDTH = 1000;      // width of the phone-photo JPEG
const MAX_IMAGE_BYTES = 390 * 1024;
const PHOTO_TARGET_BYTES = 150 * 1024; // keeps the whole set under 12 MB
const MAX_TOTAL_BYTES = 12 * 1024 * 1024;

// ---------------------------------------------------------------- seeded randomness

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(SEED);
const int = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
const pick = (a) => a[Math.floor(rand() * a.length)];
const digits = (n) => { let s = ''; for (let i = 0; i < n; i++) s += int(0, 9); return s; };
const ALNUM = 'ABCDEFGHJKLMNPRSTUVWXY0123456789';

// ---------------------------------------------------------------- tax numbers (all pass their checks)

const IRD_W1 = [3, 2, 7, 6, 5, 4, 3, 2], IRD_W2 = [7, 4, 3, 2, 5, 2, 7, 6];
function irdDigit(body8, w) {
  let s = 0; for (let i = 0; i < 8; i++) s += w[i] * Number(body8[i]);
  const r = s % 11; return r === 0 ? 0 : 11 - r;
}
function nzGstValid(raw) {
  const n = String(raw).replace(/[\s-]/g, '');
  if (!/^\d{8,9}$/.test(n)) return false;
  const v = Number(n); if (v < 10000000 || v > 150000000) return false;
  const body = n.slice(0, -1).padStart(8, '0');
  let c = irdDigit(body, IRD_W1); if (c === 10) c = irdDigit(body, IRD_W2);
  return c !== 10 && c === Number(n[n.length - 1]);
}
function makeNzGst(nine) {
  for (;;) {
    const base = nine ? int(10000000, 14999999) : int(1000000, 9999999);
    const body = String(base).padStart(8, '0');
    let c = irdDigit(body, IRD_W1); if (c === 10) c = irdDigit(body, IRD_W2);
    if (c === 10) continue;
    const n = String(base) + c;
    if (!nzGstValid(n)) throw new Error('bad GST ' + n);
    return n.length === 9 ? `${n.slice(0, 3)}-${n.slice(3, 6)}-${n.slice(6)}` : `${n.slice(0, 2)}-${n.slice(2, 5)}-${n.slice(5)}`;
  }
}
const ABN_W = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
function abnValid(raw) {
  const d = String(raw).replace(/\s/g, ''); if (!/^\d{11}$/.test(d)) return false;
  let s = 0; for (let i = 0; i < 11; i++) s += ABN_W[i] * (Number(d[i]) - (i === 0 ? 1 : 0));
  return s % 89 === 0;
}
function makeAbn() {
  for (;;) {
    const rest = String(int(1, 9)) + digits(8), start = int(10, 99);
    for (let k = 0; k < 90; k++) {
      const p = 10 + ((start - 10 + k) % 90), d = String(p) + rest;
      if (abnValid(d)) return `${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5, 8)} ${d.slice(8)}`;
    }
  }
}
function gbVatValid(raw) {
  const d = String(raw).replace(/^GB/i, '').replace(/\s/g, ''); if (!/^\d{9}$/.test(d)) return false;
  let s = 0; for (let i = 0; i < 7; i++) s += (8 - i) * Number(d[i]);
  s += Number(d.slice(7)); return s % 97 === 0 || (s + 55) % 97 === 0;
}
function makeGbVat() {
  const f = String(int(1, 9)) + digits(6);
  let s = 0; for (let i = 0; i < 7; i++) s += (8 - i) * Number(f[i]);
  const d = f + String((97 - (s % 97)) % 97).padStart(2, '0');
  if (!gbVatValid(d)) throw new Error('bad GB VAT');
  return `GB ${d.slice(0, 3)} ${d.slice(3, 7)} ${d.slice(7)}`;
}
function deDigit(d8) {
  let product = 10;
  for (const ch of d8) { let sum = (Number(ch) + product) % 10; if (sum === 0) sum = 10; product = (2 * sum) % 11; }
  const c = 11 - product; return c === 10 ? 0 : c;
}
function makeDeVat() { const d = String(int(1, 9)) + digits(7); return 'DE' + d + deDigit(d); }
function luhnValid(s) {
  let sum = 0;
  for (let i = 0; i < s.length; i++) { let d = Number(s[s.length - 1 - i]); if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; } sum += d; }
  return sum % 10 === 0;
}
function luhnComplete(p) { for (let c = 0; c < 10; c++) if (luhnValid(p + c)) return p + c; throw new Error('luhn'); }
function makeFrIds() {
  const siren = luhnComplete(String(int(3, 9)) + digits(7));
  const key = String((12 + 3 * (Number(siren) % 97)) % 97).padStart(2, '0');
  const siret = luhnComplete(siren + '0' + digits(3));
  return { vat: `FR${key}${siren}`, vatPrinted: `FR ${key} ${siren.slice(0, 3)} ${siren.slice(3, 6)} ${siren.slice(6)}`, siret: `${siret.slice(0, 3)} ${siret.slice(3, 6)} ${siret.slice(6, 9)} ${siret.slice(9)}` };
}
function cifControl(d7) {
  let even = 0, odd = 0;
  for (let i = 0; i < 7; i++) { const n = Number(d7[i]); if (i % 2 === 1) even += n; else { const x = n * 2; odd += Math.floor(x / 10) + (x % 10); } }
  return (10 - ((even + odd) % 10)) % 10;
}
function makeEsVat() { const d = digits(7); return 'ESB' + d + cifControl(d); }
function ibanCheck(cc, bban) {
  const s = (bban + cc + '00').replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let r = 0; for (const ch of s) r = (r * 10 + Number(ch)) % 97;
  return String(98 - r).padStart(2, '0');
}
function makeIban(cc) {
  const bban = cc === 'DE' ? digits(18) : cc === 'FR' ? digits(23) : digits(20);
  const iban = cc + ibanCheck(cc, bban) + bban;
  return iban.replace(/(.{4})/g, '$1 ').trim();
}

// ---------------------------------------------------------------- courier tracking numbers (noise)

function upsDigit(body) {
  let s = 0;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i], v = /\d/.test(ch) ? Number(ch) : (ch.charCodeAt(0) - 63) % 10;
    s += i % 2 === 1 ? 2 * v : v;
  }
  return (10 - (s % 10)) % 10;
}
if (upsDigit('999AA1012345678') !== 4) throw new Error('UPS check digit');
function ups() {
  let shipper = ''; for (let i = 0; i < 6; i++) shipper += pick(ALNUM);
  const body = shipper + pick(['01', '02', '03', '12']) + digits(7);
  const v = '1Z' + body + upsDigit(body);
  return { carrier: 'UPS', value: v, printed: `1Z ${v.slice(2, 5)} ${v.slice(5, 8)} ${v.slice(8, 10)} ${v.slice(10, 14)} ${v.slice(14)}`, plain: v };
}
function fedex() {
  const b = '7' + digits(10), w = [1, 3, 7];
  let s = 0; for (let i = 0; i < 11; i++) s += Number(b[10 - i]) * w[i % 3];
  const v = b + ((s % 11) % 10);
  return { carrier: 'FedEx', value: v, printed: `${v.slice(0, 4)} ${v.slice(4, 8)} ${v.slice(8)}`, plain: v };
}
function dhl() {
  const b = String(int(1, 9)) + digits(8), v = b + (Number(b) % 7);
  return { carrier: 'DHL Express', value: v, printed: v, plain: v };
}
function nzpost() {
  const w = [8, 6, 4, 2, 3, 5, 9, 7], d = digits(8);
  let s = 0; for (let i = 0; i < 8; i++) s += w[i] * Number(d[i]);
  let c = 11 - (s % 11); if (c === 10) c = 0; if (c === 11) c = 5;
  const v = pick(['EZ', 'RN', 'CP', 'LZ']) + d + c + 'NZ';
  return { carrier: 'NZ Post', value: v, printed: v, plain: v };
}

// ---------------------------------------------------------------- formatting

const NUM = {
  en: { group: ',', dec: '.' }, zh: { group: ',', dec: '.' },
  de: { group: '.', dec: ',' }, es: { group: '.', dec: ',' }, fr: { group: '\u00a0', dec: ',' },
};
function groupInt(n, g) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, g); }
function fmtCents(cents, lang) {
  const f = NUM[lang], neg = cents < 0, a = Math.abs(cents);
  return (neg ? '-' : '') + groupInt(Math.floor(a / 100), f.group) + f.dec + String(a % 100).padStart(2, '0');
}
function fmtQty(q, lang, decimals) {
  const f = NUM[lang];
  if (decimals) { const s = q.toFixed(decimals).split('.'); return groupInt(Number(s[0]), f.group) + f.dec + s[1]; }
  if (Number.isInteger(q)) return groupInt(q, f.group);
  const s = String(q).split('.'); return groupInt(Number(s[0]), f.group) + f.dec + s[1];
}
const dec = (cents) => (cents < 0 ? '-' : '') + Math.floor(Math.abs(cents) / 100) + '.' + String(Math.abs(cents) % 100).padStart(2, '0');
const MONTHS = {
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  de: ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'],
  fr: ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'],
  es: ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'],
};
function fmtDate(iso, style) {
  const [y, m, d] = iso.split('-').map(Number), p = (n) => String(n).padStart(2, '0');
  switch (style) {
    case 'd/m/y': return `${d}/${m}/${y}`;
    case 'dd/mm/yyyy': return `${p(d)}/${p(m)}/${y}`;
    case 'mm/dd/yyyy': return `${p(m)}/${p(d)}/${y}`;
    case 'dd.mm.yyyy': return `${p(d)}.${p(m)}.${y}`;
    case 'd MMMM yyyy': return `${d} ${MONTHS.en[m - 1]} ${y}`;
    case 'dd-MMM-yyyy': return `${p(d)}-${MONTHS.en[m - 1].slice(0, 3)}-${y}`;
    case 'MMM d, yyyy': return `${MONTHS.en[m - 1].slice(0, 3)} ${d}, ${y}`;
    case 'de-long': return `${d}. ${MONTHS.de[m - 1]} ${y}`;
    case 'fr-long': return `${d} ${MONTHS.fr[m - 1]} ${y}`;
    case 'es-long': return `${d} de ${MONTHS.es[m - 1]} de ${y}`;
    case 'zh': return `${y}年${m}月${d}日`;
    case 'iso': return iso;
    default: throw new Error('date style ' + style);
  }
}
function addDays(iso, n) {
  const t = Date.UTC(...iso.split('-').map((v, i) => Number(v) - (i === 1 ? 1 : 0))) + n * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---------------------------------------------------------------- words

const T = {
  en: {
    title: { order: 'Purchase Order', confirmation: 'Order Confirmation', invoice: 'Tax Invoice' },
    no: { order: 'PO number', confirmation: 'Confirmation no.', invoice: 'Invoice no.' },
    date: { order: 'Order date', confirmation: 'Date', invoice: 'Invoice date' },
    yourOrder: 'Your order no.', customerNo: 'Customer no.', supplierNo: 'Supplier no.', due: 'Due date',
    required: 'Required by', dispatch: 'Expected dispatch', billTo: 'Bill to', shipTo: 'Deliver to', to: 'Supplier',
    contact: 'Contact', subtotal: 'Subtotal', total: 'Total', paid: 'Amount paid', balance: 'Balance due',
    page: (i, n) => `Page ${i} of ${n}`, cont: 'continued', carried: 'Carried forward', brought: 'Brought forward',
    ph: 'Ph', em: 'Email', bank: 'Bank account',
    cols: { pos: 'Line', item: 'Item', code: 'Code', desc: 'Description', qty: 'Qty', uom: 'Unit', unit: 'Unit price', amount: 'Amount' },
    uom: { ea: 'ea', pr: 'pr', box: 'box', m: 'm', roll: 'roll', pk: 'pk', ctn: 'ctn', bag: 'bag', set: 'set', l: 'L', kg: 'kg' },
    ship: (c, n) => (c.startsWith('DHL') ? `Dispatched via ${c}, waybill (AWB) ${n}` : `Dispatched via ${c}, tracking ${n}`),
  },
  de: {
    title: { order: 'Bestellung', confirmation: 'Auftragsbestätigung', invoice: 'Rechnung' },
    no: { order: 'Bestellnummer', confirmation: 'AB-Nummer', invoice: 'Rechnungsnummer' },
    date: { order: 'Bestelldatum', confirmation: 'Datum', invoice: 'Rechnungsdatum' },
    yourOrder: 'Ihre Bestellung', customerNo: 'Kundennummer', supplierNo: 'Lieferantennummer', due: 'Fällig am',
    required: 'Liefertermin', dispatch: 'Voraussichtlicher Versand', billTo: 'Rechnungsanschrift', shipTo: 'Lieferanschrift', to: 'Lieferant',
    contact: 'Ansprechpartner', subtotal: 'Nettobetrag', total: 'Gesamtbetrag', paid: 'Bereits bezahlt', balance: 'Zahlbetrag',
    page: (i, n) => `Seite ${i} von ${n}`, cont: 'Fortsetzung', carried: 'Übertrag', brought: 'Übertrag',
    ph: 'Tel.', em: 'E-Mail', bank: 'Bankverbindung',
    cols: { pos: 'Pos.', item: 'Pos.', code: 'Art.-Nr.', desc: 'Bezeichnung', qty: 'Menge', uom: 'Einheit', unit: 'Einzelpreis', amount: 'Gesamt' },
    uom: { ea: 'Stk', pr: 'Paar', box: 'Pkg', m: 'm', roll: 'Rolle', pk: 'Pkg', ctn: 'Karton', bag: 'Beutel', set: 'Satz', l: 'l', kg: 'kg' },
    ship: (c, n) => `Versand: ${c}, AWB ${n}`,
  },
  fr: {
    title: { order: 'Bon de commande', confirmation: 'Confirmation de commande', invoice: 'Facture' },
    no: { order: 'N° de commande', confirmation: 'N° de confirmation', invoice: 'N° de facture' },
    date: { order: 'Date de commande', confirmation: 'Date', invoice: 'Date de facture' },
    yourOrder: 'Votre commande', customerNo: 'N° client', supplierNo: 'N° fournisseur', due: 'Échéance',
    required: 'Livraison souhaitée', dispatch: 'Expédition prévue', billTo: 'Facturer à', shipTo: 'Livrer à', to: 'Fournisseur',
    contact: 'Contact', subtotal: 'Total HT', total: 'Total TTC', paid: 'Acompte versé', balance: 'Net à payer',
    page: (i, n) => `Page ${i} sur ${n}`, cont: 'suite', carried: 'À reporter', brought: 'Report',
    ph: 'Tél.', em: 'Courriel', bank: 'Coordonnées bancaires',
    cols: { pos: 'Pos.', item: 'Pos.', code: 'Réf.', desc: 'Désignation', qty: 'Quantité', uom: 'Unité', unit: 'Prix unitaire HT', amount: 'Montant HT' },
    uom: { ea: 'u', pr: 'paire', box: 'boîte', m: 'm', roll: 'rouleau', pk: 'lot', ctn: 'carton', bag: 'sac', set: 'lot', l: 'l', kg: 'kg' },
    ship: (c, n) => `Expédié par ${c}, n° de suivi ${n}`,
  },
  es: {
    title: { order: 'Pedido', confirmation: 'Confirmación de pedido', invoice: 'Factura' },
    no: { order: 'Nº de pedido', confirmation: 'Nº de confirmación', invoice: 'Nº de factura' },
    date: { order: 'Fecha de pedido', confirmation: 'Fecha', invoice: 'Fecha de factura' },
    yourOrder: 'Su pedido', customerNo: 'Nº de cliente', supplierNo: 'Nº de proveedor', due: 'Vencimiento',
    required: 'Fecha de entrega', dispatch: 'Envío previsto', billTo: 'Facturar a', shipTo: 'Entregar en', to: 'Proveedor',
    contact: 'Contacto', subtotal: 'Base imponible', total: 'Total', paid: 'Pagado', balance: 'Total a pagar',
    page: (i, n) => `Página ${i} de ${n}`, cont: 'continuación', carried: 'Suma y sigue', brought: 'Suma anterior',
    ph: 'Tel.', em: 'Email', bank: 'Datos bancarios',
    cols: { pos: 'Pos.', item: 'Pos.', code: 'Código', desc: 'Descripción', qty: 'Cantidad', uom: 'Ud.', unit: 'Precio', amount: 'Importe' },
    uom: { ea: 'ud.', pr: 'par', box: 'caja', m: 'm', roll: 'rollo', pk: 'paq.', ctn: 'caja', bag: 'saco', set: 'juego', l: 'l', kg: 'kg' },
    ship: (c, n) => `Enviado por ${c}, nº de seguimiento ${n}`,
  },
  zh: {
    title: { order: '采购订单', confirmation: '订单确认书', invoice: '商业发票' },
    no: { order: '订单号', confirmation: '确认书编号', invoice: '发票号码' },
    date: { order: '订单日期', confirmation: '日期', invoice: '开票日期' },
    yourOrder: '客户订单号', customerNo: '客户编号', supplierNo: '供应商编号', due: '付款期限',
    required: '交货日期', dispatch: '预计发货', billTo: '买方', shipTo: '收货地址', to: '供应商',
    contact: '联系人', subtotal: '小计', total: '合计', paid: '已付', balance: '应付金额',
    page: (i, n) => `第 ${i} 页，共 ${n} 页`, cont: '续', carried: '转下页', brought: '承上页',
    ph: '电话', em: '邮箱', bank: '银行账户',
    cols: { pos: '序号', item: '序号', code: '货号', desc: '品名及规格', qty: '数量', uom: '单位', unit: '单价', amount: '金额' },
    uom: { ea: '个', pr: '对', box: '盒', m: '米', roll: '卷', pk: '包', ctn: '箱', bag: '袋', set: '套', l: '升', kg: '千克' },
    ship: (c, n) => `承运人 ${c}，运单号 ${n}`,
  },
};

const TERMS = {
  'NZ-order': 'Please quote our PO number on every invoice and delivery docket. Deliveries are accepted Monday to Friday, 7:30 am to 3:30 pm. Maximum pallet height 1.8 m. Invoices received after the 25th are processed the following month.',
  'NZ-supplier': 'Payment due on the 20th of the month following the invoice date. Overdue accounts may be charged interest at 1.5% per month. Goods remain our property until paid in full. Returns within 30 days in original packaging; a 15% restocking fee applies.',
  'AU-order': 'Quote the PO number on all paperwork. Deliveries to the loading dock between 6:00 am and 2:00 pm. Goods must be received within 14 days of the required date.',
  'AU-supplier': 'Payment within 30 days of invoice date. Please use the invoice number as your payment reference. Shortages must be reported within 7 days. Credit card payments incur a 1.2% surcharge.',
  'GB-order': 'Please acknowledge this order within 2 working days. Deliveries between 08:00 and 16:00. Invoices must show our PO number and be sent to accounts within 30 days of delivery.',
  'GB-supplier': 'Payment due within 30 days. Interest on late payment is charged at 8% per annum above base rate. Returns accepted within 28 days with a returns number.',
  'US-order': 'Ship complete unless otherwise noted. Packing list must reference PO number. Payment terms Net 45. Freight on board: destination.',
  'US-supplier': 'Net 30. A finance charge of 1.5% per month (18% per year) applies to past-due balances. Returns require an RMA number within 14 days; a 20% restocking fee may apply.',
  'DE-order': 'Bitte geben Sie unsere Bestellnummer auf allen Lieferscheinen und Rechnungen an. Anlieferung Mo. bis Fr. 7:00 bis 15:30 Uhr. Es gelten unsere Einkaufsbedingungen (Stand 03/2026).',
  'DE-supplier': 'Zahlbar innerhalb von 30 Tagen ohne Abzug, innerhalb von 10 Tagen mit 2 % Skonto. Lieferung frei Haus ab 250,00 € Warenwert. Die Ware bleibt bis zur vollständigen Bezahlung unser Eigentum.',
  'FR-order': 'Merci de rappeler le numéro de commande sur le bon de livraison et la facture. Livraison du lundi au vendredi de 6 h à 11 h.',
  'FR-supplier': 'Paiement à 30 jours fin de mois. Pénalités de retard : 3 fois le taux d\'intérêt légal. Indemnité forfaitaire pour frais de recouvrement : 40 €. Pas d\'escompte pour paiement anticipé.',
  'ES-order': 'Indique nuestro número de pedido en el albarán y en la factura. Horario de recepción de 8:00 a 13:00 h, de lunes a viernes.',
  'ES-supplier': 'Forma de pago: transferencia bancaria a 30 días fecha factura. Inscrita en el Registro Mercantil de Valencia, Tomo 9876, Folio 54, Hoja V-123456.',
  'CN-supplier': '付款方式：电汇，见提单副本后 30 天内付款。贸易术语：FOB 宁波。',
};

const TAX = {
  NZ: { rate: 15, label: 'GST 15%', type: 'nz-gst', idLabel: 'GST No.' },
  AU: { rate: 10, label: 'GST 10%', type: 'abn', idLabel: 'ABN' },
  GB: { rate: 20, label: 'VAT @ 20%', type: 'gb-vat', idLabel: 'VAT Reg. No.' },
  US: { rate: 0, label: 'Sales tax', type: null, idLabel: null },
  DE: { rate: 19, label: 'zzgl. 19 % MwSt.', type: 'eu-vat', idLabel: 'USt-IdNr.' },
  FR: { rate: 20, label: 'TVA 20 %', type: 'eu-vat', idLabel: 'N° TVA intracom.' },
  ES: { rate: 21, label: 'IVA 21 %', type: 'eu-vat', idLabel: 'NIF' },
  CN: { rate: 0, label: '税额', type: null, idLabel: null },
};
const CUR = {
  NZD: { sym: '$', post: false }, AUD: { sym: '$', post: false }, USD: { sym: '$', post: false },
  GBP: { sym: '£', post: false }, EUR: { sym: '€', post: true },
};

// ---------------------------------------------------------------- parties (all invented)

function party(o) {
  const tax = TAX[o.country];
  if (o.tax !== false && tax.type) {
    if (o.country === 'NZ') o.taxId = { type: 'nz-gst', value: makeNzGst(rand() < 0.75), label: pick(['GST No.', 'GST number', 'GST Reg No']) };
    if (o.country === 'AU') o.taxId = { type: 'abn', value: makeAbn(), label: 'ABN' };
    if (o.country === 'GB') o.taxId = { type: 'gb-vat', value: makeGbVat(), label: pick(['VAT Reg. No.', 'VAT No.']) };
    if (o.country === 'DE') o.taxId = { type: 'eu-vat', value: makeDeVat(), label: 'USt-IdNr.' };
    if (o.country === 'FR') { const f = makeFrIds(); o.taxId = { type: 'eu-vat', value: f.vatPrinted, label: 'N° TVA intracom.' }; o.siret = f.siret; }
    if (o.country === 'ES') o.taxId = { type: 'eu-vat', value: makeEsVat(), label: 'NIF' };
  }
  if (o.country === 'NZ') o.bank = `${pick(['12', '02', '06', '38'])}-${digits(4)}-${digits(7)}-${digits(2)}`;
  if (o.country === 'AU') o.bank = `BSB ${digits(3)}-${digits(3)}  Account ${digits(4)} ${digits(4)}`;
  if (o.country === 'GB') o.bank = `Sort code ${digits(2)}-${digits(2)}-${digits(2)}  Account ${digits(8)}`;
  if (o.country === 'US') o.bank = `ACH account ${digits(4)} ${digits(4)} ${digits(4)}`;
  if (o.country === 'CN') o.bank = `示例银行宁波分行 账号 ${digits(4)} ${digits(4)} ${digits(4)} ${digits(4)}`;
  if (['DE', 'FR', 'ES'].includes(o.country)) o.bank = `IBAN ${makeIban(o.country)}  BIC SMPL${o.country}${pick(['M1', 'PP', '2X'])}XXX`;
  return o;
}

const P = {
  hardware: party({ name: 'Sample Hardware Imports Ltd', country: 'NZ', addr: ['41 Example Road, Penrose', 'Auckland 1061', 'New Zealand'], phone: '+64 9 555 0142', email: 'accounts@samplehardware.example', contact: 'Grace Tanaka', accent: '#1f4e79' }),
  kitchens: party({ name: 'Example Kitchens Ltd', country: 'NZ', addr: ['Unit 3, 18 Sample Place, Wigram', 'Christchurch 8042', 'New Zealand'], phone: '03 555 0187', email: 'purchasing@examplekitchens.example', contact: 'Aroha Wilson', accent: '#2e5d3a' }),
  fasteners: party({ name: 'Sample Fasteners NZ Ltd', country: 'NZ', addr: ['7 Demo Street, Te Rapa', 'Hamilton 3200'], phone: '07 555 0119', email: 'sales@samplefasteners.example', contact: 'Ravi Patel', accent: '#7a2e1f' }),
  joinery: party({ name: 'Example Joinery Ltd', country: 'NZ', addr: ['220 Placeholder Road, Onekawa', 'Napier 4110'], phone: '06 555 0164', email: 'office@examplejoinery.example', contact: 'Ben Hartley', accent: '#3b3b3b' }),
  building: party({ name: 'Sample Building Supplies Ltd', country: 'NZ', addr: ['95 Illustration Drive, Seaview', 'Lower Hutt 5010'], phone: '04 555 0136', email: 'trade@samplebuilding.example', contact: 'Sina Faleolo', accent: '#b35c00' }),
  fitout: party({ name: 'Example Fit-Out Group Ltd', country: 'NZ', addr: ['Level 2, 11 Mock Street', 'Te Aro, Wellington 6011'], phone: '04 555 0171', email: 'po@examplefitout.example', contact: 'Daniel Ngata', accent: '#22427a' }),
  electrical: party({ name: 'Sample Electrical Wholesale Ltd', country: 'NZ', addr: ['3 Specimen Lane, Mount Maunganui', 'Tauranga 3116'], phone: '07 555 0102', email: 'orders@sampleelectrical.example', contact: 'Liam Brennan', accent: '#004d66' }),
  property: party({ name: 'Example Property Services Ltd', country: 'NZ', addr: ['PO Box 4417', 'Tauranga 3140'], phone: '07 555 0158', email: 'maintenance@exampleproperty.example', contact: 'Olivia Reid', accent: '#444' }),
  marineNz: party({ name: 'Example Marine Ltd', country: 'NZ', addr: ['14 Wharf Example Road, Port Nelson', 'Nelson 7010', 'New Zealand'], phone: '+64 3 555 0193', email: 'buying@examplemarine.example', contact: 'Hannah Ward', accent: '#0b5563' }),
  marineUs: party({ name: 'Sample Marine Supply Inc.', country: 'US', addr: ['2200 Sample Ave NW, Suite 4', 'Seattle, WA 98107', 'USA'], phone: '(206) 555-0147', email: 'export@samplemarine.example', contact: 'Tom Rivera', accent: '#0a3d62' }),
  office: party({ name: 'Sample Office Furniture Ltd', country: 'NZ', addr: ['60 Template Road, East Tamaki', 'Auckland 2013'], phone: '09 555 0175', email: 'contracts@sampleoffice.example', contact: 'Mere Tamihana', accent: '#5b2a86' }),
  legal: party({ name: 'Example Legal Services Ltd', country: 'NZ', addr: ['Level 9, 1 Example Quay', 'Auckland 1010'], phone: '09 555 0129', email: 'facilities@examplelegal.example', contact: 'Sophie Lam', accent: '#333' }),
  timber: party({ name: 'Sample Timber Products Pty Ltd', country: 'AU', addr: ['12 Example Court', 'Dandenong South VIC 3175'], phone: '(03) 5550 1234', email: 'accounts@sampletimber.example', contact: 'Jack Morrison', accent: '#6b4226' }),
  cabinetry: party({ name: 'Example Cabinetry Pty Ltd', country: 'AU', addr: ['8 Demo Street', 'North Geelong VIC 3215'], phone: '(03) 5550 8821', email: 'orders@examplecabinetry.example', contact: 'Chloe Nguyen', accent: '#29524a' }),
  packaging: party({ name: 'Sample Packaging Australia Pty Ltd', country: 'AU', addr: ['44 Specimen Road', 'Eagle Farm QLD 4009'], phone: '(07) 5550 4410', email: 'ar@samplepackaging.example', contact: 'Ethan Brooks', accent: '#8a1c1c' }),
  foods: party({ name: 'Example Foods Pty Ltd', country: 'AU', addr: ['3/19 Placeholder Way', 'Burleigh Heads QLD 4220'], phone: '0491 570 156', email: 'purchasing@examplefoods.example', contact: 'Isla Fraser', accent: '#2f6f2f' }),
  lighting: party({ name: 'Sample Lighting Co Pty Ltd', country: 'AU', addr: ['210 Example Parade', 'Alexandria NSW 2015'], phone: '(02) 5550 3377', email: 'sales@samplelighting.example', contact: 'Noah Kelly', accent: '#111' }),
  hospitality: party({ name: 'Example Hospitality Group Pty Ltd', country: 'AU', addr: ['77 Sample Street', 'Newcastle NSW 2300'], phone: '(02) 5550 9012', email: 'procurement@examplehospitality.example', contact: 'Ava Thompson', accent: '#7b4f00' }),
  catering: party({ name: 'Sample Catering Equipment Ltd', country: 'GB', addr: ['Unit 5, Example Trading Estate', 'Leeds LS11 9ZZ', 'United Kingdom'], phone: '0113 496 0571', email: 'invoices@samplecatering.example', contact: 'Oliver Price', accent: '#264653' }),
  bistro: party({ name: 'Example Bistro Ltd', country: 'GB', addr: ['3 Sample Lane', 'York YO1 9ZZ'], phone: '01904 496 0128', email: 'office@examplebistro.example', contact: 'Amelia Hughes', accent: '#6d2e46' }),
  print: party({ name: 'Sample Print Supplies Ltd', country: 'GB', addr: ['88 Demo Road', 'Manchester M4 9ZZ'], phone: '0161 496 0344', email: 'sales@sampleprint.example', contact: 'Harry Collins', accent: '#c1121f' }),
  studio: party({ name: 'Example Design Studio Ltd', country: 'GB', addr: ['Studio 4, 21 Example Wharf', 'Bristol BS1 9ZZ'], phone: '0117 496 0882', email: 'studio@exampledesign.example', contact: 'Isabella Turner', accent: '#1d3557' }),
  beschlaege: party({ name: 'Sample Beschläge GmbH', country: 'DE', addr: ['Musterstraße 12', '70173 Stuttgart'], phone: '+49 711 555 0123', email: 'vertrieb@sample-beschlaege.example', contact: 'Jonas Becker', accent: '#003366', reg: 'Geschäftsführer: Lena Krüger | Amtsgericht Stuttgart HRB 765432' }),
  moebel: party({ name: 'Example Möbelwerkstatt GmbH', country: 'DE', addr: ['Beispielweg 4', '89073 Ulm'], phone: '+49 731 555 0456', email: 'einkauf@example-moebel.example', contact: 'Miriam Vogel', accent: '#4a4a4a', reg: 'Geschäftsführer: Paul Seidel | Amtsgericht Ulm HRB 112233' }),
  elektro: party({ name: 'Sample Elektrotechnik GmbH', country: 'DE', addr: ['Industriestraße 80', '50829 Köln'], phone: '+49 221 555 0789', email: 'rechnung@sample-elektro.example', contact: 'Felix Wagner', accent: '#a4161a', reg: 'Geschäftsführer: Sabine Roth | Amtsgericht Köln HRB 445566' }),
  anlagenbau: party({ name: 'Example Anlagenbau GmbH', country: 'DE', addr: ['Am Musterhafen 7', '53111 Bonn'], phone: '+49 228 555 0321', email: 'bestellung@example-anlagenbau.example', contact: 'Tobias Schulz', accent: '#14213d', reg: 'Geschäftsführer: Anna Lehmann | Amtsgericht Bonn HRB 998877' }),
  fournitures: party({ name: 'Sample Fournitures SARL', country: 'FR', addr: ['15 rue de l\'Exemple', '69007 Lyon', 'France'], phone: '01 99 00 12 34', email: 'facturation@sample-fournitures.example', contact: 'Camille Lefèvre', accent: '#1b4965', reg: 'SARL au capital de 20 000 € | RCS Lyon' }),
  boulangerie: party({ name: 'Example Boulangerie SAS', country: 'FR', addr: ['4 place du Modèle', '69100 Villeurbanne'], phone: '01 99 00 56 78', email: 'achats@example-boulangerie.example', contact: 'Julien Moreau', accent: '#8c5e2a', reg: 'SAS au capital de 50 000 € | RCS Lyon' }),
  suministros: party({ name: 'Sample Suministros Hosteleros S.L.', country: 'ES', addr: ['Calle del Ejemplo, 23', '46001 Valencia'], phone: '+34 96 555 01 23', email: 'facturas@sample-suministros.example', contact: 'Lucía Romero', accent: '#9b2226' }),
  restauracion: party({ name: 'Example Restauración S.L.', country: 'ES', addr: ['Avenida de Muestra, 8', '03001 Alicante'], phone: '+34 96 555 04 56', email: 'compras@example-restauracion.example', contact: 'Javier Ortega', accent: '#005f73' }),
  industrial: party({ name: 'Sample Industrial Supply LLC', country: 'US', addr: ['4100 Example Blvd', 'Columbus, OH 43219'], phone: '(614) 555-0172', email: 'ar@sampleindustrial.example', contact: 'Megan Carter', accent: '#bc6c25' }),
  machine: party({ name: 'Example Machine Works Inc.', country: 'US', addr: ['901 Sample Industrial Pkwy', 'Dayton, OH 45414'], phone: '(937) 555-0135', email: 'purchasing@examplemachine.example', contact: 'Kevin Dunn', accent: '#283618' }),
  cleaning: party({ name: 'Sample Cleaning Supplies Ltd', country: 'NZ', addr: ['5 Instance Road, Hornby', 'Christchurch 8042'], phone: '03 555 0110', email: 'hello@samplecleaning.example', contact: 'Ana Lealaiauloto', accent: '#0077b6' }),
  plumbing: party({ name: 'Sample Plumbing Supplies Pty Ltd', country: 'AU', addr: ['31 Example Crescent', 'Moorabbin VIC 3189'], phone: '(03) 5550 6634', email: 'accounts@sampleplumbing.example', contact: 'Lachlan Reid', accent: '#023e8a' }),
  ningbo: party({ name: '示例五金（宁波）有限公司', country: 'CN', tax: false, addr: ['浙江省宁波市示例工业区样本路 88 号'], phone: '+86 574 5555 0123', email: 'export@sample-ningbo.example', contact: '陈明', accent: '#9d0208' }),
};
P.kitchens.deliver = ['Example Kitchens Ltd — Receiving', '18 Sample Place, Wigram', 'Christchurch 8042'];
P.fitout.deliver = ['Site: Level 4 fit-out, 30 Demo Terrace', 'Wellington Central 6011', 'Site contact Daniel Ngata 021 555 0199'];
P.hospitality.deliver = ['The Example Hotel — Loading dock', '12 Pretend Street', 'Newcastle NSW 2300'];
P.machine.deliver = ['Example Machine Works Inc. — Plant 2', '1450 Sample Rd', 'Dayton, OH 45414'];

// ---------------------------------------------------------------- documents

const DOCS = [];
const PAIRS = [];

const item = (code, desc, qty, unit, uom = 'ea') => ({ code, desc, qty, unitCents: Math.round(unit * 100), uom });
const charge = (desc, cents, qty = null) => ({ code: null, desc, qty, unitCents: qty == null ? null : cents, amountCents: cents * (qty || 1), uom: null, charge: true });
const clone = (lines) => lines.map((l) => ({ ...l }));

// Columns per layout. 'desc' in L7 also prints the code under the description.
const LAYOUT_COLS = {
  L1: ['code', 'desc', 'qty', 'unit', 'amount'],
  L2: ['desc', 'code', 'unit', 'qty', 'amount'],
  L3: ['desc', 'qty', 'unit', 'amount'],
  L4: ['code', 'desc', 'qty', 'unit'],
  L5: ['pos', 'code', 'desc', 'qty', 'uom', 'unit', 'amount'],
  L6: ['qty', 'code', 'desc', 'unit', 'amount'],
  L7: ['desc', 'qty', 'unit', 'amount'],
  L8: ['item', 'code', 'desc', 'qty', 'uom', 'unit', 'amount'],
};
const LAYOUT_NOTES = {
  L1: 'Layout L1: code, description, qty, unit price, amount; header block on the left.',
  L2: 'Layout L2: description first, then code, and price before quantity; header block on the right.',
  L3: 'Layout L3: no code column.',
  L4: 'Layout L4: no amount column, so line amounts are not printed (truth amount = qty x unit).',
  L5: 'Layout L5 (DIN style): the Pos. column (1, 2, 3...) and the unit-of-measure column are not quantities.',
  L6: 'Layout L6: quantity is the first column; boxed grid.',
  L7: 'Layout L7: no code column; the code is printed under each description.',
  L8: 'Layout L8 (ERP printout): item numbers 00010, 00020... are not quantities, quantities have 3 decimals, and each line has a delivery-date sub-row.',
};

function makeDoc(o) {
  const d = { ...o };
  d.T = T[d.lang];
  d.issuer = d.kind === 'order' ? d.buyer : d.supplier;
  d.recipient = d.kind === 'order' ? d.supplier : d.buyer;
  d.country = d.issuer.country;
  d.title = d.title || d.T.title[d.kind];
  d.cur = { ...CUR[d.currency], ...(d.cur || {}) };
  const cols = LAYOUT_COLS[d.layout];
  d.codePrinted = cols.includes('code') || d.layout === 'L7';
  d.lines = d.lines.map((l) => {
    const n = { ...l };
    if (!d.codePrinted) n.code = null;
    if (!n.charge) n.amountCents = Math.round(n.qty * n.unitCents);
    return n;
  });
  d.taxRate = d.taxRate != null ? d.taxRate : TAX[d.country].rate;
  d.taxLabel = d.taxLabel || TAX[d.country].label;
  d.subtotalCents = d.lines.reduce((s, l) => s + l.amountCents, 0);
  d.correctTaxCents = Math.round((d.subtotalCents * d.taxRate) / 100);
  d.taxCents = d.taxCentsFn ? d.taxCentsFn(d.subtotalCents) : d.correctTaxCents;      // deliberate GST error
  d.totalCents = d.totalFn ? d.totalFn(d.subtotalCents, d.taxCents) : d.subtotalCents + d.taxCents; // deliberate total error
  d.tracking = d.tracking || [];
  d.extraMeta = d.extraMeta || [];
  d.taxId = d.issuer.taxId && d.showTaxId !== false ? { type: d.issuer.taxId.type, value: d.issuer.taxId.value } : null;
  d.notes = [LAYOUT_NOTES[d.layout]].concat(d.notes || []);
  if (d.tracking.length) d.notes.push(`Courier tracking numbers (${d.tracking.map((t) => t.carrier).join(', ')}) are noise, not lines.`);
  // pages
  const caps = d.pageCaps || [99];
  d.pageLines = [];
  for (let i = 0; i < d.lines.length;) {
    const cap = caps[Math.min(d.pageLines.length, caps.length - 1)];
    d.pageLines.push(d.lines.slice(i, i + cap)); i += cap;
  }
  d.pages = d.pageLines.length;
  DOCS.push(d);
  return d;
}

const lineItem = (l) => l.code || l.desc;
// Compare a later document (b) with the one it follows (a). Every difference is computed, then checked
// against the differences the scenario says it built in, so the pair labels cannot drift from the documents.
function diffDocs(a, b) {
  const out = [];
  if (a.currency !== b.currency) out.push({ type: 'currency-differs', item: null, expected: a.currency, actual: b.currency });
  const used = new Set();
  const same = (x, y) => (x.code && y.code ? x.code === y.code : x.desc === y.desc);
  for (const la of a.lines) {
    let j = b.lines.findIndex((lb, k) => !used.has(k) && same(la, lb));
    let codeDiff = false;
    if (j < 0) {
      j = b.lines.findIndex((lb, k) => !used.has(k) && la.code && lb.code && lb.code !== la.code && lb.desc === la.desc);
      codeDiff = j >= 0;
    }
    if (j < 0) { out.push({ type: 'missing-line', item: lineItem(la), description: la.desc, expected: dec(la.amountCents), actual: null }); continue; }
    used.add(j);
    const lb = b.lines[j];
    if (codeDiff) out.push({ type: 'code-differs', item: la.code, description: la.desc, expected: la.code, actual: lb.code });
    const it = la.code || lb.code || la.desc;
    if (la.charge || lb.charge) {
      if (la.amountCents !== lb.amountCents) throw new Error(`charge line differs in ${a.id}/${b.id}`);
      continue;
    }
    if (lb.unitCents > la.unitCents) out.push({ type: 'price-higher', item: it, expected: dec(la.unitCents), actual: dec(lb.unitCents) });
    if (lb.unitCents < la.unitCents) throw new Error(`price lower is not a modelled difference (${a.id}/${b.id})`);
    if (lb.qty > la.qty) out.push({ type: 'qty-over', item: it, expected: String(la.qty), actual: String(lb.qty) });
    if (lb.qty < la.qty) out.push({ type: 'qty-under', item: it, expected: String(la.qty), actual: String(lb.qty) });
  }
  b.lines.forEach((lb, k) => { if (!used.has(k)) out.push({ type: 'extra-line', item: lineItem(lb), description: lb.desc, expected: null, actual: dec(lb.amountCents) }); });
  out.push(...selfCheck(b));
  return out;
}
function selfCheck(d) {
  const out = [], sum = d.lines.reduce((s, l) => s + l.amountCents, 0);
  if (sum !== d.subtotalCents) out.push({ type: 'totals-wrong', item: 'subtotal', expected: dec(sum), actual: dec(d.subtotalCents) });
  if (d.taxCents !== d.correctTaxCents) out.push({ type: 'gst-wrong', item: 'tax', expected: dec(d.correctTaxCents), actual: dec(d.taxCents) });
  if (d.totalCents !== d.subtotalCents + d.taxCents) out.push({ type: 'totals-wrong', item: 'total', expected: dec(d.subtotalCents + d.taxCents), actual: dec(d.totalCents) });
  return out;
}
function pairUp(a, b, expected) {
  if (selfCheck(a).length) throw new Error(`${a.id} should be internally consistent`);
  const diff = diffDocs(a, b);
  const got = diff.map((x) => x.type).sort().join(','), want = expected.slice().sort().join(',');
  if (got !== want) throw new Error(`pair ${a.id} -> ${b.id}: built ${want || 'none'}, found ${got || 'none'}\n${JSON.stringify(diff, null, 1)}`);
  PAIRS.push({ a, b, differences: diff });
}

// Common dates, numbers and noise for a chain of documents.
const NZ = { lang: 'en', currency: 'NZD', curLabel: 'NZD' };

// 01 NZ. SAP-style PO, confirmation that matches it, invoice with one higher price.
{
  const lines = [
    item('RUN-500', 'Drawer runner, 500 mm, soft close, pair', 80, 15.60, 'pr'),
    item('HNG-110', 'Concealed hinge 110°, clip-on, with mounting plate', 400, 3.65),
    item('HND-160', 'Bar handle 160 mm centres, brushed nickel', 240, 5.90),
    item('LEG-150', 'Adjustable cabinet leg 150 mm, with plinth clip', 320, 1.45),
    item('BIN-60', 'Pull-out waste bin, twin 30 litre, for 600 mm base cabinet, grey', 12, 138.50),
    item('LED-2K', 'Under-cabinet LED strip kit 2 m, warm white, with driver and door sensor switch', 20, 89.90, 'set'),
  ];
  const po = makeDoc({ id: 'po-01', kind: 'order', ...NZ, layout: 'L8', number: '4500012904', supplier: P.hardware, buyer: P.kitchens, issued: '2026-10-27',
    lines, dateStyle: 'dd.mm.yyyy', required: '2026-11-10', extraMeta: [['Vendor', '100873'], ['Purchasing group', 'K02 / Aroha Wilson']],
    notes: ['The SAP vendor number 100873 and purchasing group are not document numbers.'] });
  const conf = makeDoc({ id: 'conf-01', kind: 'confirmation', ...NZ, layout: 'L2', title: 'Sales Order Acknowledgement', number: 'SO-88412', orderNumber: po.number,
    supplier: P.hardware, buyer: P.kitchens, issued: '2026-10-28', dateStyle: 'd MMMM yyyy', dispatch: '2026-11-04', lines: clone(lines),
    extraMeta: [['Customer no.', 'EXK001']], notes: ['Titled "Sales Order Acknowledgement".'] });
  const invLines = clone(lines); invLines[0].unitCents = 1610;
  const inv = makeDoc({ id: 'inv-01', kind: 'invoice', ...NZ, layout: 'L1', number: 'INV-20931', orderNumber: po.number, supplier: P.hardware, buyer: P.kitchens,
    issued: '2026-11-05', dateStyle: 'dd/mm/yyyy', due: '2026-12-20', lines: invLines, tracking: [ups(), nzpost()],
    extraMeta: [['Sales order', 'SO-88412'], ['Customer no.', 'EXK001']], notes: ['Sales order SO-88412 is also printed; the order number is the PO 4500012904.'] });
  pairUp(po, conf, []);
  pairUp(conf, inv, ['price-higher']);
  pairUp(po, inv, ['price-higher']);
}

// 02 NZ. PO without an amount column; invoice with the code under each description, one line over-invoiced.
{
  const lines = [
    item('SCR-850Z', 'Chipboard screw 8g x 50 mm, zinc plated, box of 500', 10, 24.80, 'box'),
    item('SCR-1465G', 'Batten screw 14g x 65 mm, hot-dip galvanised, box of 100', 20, 31.50, 'box'),
    item('ANC-M1080', 'Masonry anchor M10 x 80 mm, box of 50', 6, 58.00, 'box'),
    item('NAI-9031', 'Framing nail 90 x 3.15 mm, bright, collated, 2,000 per carton', 8, 96.40, 'ctn'),
    item('BOL-M12100', 'Hex bolt M12 x 100 mm with nut and washer, hot-dip galvanised', 100, 2.85),
    item('WSH-M12', 'Flat washer M12, galvanised, bag of 100', 4, 14.20, 'bag'),
    item('GLU-PU750', 'Polyurethane construction adhesive 750 ml sausage, box of 12', 3, 118.80, 'box'),
  ];
  const po = makeDoc({ id: 'po-02', kind: 'order', ...NZ, layout: 'L4', number: 'PO-7731', supplier: P.fasteners, buyer: P.joinery, issued: '2026-10-12',
    dateStyle: 'd/m/y', required: '2026-10-19', lines, extraMeta: [['Supplier no.', 'SF-2210'], ['Job', 'Napier Hospital wing, stage 2']],
    notes: ['Descriptions contain sizes and pack counts (8g x 50 mm, box of 500, 2,000 per carton) that are not quantities.'] });
  const invLines = clone(lines); invLines[4].qty = 120;
  const inv = makeDoc({ id: 'inv-02', kind: 'invoice', ...NZ, layout: 'L7', title: 'TAX INVOICE', number: '100482', orderNumber: po.number, supplier: P.fasteners,
    buyer: P.joinery, issued: '2026-10-21', dateStyle: 'd MMMM yyyy', due: '2026-11-20', lines: invLines, tracking: [nzpost()],
    extraMeta: [['Account', 'JOIN-04']], notes: ['The invoice number 100482 is a plain number.'] });
  pairUp(po, inv, ['qty-over']);
}

// 03 NZ. Two-page PO with 46 lines; two-page invoice with one line missing and carried-forward rows.
{
  const base = [
    ['PB10-2412', 'Plasterboard standard 10 mm, 2400 x 1200', 'ea', 24.50], ['PB13-2412', 'Plasterboard standard 13 mm, 2400 x 1200', 'ea', 29.80],
    ['PB13-2712', 'Plasterboard standard 13 mm, 2700 x 1200', 'ea', 33.40], ['PBA10-2412', 'Wet area plasterboard 10 mm, 2400 x 1200', 'ea', 36.90],
    ['PBF13-2412', 'Fire-rated plasterboard 13 mm, 2400 x 1200', 'ea', 41.20], ['ST64-30', 'Steel stud 64 mm, 0.55 BMT, 3.0 m', 'ea', 8.95],
    ['ST92-30', 'Steel stud 92 mm, 0.55 BMT, 3.0 m', 'ea', 11.40], ['TR64-30', 'Steel track 64 mm, 3.0 m', 'ea', 7.10],
    ['TR92-30', 'Steel track 92 mm, 3.0 m', 'ea', 9.30], ['PF9045-48', 'Pine framing 90 x 45 MSG8 H1.2, 4.8 m', 'ea', 21.60],
    ['PF7045-48', 'Pine framing 70 x 45 MSG8 H1.2, 4.8 m', 'ea', 16.90], ['SCR-PB25', 'Plasterboard screw 6g x 25 mm, box of 1000', 'box', 27.50],
    ['SCR-PB41', 'Plasterboard screw 6g x 41 mm, box of 1000', 'box', 34.20], ['JC-BASE20', 'Joint compound base coat, 20 kg bag', 'bag', 38.00],
    ['JC-FIN15', 'Finishing compound, 15 L pail', 'ea', 44.50], ['TAPE-5075', 'Paper joint tape 50 mm x 75 m', 'roll', 6.80],
    ['CB-3000', 'External corner bead 3.0 m, galvanised', 'ea', 5.40], ['INS-R26-90', 'Wall insulation batt R2.6, 90 mm, pack', 'pk', 64.00],
    ['INS-R32-140', 'Ceiling insulation batt R3.2, 140 mm, pack', 'pk', 71.50], ['DR-HC760', 'Hollow core door 1980 x 760 x 35 mm, primed', 'ea', 118.00],
    ['DR-HC810', 'Hollow core door 1980 x 810 x 35 mm, primed', 'ea', 124.00], ['JB-PINE', 'Door jamb set, finger-jointed pine, 1980 mm', 'set', 62.00],
    ['HW-LEV-SC', 'Passage lever set, satin chrome', 'set', 39.90], ['HW-PRIV-SC', 'Privacy lever set, satin chrome', 'set', 46.90],
    ['HW-STOP-SC', 'Door stop, skirting mount, satin chrome', 'ea', 6.20], ['HW-HNG100', 'Butt hinge 100 mm, satin chrome, pair', 'pr', 9.80],
    ['PT-SEAL10', 'Sealer undercoat, 10 L', 'ea', 129.00], ['PT-LS-W10', 'Interior low sheen acrylic, white, 10 L', 'ea', 189.00],
    ['PT-CEIL10', 'Ceiling flat acrylic, white, 10 L', 'ea', 149.00], ['PT-ROLL230', 'Paint roller 230 mm, medium nap', 'ea', 11.50],
    ['CT-1206', 'Ceiling tile 1200 x 600 mm, square edge, box of 8', 'box', 96.00], ['CG-MAIN36', 'Ceiling grid main tee 3600 mm', 'ea', 12.40],
    ['CG-CROSS12', 'Ceiling grid cross tee 1200 mm', 'ea', 4.10], ['CG-WALL30', 'Ceiling wall angle 3000 mm', 'ea', 5.30],
    ['SK-MDF60', 'MDF skirting 60 x 12 mm, primed, 5.4 m', 'ea', 18.70], ['AR-MDF42', 'MDF architrave 42 x 12 mm, primed, 5.4 m', 'ea', 14.90],
    ['GF-450W', 'Acrylic gap filler 450 g, white', 'ea', 7.40], ['SIL-300C', 'Silicone sealant 300 g, clear', 'ea', 12.60],
    ['ADH-STUD', 'Stud adhesive, 380 ml cartridge', 'ea', 9.90], ['ANC-FR6', 'Frame anchor 6 x 60 mm, box of 100', 'box', 32.00],
    ['NOG-9045', 'Nogging 90 x 45, 2.4 m', 'ea', 9.60], ['BR-STEEL', 'Steel bracing strap 30 x 0.8 mm, 30 m roll', 'roll', 48.00],
    ['GL-SAFE', 'Safety glasses, clear', 'ea', 4.50], ['DUST-P2', 'Disposable P2 dust mask, box of 20', 'box', 36.00],
    ['TARP-46', 'Drop sheet 4 x 6 m, canvas', 'ea', 58.00], ['BIN-240', 'Site waste bin hire, 240 L, per week', 'ea', 22.00],
  ];
  const qtys = [10, 12, 20, 24, 30, 40, 48, 50, 60, 80, 100, 120, 6, 8, 4, 2, 15, 16];
  const lines = base.map(([c, desc, uom, p]) => item(c, desc, pick(qtys), p, uom));
  const po = makeDoc({ id: 'po-03', kind: 'order', ...NZ, layout: 'L1', number: 'FO-2026-0317', supplier: P.building, buyer: P.fitout, issued: '2026-09-21',
    dateStyle: 'dd/mm/yyyy', required: '2026-10-05', lines, pageCaps: [26, 30], extraMeta: [['Project', 'L4 fit-out, 30 Demo Terrace'], ['Supplier no.', 'V-00412']],
    notes: ['Two pages, 46 lines; the table header repeats on page 2.'] });
  const invLines = clone(lines); const missing = invLines.splice(37, 1)[0];
  const inv = makeDoc({ id: 'inv-03', kind: 'invoice', ...NZ, layout: 'L2', number: 'INV-0041872', orderNumber: po.number, supplier: P.building, buyer: P.fitout,
    issued: '2026-10-08', dateStyle: 'd MMMM yyyy', due: '2026-11-20', lines: invLines, pageCaps: [24, 30], carryForward: true, tracking: [ups()],
    extraMeta: [['Customer no.', '30-7781'], ['Delivery docket', 'DD-55213']],
    notes: [`Two pages, 45 lines; "${missing.desc}" from the PO is not invoiced. "Carried forward" and "Brought forward" rows are page subtotals, not lines.`] });
  pairUp(po, inv, ['missing-line']);
}

// 04 NZ. No codes on either document; the invoice GST is 12.5% of the subtotal instead of 15%.
{
  const lines = [
    item(null, 'Double power point, horizontal, white', 24, 9.80),
    item(null, 'LED downlight 10 W, 90 mm cut-out, tri-colour, IC-F rated', 60, 18.40),
    item(null, 'TPS cable 2.5 mm² twin and earth, 100 m roll', 4, 189.00, 'roll'),
    item(null, 'RCD 40 A Type A, 30 mA, 2 pole', 6, 64.50),
    item(null, 'Weatherproof outdoor socket, single, IP56, grey', 8, 27.90),
    item(null, 'Smoke alarm, photoelectric, 10-year lithium battery, hush button', 12, 39.95),
  ];
  const po = makeDoc({ id: 'po-04', kind: 'order', ...NZ, layout: 'L3', number: 'EPS-PO-1188', supplier: P.electrical, buyer: P.property, issued: '2026-10-02',
    dateStyle: 'dd-MMM-yyyy', required: '2026-10-09', lines, extraMeta: [['Work order', 'WO 66120 (Unit 14, 9 Pretend Ave)']],
    notes: ['Work order number WO 66120 is not the PO number.'] });
  const inv = makeDoc({ id: 'inv-04', kind: 'invoice', ...NZ, layout: 'L6', number: 'TI-55120', orderNumber: po.number, supplier: P.electrical, buyer: P.property,
    issued: '2026-10-14', dateStyle: 'dd/mm/yyyy', due: '2026-11-20', lines: clone(lines), taxLabel: 'GST', tracking: [],
    extraMeta: [['Account', 'EPS-118']], taxCentsFn: (sub) => Math.round(sub * 0.125),
    notes: ['GST printed is 12.5% of the subtotal (should be 15%); the total adds up with the wrong GST.'] });
  pairUp(po, inv, ['gst-wrong']);
}

// 05 NZ PO in NZD, US supplier invoices in USD with the same numbers.
{
  const lines = [
    item('SMS-SH08', 'Stainless bow shackle 8 mm, 316 grade', 50, 6.40),
    item('SMS-BP1100', 'Bilge pump 1100 GPH, 12 V, automatic float switch', 6, 142.00),
    item('SMS-NL2', 'LED navigation light pair, port and starboard, 2 nm', 4, 96.50, 'pr'),
    item('SMS-CL10', 'Mooring line 10 mm double braid, 15 m, navy', 10, 58.75),
    item('SMS-FD4', 'Fender 4.5 x 16 in, white, with line', 12, 21.90),
  ];
  const po = makeDoc({ id: 'po-05', kind: 'order', ...NZ, layout: 'L1', number: 'EM-2026-044', supplier: P.marineUs, buyer: P.marineNz, issued: '2026-09-29',
    dateStyle: 'd/m/y', required: '2026-10-30', lines, taxRate: 0, taxLabel: 'GST (overseas supplier)', curLabel: 'NZD', cur: { sym: 'NZ$' },
    extraMeta: [['Currency', 'NZD'], ['Incoterms', 'FCA Seattle']], notes: ['Overseas supplier, so no GST; all amounts are NZD.'] });
  const inv = makeDoc({ id: 'inv-05', kind: 'invoice', lang: 'en', currency: 'USD', layout: 'L6', title: 'COMMERCIAL INVOICE', number: 'SMS-INV-30871',
    orderNumber: po.number, supplier: P.marineUs, buyer: P.marineNz, issued: '2026-10-09', dateStyle: 'mm/dd/yyyy', due: '2026-11-08', lines: clone(lines),
    taxRate: 0, taxLabel: 'Sales tax (export)', curLabel: 'USD', cur: { sym: 'US$' }, tracking: [fedex()],
    extraMeta: [['Customer ID', 'NZ-0193'], ['Terms', 'Net 30']], notes: ['US date format mm/dd/yyyy (10/09/2026 is 9 October). Same figures as the NZD order but in USD.'] });
  pairUp(po, inv, ['currency-differs']);
}

// 06 NZ. Confirmation and invoice both with a contract discount line; nothing differs.
{
  const lines = [
    item('CHR-MESH-BK', 'Task chair, mesh back, adjustable arms, black', 8, 389.00),
    item('DSK-1680-W', 'Desk 1600 x 800 mm, white top, silver frame', 8, 465.00),
    item('PED-3D-L', 'Mobile pedestal, 3 drawer, lockable, white', 8, 239.00),
    item('MON-ARM-2', 'Dual monitor arm, desk clamp, gas spring', 8, 149.00),
  ];
  const goods = lines.reduce((s, l) => s + l.qty * l.unitCents, 0);
  lines.push(charge('Contract discount 10% (agreement EL-2026-07)', -Math.round(goods / 10)));
  const conf = makeDoc({ id: 'conf-06', kind: 'confirmation', ...NZ, layout: 'L2', number: 'OC-24019', orderNumber: 'ELS-PO-0912', supplier: P.office, buyer: P.legal,
    issued: '2026-10-15', dateStyle: 'dd/mm/yyyy', dispatch: '2026-10-29', lines, extraMeta: [['Customer no.', 'C-5520']],
    notes: ['The discount is a table line with no quantity or unit price; it is part of the subtotal.'] });
  const inv = makeDoc({ id: 'inv-06', kind: 'invoice', ...NZ, layout: 'L1', number: 'SOF-61377', orderNumber: 'ELS-PO-0912', supplier: P.office, buyer: P.legal,
    issued: '2026-10-30', dateStyle: 'd MMMM yyyy', due: '2026-11-20', lines: clone(lines), extraMeta: [['Order confirmation', 'OC-24019']],
    notes: ['The discount is a table line with no quantity or unit price; it is part of the subtotal.'] });
  pairUp(conf, inv, []);
}

// 07 AU. PO without amounts; invoice short-ships one line.
{
  const lines = [
    item('MDF16-2412', 'Moisture resistant MDF 16 mm, 2400 x 1200', 60, 48.90),
    item('HPP12-2412', 'Hoop pine plywood 12 mm, 2400 x 1200, BB grade', 30, 72.40),
    item('MEL16-WH', 'Melamine board 16 mm white, 3600 x 1800, two sides', 40, 96.80),
    item('EDG22-WH', 'ABS edge tape 22 x 1 mm white, 100 m roll', 10, 38.50, 'roll'),
    item('EDG29-OAK', 'ABS edge tape 29 x 1 mm natural oak, 50 m roll', 6, 44.20, 'roll'),
  ];
  const po = makeDoc({ id: 'po-07', kind: 'order', lang: 'en', currency: 'AUD', layout: 'L4', number: 'PO26-0458', supplier: P.timber, buyer: P.cabinetry,
    issued: '2026-10-06', dateStyle: 'dd/mm/yyyy', required: '2026-10-13', lines, curLabel: 'AUD', extraMeta: [['Supplier no.', 'STP-07']] });
  const invLines = clone(lines); invLines[2].qty = 34;
  const inv = makeDoc({ id: 'inv-07', kind: 'invoice', lang: 'en', currency: 'AUD', layout: 'L2', number: 'INV-118204', orderNumber: po.number, supplier: P.timber,
    buyer: P.cabinetry, issued: '2026-10-14', dateStyle: 'd MMMM yyyy', due: '2026-11-13', lines: invLines, curLabel: 'AUD', tracking: [dhl()],
    extraMeta: [['Customer no.', 'ECP-221']], notes: ['Total line reads "Total inc. GST".'] });
  pairUp(po, inv, ['qty-under']);
}

// 08 AU. Invoice total does not equal subtotal plus GST (two digits swapped).
{
  const lines = [
    item('CTN-433', 'Shipping carton 400 x 300 x 300 mm, single wall, bundle of 25', 40, 31.25),
    item('TPE-4875', 'Packing tape 48 mm x 75 m, clear, acrylic', 72, 2.95, 'roll'),
    item('TRY-KM', 'Kraft food tray, medium, carton of 300', 15, 64.80, 'ctn'),
    item('LID-KM', 'Clear lid for kraft food tray, medium, carton of 300', 15, 52.30, 'ctn'),
    item('LBL-100', 'Thermal labels 100 x 150 mm, 500 per roll', 24, 18.60, 'roll'),
  ];
  const po = makeDoc({ id: 'po-08', kind: 'order', lang: 'en', currency: 'AUD', layout: 'L1', number: 'EF-PO-55210', supplier: P.packaging, buyer: P.foods,
    issued: '2026-10-19', dateStyle: 'dd/mm/yyyy', required: '2026-10-26', lines, curLabel: 'AUD' });
  const inv = makeDoc({ id: 'inv-08', kind: 'invoice', lang: 'en', currency: 'AUD', layout: 'L7', number: 'SPA-0098811', orderNumber: po.number, supplier: P.packaging,
    buyer: P.foods, issued: '2026-10-27', dateStyle: 'dd/mm/yyyy', due: '2026-11-26', lines: clone(lines), curLabel: 'AUD', tracking: [ups()],
    totalFn: (sub, tax) => { const s = String(sub + tax), i = s.length - 4; return Number(s.slice(0, i) + s[i + 1] + s[i] + s.slice(i + 2)); },
    extraMeta: [['Customer no.', 'EF-3301']], notes: ['The printed total has two digits swapped, so it is not subtotal + GST.'] });
  pairUp(po, inv, ['totals-wrong']);
}

// 09 AU. PO has no codes; invoice adds a freight line.
{
  const lines = [
    item('PND-350-BK', 'Pendant light, spun aluminium, 350 mm, matt black', 24, 129.00),
    item('TRK-15-30', 'Track spotlight 15 W, 3000 K, white', 40, 54.50),
    item('TRK-RAIL-2', 'Single-circuit track rail 2 m, white, with end caps', 12, 46.00),
    item('DRV-24-60', 'LED driver 24 V, 60 W, constant voltage, IP67', 10, 38.90),
    item('STR-24-5', 'LED strip 24 V, 14.4 W/m, 2700 K, 5 m reel', 10, 62.00, 'roll'),
  ];
  const po = makeDoc({ id: 'po-09', kind: 'order', lang: 'en', currency: 'AUD', layout: 'L3', number: 'EHG-PO-3307', supplier: P.lighting, buyer: P.hospitality,
    issued: '2026-09-15', dateStyle: 'd MMMM yyyy', required: '2026-09-29', lines, curLabel: 'AUD', extraMeta: [['Cost centre', '4410 Refurb']] });
  const invLines = clone(lines); invLines.push(charge('Freight: Sydney to Newcastle, 3 cartons', 8500, 1));
  const inv = makeDoc({ id: 'inv-09', kind: 'invoice', lang: 'en', currency: 'AUD', layout: 'L1', number: 'SL-2026-1204', orderNumber: po.number, supplier: P.lighting,
    buyer: P.hospitality, issued: '2026-09-24', dateStyle: 'dd/mm/yyyy', due: '2026-10-24', lines: invLines, curLabel: 'AUD', tracking: [dhl()],
    extraMeta: [['Customer no.', 'EHG-01']], notes: ['Freight is a real table line (no code) and is not on the PO.'] });
  pairUp(po, inv, ['extra-line']);
}

// 10 GB. Invoice adds an item that was not ordered.
{
  const lines = [
    item('GN11-65', 'Gastronorm pan 1/1, 65 mm deep, stainless steel', 12, 18.40),
    item('BLD-2L', 'Commercial blender 2 litre, 1500 W', 2, 289.00),
    item('CBS-6', 'Chopping board set, colour coded, 6 boards with rack', 3, 64.95, 'set'),
    item('THM-PRB', 'Digital probe thermometer, -50 to 300 °C', 6, 19.50),
    item('HLP-2', 'Heat lamp, twin bulb, 500 W', 1, 145.00),
  ];
  const po = makeDoc({ id: 'po-10', kind: 'order', lang: 'en', currency: 'GBP', layout: 'L2', number: 'EB/PO/0219', supplier: P.catering, buyer: P.bistro,
    issued: '2026-10-20', dateStyle: 'dd/mm/yyyy', required: '2026-10-27', lines, showTaxId: false, extraMeta: [['Account', 'SCE-88']] });
  const invLines = clone(lines); invLines.splice(1, 0, item('GN12-65', 'Gastronorm pan 1/2, 65 mm deep, stainless steel', 12, 11.20));
  const inv = makeDoc({ id: 'inv-10', kind: 'invoice', lang: 'en', currency: 'GBP', layout: 'L1', title: 'Invoice', number: 'SCE-77612', orderNumber: po.number,
    supplier: P.catering, buyer: P.bistro, issued: '2026-10-28', dateStyle: 'd MMMM yyyy', due: '2026-11-27', lines: invLines, tracking: [dhl()],
    extraMeta: [['Customer no.', 'EXB-12']], notes: ['Titled just "Invoice"; VAT 20%.'] });
  pairUp(po, inv, ['extra-line']);
}

// 11 GB. PO -> confirmation substitutes a code -> invoice ships part of one line.
{
  const lines = [
    item('TNR-K-HY', 'Toner cartridge, black, high yield, 12,000 pages', 6, 148.00),
    item('PPR-A4-80', 'A4 copier paper 80 gsm, box of 5 reams', 20, 21.50, 'box'),
    item('PPR-A3-100', 'A3 bright white paper 100 gsm, ream of 500', 10, 14.80, 'pk'),
    item('LAM-A4-150', 'Laminating pouch A4, 150 micron, pack of 100', 4, 23.90, 'pk'),
    item('INK-C-XL', 'Ink cartridge, cyan, XL', 8, 32.40),
    item('BND-21', 'Plastic binding comb 21 mm, black, box of 50', 2, 17.60, 'box'),
  ];
  const po = makeDoc({ id: 'po-11', kind: 'order', lang: 'en', currency: 'GBP', layout: 'L1', number: 'PO-004417', supplier: P.print, buyer: P.studio,
    issued: '2026-10-05', dateStyle: 'dd/mm/yyyy', required: '2026-10-12', lines });
  const confLines = clone(lines); confLines[0].code = 'TNR-K-HY2';
  const conf = makeDoc({ id: 'conf-11', kind: 'confirmation', lang: 'en', currency: 'GBP', layout: 'L4', title: 'Order Acknowledgement', number: 'SOA-260934',
    orderNumber: po.number, supplier: P.print, buyer: P.studio, issued: '2026-10-06', dateStyle: 'd MMMM yyyy', dispatch: '2026-10-08', lines: confLines,
    notes: ['The toner has a new supplier code (TNR-K-HY2) with the same description.'] });
  const invLines = clone(confLines); invLines[2].qty = 6;
  const inv = makeDoc({ id: 'inv-11', kind: 'invoice', lang: 'en', currency: 'GBP', layout: 'L2', title: 'VAT Invoice', number: 'SPS-INV-090221', orderNumber: po.number,
    supplier: P.print, buyer: P.studio, issued: '2026-10-09', dateStyle: 'dd/mm/yyyy', due: '2026-11-08', lines: invLines, tracking: [ups()],
    extraMeta: [['Acknowledgement', 'SOA-260934']], notes: ['Part shipment: 6 of 10 reams of A3 paper.'] });
  pairUp(po, conf, ['code-differs']);
  pairUp(conf, inv, ['qty-under']);
  pairUp(po, inv, ['code-differs', 'qty-under']);
}

// 12 DE. Bestellung -> Auftragsbestätigung with two price rises -> Rechnung that matches the AB.
{
  const lines = [
    item('SCH-110-CL', 'Möbelscharnier 110°, Clip-Montage, mit Dämpfung', 500, 2.95),
    item('VA-500-SE', 'Vollauszug 500 mm, Softeinzug, Tragkraft 40 kg (Paar)', 60, 18.40, 'pr'),
    item('GRF-128-ES', 'Griff Edelstahl, Lochabstand 128 mm', 300, 3.80),
    item('SCHR-4-30', 'Spanplattenschraube 4 x 30 mm, verzinkt', 2000, 0.04),
    item('BEL-LED-12', 'LED-Unterbauleuchte 12 V, 600 mm, warmweiß, mit Anschlusskabel 2 m', 25, 34.90),
    item('KU-BU-22', 'Kantenumleimer Buche, 22 mm, Rolle 50 m', 12, 9.85, 'roll'),
  ];
  const po = makeDoc({ id: 'po-12', kind: 'order', lang: 'de', currency: 'EUR', layout: 'L2', number: 'B-2026-0412', supplier: P.beschlaege, buyer: P.moebel,
    issued: '2026-10-07', dateStyle: 'dd.mm.yyyy', required: '2026-10-21', lines, extraMeta: [['Lieferantennummer', '70044']],
    notes: ['German number format: Menge 2.000 is two thousand; 1.234,56 money.'] });
  const abLines = clone(lines); abLines[1].unitCents = 1915; abLines[4].unitCents = 3630;
  const ab = makeDoc({ id: 'conf-12', kind: 'confirmation', lang: 'de', currency: 'EUR', layout: 'L5', number: 'AB-26-0931', orderNumber: po.number,
    supplier: P.beschlaege, buyer: P.moebel, issued: '2026-10-08', dateStyle: 'dd.mm.yyyy', dispatch: '2026-10-16', lines: abLines,
    extraMeta: [['Kundennummer', '10442']], notes: ['Two prices are higher than on the Bestellung (Preisanpassung).'] });
  const re = makeDoc({ id: 'inv-12', kind: 'invoice', lang: 'de', currency: 'EUR', layout: 'L5', number: 'RE-2026-10457', orderNumber: po.number,
    supplier: P.beschlaege, buyer: P.moebel, issued: '2026-10-19', dateStyle: 'dd.mm.yyyy', due: '2026-11-18', lines: clone(abLines), tracking: [dhl()],
    extraMeta: [['Kundennummer', '10442'], ['Auftrag', 'AB-26-0931'], ['Lieferdatum', '16.10.2026']], skonto: true,
    notes: ['The 2 % Skonto amount under the totals is not the tax or the total.'] });
  pairUp(po, ab, ['price-higher', 'price-higher']);
  pairUp(ab, re, []);
  pairUp(po, re, ['price-higher', 'price-higher']);
}

// 13 DE. Rechnung uses a different Art.-Nr. for the same RCD; one quantity in metres with a decimal.
{
  const lines = [
    item('NYM-3X15', 'Mantelleitung NYM-J 3 x 1,5 mm²', 112.5, 0.88, 'm'),
    item('LS-B16', 'Leitungsschutzschalter B16, 1-polig, 6 kA', 24, 4.95),
    item('FI-40-30', 'FI-Schutzschalter 40 A, 30 mA, 4-polig, Typ A', 4, 38.60),
    item('ABZ-IP54', 'Abzweigdose Aufputz IP54, 100 x 100 mm, grau', 40, 2.35),
    item('KK-2020', 'Kabelkanal 20 x 20 mm, weiß, Länge 2 m', 30, 3.10),
    item('VK-3P', 'Verbindungsklemme 3-polig, 0,2 bis 4 mm², Packung 50', 6, 11.90, 'pk'),
  ];
  const po = makeDoc({ id: 'po-13', kind: 'order', lang: 'de', currency: 'EUR', layout: 'L5', number: 'EA-B-26-0213', supplier: P.elektro, buyer: P.anlagenbau,
    issued: '2026-10-13', dateStyle: 'dd.mm.yyyy', required: '2026-10-20', lines, extraMeta: [['Lieferantennummer', '2041'], ['Kostenstelle', '310']],
    notes: ['Menge 112,5 m is a decimal quantity.'] });
  const reLines = clone(lines); reLines[2].code = 'FI-4P-40-30';
  const re = makeDoc({ id: 'inv-13', kind: 'invoice', lang: 'de', currency: 'EUR', layout: 'L2', number: '2026-30118', orderNumber: po.number, supplier: P.elektro,
    buyer: P.anlagenbau, issued: '2026-10-22', dateStyle: 'de-long', due: '2026-11-21', lines: reLines, extraMeta: [['Kundennummer', 'K-55120'], ['Leistungsdatum', '21.10.2026']],
    notes: ['Invoice number 2026-30118 looks like a date range; the FI switch has a different Art.-Nr. with the same description.'] });
  pairUp(po, re, ['code-differs']);
}

// 14 FR. Bon de commande and facture agree exactly.
{
  const lines = [
    item('FAR-T65-25', 'Farine de blé T65, sac de 25 kg', 40, 21.60, 'bag'),
    item('SAC-KR-1000', 'Sachets kraft pour baguette, lot de 1000', 6, 38.90, 'pk'),
    item('GNT-NIT-M', 'Gants nitrile taille M, boîte de 100', 10, 7.45, 'box'),
    item('PAP-CUI-500', 'Papier cuisson 40 x 60 cm, paquet de 500 feuilles', 4, 26.80, 'pk'),
    item('LEV-500', 'Levure sèche boulangère, 500 g', 24, 4.15),
    item('BAN-PL-60', 'Bannetons plastique 60 x 40 cm, lot de 10', 2, 112.00, 'pk'),
  ];
  const po = makeDoc({ id: 'po-14', kind: 'order', lang: 'fr', currency: 'EUR', layout: 'L5', number: 'BC-2026-118', supplier: P.fournitures, buyer: P.boulangerie,
    issued: '2026-10-01', dateStyle: 'dd/mm/yyyy', required: '2026-10-06', lines, extraMeta: [['N° fournisseur', 'F-0091']],
    notes: ['French number format with a space as the thousands separator (1 234,56).'] });
  const inv = makeDoc({ id: 'inv-14', kind: 'invoice', lang: 'fr', currency: 'EUR', layout: 'L1', number: 'F2026-0318', orderNumber: po.number, supplier: P.fournitures,
    buyer: P.boulangerie, issued: '2026-10-07', dateStyle: 'fr-long', due: '2026-11-30', lines: clone(lines), extraMeta: [['N° client', 'CL-2207']],
    notes: ['French legal footer text contains 40 € and other numbers that are not totals.'] });
  pairUp(po, inv, []);
}

// 15 ES. Pedido -> confirmación (one line short, one line dropped) -> factura that matches the confirmación.
{
  const lines = [
    item('VAS-SID-6', 'Vaso de sidra 50 cl, caja de 6', 20, 9.60, 'box'),
    item('SRV-2C-40', 'Servilletas 2 capas 40 x 40 cm, paquete de 50', 60, 2.15, 'pk'),
    item('GN11-INOX', 'Bandeja GN 1/1 acero inoxidable, 65 mm', 10, 16.90),
    item('CUB-24', 'Cubiertos de mesa, juego de 24 piezas, acero 18/10', 8, 34.50, 'set'),
    item('MANT-PAP', 'Mantel de papel 100 x 100 cm, blanco, caja de 400', 5, 41.80, 'box'),
    item('JAR-1L', 'Jarra de vidrio 1 litro con tapa', 12, 5.75),
  ];
  const po = makeDoc({ id: 'po-15', kind: 'order', lang: 'es', currency: 'EUR', layout: 'L1', number: 'PED-26-0577', supplier: P.suministros, buyer: P.restauracion,
    issued: '2026-10-09', dateStyle: 'dd/mm/yyyy', required: '2026-10-16', lines, extraMeta: [['Nº de proveedor', 'P-334']] });
  const confLines = clone(lines); confLines[1].qty = 40; confLines.splice(3, 1);
  const conf = makeDoc({ id: 'conf-15', kind: 'confirmation', lang: 'es', currency: 'EUR', layout: 'L3', number: 'CP-26-1290', orderNumber: po.number,
    supplier: P.suministros, buyer: P.restauracion, issued: '2026-10-10', dateStyle: 'es-long', dispatch: '2026-10-14', lines: confLines,
    notes: ['Servilletas confirmed 40 of 60; cubiertos (CUB-24) dropped as discontinued. No code column.'] });
  const inv = makeDoc({ id: 'inv-15', kind: 'invoice', lang: 'es', currency: 'EUR', layout: 'L5', number: 'A-2026/0941', orderNumber: po.number, supplier: P.suministros,
    buyer: P.restauracion, issued: '2026-10-16', dateStyle: 'dd/mm/yyyy', due: '2026-11-15', lines: clone(confLines), extraMeta: [['Nº de cliente', '43001'], ['Albarán', 'ALB-26-3310']],
    notes: ['Invoice number contains a slash (A-2026/0941). Albarán ALB-26-3310 is a delivery note number.'] });
  pairUp(po, conf, ['qty-under', 'missing-line']);
  pairUp(conf, inv, []);
  pairUp(po, inv, ['qty-under', 'missing-line']);
}

// 16 US. Boxed PO with quantity first; invoice raises one price and over-invoices another line.
{
  const lines = [
    item('HCS-12-13-2', 'Hex cap screw 1/2-13 x 2 in, grade 8, yellow zinc (box of 50)', 10, 18.75, 'box'),
    item('SG-CLR-AF', 'Safety glasses, clear lens, anti-fog', 48, 3.40),
    item('NG-L-1000', 'Nitrile gloves, size L, 5 mil, case of 1000', 6, 74.00, 'ctn'),
    item('CUT-OIL-1G', 'Cutting oil, sulfurized, 1 gallon', 4, 26.90),
    item('FD-45-60', 'Flap disc 4-1/2 in, 60 grit, zirconia (pack of 10)', 12, 21.50, 'pk'),
  ];
  const po = makeDoc({ id: 'po-16', kind: 'order', lang: 'en', currency: 'USD', layout: 'L6', title: 'PURCHASE ORDER', number: 'EMW-10442', supplier: P.industrial,
    buyer: P.machine, issued: '2026-10-05', dateStyle: 'mm/dd/yyyy', required: '2026-10-12', lines, taxLabel: 'Sales tax (exempt, resale cert. RC-48213)',
    extraMeta: [['Vendor ID', 'V-2290'], ['Ship via', 'UPS Ground'], ['F.O.B.', 'Destination']], notes: ['Dates are mm/dd/yyyy. Resale certificate number RC-48213 is noise.'] });
  const invLines = clone(lines); invLines[1].unitCents = 410; invLines[2].qty = 8;
  const inv = makeDoc({ id: 'inv-16', kind: 'invoice', lang: 'en', currency: 'USD', layout: 'L7', title: 'Invoice', number: '418805', orderNumber: po.number,
    supplier: P.industrial, buyer: P.machine, issued: '2026-10-13', dateStyle: 'MMM d, yyyy', due: '2026-11-12', lines: invLines,
    taxLabel: 'Sales tax (exempt)', tracking: [ups()], extraMeta: [['Customer ID', 'EMW-01'], ['Terms', 'Net 30']],
    notes: ['Only a $ sign; the currency is USD from the US addresses.'] });
  pairUp(po, inv, ['price-higher', 'qty-over']);
}

// 17 NZ. Small invoice titled just "Invoice", no PO reference.
makeDoc({ id: 'inv-17', kind: 'invoice', ...NZ, layout: 'L3', title: 'Invoice', number: '2026-1149', orderNumber: null, supplier: P.cleaning, buyer: P.kitchens,
  issued: '2026-11-02', dateStyle: 'd/m/y', due: '2026-11-20', tracking: [nzpost()],
  lines: [
    item(null, 'Kitchen degreaser concentrate 5 L', 4, 32.50),
    item(null, 'Microfibre cloths, colour coded, pack of 40', 3, 27.00, 'pk'),
    item(null, 'Hand towel roll 200 m, carton of 6', 5, 44.90, 'ctn'),
    item(null, 'Foaming hand soap refill 1 L', 6, 11.20),
  ],
  extraMeta: [['Account', 'EXK-77']], notes: ['No order number on the document (orderNumber null). Titled just "Invoice".'] });

// 18 AU. Tax invoice with long wrapped descriptions; its PO is not in the set.
makeDoc({ id: 'inv-18', kind: 'invoice', lang: 'en', currency: 'AUD', layout: 'L6', title: 'TAX INVOICE', number: 'TI-660192', orderNumber: 'ECP-7720',
  supplier: P.plumbing, buyer: P.cabinetry, issued: '2026-10-30', dateStyle: 'dd/mm/yyyy', due: '2026-11-29', curLabel: 'AUD', tracking: [dhl()],
  lines: [
    item('MXR-SNK-CH', 'Sink mixer, gooseneck, pull-out spray, chrome finish, 5 star water rating, with braided hoses and mounting kit', 6, 189.00),
    item('SNK-DB-860', 'Double bowl sink 860 x 480 mm, 1.0 mm stainless steel, with overflow, basket wastes and template', 3, 279.00),
    item('TRP-40-PP', 'Bottle trap 40 mm, polypropylene, adjustable height 50 to 80 mm', 6, 14.60),
    item('HOS-450', 'Braided flexible hose 450 mm, 1/2 in F x 1/2 in F, pair', 12, 8.95, 'pr'),
  ],
  extraMeta: [['Customer ID', 'ECP-221'], ['Ship via', 'DHL Express']], notes: ['Long descriptions wrap over two lines.'] });

// 19 CN. Chinese commercial invoice, PDF only (no images).
makeDoc({ id: 'inv-19-zh', kind: 'invoice', lang: 'zh', currency: 'USD', layout: 'L1', number: 'CI-NB-26118', orderNumber: '4500012977', supplier: P.ningbo,
  buyer: P.kitchens, issued: '2026-10-08', dateStyle: 'zh', due: '2026-11-07', curLabel: 'USD', cur: { sym: 'US$' }, pdfOnly: true, tracking: [],
  lines: [
    item('HNG-110', '110° 隐藏式铰链，快装底座', 2000, 0.42),
    item('RUN-450', '三节阻尼滑轨 450 毫米（对）', 500, 3.85, 'pr'),
    item('HND-128', '不锈钢拉手，孔距 128 毫米', 1000, 0.96),
  ],
  extraMeta: [['贸易术语', 'FOB 宁波']], notes: ['Chinese text (WenQuanYi Zen Hei font); PDF only. Export invoice, no tax.'] });

// ---------------------------------------------------------------- truth.json

function variantsOf(d) {
  if (d.pdfOnly) return [];
  if (d.pages === 1) return [`out/${d.id}.png`, `out/${d.id}-photo.jpg`];
  const v = [];
  for (let i = 1; i <= d.pages; i++) v.push(`out/${d.id}-p${i}.png`, `out/${d.id}-p${i}-photo.jpg`);
  return v;
}
function truth() {
  return {
    about: 'Made-up purchasing documents for measuring a document reader. Every company, person, address, tax number and price is invented. Money is a decimal string with a dot. taxId is the tax number of the party that issued the document (the buyer on a purchase order), as printed. unit is the unit price. On multi-page documents the variants are one PNG and one photo per page, in page order.',
    seed: SEED,
    docs: DOCS.map((d) => ({
      file: `out/${d.id}.pdf`,
      variants: variantsOf(d),
      pages: d.pages,
      layout: d.layout,
      kind: d.kind,
      title: d.title,
      language: d.lang,
      number: d.number,
      orderNumber: d.kind === 'order' ? d.number : d.orderNumber,
      supplier: d.supplier.name,
      buyer: d.buyer.name,
      taxId: d.taxId,
      country: d.country,
      currency: d.currency,
      issued: d.issued,
      lines: d.lines.map((l) => ({ code: l.code || null, description: l.desc, qty: l.qty, unit: l.unitCents == null ? null : dec(l.unitCents), amount: dec(l.amountCents) })),
      subtotal: dec(d.subtotalCents),
      tax: dec(d.taxCents),
      total: dec(d.totalCents),
      tracking: d.tracking.map((t) => t.value),
      notes: d.notes.join(' '),
    })),
    pairs: PAIRS.map((p) => ({ a: `out/${p.a.id}.pdf`, b: `out/${p.b.id}.pdf`, differences: p.differences })),
  };
}

// ---------------------------------------------------------------- HTML

function money(d, cents, sym) {
  const n = fmtCents(cents, d.lang);
  if (!sym) return n;
  const neg = n.startsWith('-'), a = neg ? n.slice(1) : n;
  return (neg ? '-' : '') + (d.cur.post ? `${a}\u00a0${d.cur.sym}` : `${d.cur.sym}${a}`);
}
const dt = (d, iso) => fmtDate(iso, d.dateStyle);

function metaRows(d) {
  const t = d.T, r = [[t.no[d.kind], d.number], [t.date[d.kind], dt(d, d.issued)]];
  if (d.kind !== 'order' && d.orderNumber) r.push([t.yourOrder, d.orderNumber]);
  if (d.kind === 'order' && d.required) r.push([t.required, dt(d, d.required)]);
  if (d.kind === 'confirmation' && d.dispatch) r.push([t.dispatch, dt(d, d.dispatch)]);
  if (d.kind === 'invoice' && d.due) r.push([t.due, dt(d, d.due)]);
  return r.concat(d.extraMeta);
}
function metaTable(rows, cls = 'meta') {
  return `<table class="${cls}">${rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</table>`;
}
function partyBlock(d, p, o = {}) {
  let h = o.name === false ? '' : `<div class="pname">${esc(p.name)}</div>`;
  h += `<div class="paddr">${p.addr.map(esc).join('<br>')}</div>`;
  if (o.contact !== false) h += `<div class="pcontact">${esc(d.T.ph)} ${esc(p.phone)}<br>${esc(d.T.em)} ${esc(p.email)}</div>`;
  if (o.tax && p.taxId && d.taxId) h += `<div class="ptax">${esc(p.taxId.label)} ${esc(p.taxId.value)}</div>`;
  if (o.siret && p.siret) h += `<div class="ptax">SIRET ${esc(p.siret)}</div>`;
  return h;
}
function addrBox(label, lines, cls = 'abox') {
  return `<div class="${cls}"><div class="albl">${esc(label)}</div>${lines.map(esc).join('<br>')}</div>`;
}
const recipientLines = (p) => [p.name, ...p.addr];
const deliverLines = (d) => (d.buyer.deliver ? d.buyer.deliver : recipientLines(d.buyer));

function linesTable(d, pg, o = {}) {
  const t = d.T, cols = LAYOUT_COLS[d.layout].filter((c) => c !== 'code' || d.lines.some((l) => l.code));
  const lab = { ...t.cols, ...(o.labels || {}) };
  const widths = cols.map((c) => (o.widths && o.widths[c]) || { pos: 5, item: 7, code: 13, desc: 44, qty: 8, uom: 7, unit: 12, amount: 13 }[c]);
  const tot = widths.reduce((a, b) => a + b, 0);
  let h = `<table class="lines"><colgroup>${widths.map((w) => `<col style="width:${((w / tot) * 100).toFixed(2)}%">`).join('')}</colgroup>`;
  h += `<thead><tr>${cols.map((c) => `<th class="c-${c}">${esc(lab[c])}</th>`).join('')}</tr></thead><tbody>`;
  const sumRow = (label, cents) => `<tr class="carry"><td colspan="${cols.length - 1}">${esc(label)}</td><td class="c-amount">${money(d, cents, o.lineSym)}</td></tr>`;
  if (pg.brought != null) h += sumRow(t.brought, pg.brought);
  pg.lines.forEach((l, k) => {
    const idx = pg.start + k;
    h += '<tr>' + cols.map((c) => {
      let v = '';
      if (c === 'pos') v = l.charge ? '' : String(idx + 1);
      if (c === 'item') v = String((idx + 1) * 10).padStart(5, '0');
      if (c === 'code') v = esc(l.code || '');
      if (c === 'desc') v = `<span class="d">${esc(l.desc)}</span>` + (o.skuUnder && l.code ? `<div class="sku">${esc(o.skuUnder)} ${esc(l.code)}</div>` : '') + (o.subrow ? o.subrow(l) : '');
      if (c === 'qty') v = l.qty == null ? '' : esc(fmtQty(l.qty, d.lang, o.qtyDecimals));
      if (c === 'uom') v = l.uom ? esc(t.uom[l.uom]) : '';
      if (c === 'unit') v = l.unitCents == null ? '' : money(d, l.unitCents, o.lineSym);
      if (c === 'amount') v = money(d, l.amountCents, o.lineSym);
      return `<td class="c-${c}">${v}</td>`;
    }).join('') + '</tr>';
  });
  if (pg.carried != null) h += sumRow(t.carried, pg.carried);
  return h + '</tbody></table>';
}
function totalsRows(d, o = {}) {
  const t = d.T, cl = d.curLabel ? ` ${d.curLabel}` : '';
  const rows = [[t.subtotal + (o.subLabel || ''), money(d, d.subtotalCents, o.sym)], [d.taxLabel, money(d, d.taxCents, o.sym)]];
  if (o.shipping) rows.push([o.shipping, money(d, 0, o.sym)]);
  const totalLabel = d.country === 'AU' && d.kind === 'invoice' ? 'Total inc. GST' : t.total;
  rows.push([totalLabel + cl, money(d, d.totalCents, true), 'grand']);
  if (o.balance) { rows.push([t.paid, money(d, 0, o.sym)]); rows.push([t.balance + cl, money(d, d.totalCents, true), 'grand']); }
  return rows;
}
function totalsTable(d, o = {}) {
  return `<table class="totals">${totalsRows(d, o).map(([k, v, c]) => `<tr class="${c || ''}"><th>${esc(k)}</th><td>${v}</td></tr>`).join('')}</table>`;
}
function trackingHtml(d) {
  if (!d.tracking.length) return '';
  return `<div class="ship">${d.tracking.map((x) => esc(d.T.ship(x.carrier, x.printed))).join('<br>')}</div>`;
}
function termsKey(d) { return `${d.country}-${d.kind === 'order' ? 'order' : 'supplier'}`; }
function footerHtml(d, pg, o = {}) {
  const parts = [];
  if (pg.last && o.terms !== false) parts.push(`<div class="terms">${esc(TERMS[termsKey(d)] || '')}</div>`);
  if (d.kind !== 'order' && o.bank !== false) parts.push(`<div class="bank">${esc(d.T.bank)}: ${esc(d.issuer.bank)}</div>`);
  const pageNo = o.page !== false ? `<div class="pageno">${esc(d.T.page(pg.i, pg.n))}</div>` : '';
  return `<footer class="foot">${parts.join('')}${pageNo}</footer>`;
}
function contHeader(d, pg) {
  return `<div class="cont"><b>${esc(d.issuer.name)}</b> &nbsp; ${esc(d.title)} ${esc(d.number)} (${esc(d.T.cont)})<span>${esc(d.T.page(pg.i, pg.n))}</span></div>`;
}

const LAYOUTS = {
  // Classic: issuer on the left, title and details on the right.
  L1(d, pg) {
    let h = '';
    if (pg.first) {
      h += `<header class="hd"><div class="issuer">${partyBlock(d, d.issuer, { tax: true, siret: true })}</div><div class="tbox"><h1>${esc(d.title)}</h1>${metaTable(metaRows(d))}</div></header>`;
      h += `<div class="parties">${addrBox(d.kind === 'order' ? d.T.to : d.T.billTo, recipientLines(d.recipient))}${addrBox(d.T.shipTo, deliverLines(d))}</div>`;
    } else h += contHeader(d, pg);
    h += linesTable(d, pg, { labels: d.lang === 'fr' ? { qty: 'Qté', unit: 'P.U. HT', amount: 'Total HT' } : d.lang === 'en' ? { unit: 'Unit Price' } : {}, widths: { code: 16, desc: 42 } });
    if (pg.last) h += `<div class="after">${trackingHtml(d)}${totalsTable(d, { sym: true })}</div>`;
    return h + footerHtml(d, pg);
  },
  // Header block on the right, title on the left; description first and price before quantity.
  L2(d, pg) {
    let h = '';
    if (pg.first) {
      h += `<header class="hd"><div class="tleft"><h1>${esc(d.title)}</h1>${metaTable(metaRows(d))}</div><div class="issuer">${partyBlock(d, d.issuer, { tax: true })}</div></header>`;
      h += `<div class="parties">${addrBox(d.kind === 'order' ? d.T.to : d.T.billTo, recipientLines(d.recipient))}${addrBox(d.T.shipTo, deliverLines(d))}</div>`;
    } else h += contHeader(d, pg);
    const labels = d.lang === 'de' ? { code: 'Artikel', unit: 'Preis', amount: 'Betrag' } : { code: 'Item code', unit: 'Price', qty: 'Quantity', amount: 'Total' };
    h += linesTable(d, pg, { labels, widths: { desc: 50, code: 14 } });
    if (pg.last) h += `<div class="after">${trackingHtml(d)}${totalsTable(d, { sym: true, balance: d.kind === 'invoice' })}</div>`;
    return h + footerHtml(d, pg);
  },
  // Title band, no code column.
  L3(d, pg) {
    let h = `<div class="band">${esc(d.title)}</div>`;
    h += `<header class="hd"><div class="issuer">${partyBlock(d, d.issuer, { tax: true })}</div><div>${metaTable(metaRows(d))}</div></header>`;
    h += `<div class="parties">${addrBox(d.kind === 'order' ? d.T.to : d.T.billTo, recipientLines(d.recipient))}${d.kind !== 'invoice' ? addrBox(d.T.shipTo, deliverLines(d)) : ''}</div>`;
    h += linesTable(d, pg, { labels: d.lang === 'es' ? { unit: 'Precio unitario' } : {}, widths: { desc: 54, qty: 11 } });
    h += `<div class="after">${trackingHtml(d)}${totalsTable(d, { sym: true })}</div>`;
    return h + footerHtml(d, pg, { page: false });
  },
  // Serif letterhead, no amount column.
  L4(d, pg) {
    const p = d.issuer;
    let h = `<header class="lh"><div class="pname">${esc(p.name)}</div><div class="pline">${esc(p.addr.join(', '))} &nbsp;|&nbsp; ${esc(p.phone)} &nbsp;|&nbsp; ${esc(p.email)}</div>`;
    if (d.taxId) h += `<div class="pline">${esc(p.taxId.label)} ${esc(p.taxId.value)}</div>`;
    h += '</header>';
    h += `<div class="hd"><div>${addrBox(d.kind === 'order' ? d.T.to : d.T.billTo, recipientLines(d.recipient))}</div><div class="tbox"><h1>${esc(d.title)}</h1>${metaTable(metaRows(d))}</div></div>`;
    h += linesTable(d, pg, { labels: { code: 'Part no.', unit: 'Price each' }, widths: { code: 15, desc: 55, qty: 10, unit: 14 } });
    h += `<div class="after">${trackingHtml(d)}${totalsTable(d, { sym: true, subLabel: d.country === 'NZ' || d.country === 'AU' ? ' (excl. GST)' : ' (excl. VAT)' })}</div>`;
    return h + footerHtml(d, pg);
  },
  // DIN 5008 style business letter.
  L5(d, pg) {
    const p = d.issuer, t = d.T;
    let h = `<header class="din"><div class="logo">${esc(p.name)}</div></header>`;
    h += `<div class="din-top"><div class="window"><div class="sender">${esc(p.name)} · ${esc(p.addr.join(' · '))}</div>${recipientLines(d.recipient).map(esc).join('<br>')}</div>`;
    h += `<div class="info">${metaTable(metaRows(d).concat([[t.contact, p.contact], [t.ph, p.phone]]))}</div></div>`;
    const greet = { de: 'Sehr geehrte Damen und Herren,', fr: 'Madame, Monsieur,', es: 'Estimados señores:' }[d.lang];
    const intro = {
      de: { order: 'wir bestellen zu den vereinbarten Konditionen:', confirmation: 'vielen Dank für Ihre Bestellung. Wir bestätigen wie folgt:', invoice: 'für unsere Lieferung berechnen wir Ihnen:' },
      fr: { order: 'veuillez trouver ci-dessous notre commande :', confirmation: 'nous confirmons votre commande :', invoice: 'nous vous facturons la livraison suivante :' },
      es: { order: 'les rogamos nos suministren:', confirmation: 'confirmamos su pedido:', invoice: 'les facturamos el siguiente suministro:' },
    }[d.lang][d.kind];
    h += `<div class="subject">${esc(d.title)} ${esc(d.lang === 'de' ? 'Nr.' : 'n°')} ${esc(d.number)}</div><p class="greet">${esc(greet)}<br>${esc(intro)}</p>`;
    h += linesTable(d, pg, { widths: { pos: 5, code: 16, desc: 38, qty: 9, uom: 7, unit: 13, amount: 13 } });
    h += `<div class="after">${trackingHtml(d)}${totalsTable(d, { sym: true })}</div>`;
    if (d.skonto) {
      const sk = Math.round(d.totalCents * 0.02);
      h += `<p class="closing">Bei Zahlung bis ${esc(dt(d, addDays(d.issued, 10)))} ziehen Sie bitte 2 % Skonto (${esc(money(d, sk, true))}) ab und überweisen ${esc(money(d, d.totalCents - sk, true))}.</p>`;
    }
    const regLine = [p.reg, p.siret && `SIRET ${p.siret}`].filter(Boolean).join('\n');
    h += `<footer class="foot din-foot"><div>${esc(p.name)}<br>${p.addr.map(esc).join('<br>')}</div><div>${esc(t.ph)} ${esc(p.phone)}<br>${esc(p.email)}</div>`;
    h += `<div>${esc(p.bank).replace('  BIC', '<br>BIC')}</div><div>${esc(regLine).replace('\n', '<br>')}${d.taxId ? `<br>${esc(p.taxId.label)} ${esc(p.taxId.value)}` : ''}</div>`;
    h += `<div class="pageno">${esc(t.page(pg.i, pg.n))}</div></footer>`;
    h += pg.last ? `<div class="terms din-terms">${esc(TERMS[termsKey(d)])}</div>` : '';
    return h;
  },
  // US boxed grid, quantity first.
  L6(d, pg) {
    const p = d.issuer;
    let h = `<header class="bar"><div class="pname">${esc(p.name)}</div><h1>${esc(d.title.toUpperCase())}</h1></header>`;
    h += `<div class="hd"><div class="issuer">${partyBlock(d, p, { name: false, tax: true })}</div>${metaTable(metaRows(d).slice(0, 3), 'meta boxed')}</div>`;
    h += `<div class="parties">${addrBox(d.kind === 'order' ? 'VENDOR' : 'BILL TO', recipientLines(d.recipient))}${addrBox('SHIP TO', deliverLines(d))}</div>`;
    const strip = metaRows(d).slice(3);
    if (strip.length) h += `<table class="strip"><tr>${strip.map(([k]) => `<th>${esc(k.toUpperCase())}</th>`).join('')}</tr><tr>${strip.map(([, v]) => `<td>${esc(v)}</td>`).join('')}</tr></table>`;
    h += linesTable(d, pg, { labels: { qty: 'QTY', code: 'ITEM #', desc: 'DESCRIPTION', unit: 'UNIT PRICE', amount: 'LINE TOTAL' }, widths: { qty: 8, code: 15, desc: 49, unit: 13, amount: 15 }, lineSym: d.lang === 'en' && d.country === 'US' });
    h += `<div class="after">${trackingHtml(d)}${totalsTable(d, { sym: true, shipping: d.country === 'US' ? 'Shipping & handling' : null })}</div>`;
    h += `<div class="thanks">${d.kind === 'order' ? 'Please confirm receipt of this order.' : 'Thank you for your business!'}</div>`;
    return h + footerHtml(d, pg);
  },
  // Modern, code printed under the description.
  L7(d, pg) {
    const p = d.issuer, initials = p.name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('');
    let h = `<header class="hd"><div class="brand"><span class="badge">${esc(initials)}</span><div>${partyBlock(d, p, { tax: true })}</div></div>`;
    h += `<div class="tbox"><h1>${esc(d.title)}</h1><div class="bignum">${esc(d.number)}</div></div></header>`;
    const rows = metaRows(d).slice(1);
    h += `<div class="grid">${rows.map(([k, v]) => `<div><span>${esc(k)}</span>${esc(v)}</div>`).join('')}</div>`;
    h += `<div class="parties">${addrBox(d.kind === 'order' ? d.T.to : 'Billed to', recipientLines(d.recipient))}${addrBox('Ship to', deliverLines(d))}</div>`;
    h += linesTable(d, pg, { labels: { desc: 'Item', qty: 'Qty', unit: 'Price', amount: 'Total' }, skuUnder: 'SKU', widths: { desc: 58, qty: 10, unit: 15, amount: 17 } });
    h += `<div class="after">${trackingHtml(d)}${totalsTable(d, { sym: true })}</div>`;
    return h + footerHtml(d, pg);
  },
  // ERP printout in a fixed-width font.
  L8(d, pg) {
    const p = d.issuer, r = d.recipient;
    let h = `<header class="hd"><div>${esc(p.name)}<br>${p.addr.map(esc).join('<br>')}<br>${esc(p.taxId.label)} ${esc(p.taxId.value)}</div>`;
    h += `<div><h1>${esc(d.title.toUpperCase())}</h1>${metaTable([['Number/Date', `${d.number} / ${dt(d, d.issued)}`], ['Contact', p.contact], ['Telephone', p.phone], ['Page', `${pg.i} of ${pg.n}`]])}</div></header>`;
    h += `<div class="parties"><div>Vendor ${esc(d.extraMeta[0][1])}<br>${recipientLines(r).map(esc).join('<br>')}</div><div>Delivery address:<br>${deliverLines(d).map(esc).join('<br>')}</div></div>`;
    h += `<div class="mline">Purchasing group ${esc(d.extraMeta[1][1])} &nbsp; Currency NZD &nbsp; Terms: 20th month following</div>`;
    h += linesTable(d, pg, {
      labels: { item: 'Item', code: 'Material', desc: 'Description', qty: 'Order qty', uom: 'Unit', unit: 'Net price', amount: 'Net value' },
      widths: { item: 7, code: 12, desc: 41, qty: 11, uom: 6, unit: 11, amount: 12 }, qtyDecimals: 3,
      subrow: () => `<div class="sub">Delivery date: ${esc(dt(d, d.required))}</div>`,
    });
    h += `<table class="totals">${[['Total net value excl. GST', money(d, d.subtotalCents)], ['GST 15%', money(d, d.taxCents)], ['Total incl. GST NZD', money(d, d.totalCents)]].map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('')}</table>`;
    h += `<div class="mline">Printed ${esc(dt(d, d.issued))} 14:32 by AWILSON. This order is subject to our standard terms (rev. 4.2).</div>`;
    return h + footerHtml(d, pg, { page: false });
  },
};

const BASE_CSS = `
@page { size: A4; margin: 0 }
* { box-sizing: border-box }
html, body { margin: 0; padding: 0; background: #fff; color: #1a1a1a }
.page { width: 210mm; height: 296mm; padding: 13mm 14mm 0; position: relative; overflow: hidden; break-after: page; page-break-after: always }
.page:last-child { break-after: auto; page-break-after: auto }
h1 { margin: 0 0 3mm; font-weight: 700 }
table { border-collapse: collapse }
table.lines { width: 100%; margin-top: 4mm; table-layout: fixed }
table.lines th, table.lines td { padding: 1.3mm 1.5mm; vertical-align: top; line-height: 1.3; text-align: left }
table.lines .c-qty, table.lines .c-unit, table.lines .c-amount { text-align: right }
table.lines td.c-qty, table.lines td.c-unit, table.lines td.c-amount { white-space: nowrap }
table.lines td.c-code, table.lines td.c-item { white-space: nowrap; font-size: 0.94em }
table.lines tr.carry td { font-style: italic; text-align: right }
.sku { font-size: 0.82em; color: #666; margin-top: 0.4mm }
table.meta th { text-align: left; font-weight: 600; padding: 0.4mm 3mm 0.4mm 0; white-space: nowrap }
table.meta td { padding: 0.4mm 0; }
table.totals { margin-left: auto; margin-top: 3mm; min-width: 72mm }
table.totals th { text-align: left; font-weight: 400; padding: 0.8mm 4mm 0.8mm 0 }
table.totals td { text-align: right; padding: 0.8mm 0; white-space: nowrap }
table.totals tr.grand th, table.totals tr.grand td { font-weight: 700 }
.after { display: flex; justify-content: space-between; align-items: flex-start; gap: 6mm }
.ship { margin-top: 3mm; font-size: 0.9em }
.foot { position: absolute; left: 14mm; right: 14mm; bottom: 8mm; font-size: 7.5pt; color: #444; border-top: 0.3mm solid #bbb; padding-top: 1.5mm }
.foot .pageno { text-align: right; margin-top: 1mm }
.foot .terms { margin-bottom: 1mm }
.cont { display: flex; justify-content: space-between; border-bottom: 0.3mm solid #999; padding-bottom: 2mm; margin-bottom: 2mm }
.parties { display: flex; gap: 8mm; margin-top: 5mm }
.parties > * { flex: 1 }
.albl { font-weight: 700; margin-bottom: 1mm }
.hd { display: flex; justify-content: space-between; gap: 8mm }
.pname { font-weight: 700 }
`;
const LAYOUT_CSS = {
  L1: `body { font: 9.4pt 'Liberation Sans', Arial, sans-serif } .issuer .pname { font-size: 16pt; color: var(--accent) } .tbox h1 { font-size: 20pt; text-align: right; color: var(--accent) }
    .ptax { margin-top: 1mm; font-weight: 600 } .abox { border: 0.3mm solid #ccc; padding: 2mm 3mm } table.lines thead th { background: var(--accent); color: #fff }
    table.lines tbody td { border-bottom: 0.2mm solid #ddd } table.totals tr.grand { border-top: 0.4mm solid #333 }`,
  L2: `body { font: 10pt Carlito, Calibri, sans-serif } .tleft h1 { font-size: 24pt; letter-spacing: 0.5pt } .issuer { text-align: right } .issuer .pname { font-size: 14pt; color: var(--accent) }
    .abox .albl { color: var(--accent); text-transform: uppercase; font-size: 8.5pt } table.lines thead th { border-bottom: 0.5mm solid var(--accent); color: var(--accent) }
    table.lines tbody tr:nth-child(even) td { background: #f3f5f7 } table.totals tr.grand td, table.totals tr.grand th { border-top: 0.3mm solid #999; font-size: 11pt }`,
  L3: `body { font: 8.8pt 'DejaVu Sans', sans-serif } .band { background: #e4e4e4; text-align: center; font-size: 15pt; font-weight: 700; letter-spacing: 2pt; padding: 2.5mm; margin-bottom: 5mm; text-transform: uppercase }
    .issuer .pname { font-size: 12pt } table.lines { border: 0.3mm solid #777 } table.lines th { background: #f0f0f0; border-bottom: 0.3mm solid #777 } table.lines td { border-bottom: 0.2mm solid #ccc }
    table.lines td + td, table.lines th + th { border-left: 0.2mm solid #ccc } .abox { padding: 1mm 0 }`,
  L4: `body { font: 10.2pt 'Liberation Serif', 'Times New Roman', serif } .lh { text-align: center; border-bottom: 0.6mm double #333; padding-bottom: 2mm; margin-bottom: 6mm }
    .lh .pname { font-size: 19pt; letter-spacing: 0.4pt } .lh .pline { font-size: 8.8pt } .tbox h1 { font-size: 17pt }
    table.lines th { border-top: 0.4mm solid #000; border-bottom: 0.4mm solid #000; font-style: italic } table.lines td { border-bottom: 0.15mm dotted #999 }`,
  L5: `body { font: 9.6pt 'Liberation Sans', Arial, sans-serif } .din { text-align: right; height: 22mm } .din .logo { font-size: 17pt; font-weight: 700; color: var(--accent); border-bottom: 1mm solid var(--accent); display: inline-block; padding-bottom: 1mm }
    .din-top { display: flex; justify-content: space-between; height: 46mm } .window { width: 85mm; padding-top: 1mm } .sender { font-size: 6.8pt; text-decoration: underline; margin-bottom: 3mm; color: #333 }
    .info table.meta { font-size: 8.6pt } .subject { font-weight: 700; font-size: 11pt; margin-top: 4mm } .greet { margin: 3mm 0 1mm }
    table.lines th { border-bottom: 0.4mm solid #000 } table.lines td { border-bottom: 0.15mm solid #ccc } .closing { margin-top: 4mm }
    .din-foot { display: grid; grid-template-columns: 1fr 1fr 1.4fr 1.4fr; gap: 3mm; font-size: 6.8pt; bottom: 14mm } .din-foot .pageno { grid-column: 1 / -1 }
    .din-terms { position: absolute; left: 14mm; right: 14mm; bottom: 34mm; font-size: 7.6pt; color: #333 }`,
  L6: `body { font: 9pt 'Liberation Sans', Arial, sans-serif } .bar { display: flex; justify-content: space-between; align-items: center; background: var(--accent); color: #fff; padding: 3mm 4mm; margin: -2mm 0 4mm }
    .bar .pname { font-size: 15pt } .bar h1 { margin: 0; font-size: 18pt; letter-spacing: 1pt } table.boxed th, table.boxed td { border: 0.3mm solid #555; padding: 1mm 2mm }
    table.boxed th { background: #eee; font-size: 8pt } .abox { border: 0.3mm solid #555 } .abox .albl { background: #eee; border-bottom: 0.3mm solid #555; padding: 0.8mm 2mm; margin: 0 0 1mm; font-size: 8pt }
    .parties .abox { padding: 0 2mm 1.5mm }
    table.strip { width: 100%; margin-top: 4mm } table.strip th, table.strip td { border: 0.3mm solid #555; padding: 0.8mm 2mm; text-align: center } table.strip th { background: #eee; font-size: 7.5pt }
    table.lines, table.lines th, table.lines td { border: 0.3mm solid #555 } table.lines th { background: #eee; font-size: 8pt } table.totals td, table.totals th { border: 0.3mm solid #555; padding: 1mm 2mm }
    .thanks { text-align: center; font-style: italic; margin-top: 6mm }`,
  L7: `body { font: 9pt Inter, sans-serif; font-feature-settings: 'calt' 0 } .brand { display: flex; gap: 3mm } .badge { display: inline-flex; width: 13mm; height: 13mm; border-radius: 50%; background: var(--accent); color: #fff; font-weight: 700; font-size: 13pt; align-items: center; justify-content: center; flex: none }
    .tbox { text-align: right } .tbox h1 { font-size: 13pt; color: #666; text-transform: uppercase; letter-spacing: 1.5pt; margin: 0 } .bignum { font-size: 18pt; font-weight: 700 }
    .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 2mm 6mm; margin-top: 5mm; padding: 3mm; background: #f4f4f6 } .grid span { display: block; color: #666; font-size: 7.5pt }
    table.lines th { color: #666; font-weight: 600; border-bottom: 0.3mm solid #222 } table.lines td { border-bottom: 0.2mm solid #e2e2e2 } table.totals tr.grand td { font-size: 13pt }`,
  L8: `body { font: 8.2pt 'Liberation Mono', 'Courier New', monospace } h1 { font-size: 13pt } .hd > div:last-child { width: 82mm } .mline { margin: 3mm 0 } .parties { gap: 10mm }
    table.lines th { border-top: 0.3mm dashed #000; border-bottom: 0.3mm dashed #000; font-weight: 400 } table.lines tbody tr:last-child td { border-bottom: 0.3mm dashed #000 } .sub { color: #333 }
    table.totals th { font-weight: 400 }`,
};

function pageHtml(d) {
  const pages = [];
  let start = 0, running = 0;
  d.pageLines.forEach((lines, i) => {
    const pg = { i: i + 1, n: d.pages, first: i === 0, last: i === d.pages - 1, lines, start };
    if (d.carryForward && i > 0) pg.brought = running;
    running += lines.reduce((s, l) => s + l.amountCents, 0);
    if (d.carryForward && !pg.last) pg.carried = running;
    pages.push(`<section class="page">${LAYOUTS[d.layout](d, pg)}</section>`);
    start += lines.length;
  });
  const font = d.lang === 'zh' ? "body { font-family: 'WenQuanYi Zen Hei', sans-serif !important }" : '';
  return `<!doctype html><html lang="${d.lang}"><head><meta charset="utf-8"><title>${esc(d.title)} ${esc(d.number)}</title>
<style>${BASE_CSS}${LAYOUT_CSS[d.layout]}${font} :root { --accent: ${d.issuer.accent} }</style></head><body>${pages.join('')}</body></html>`;
}

// ---------------------------------------------------------------- rendering

// Chrome writes RGB screenshots. The pages use a few hundred colours, so they are re-encoded as
// 8-bit palette PNGs (the 256 most common colours; rare anti-aliasing shades map to the nearest one).
function pngDecode(buf) {
  let p = 8, w, h, ct; const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8), data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); ct = data[9]; if (data[8] !== 8 || data[12] !== 0) throw new Error('unexpected PNG'); }
    if (type === 'IDAT') idat.push(data);
    p += 12 + len;
  }
  const bpp = { 2: 3, 6: 4 }[ct]; if (!bpp) throw new Error('unexpected PNG colour type ' + ct);
  const raw = zlib.inflateSync(Buffer.concat(idat)), stride = w * bpp, px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, row = y * stride, prev = row - stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[row + x - bpp] : 0, b = y ? px[prev + x] : 0, c = y && x >= bpp ? px[prev + x - bpp] : 0;
      let v = raw[src + x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[row + x] = v & 255;
    }
  }
  return { w, h, bpp, px };
}
const CRC_TABLE = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
function pngChunk(type, data) {
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  let c = -1; for (const x of td) c = CRC_TABLE[(c ^ x) & 255] ^ (c >>> 8);
  const out = Buffer.alloc(td.length + 8); out.writeUInt32BE(data.length, 0); td.copy(out, 4); out.writeUInt32BE((c ^ -1) >>> 0, td.length + 4);
  return out;
}
function toPalettePng(buf) {
  const { w, h, bpp, px } = pngDecode(buf), n = w * h, key = new Uint32Array(n), count = new Map();
  for (let i = 0; i < n; i++) { const k = (px[i * bpp] << 16) | (px[i * bpp + 1] << 8) | px[i * bpp + 2]; key[i] = k; count.set(k, (count.get(k) || 0) + 1); }
  const pal = [...count.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 256).map((e) => e[0]);
  const index = new Map(pal.map((k, i) => [k, i]));
  const nearest = (k) => {
    let best = 0, bd = Infinity;
    pal.forEach((q, i) => { const dr = (k >> 16) - (q >> 16), dg = ((k >> 8) & 255) - ((q >> 8) & 255), db = (k & 255) - (q & 255), dd = dr * dr + dg * dg + db * db; if (dd < bd) { bd = dd; best = i; } });
    return best;
  };
  const raw = Buffer.alloc(h * (w + 1));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const k = key[y * w + x]; let i = index.get(k);
    if (i === undefined) { i = nearest(k); index.set(k, i); }
    raw[y * (w + 1) + 1 + x] = i;
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 3;
  const plte = Buffer.alloc(pal.length * 3); pal.forEach((k, i) => { plte[i * 3] = k >> 16; plte[i * 3 + 1] = (k >> 8) & 255; plte[i * 3 + 2] = k & 255; });
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', ihdr), pngChunk('PLTE', plte),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9, memLevel: 9 })), pngChunk('IEND', Buffer.alloc(0))]);
}

async function photo(page, png, seed) {
  return page.evaluate(async ({ src, seed, target, maxBytes, outW }) => {
    function mulberry32(a) { return function () { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
    const r = mulberry32(seed);
    const img = new Image(); img.src = src; await img.decode();
    const W = outW, H = Math.round((outW * img.height) / img.width);
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d');
    const tones = [['#7d6a55', '#4f4234'], ['#8d949b', '#5c6268'], ['#c4b08f', '#97805f'], ['#5a6b5d', '#38443a']];
    const [t0, t1] = tones[Math.floor(r() * tones.length)];
    const g = x.createLinearGradient(0, 0, W, H); g.addColorStop(0, t0); g.addColorStop(1, t1);
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    const deg = (0.5 + r() * 2.0) * (r() < 0.5 ? -1 : 1), k = 0.93 + r() * 0.03;
    const blur = 0.35 + r() * 0.5, bright = 0.86 + r() * 0.18, contrast = 0.88 + r() * 0.14, sepia = r() * 0.18;
    x.save();
    x.translate(W / 2 + (r() - 0.5) * W * 0.02, H / 2 + (r() - 0.5) * H * 0.02);
    x.rotate((deg * Math.PI) / 180);
    x.shadowColor = 'rgba(0,0,0,0.45)'; x.shadowBlur = 16; x.shadowOffsetX = 3; x.shadowOffsetY = 6;
    x.filter = `blur(${blur.toFixed(2)}px) brightness(${bright.toFixed(3)}) contrast(${contrast.toFixed(3)}) sepia(${sepia.toFixed(3)})`;
    x.drawImage(img, (-W * k) / 2, (-H * k) / 2, W * k, H * k);
    x.restore();
    const lx = W * (0.15 + r() * 0.7), ly = H * (0.1 + r() * 0.5);
    const rg = x.createRadialGradient(lx, ly, W * 0.05, lx, ly, W * 1.2);
    rg.addColorStop(0, 'rgba(255,252,235,0.10)'); rg.addColorStop(1, 'rgba(0,0,0,0.30)');
    x.fillStyle = rg; x.fillRect(0, 0, W, H);
    const id = x.getImageData(0, 0, W, H), px = id.data, amp = 5 + r() * 6;
    for (let y = 0; y < H; y += 2) {
      for (let xx = 0; xx < W; xx += 2) {
        const n = (r() - 0.5) * amp;
        for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
          if (xx + dx >= W || y + dy >= H) continue;
          const i = ((y + dy) * W + xx + dx) * 4;
          px[i] += n; px[i + 1] += n; px[i + 2] += n * 0.9;
        }
      }
    }
    x.putImageData(id, 0, 0);
    // Highest JPEG quality that meets the size target, but never below 0.45 (then the hard limit applies).
    for (let q = 0.8; q >= 0.449; q -= 0.05) {
      const url = c.toDataURL('image/jpeg', q), bytes = (url.length - 23) * 0.75;
      if (bytes <= target || (q < 0.5 && bytes <= maxBytes)) return { b64: url.slice(url.indexOf(',') + 1), q, deg };
    }
    throw new Error('photo too large');
  }, { src: 'data:image/png;base64,' + png.toString('base64'), seed, target: PHOTO_TARGET_BYTES, maxBytes: MAX_IMAGE_BYTES, outW: PHOTO_WIDTH });
}

async function render() {
  const { chromium } = require('playwright');
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 794, height: 1123 }, deviceScaleFactor: SCALE });
  const page = await ctx.newPage();
  const scratch = await ctx.newPage();
  await scratch.setContent('<!doctype html><html><body></body></html>');
  const report = [];
  for (const [n, d] of DOCS.entries()) {
    await page.setContent(pageHtml(d), { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    const fit = await page.evaluate(() => [...document.querySelectorAll('.page')].map((p) => {
      const foot = p.querySelector('.foot'), top = foot ? foot.getBoundingClientRect().top : p.getBoundingClientRect().bottom;
      let bottom = -Infinity;
      const parts = [];
      for (const el of p.children) {
        if (el.classList.contains('foot') || el.classList.contains('din-terms')) continue;
        bottom = Math.max(bottom, el.getBoundingClientRect().bottom); parts.push(el.className + ':' + Math.round(el.getBoundingClientRect().bottom));
      }
      const terms = p.querySelector('.din-terms');
      const termsTop = terms ? terms.getBoundingClientRect().top : top;
      const wrapped = [...p.querySelectorAll('td.c-desc .d')].filter((e) => e.getClientRects().length > 1).length;
      const cells = [...p.querySelectorAll('td, th')].filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent);
      const termsBottom = terms ? terms.getBoundingClientRect().bottom : -Infinity;
      return { overflow: bottom > Math.min(top, termsTop) - 2 || termsBottom > top - 1 || p.scrollWidth > p.clientWidth + 1 || cells.length > 0, cells, wrapped, room: Math.round(Math.min(top, termsTop) - bottom), parts: parts.join(' ') + ' foot:' + Math.round(top) };
    }));
    if (fit.some((f) => f.overflow)) throw new Error(`${d.id}: content runs into the footer (${JSON.stringify(fit)})`);
    d.wrapped = fit.reduce((s, f) => s + f.wrapped, 0);
    await page.pdf({ path: path.join(OUT, `${d.id}.pdf`), preferCSSPageSize: true, printBackground: true });
    if (!d.pdfOnly) {
      const shots = variantsOf(d).filter((v) => v.endsWith('.png'));
      for (const [i, rel] of shots.entries()) {
        const png = await page.locator('.page').nth(i).screenshot({ type: 'png' });
        fs.writeFileSync(path.join(ROOT, rel), toPalettePng(png));
        const ph = await photo(scratch, png, SEED + n * 31 + i);
        d.photoInfo = (d.photoInfo || []).concat(`q${ph.q.toFixed(2)} ${ph.deg.toFixed(1)}deg`);
        fs.writeFileSync(path.join(ROOT, rel.replace(/\.png$/, '-photo.jpg')), Buffer.from(ph.b64, 'base64'));
      }
    }
    report.push(`${d.id.padEnd(10)} ${d.layout} ${d.lang} ${String(d.pages)}p ${String(d.lines.length).padStart(2)} lines, ${d.wrapped} wrapped, room ${fit.map((f) => f.room).join('/')} px${d.photoInfo ? ', photo ' + d.photoInfo.join('/') : ''}`);
  }
  await browser.close();
  return report;
}

// ---------------------------------------------------------------- checking the PDFs against the labels

function pdfText(file) {
  const r = spawnSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8' });
  if (r.error || r.status !== 0) return null;
  return r.stdout.normalize('NFKC').replace(/[\u00a0\u202f\u2009]/g, ' ');
}
function check(docs) {
  const problems = [];
  let checked = 0;
  for (const d of docs) {
    const file = path.join(OUT, `${d.id}.pdf`);
    const text = pdfText(file);
    if (text == null) return { checked: 0, problems, skipped: true };
    checked++;
    const flat = text.replace(/[ \t]+/g, ' ');
    const nospace = text.replace(/\s+/g, '');
    const lines = text.split('\n').map((l) => l.replace(/[ \t]+/g, ' '));
    const has = (s) => flat.includes(String(s).normalize('NFKC').replace(/[\u00a0]/g, ' '));
    const bad = (m) => problems.push(`${d.id}: ${m}`);
    const pages = (text.match(/\f/g) || []).length;
    if (pages !== d.pages) bad(`expected ${d.pages} page(s), found ${pages}`);
    if (!has(d.number)) bad(`number ${d.number} not found`);
    if (d.orderNumber && !has(d.orderNumber)) bad(`order number ${d.orderNumber} not found`);
    if (!has(d.supplier.name)) bad(`supplier ${d.supplier.name} not found`);
    if (!has(d.buyer.name)) bad(`buyer ${d.buyer.name} not found`);
    if (d.taxId && !has(d.taxId.value)) bad(`tax id ${d.taxId.value} not found`);
    if (!has(fmtDate(d.issued, d.dateStyle))) bad(`issue date ${fmtDate(d.issued, d.dateStyle)} not found`);
    for (const t of d.tracking) if (!nospace.includes(t.value)) bad(`tracking ${t.value} not found`);
    for (const c of [d.subtotalCents, d.taxCents, d.totalCents]) if (!has(fmtCents(c, d.lang))) bad(`total ${fmtCents(c, d.lang)} not found`);
    const qtyDecimals = d.layout === 'L8' ? 3 : 0;
    const amountShown = LAYOUT_COLS[d.layout].includes('amount');
    for (const l of d.lines) {
      const num = (s) => new RegExp(`(^|[^\\d.,])${s.replace(/\u00a0/g, ' ').replace(/[.$]/g, '\\$&').replace(/ /g, ' ?')}(?![\\d]|[.,]\\d)`);
      const unit = l.unitCents == null ? null : num(fmtCents(l.unitCents, d.lang));
      const amount = num(fmtCents(l.amountCents, d.lang));
      const qty = l.qty == null ? null : num(fmtQty(l.qty, d.lang, qtyDecimals));
      const row = lines.findIndex((s) => (!unit || unit.test(s)) && (!qty || qty.test(s)) && (!amountShown || amount.test(s)));
      if (row < 0) { bad(`no row with qty/unit/amount for "${l.desc}"`); continue; }
      const near = lines.slice(Math.max(0, row - 2), row + 4).join(' ');
      if (l.code && !near.includes(l.code)) bad(`code ${l.code} not next to its row`);
      // Every word of the description must be printed on the row or the wrapped lines just below it.
      const words = l.desc.normalize('NFKC').split(/\s+/);
      const nearWords = new Set(near.split(/\s+/));
      for (const w of words) if (!nearWords.has(w)) bad(`description word "${w}" of "${l.desc}" not printed on its row`);
      const first = l.desc.split(/\s+/)[0];
      if (d.lang !== 'zh' && !near.includes(first)) bad(`description "${l.desc}" does not start near its row`);
    }
  }
  return { checked, problems };
}

function sizeReport() {
  let total = 0, biggest = 0, count = 0;
  const kinds = {};
  for (const f of fs.readdirSync(OUT)) {
    const s = fs.statSync(path.join(OUT, f)).size; total += s; count++;
    const ext = path.extname(f); kinds[ext] = (kinds[ext] || 0) + 1;
    if (ext !== '.pdf') biggest = Math.max(biggest, s);
    if (ext !== '.pdf' && s > 400 * 1024) throw new Error(`${f} is ${s} bytes, over 400 KB`);
  }
  if (total > MAX_TOTAL_BYTES) throw new Error(`out/ is ${total} bytes, over 12 MB`);
  return { total, biggest, count, kinds };
}

async function main() {
  // Sanity checks on the labels themselves.
  const t = truth();
  for (const d of DOCS) {
    if (d.taxId && d.taxId.type === 'nz-gst' && !nzGstValid(d.taxId.value)) throw new Error(`${d.id} GST number fails`);
    if (d.taxId && d.taxId.type === 'abn' && !abnValid(d.taxId.value)) throw new Error(`${d.id} ABN fails`);
    if (d.taxId && d.taxId.type === 'gb-vat' && !gbVatValid(d.taxId.value)) throw new Error(`${d.id} GB VAT fails`);
  }
  fs.writeFileSync(TRUTH, JSON.stringify(t, null, 2) + '\n');
  console.log(`truth.json: ${t.docs.length} documents, ${t.pairs.length} pairs`);
  if (process.argv.includes('--labels-only')) return;
  const htmlAt = process.argv.indexOf('--html');
  if (htmlAt > 0) { // debugging aid: write one document's HTML to a file
    const d = DOCS.find((x) => x.id === process.argv[htmlAt + 1]);
    fs.writeFileSync(process.argv[htmlAt + 2], pageHtml(d));
    return;
  }
  if (!process.argv.includes('--check')) {
    const report = await render();
    console.log(report.join('\n'));
  }
  const s = sizeReport();
  console.log(`out/: ${s.count} files (${Object.entries(s.kinds).map(([k, v]) => `${v} ${k}`).join(', ')}), ${(s.total / 1048576).toFixed(2)} MB, largest image ${(s.biggest / 1024).toFixed(0)} KB`);
  const c = check(DOCS);
  if (c.skipped) { console.log('PDF text check skipped: pdftotext is not installed'); return; }
  console.log(`PDF text check: ${c.checked} documents, ${c.problems.length} problems`);
  for (const p of c.problems) console.log('  ' + p);
  if (c.problems.length) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
