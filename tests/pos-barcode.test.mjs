import assert from "node:assert/strict";
import test from "node:test";

import { hasValidGtinCheckDigit, inspectBarcode, normalizeBarcodeInput, parseScaleBarcode } from "../lib/pos-barcode.ts";

test("normalizes Kurdish, Arabic and Persian barcode digits", () => {
  assert.equal(normalizeBarcodeInput(" ٦٢٦-١٢۳ ٤٥ "), "62612345");
});

test("validates standard GTIN check digits without rejecting internal codes", () => {
  assert.equal(hasValidGtinCheckDigit("6291041500213"), true);
  assert.equal(hasValidGtinCheckDigit("6291041500214"), false);
  assert.deepEqual(inspectBarcode("12345"), {
    normalized: "12345", kind: "internal", valid: true, message: "بارکۆدی ناوخۆی فرۆشگا",
  });
});

test("parses the configured Kurdistan market scale barcode format", () => {
  assert.deepEqual(parseScaleBarcode("2700002029709", { prefix: "27", itemDigits: 7, decimals: 3 }), {
    raw: "2700002029709", itemCode: "2700002", shortCode: "00002", quantity: 2.97,
  });
  assert.equal(parseScaleBarcode("123456789", { prefix: "27", itemDigits: 7, decimals: 3 }), null);
});
