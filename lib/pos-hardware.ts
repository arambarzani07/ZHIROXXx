"use client";

type SerialWriter = {
  write(data: Uint8Array): Promise<void>;
  releaseLock(): void;
};

type SerialPortLike = {
  readable: unknown | null;
  writable: { getWriter(): SerialWriter } | null;
  open(options: { baudRate: number }): Promise<void>;
};

type SerialApi = {
  getPorts(): Promise<SerialPortLike[]>;
  requestPort(): Promise<SerialPortLike>;
};

let activePort: SerialPortLike | null = null;

function serialApi(): SerialApi | null {
  if (typeof navigator === "undefined") return null;
  return (navigator as Navigator & { serial?: SerialApi }).serial ?? null;
}

export function cashDrawerIsSupported() {
  return serialApi() !== null;
}

async function openPort(port: SerialPortLike) {
  if (!port.readable && !port.writable) await port.open({ baudRate: 9600 });
  if (!port.writable) throw new Error("CASH_DRAWER_PORT_NOT_WRITABLE");
  activePort = port;
  return port;
}

export async function connectCashDrawer() {
  const serial = serialApi();
  if (!serial) throw new Error("CASH_DRAWER_UNSUPPORTED");
  return openPort(await serial.requestPort());
}

async function authorizedPort() {
  if (activePort?.writable) return activePort;
  const serial = serialApi();
  if (!serial) throw new Error("CASH_DRAWER_UNSUPPORTED");
  const [port] = await serial.getPorts();
  if (!port) throw new Error("CASH_DRAWER_NOT_CONNECTED");
  return openPort(port);
}

export async function pulseCashDrawer() {
  const port = await authorizedPort();
  const writer = port.writable!.getWriter();
  try {
    await writer.write(new Uint8Array([0x1b, 0x70, 0x00, 0x32, 0xfa]));
  } finally {
    writer.releaseLock();
  }
}
