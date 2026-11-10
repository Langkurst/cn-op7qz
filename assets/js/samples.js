/*
  Sample orders and invoices for the checker demo.
  Everything here is made up: the suppliers, the order numbers, the items and the prices.
  Prices are in whole cents. To add a sample, copy one block and change the numbers.
  The tests in tests/matcher.test.js check what each sample should flag ("expect").
*/
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.InvoiceSamples = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  return [
    {
      id: "match",
      label: "Invoice matches the order",
      order: {
        number: "4500012871", supplier: "Example Fittings Ltd",
        lines: [
          { code: "HNG-110", description: "Concealed hinge, 110 degree", qty: 200, unitCents: 285 },
          { code: "RUN-450", description: "Drawer runner, 450 mm, pair", qty: 60, unitCents: 1420 },
          { code: "HDL-128", description: "Bar handle, 128 mm, brushed", qty: 120, unitCents: 640 }
        ]
      },
      invoice: {
        number: "INV-20418", supplier: "Example Fittings Ltd", orderNumber: "4500012871",
        lines: [
          { code: "HNG-110", description: "Concealed hinge, 110 degree", qty: 200, unitCents: 285 },
          { code: "RUN-450", description: "Drawer runner, 450 mm, pair", qty: 60, unitCents: 1420 },
          { code: "HDL-128", description: "Bar handle, 128 mm, brushed", qty: 120, unitCents: 640 }
        ],
        subtotalCents: 219000, gstCents: 32850, totalCents: 251850
      },
      expect: []
    },
    {
      id: "price-quantity",
      label: "Price and quantity differences",
      order: {
        number: "4500012904", supplier: "Sample Hardware Imports Ltd",
        lines: [
          { code: "RUN-500", description: "Drawer runner, 500 mm, pair", qty: 80, unitCents: 1560 },
          { code: "LED-2M", description: "LED strip, 2 m, warm white", qty: 50, unitCents: 1850 },
          { code: "SCR-430", description: "Screws, 4 x 30 mm, box of 500", qty: 24, unitCents: 1190 },
          { code: "LEG-100", description: "Adjustable cabinet leg, 100 mm", qty: 400, unitCents: 135 }
        ]
      },
      invoice: {
        number: "SHI-7731", supplier: "Sample Hardware Imports Ltd", orderNumber: "4500012904",
        lines: [
          { code: "RUN-500", description: "Drawer runner, 500 mm, pair", qty: 80, unitCents: 1610 },
          { code: "LED-2M", description: "LED strip, 2 m, warm white", qty: 60, unitCents: 1850 },
          { code: "SCR-430", description: "Screws, 4 x 30 mm, box of 500", qty: 24, unitCents: 1190 },
          { code: "LEG-100", description: "Adjustable cabinet leg, 100 mm", qty: 300, unitCents: 135 }
        ],
        subtotalCents: 308860, gstCents: 46329, totalCents: 355189
      },
      expect: ["price-higher", "quantity-over", "quantity-short"]
    },
    {
      id: "lines",
      label: "Extra, missing and repeated lines",
      order: {
        number: "4500012933", supplier: "Example Fittings Ltd",
        lines: [
          { code: "HNG-110", description: "Concealed hinge, 110 degree", qty: 300, unitCents: 285 },
          { code: "HDL-160", description: "Bar handle, 160 mm, matt black", qty: 150, unitCents: 710 },
          { code: "SLD-1200", description: "Sliding door track, 1200 mm", qty: 20, unitCents: 3200 }
        ]
      },
      invoice: {
        number: "INV-20466", supplier: "Example Fittings Ltd", orderNumber: "4500012933",
        lines: [
          { code: "HNG-110", description: "Concealed hinge, 110 degree", qty: 300, unitCents: 285 },
          { code: "HDL-160", description: "Bar handle, 160 mm, matt black", qty: 100, unitCents: 710 },
          { code: "HDL-160", description: "Bar handle, 160 mm, matt black", qty: 100, unitCents: 710 },
          { code: "FRT", description: "Freight, Auckland metro", qty: 1, unitCents: 8500 }
        ],
        subtotalCents: 236000, gstCents: 35400, totalCents: 271400
      },
      expect: ["duplicate-line", "quantity-over", "extra-line", "missing-line"]
    },
    {
      id: "totals",
      label: "GST and totals do not add up",
      order: {
        number: "4500012958", supplier: "Sample Hardware Imports Ltd",
        lines: [
          { code: "RUN-450", description: "Drawer runner, 450 mm, pair", qty: 100, unitCents: 1420 },
          { code: "HNG-110", description: "Concealed hinge, 110 degree", qty: 500, unitCents: 285 }
        ]
      },
      invoice: {
        number: "SHI-7802", supplier: "Sample Hardware Imports Ltd", orderNumber: "4500012985",
        lines: [
          { code: "RUN-450", description: "Drawer runner, 450 mm, pair", qty: 100, unitCents: 1420 },
          { code: "HNG-110", description: "Concealed hinge, 110 degree", qty: 500, unitCents: 285 }
        ],
        subtotalCents: 284500, gstCents: 39830, totalCents: 327175
      },
      expect: ["order-number", "gst", "total"]
    }
  ];
});
