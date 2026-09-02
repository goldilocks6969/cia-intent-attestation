import { createHash } from "node:crypto";

/** Node Buffers may be pool-backed; simplewebauthn's types want Uint8Array<ArrayBuffer>. */
export function toBytes(input: Uint8Array | ArrayBuffer): Uint8Array<ArrayBuffer> {
  const src = input instanceof ArrayBuffer ? new Uint8Array(input) : input;
  const out = new Uint8Array(new ArrayBuffer(src.byteLength));
  out.set(src);
  return out;
}

export function sha256Bytes(data: Uint8Array | string): Uint8Array<ArrayBuffer> {
  return toBytes(createHash("sha256").update(data).digest());
}
