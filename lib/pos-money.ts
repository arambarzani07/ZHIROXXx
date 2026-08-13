export type Currency = "IQD" | "USD";
export type PaymentMethod = "cash" | "card" | "transfer";

export const DEFAULT_USD_TO_IQD_RATE = 1500;

export function normalizePaymentMethod(method?: PaymentMethod): PaymentMethod {
  return method === "card" || method === "transfer" ? method : "cash";
}

export function roundAccountingAmount(value: number): number {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}

export function resolveUsdRate(rate?: number): number {
  const value = Number(rate ?? DEFAULT_USD_TO_IQD_RATE);
  if (!Number.isFinite(value) || value <= 0) throw new Error("نرخی گۆڕینەوەی دۆلار دروست نییە");
  return roundAccountingAmount(value);
}

export function convertCurrencyToIQD(amount: number, currency: Currency, rate?: number): number {
  if (!Number.isFinite(amount) || amount < 0) throw new Error("بڕی پارە دروست نییە");
  return currency === "USD" ? Math.round(amount * resolveUsdRate(rate)) : roundAccountingAmount(amount);
}

export function convertIQDToCurrency(amountIQD: number, currency: Currency, rate?: number): number {
  if (!Number.isFinite(amountIQD) || amountIQD < 0) throw new Error("بڕی دینار دروست نییە");
  return currency === "USD"
    ? Math.round((amountIQD / resolveUsdRate(rate) + Number.EPSILON) * 100) / 100
    : roundAccountingAmount(amountIQD);
}

export function settlementRoundingToleranceIQD(currency: Currency, rate?: number): number {
  return currency === "USD" ? roundAccountingAmount(resolveUsdRate(rate) / 200) : 0.001;
}

export function calculateDiscountedSale(subtotalIQD: number, discountIQD: number) {
  if (!Number.isFinite(subtotalIQD) || subtotalIQD < 0) throw new Error("کۆی فرۆشتن دروست نییە");
  if (!Number.isFinite(discountIQD) || discountIQD < 0) throw new Error("داشکاندن دروست نییە");
  const subtotal = roundAccountingAmount(subtotalIQD);
  const discount = roundAccountingAmount(discountIQD);
  if (discount > subtotal) throw new Error("داشکاندن نابێت لە کۆی کاڵاکان زیاتر بێت");
  return { subtotalIQD: subtotal, discountIQD: discount, totalIQD: roundAccountingAmount(subtotal - discount) };
}

export function allocateReturnDiscount(input: {
  saleSubtotalIQD: number;
  saleDiscountIQD: number;
  grossReturnIQD: number;
  priorDiscountIQD: number;
  isFinalReturn: boolean;
}) {
  const sale = calculateDiscountedSale(input.saleSubtotalIQD, input.saleDiscountIQD);
  if (!Number.isFinite(input.grossReturnIQD) || input.grossReturnIQD < 0 || input.grossReturnIQD > sale.subtotalIQD) throw new Error("کۆی گەڕاوە دروست نییە");
  if (!Number.isFinite(input.priorDiscountIQD) || input.priorDiscountIQD < 0 || input.priorDiscountIQD > sale.discountIQD) throw new Error("داشکاندنی پێشووی گەڕاوە دروست نییە");
  const remainingDiscount = roundAccountingAmount(sale.discountIQD - input.priorDiscountIQD);
  const proportional = sale.subtotalIQD > 0
    ? roundAccountingAmount(sale.discountIQD * input.grossReturnIQD / sale.subtotalIQD)
    : 0;
  const discountImpactIQD = input.isFinalReturn ? remainingDiscount : Math.min(remainingDiscount, proportional);
  return {
    grossTotalIQD: roundAccountingAmount(input.grossReturnIQD),
    discountImpactIQD,
    totalIQD: roundAccountingAmount(input.grossReturnIQD - discountImpactIQD),
  };
}

export interface SettlementCashMovement {
  direction: "in" | "out";
  amountIQD: number;
  paymentMethod?: PaymentMethod;
  currency?: Currency;
  amountOriginal?: number;
  exchangeRateIQDPerUSD?: number;
}

export function settlementCurrency(entry: SettlementCashMovement): Currency {
  return entry.currency === "USD" ? "USD" : "IQD";
}

export function settlementOriginalAmount(entry: SettlementCashMovement): number {
  return entry.amountOriginal ?? convertIQDToCurrency(entry.amountIQD, settlementCurrency(entry), entry.exchangeRateIQDPerUSD);
}

export function calculateCurrencyDrawer(openingIQD: number, openingUSD: number, entries: SettlementCashMovement[]) {
  let cashInIQD = 0;
  let cashOutIQD = 0;
  let cashInUSD = 0;
  let cashOutUSD = 0;
  for (const entry of entries) {
    if (normalizePaymentMethod(entry.paymentMethod) !== "cash") continue;
    const original = settlementOriginalAmount(entry);
    if (settlementCurrency(entry) === "USD") {
      if (entry.direction === "in") cashInUSD += original;
      else cashOutUSD += original;
    } else if (entry.direction === "in") {
      cashInIQD += original;
    } else {
      cashOutIQD += original;
    }
  }
  cashInIQD = roundAccountingAmount(cashInIQD);
  cashOutIQD = roundAccountingAmount(cashOutIQD);
  cashInUSD = Math.round((cashInUSD + Number.EPSILON) * 100) / 100;
  cashOutUSD = Math.round((cashOutUSD + Number.EPSILON) * 100) / 100;
  return {
    cashInIQD,
    cashOutIQD,
    expectedCashIQD: roundAccountingAmount(openingIQD + cashInIQD - cashOutIQD),
    cashInUSD,
    cashOutUSD,
    expectedCashUSD: Math.round((openingUSD + cashInUSD - cashOutUSD + Number.EPSILON) * 100) / 100,
  };
}

export interface JournalAmountLine {
  debitIQD: number;
  creditIQD: number;
}

export function calculateBalancedJournalTotals(lines: JournalAmountLine[]) {
  if (lines.length < 2) throw new Error("تۆماری ژمێریاری لانیکەم دوو ڕیزی پێویستە");
  if (lines.some((line) => line.debitIQD < 0 || line.creditIQD < 0 || (line.debitIQD > 0 && line.creditIQD > 0))) {
    throw new Error("ڕیزی Debit/Credit دروست نییە");
  }
  const debitTotalIQD = roundAccountingAmount(lines.reduce((sum, line) => sum + line.debitIQD, 0));
  const creditTotalIQD = roundAccountingAmount(lines.reduce((sum, line) => sum + line.creditIQD, 0));
  if (Math.abs(debitTotalIQD - creditTotalIQD) > 0.001) throw new Error("تۆماری ژمێریاری هاوسەنگ نییە");
  return { debitTotalIQD, creditTotalIQD };
}
