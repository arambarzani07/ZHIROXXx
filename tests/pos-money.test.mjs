import assert from "node:assert/strict";
import test from "node:test";

import {
  allocateReturnDiscount,
  calculateBalancedJournalTotals,
  calculateCurrencyDrawer,
  calculateDiscountedSale,
  convertCurrencyToIQD,
  convertIQDToCurrency,
  normalizePaymentMethod,
  resolveUsdRate,
  settlementRoundingToleranceIQD,
} from "../lib/pos-money.ts";
import { createBrowserSafeUuid } from "../lib/pos-id.ts";

test("creates browser-safe UUIDs when randomUUID is unavailable", () => {
  const fallbackUuid = createBrowserSafeUuid({
    getRandomValues(bytes) {
      bytes.fill(0x2a);
      return bytes;
    },
  });

  assert.equal(fallbackUuid, "2a2a2a2a-2a2a-4a2a-aa2a-2a2a2a2a2a2a");
});

test("calculates controlled discounts without allowing a negative sale", () => {
  assert.deepEqual(calculateDiscountedSale(100_000, 10_000), {
    subtotalIQD: 100_000,
    discountIQD: 10_000,
    totalIQD: 90_000,
  });
  assert.throws(() => calculateDiscountedSale(100_000, 100_001));
  assert.throws(() => calculateDiscountedSale(100_000, -1));
});

test("allocates discount across partial returns and closes rounding on the final return", () => {
  const partial = allocateReturnDiscount({
    saleSubtotalIQD: 100_000,
    saleDiscountIQD: 10_000,
    grossReturnIQD: 30_000,
    priorDiscountIQD: 0,
    isFinalReturn: false,
  });
  assert.deepEqual(partial, { grossTotalIQD: 30_000, discountImpactIQD: 3_000, totalIQD: 27_000 });

  const final = allocateReturnDiscount({
    saleSubtotalIQD: 100_000,
    saleDiscountIQD: 10_000,
    grossReturnIQD: 70_000,
    priorDiscountIQD: partial.discountImpactIQD,
    isFinalReturn: true,
  });
  assert.deepEqual(final, { grossTotalIQD: 70_000, discountImpactIQD: 7_000, totalIQD: 63_000 });
  assert.equal(partial.totalIQD + final.totalIQD, 90_000);
  assert.equal(partial.discountImpactIQD + final.discountImpactIQD, 10_000);
});

test("normalizes legacy and supported payment channels", () => {
  assert.equal(normalizePaymentMethod(), "cash");
  assert.equal(normalizePaymentMethod("cash"), "cash");
  assert.equal(normalizePaymentMethod("card"), "card");
  assert.equal(normalizePaymentMethod("transfer"), "transfer");
  assert.equal(settlementRoundingToleranceIQD("IQD", 1500), 0.001);
  assert.equal(settlementRoundingToleranceIQD("USD", 1500), 7.5);
});

test("keeps each USD settlement tied to its captured exchange rate", () => {
  assert.equal(resolveUsdRate(1320), 1320);
  assert.equal(convertCurrencyToIQD(27.35, "USD", 1320), 36102);
  assert.equal(convertIQDToCurrency(36102, "USD", 1320), 27.35);
  assert.equal(convertCurrencyToIQD(125_000, "IQD", 9999), 125_000);
  assert.throws(() => resolveUsdRate(0));
  assert.throws(() => convertCurrencyToIQD(-1, "USD", 1320));
});

test("balances IQD and USD physical drawers independently", () => {
  const drawer = calculateCurrencyDrawer(100_000, 50, [
    { direction: "in", amountIQD: 50_000 },
    { direction: "out", amountIQD: 10_000, currency: "IQD", amountOriginal: 10_000 },
    { direction: "in", amountIQD: 19_800, currency: "USD", amountOriginal: 15, exchangeRateIQDPerUSD: 1320 },
    { direction: "out", amountIQD: 3_300, currency: "USD", amountOriginal: 2.5, exchangeRateIQDPerUSD: 1320 },
  ]);
  assert.deepEqual(drawer, {
    cashInIQD: 50_000,
    cashOutIQD: 10_000,
    expectedCashIQD: 140_000,
    cashInUSD: 15,
    cashOutUSD: 2.5,
    expectedCashUSD: 62.5,
  });
});

test("keeps card and bank-transfer movements outside the physical drawer", () => {
  assert.deepEqual(calculateCurrencyDrawer(100_000, 50, [
    { direction: "in", amountIQD: 25_000, paymentMethod: "cash" },
    { direction: "out", amountIQD: 5_000, paymentMethod: "cash" },
    { direction: "in", amountIQD: 300_000, paymentMethod: "card" },
    { direction: "out", amountIQD: 200_000, paymentMethod: "transfer" },
    { direction: "in", amountIQD: 15_000, amountOriginal: 10, currency: "USD", exchangeRateIQDPerUSD: 1500, paymentMethod: "card" },
  ]), {
    cashInIQD: 25_000,
    cashOutIQD: 5_000,
    expectedCashIQD: 120_000,
    cashInUSD: 0,
    cashOutUSD: 0,
    expectedCashUSD: 50,
  });
});

test("balances purchase and purchase-return bank settlements", () => {
  assert.deepEqual(calculateBalancedJournalTotals([
    { debitIQD: 100_000, creditIQD: 0 },
    { debitIQD: 0, creditIQD: 60_000 },
    { debitIQD: 0, creditIQD: 40_000 },
  ]), { debitTotalIQD: 100_000, creditTotalIQD: 100_000 });
  assert.deepEqual(calculateBalancedJournalTotals([
    { debitIQD: 20_000, creditIQD: 0 },
    { debitIQD: 10_000, creditIQD: 0 },
    { debitIQD: 0, creditIQD: 30_000 },
  ]), { debitTotalIQD: 30_000, creditTotalIQD: 30_000 });
});

test("rejects unbalanced or invalid double-entry journals", () => {
  assert.deepEqual(
    calculateBalancedJournalTotals([
      { debitIQD: 36_102, creditIQD: 0 },
      { debitIQD: 0, creditIQD: 36_102 },
    ]),
    { debitTotalIQD: 36_102, creditTotalIQD: 36_102 },
  );
  assert.throws(() => calculateBalancedJournalTotals([
    { debitIQD: 10_000, creditIQD: 0 },
    { debitIQD: 0, creditIQD: 9_999 },
  ]));
  assert.throws(() => calculateBalancedJournalTotals([
    { debitIQD: 10_000, creditIQD: 10_000 },
    { debitIQD: 0, creditIQD: 0 },
  ]));
});

test("aggregates fifty thousand mixed-currency drawer movements exactly", () => {
  const entries = [];
  for (let group = 0; group < 12_500; group += 1) {
    entries.push(
      { direction: "in", amountIQD: 1_000 },
      { direction: "in", amountIQD: 1_875, currency: "USD", amountOriginal: 1.25, exchangeRateIQDPerUSD: 1500 },
      { direction: "out", amountIQD: 400, currency: "IQD", amountOriginal: 400 },
      { direction: "out", amountIQD: 375, currency: "USD", amountOriginal: 0.25, exchangeRateIQDPerUSD: 1500 },
    );
  }
  assert.equal(entries.length, 50_000);
  assert.deepEqual(calculateCurrencyDrawer(100_000, 50, entries), {
    cashInIQD: 12_500_000,
    cashOutIQD: 5_000_000,
    expectedCashIQD: 7_600_000,
    cashInUSD: 15_625,
    cashOutUSD: 3_125,
    expectedCashUSD: 12_550,
  });
});
