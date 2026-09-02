import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { config } from "../config.js";
import { evaluateGate } from "../gate.js";
import { ledger, type GateCheck } from "../ledger.js";
import { log, logError } from "../log.js";
import type { PaymentProvider } from "../payments.js";
import { certificates, findCredential, users } from "../store.js";
import { agentRuns } from "./agent.js";
import type { CartLine } from "../agent/tools.js";

const CartSchema = z.object({
  sku: z.string(),
  name: z.string(),
  merchant: z.string(),
  priceMinorUnits: z.number().int().nonnegative(),
  currency: z.literal("INR"),
  quantity: z.number().int().positive(),
});
const CheckoutSchema = z.object({
  intentId: z.string().uuid(),
  /** Optional explicit cart; defaults to the latest agent run's finalCart for this intent. */
  cart: CartSchema.optional(),
});

export function createCheckoutRouter(provider: PaymentProvider) {
  const router = Router();

  router.post("/", async (req, res) => {
    const parsed = CheckoutSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "intentId (uuid) required", issues: parsed.error.flatten() });
    const { intentId } = parsed.data;
    const gateOff = String(req.query.gate ?? "on").toLowerCase() === "off";
    const cart: CartLine | null = parsed.data.cart ?? agentRuns.get(intentId)?.finalCart ?? null;
    const cert = certificates.get(intentId);
    const t0 = Date.now();

    log("GATE", `checkout requested (gate ${gateOff ? "OFF" : "ON"})`, {
      intentId,
      cart: cart ? `${cart.quantity}× ${cart.sku} @ ${cart.priceMinorUnits}` : null,
    });

    // ---------------------------------------------------------------- gate OFF: unfenced
    if (gateOff) {
      if (!cart) return res.status(400).json({ error: "no cart to check out" });
      const amount = cart.priceMinorUnits * cart.quantity;
      const checks: GateCheck[] = [{ name: "gate", passed: true, detail: "verification gate disabled — no checks performed" }];
      try {
        const order = await provider.createOrder({
          amountMinorUnits: amount,
          currency: cart.currency,
          receipt: `unfenced_${intentId.slice(0, 8)}_${randomUUID().slice(0, 8)}`,
          notes: { intentId, sku: cart.sku, gate: "off" },
        });
        const entry = ledger.append({ intentId, computedHash: null, matchedCertHash: cert?.hash ?? null, checks, decision: "ALLOWED", gate: "off", timestamp: Date.now(), orderId: order.id, amountMinorUnits: amount });
        log("GATE", "⚠ ALLOWED (unfenced) — order created without verification", { intentId, orderId: order.id, amount, ledgerSeq: entry.seq });
        return res.json({ decision: "ALLOWED", gate: "off", checks, razorpayOrder: order, cart, ledger: { seq: entry.seq, hash: entry.hash } });
      } catch (err) {
        logError("GATE", "payment provider error (unfenced)", err);
        checks.push({ name: "payment_provider", passed: false, detail: "payment provider error" });
        const entry = ledger.append({ intentId, computedHash: null, matchedCertHash: cert?.hash ?? null, checks, decision: "BLOCKED", gate: "off", timestamp: Date.now(), orderId: null, amountMinorUnits: amount });
        return res.status(502).json({ decision: "BLOCKED", gate: "off", checks, reason: "payment provider error", cart, ledger: { seq: entry.seq, hash: entry.hash } });
      }
    }

    // ---------------------------------------------------------------- gate ON
    const user = cert && users.get(cert.intent.userId);
    const credential = user && cert ? findCredential(user, cert.credentialID) : undefined;
    const usedNonces = new Set<string>();
    for (const [id, other] of certificates) if (id !== intentId && other.consumedAt !== null) usedNonces.add(other.intent.nonce);

    const result = await evaluateGate({ cert, cart, publicKey: credential?.publicKey, usedNonces, rpID: config.rpID, origin: config.expectedOrigin });
    for (const c of result.checks) log("GATE", `${c.passed ? "✓" : "✗"} ${c.name}: ${c.detail.slice(0, 200)}`);

    if (result.decision === "BLOCKED") {
      const entry = ledger.append({ intentId, computedHash: result.computedHash, matchedCertHash: result.matchedCertHash, checks: result.checks, decision: "BLOCKED", gate: "on", timestamp: Date.now(), orderId: null, amountMinorUnits: result.amountMinorUnits });
      const failed = result.checks.find((c) => !c.passed);
      log("GATE", "■ BLOCKED", { intentId, failedCheck: failed?.name, ms: Date.now() - t0, ledgerSeq: entry.seq });
      return res.status(403).json({ decision: "BLOCKED", gate: "on", checks: result.checks, reason: failed?.detail, cart, intent: cert?.intent ?? null, ledger: { seq: entry.seq, hash: entry.hash } });
    }

    // All checks passed. Consume BEFORE touching the payment provider (race protection).
    const c = cert!;
    c.consumedAt = Date.now();
    c.status = "consumed";
    log("GATE", "certificate consumed; contacting payment provider", { intentId, provider: provider.name, amount: result.amountMinorUnits });

    try {
      const order = await provider.createOrder({
        amountMinorUnits: result.amountMinorUnits!,
        currency: cart!.currency,
        receipt: `cia_${intentId.slice(0, 8)}_${c.hash.slice(0, 16)}`,
        notes: { intentId, intentHash: c.hash, sku: cart!.sku, credentialID: c.credentialID },
      });
      const checks = [...result.checks, { name: "payment_provider", passed: true, detail: `${provider.name} order ${order.id} for ${order.amount} ${order.currency}` }];
      const entry = ledger.append({ intentId, computedHash: result.computedHash, matchedCertHash: result.matchedCertHash, checks, decision: "ALLOWED", gate: "on", timestamp: Date.now(), orderId: order.id, amountMinorUnits: result.amountMinorUnits });
      log("GATE", "■ ALLOWED — human-verified order created", { intentId, orderId: order.id, amount: order.amount, ms: Date.now() - t0, ledgerSeq: entry.seq });
      return res.json({ decision: "ALLOWED", gate: "on", checks, razorpayOrder: order, cart, intent: c.intent, certificateHash: c.hash, ledger: { seq: entry.seq, hash: entry.hash } });
    } catch (err) {
      // Never partially proceed: release the certificate so a retry is possible, and record the block.
      logError("GATE", "payment provider error", err);
      c.consumedAt = null;
      c.status = "active";
      const checks = [...result.checks, { name: "payment_provider", passed: false, detail: "payment provider error" }];
      const entry = ledger.append({ intentId, computedHash: result.computedHash, matchedCertHash: result.matchedCertHash, checks, decision: "BLOCKED", gate: "on", timestamp: Date.now(), orderId: null, amountMinorUnits: result.amountMinorUnits });
      return res.status(502).json({ decision: "BLOCKED", gate: "on", checks, reason: "payment provider error", cart, intent: c.intent, ledger: { seq: entry.seq, hash: entry.hash } });
    }
  });

  return router;
}
