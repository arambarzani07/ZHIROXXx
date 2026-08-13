export type BarcodeKind = "gtin" | "internal" | "invalid";

export type BarcodeInspection = {
  normalized: string;
  kind: BarcodeKind;
  valid: boolean;
  message: string;
};

export function normalizeBarcodeInput(value: string): string {
  const arabic = "٠١٢٣٤٥٦٧٨٩";
  const persian = "۰۱۲۳۴۵۶۷۸۹";
  return value
    .trim()
    .replace(/[٠-٩]/g, (digit) => String(arabic.indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String(persian.indexOf(digit)))
    .replace(/[\s-]+/g, "");
}

export function hasValidGtinCheckDigit(value: string): boolean {
  const barcode = normalizeBarcodeInput(value);
  if (![8, 12, 13, 14].includes(barcode.length) || !/^\d+$/.test(barcode)) return false;
  const digits = [...barcode].map(Number);
  const checkDigit = digits.pop()!;
  const sum = digits
    .reverse()
    .reduce((total, digit, index) => total + digit * (index % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === checkDigit;
}

export function inspectBarcode(value: string): BarcodeInspection {
  const normalized = normalizeBarcodeInput(value);
  if (!/^\d{3,24}$/.test(normalized)) {
    return { normalized, kind: "invalid", valid: false, message: "بارکۆد دەبێت تەنها ٣ تا ٢٤ ژمارە بێت" };
  }
  if ([8, 12, 13, 14].includes(normalized.length)) {
    const valid = hasValidGtinCheckDigit(normalized);
    return {
      normalized,
      kind: "gtin",
      valid,
      message: valid ? "GTIN/EAN پەسەندکرا" : "check-digit ـی GTIN/EAN دروست نییە",
    };
  }
  return { normalized, kind: "internal", valid: true, message: "بارکۆدی ناوخۆی فرۆشگا" };
}

export function parseScaleBarcode(value: string, options: {
  prefix: string;
  itemDigits: number;
  decimals: number;
}): { raw: string; itemCode: string; shortCode: string; quantity: number } | null {
  const raw = normalizeBarcodeInput(value);
  const prefix = normalizeBarcodeInput(options.prefix);
  if (!prefix || !raw.startsWith(prefix) || raw.length <= options.itemDigits + 1) return null;
  const itemCode = raw.slice(0, options.itemDigits);
  const measured = raw.slice(options.itemDigits, -1);
  if (!/^\d+$/.test(itemCode) || !/^\d+$/.test(measured)) return null;
  const quantity = Number(measured) / (10 ** options.decimals);
  if (!Number.isFinite(quantity) || quantity <= 0) return null;
  return { raw, itemCode, shortCode: itemCode.slice(prefix.length), quantity };
}
