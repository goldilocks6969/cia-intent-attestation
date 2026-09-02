import { describe, it, expect } from "vitest";
import { createHash, createSign, generateKeyPairSync } from "node:crypto";
import { hashIntent, type Intent } from "@cia/shared";
import { isoBase64URL, isoCBOR, isoUint8Array } from "@simplewebauthn/server/helpers";
import { challengeForHash, verifyCertificate, type VerifiableCertificate } from "./certificate.js";
import { toBytes } from "./bytes.js";

// --- helpers to fabricate a WebAuthn assertion with a software P-256 key ---------------------

function coseFromP256(pub: Buffer /* uncompressed 65 bytes */): Uint8Array {
  const x = pub.subarray(1, 33);
  const y = pub.subarray(33, 65);
  const cose = new Map<number, number | Uint8Array<ArrayBuffer>>([
    [1, 2], // kty: EC2
    [3, -7], // alg: ES256
    [-1, 1], // crv: P-256
    [-2, toBytes(x)],
    [-3, toBytes(y)],
  ]);
  return isoCBOR.encode(cose as never);
}

function authData(rpID: string, flags: number, counter = 1): Uint8Array {
  const rpIdHash = createHash("sha256").update(rpID).digest();
  const buf = Buffer.alloc(37);
  rpIdHash.copy(buf, 0);
  buf[32] = flags;
  buf.writeUInt32BE(counter, 33);
  return toBytes(buf);
}

function makeCert(intent: Intent, opts: { rpID?: string; origin?: string; flags?: number; challenge?: string } = {}) {
  const rpID = opts.rpID ?? "localhost";
  const origin = opts.origin ?? "http://localhost:5173";
  const hash = hashIntent(intent);
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const rawPub = publicKey.export({ format: "jwk" });
  const uncompressed = Buffer.concat([
    Buffer.from([4]),
    Buffer.from(rawPub.x as string, "base64url"),
    Buffer.from(rawPub.y as string, "base64url"),
  ]);
  const cose = coseFromP256(uncompressed);

  const clientData = Buffer.from(
    JSON.stringify({ type: "webauthn.get", challenge: opts.challenge ?? challengeForHash(hash), origin, crossOrigin: false }),
  );
  const ad = authData(rpID, opts.flags ?? 0b0000_0101 /* UP | UV */);
  const clientDataHash = createHash("sha256").update(clientData).digest();
  const signer = createSign("SHA256");
  signer.update(Buffer.concat([Buffer.from(ad), clientDataHash]));
  const signature = signer.sign({ key: privateKey, dsaEncoding: "der" });

  const cert: VerifiableCertificate = {
    intent,
    hash,
    signature: isoBase64URL.fromBuffer(toBytes(signature)),
    authenticatorData: isoBase64URL.fromBuffer(toBytes(ad)),
    clientDataJSON: isoBase64URL.fromBuffer(toBytes(clientData)),
  };
  return { cert, hash, cose };
}

const intent: Intent = {
  userId: "alice",
  merchant: "Amazon.in",
  category: "electronics",
  itemDescription: "USB-C cable",
  maxPriceMinorUnits: 199990,
  currency: "INR",
  quantity: 1,
  nonce: "5a3e2c0e-4c1e-4f7a-9c2f-0b1d2e3f4a5b",
  issuedAt: 1_800_000_000_000,
  expiresAt: 1_800_000_600_000,
};

describe("verifyCertificate", () => {
  it("accepts a well-formed certificate signed over the intent hash", async () => {
    const { cert, hash, cose } = makeCert(intent);
    const r = await verifyCertificate(cert, hash, cose, { rpID: "localhost", origin: "http://localhost:5173" });
    expect(r.reasons).toEqual([]);
    expect(r.valid).toBe(true);
    expect(r.details.challengeHex).toBe(hash);
    expect(r.details.userVerified).toBe(true);
    expect(r.details.signatureValid).toBe(true);
  });

  it("rejects when the intent was tampered after signing", async () => {
    const { cert, hash, cose } = makeCert(intent);
    const tampered = { ...cert, intent: { ...intent, maxPriceMinorUnits: 999999 } };
    const r = await verifyCertificate(tampered, hash, cose);
    expect(r.valid).toBe(false);
    expect(r.reasons.join()).toMatch(/re-hashed intent/);
  });

  it("rejects a signature from a different key", async () => {
    const { cert, hash } = makeCert(intent);
    const { cose: otherKey } = makeCert(intent);
    const r = await verifyCertificate(cert, hash, otherKey);
    expect(r.valid).toBe(false);
    expect(r.reasons.join()).toMatch(/signature/);
  });

  it("rejects wrong rpID, wrong origin, and missing UV flag", async () => {
    const { cert, hash, cose } = makeCert(intent);
    expect((await verifyCertificate(cert, hash, cose, { rpID: "evil.example" })).reasons.join()).toMatch(/rpIdHash/);
    expect((await verifyCertificate(cert, hash, cose, { origin: "https://evil.example" })).reasons.join()).toMatch(/origin/);
    const noUv = makeCert(intent, { flags: 0b0000_0001 });
    expect((await verifyCertificate(noUv.cert, noUv.hash, noUv.cose)).reasons.join()).toMatch(/user-verified/);
  });

  it("rejects a challenge that does not encode the expected hash", async () => {
    const { cert, hash, cose } = makeCert(intent, { challenge: isoBase64URL.fromUTF8String("deadbeef") });
    const r = await verifyCertificate(cert, hash, cose);
    expect(r.valid).toBe(false);
    expect(r.reasons.join()).toMatch(/challenge/);
    expect(isoUint8Array.toUTF8String(isoBase64URL.toBuffer(challengeForHash(hash)))).toBe(hash);
  });
});
