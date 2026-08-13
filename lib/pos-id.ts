type IdCryptoSource = {
  randomUUID?: () => string;
  getRandomValues?: (array: Uint8Array) => Uint8Array;
};

let fallbackSequence = 0;

function uuidFromBytes(bytes: Uint8Array): string {
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function createBrowserSafeUuid(
  randomSource: IdCryptoSource | null = typeof globalThis.crypto === "undefined" ? null : globalThis.crypto,
): string {
  if (typeof randomSource?.randomUUID === "function") return randomSource.randomUUID();

  const bytes = new Uint8Array(16);
  if (typeof randomSource?.getRandomValues === "function") {
    randomSource.getRandomValues(bytes);
  } else {
    fallbackSequence = (fallbackSequence + 1) >>> 0;
    const timestamp = Date.now() >>> 0;
    for (let index = 0; index < bytes.length; index += 1) {
      const shift = (index % 4) * 8;
      bytes[index] = Math.floor(Math.random() * 256) ^ ((timestamp >>> shift) & 0xff) ^ ((fallbackSequence >>> shift) & 0xff);
    }
  }

  return uuidFromBytes(bytes);
}

export function buildOfficialReceiptNo(input: {
  prefix: "F" | "K" | "W" | "D";
  terminalCode: string;
  sequence: number;
  date?: Date;
}): string {
  const date = input.date ?? new Date();
  const day = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
  const terminal = input.terminalCode.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4).padEnd(4, "0");
  const sequence = Math.max(1, Math.trunc(input.sequence)).toString().padStart(6, "0");
  return `ZX-${input.prefix}-${day}-${terminal}-${sequence}`;
}
