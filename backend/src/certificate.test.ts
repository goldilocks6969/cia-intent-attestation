import { describe, it, expect } from "vitest";
import { hashIntent, type Intent } from "@cia/shared";
import { isoBase64URL, isoUint8Array } from "@simplewebauthn/server/helpers";
import { challengeForHash, verifyCertificate, type VerifiableCertificate } from "./certificate.js";
import { makeFakeCert as makeCert } from "./test/fakeCert.js";

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
