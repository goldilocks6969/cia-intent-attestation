import { describe, it, expect } from "vitest";
import type { Intent } from "@cia/shared";
import { evaluateGate } from "./gate.js";
import { makeFakeCert } from "./test/fakeCert.js";
import type { CartLine } from "./agent/tools.js";
import { MockProvider, FailingProvider } from "./payments.js";

const now = 1_800_000_100_000;
const intent: Intent = {
  userId: "alice", merchant: "Amazon.in", category: "electronics", itemDescription: "wireless headphones",
  maxPriceMinorUnits: 199990, currency: "INR", quantity: 1, nonce: "nonce-1", issuedAt: now - 1000, expiresAt: now + 600_000,
};
const headphones: CartLine = { sku: "SKU-HP-001", name: "Sony WH-CH520 Wireless Headphones", merchant: "Amazon.in", priceMinorUnits: 189900, currency: "INR", quantity: 1 };
const tv: CartLine = { sku: "SKU-EVIL-TX", name: "65-inch Smart TV", merchant: "Amazon.in", priceMinorUnits: 4999000, currency: "INR", quantity: 1 };
const base = { usedNonces: new Set<string>(), now, rpID: "localhost", origin: "http://localhost:5173" };

function failedCheck(r: { checks: { name: string; passed: boolean }[] }) {
  return r.checks.find((c) => !c.passed)?.name;
}

describe("verification gate", () => {
  it("ALLOWS a clean cart that matches the signed intent and creates a (mock) order", async () => {
    const { cert, cose } = makeFakeCert(intent);
    const r = await evaluateGate({ ...base, cert, cart: headphones, publicKey: cose });
    expect(r.checks.every((c) => c.passed)).toBe(true);
    expect(r.decision).toBe("ALLOWED");
    expect(r.checks.map((c) => c.name)).toEqual([
      "certificate_present", "certificate_unexpired", "certificate_unconsumed", "cart_present",
      "txn_canonicalization", "intent_hash_binding", "hash_match", "constraints", "signature",
    ]);
    expect(r.amountMinorUnits).toBe(189900);
    const order = await new MockProvider().createOrder({ amountMinorUnits: r.amountMinorUnits!, currency: "INR", receipt: "r" });
    expect(order.id).toMatch(/^order_mock_/);
    expect(order.amount).toBe(189900);
  });

  it("BLOCKS the hijacked TV cart on hash_match (price over cap + wrong item) and short-circuits", async () => {
    const { cert, cose } = makeFakeCert(intent);
    const r = await evaluateGate({ ...base, cert, cart: tv, publicKey: cose });
    expect(r.decision).toBe("BLOCKED");
    expect(failedCheck(r)).toBe("hash_match");
    const detail = r.checks.find((c) => c.name === "hash_match")!.detail;
    expect(detail).toMatch(/total 4999000 > cap 199990/);
    expect(detail).toMatch(/does not match approved/);
    expect(r.checks.some((c) => c.name === "signature")).toBe(false); // short-circuited
  });

  it("BLOCKS a modified price: same item, total one paisa over the cap", async () => {
    const { cert, cose } = makeFakeCert(intent);
    const r = await evaluateGate({ ...base, cert, cart: { ...headphones, priceMinorUnits: 199991 }, publicKey: cose });
    expect(r.decision).toBe("BLOCKED");
    expect(failedCheck(r)).toBe("hash_match");
    // and exactly at the cap is fine
    const ok = await evaluateGate({ ...base, cert, cart: { ...headphones, priceMinorUnits: 199990 }, publicKey: cose });
    expect(ok.decision).toBe("ALLOWED");
    expect(ok.checks.find((c) => c.name === "hash_match")!.detail).toMatch(/exact hash match|⊆/);
  });

  it("BLOCKS an expired certificate", async () => {
    const { cert, cose } = makeFakeCert(intent);
    const r = await evaluateGate({ ...base, cert, cart: headphones, publicKey: cose, now: intent.expiresAt + 1 });
    expect(r.decision).toBe("BLOCKED");
    expect(failedCheck(r)).toBe("certificate_unexpired");
    expect(r.checks).toHaveLength(2);
  });

  it("BLOCKS a consumed certificate and a reused nonce", async () => {
    const { cert, cose } = makeFakeCert(intent);
    const consumed = { ...cert, consumedAt: now - 10, status: "consumed" as const };
    const r1 = await evaluateGate({ ...base, cert: consumed, cart: headphones, publicKey: cose });
    expect(r1.decision).toBe("BLOCKED");
    expect(failedCheck(r1)).toBe("certificate_unconsumed");

    const r2 = await evaluateGate({ ...base, cert, cart: headphones, publicKey: cose, usedNonces: new Set([intent.nonce]) });
    expect(r2.decision).toBe("BLOCKED");
    expect(failedCheck(r2)).toBe("constraints");
    expect(r2.checks.find((c) => c.name === "constraints")!.detail).toMatch(/nonce/);
  });

  it("BLOCKS a tampered certificate: edited intent, forged signature, wrong key", async () => {
    const { cert, cose } = makeFakeCert(intent);
    // (a) intent edited after signing → hash binding breaks
    const edited = { ...cert, intent: { ...intent, maxPriceMinorUnits: 9_999_999 } };
    const ra = await evaluateGate({ ...base, cert: edited, cart: tv, publicKey: cose });
    expect(failedCheck(ra)).toBe("intent_hash_binding");
    // (b) signature bytes flipped
    const sigBytes = Buffer.from(cert.signature, "base64url");
    sigBytes[sigBytes.length - 1] ^= 0xff;
    const forged = { ...cert, signature: sigBytes.toString("base64url") };
    const rb = await evaluateGate({ ...base, cert: forged, cart: headphones, publicKey: cose });
    expect(rb.decision).toBe("BLOCKED");
    expect(failedCheck(rb)).toBe("signature");
    // (c) verified against a different credential's key
    const other = makeFakeCert(intent);
    const rc = await evaluateGate({ ...base, cert, cart: headphones, publicKey: other.cose });
    expect(failedCheck(rc)).toBe("signature");
    // (d) missing key
    const rd = await evaluateGate({ ...base, cert, cart: headphones, publicKey: undefined });
    expect(failedCheck(rd)).toBe("signature");
  });

  it("BLOCKS a merchant swap and a quantity change even when under budget", async () => {
    const { cert, cose } = makeFakeCert(intent);
    const rm = await evaluateGate({ ...base, cert, cart: { ...headphones, merchant: "Flipkart" }, publicKey: cose });
    expect(rm.checks.find((c) => c.name === "hash_match")!.detail).toMatch(/merchant/);
    const rq = await evaluateGate({ ...base, cert, cart: { ...headphones, priceMinorUnits: 50000, quantity: 2 }, publicKey: cose });
    expect(rq.checks.find((c) => c.name === "hash_match")!.detail).toMatch(/quantity 2 ≠ 1/);
  });

  it("payment provider failure surfaces as an error the route turns into BLOCKED", async () => {
    await expect(new FailingProvider().createOrder()).rejects.toThrow(/outage/);
  });
});
