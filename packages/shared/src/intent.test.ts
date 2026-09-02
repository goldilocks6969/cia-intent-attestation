import { describe, it, expect } from "vitest";
import { canonicalIntent, hashIntent, verifyConstraints, normalizeMinorUnits, type Intent } from "./index.js";

const base: Intent = {
  userId: "user-1",
  merchant: "Amazon.in",
  category: "electronics",
  itemDescription: "USB-C cable 1m",
  maxPriceMinorUnits: 199990, // ₹1,999.90
  currency: "INR",
  quantity: 1,
  nonce: "0f5d1a1e-1b2c-4d3e-9f8a-7b6c5d4e3f2a",
  issuedAt: 1_800_000_000_000,
  expiresAt: 1_800_000_600_000,
};

describe("canonicalIntent / hashIntent", () => {
  it("produces identical hash regardless of key order", () => {
    const reordered = Object.fromEntries(Object.entries(base).reverse());
    expect(canonicalIntent(reordered)).toBe(canonicalIntent(base));
    expect(hashIntent(reordered)).toBe(hashIntent(base));
    expect(hashIntent(base)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("₹1,999.90 expressed as 199990 minor units hashes identically", () => {
    // Callers must convert rupees to paise before building the intent.
    const paise = normalizeMinorUnits("1,99,990"); // Indian-format string → 199990
    expect(paise).toBe(199990);
    expect(hashIntent({ ...base, maxPriceMinorUnits: paise })).toBe(hashIntent(base));
    expect(hashIntent({ ...base, maxPriceMinorUnits: 199990 })).toBe(hashIntent(base));
    // A float rupee value is rejected rather than silently rounded.
    expect(() => hashIntent({ ...base, maxPriceMinorUnits: 1999.9 })).toThrow(/integer/);
    expect(() => hashIntent({ ...base, maxPriceMinorUnits: Number.NaN })).toThrow(/finite/);
  });

  it("a modified maxPrice produces a different hash", () => {
    expect(hashIntent({ ...base, maxPriceMinorUnits: 199991 })).not.toBe(hashIntent(base));
  });

  it("drops unknown fields and normalizes strings (trim + NFC)", () => {
    const decomposed = "Café"; // "Café" in NFD
    const composed = "Café"; // "Café" in NFC
    const a = hashIntent({ ...base, merchant: `  ${decomposed} `, extra: "ignored" });
    const b = hashIntent({ ...base, merchant: composed });
    expect(a).toBe(b);
    expect(canonicalIntent({ ...base, extra: "x" })).not.toContain("extra");
  });
});

describe("verifyConstraints", () => {
  const now = base.issuedAt + 1000;

  it("soft merchant match passes for 'Amazon.in' vs 'amazon'", () => {
    const r = verifyConstraints(base, { merchant: "amazon", priceMinorUnits: 150000, currency: "INR" }, { now });
    expect(r.hardPass).toBe(true);
    expect(r.softMatch).toBe(true);
    expect(r.reasons).toEqual([]);
  });

  it("matches www./punctuation variants and flags unrelated merchants", () => {
    expect(verifyConstraints(base, { merchant: "www.Amazon.com", priceMinorUnits: 1, currency: "INR" }, { now }).softMatch).toBe(true);
    expect(verifyConstraints(base, { merchant: "AMAZON - IN", priceMinorUnits: 1, currency: "INR" }, { now }).softMatch).toBe(true);
    const r = verifyConstraints(base, { merchant: "Flipkart", priceMinorUnits: 1, currency: "INR" }, { now });
    expect(r.softMatch).toBe(false);
    expect(r.hardPass).toBe(true);
  });

  it("fails hard when price × qty exceeds the cap", () => {
    const r = verifyConstraints(base, { merchant: "amazon", priceMinorUnits: 100000, currency: "INR", quantity: 2 }, { now });
    expect(r.hardPass).toBe(false);
    expect(r.reasons.join()).toMatch(/exceeds max/);
  });

  it("fails hard on currency mismatch, expiry, and reused nonce", () => {
    expect(verifyConstraints(base, { merchant: "amazon", priceMinorUnits: 1, currency: "USD" }, { now }).hardPass).toBe(false);
    expect(verifyConstraints(base, { merchant: "amazon", priceMinorUnits: 1, currency: "INR" }, { now: base.expiresAt }).hardPass).toBe(false);
    const r = verifyConstraints(base, { merchant: "amazon", priceMinorUnits: 1, currency: "INR" }, { now, usedNonces: new Set([base.nonce]) });
    expect(r.hardPass).toBe(false);
    expect(r.reasons.join()).toMatch(/nonce/);
  });
});
