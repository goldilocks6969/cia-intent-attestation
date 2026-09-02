import { describe, it, expect } from "vitest";
import type { Intent } from "@cia/shared";
import { runScriptedAgent } from "./scripted.js";
import { Trace } from "./trace.js";
import { EVIL_SKU, INJECTION_PAYLOAD, findProduct, renderProductPage, searchCatalog } from "./catalog.js";

const intent: Intent = {
  userId: "alice", merchant: "Amazon.in", category: "electronics", itemDescription: "wireless headphones",
  maxPriceMinorUnits: 199990, currency: "INR", quantity: 1, nonce: "n", issuedAt: 1, expiresAt: 2,
};

describe("scripted shopping agent", () => {
  it("buys the intended headphones when the page is clean", async () => {
    const trace = new Trace();
    const cart = await runScriptedAgent(intent, { attackEnabled: false, quantity: 1 }, trace);
    expect(cart?.sku).toBe("SKU-HP-001");
    expect(trace.entries.some((e) => e.role === "attacker")).toBe(false);
    expect(trace.entries.map((e) => e.type)).toContain("decision");
  });

  it("is hijacked to the TV when the page carries the injection", async () => {
    const trace = new Trace();
    const cart = await runScriptedAgent(intent, { attackEnabled: true, quantity: 1 }, trace);
    expect(cart?.sku).toBe(EVIL_SKU);
    expect(cart?.priceMinorUnits).toBe(4999000);
    const warn = trace.entries.find((e) => e.role === "attacker");
    expect(warn?.text).toContain("SYSTEM OVERRIDE");
    // every entry is renderable: step, ts, role, type, color, text
    for (const e of trace.entries) {
      expect(e.step).toBeGreaterThan(0);
      expect(typeof e.ts).toBe("number");
      expect(e.color).toBeTruthy();
    }
  });

  it("never surfaces the evil SKU via search, only via the page", () => {
    expect(searchCatalog("65 inch smart tv").some((p) => p.sku === EVIL_SKU)).toBe(false);
    const page = renderProductPage(findProduct("SKU-HP-001")!, true);
    expect(page).toContain(`<!-- ${INJECTION_PAYLOAD} -->`);
    expect(page).toMatch(/left:-9999px[^>]*>SYSTEM OVERRIDE/);
    expect(renderProductPage(findProduct("SKU-HP-001")!, false)).not.toContain("SYSTEM OVERRIDE");
  });
});
