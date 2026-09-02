type Tag = "BOOT" | "REGISTER" | "INTENT" | "ATTEST" | "VERIFY" | "STORE" | "HTTP" | "AGENT" | "GATE";

export function log(tag: Tag, message: string, data?: Record<string, unknown>) {
  const ts = new Date().toISOString();
  if (data && Object.keys(data).length) {
    console.log(`${ts} [${tag}] ${message}`, JSON.stringify(data));
  } else {
    console.log(`${ts} [${tag}] ${message}`);
  }
}

export function logError(tag: Tag, message: string, err: unknown) {
  const ts = new Date().toISOString();
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`${ts} [${tag}] ✗ ${message}: ${msg}`);
}
