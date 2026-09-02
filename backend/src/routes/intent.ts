import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { generateAuthenticationOptions, verifyAuthenticationResponse } from "@simplewebauthn/server";
import { DEFAULT_INTENT_TTL_MS, IntentSchema, canonicalIntent, hashIntent, verifyConstraints } from "@cia/shared";
import { config } from "../config.js";
import { log, logError } from "../log.js";
import { challengeForHash, verifyCertificate } from "../certificate.js";
import {
  certificates,
  findCredential,
  pendingIntents,
  sweepPending,
  usedNonces,
  users,
  type SignedIntentCertificate,
} from "../store.js";

export const intentRouter = Router();

/** Client-supplied part of the intent. Everything else is set server-side. */
const IntentRequestSchema = z.object({
  userId: z.string().trim().min(1),
  merchant: z.string().trim().min(1),
  category: z.string().trim().min(1),
  itemDescription: z.string().trim().default(""),
  maxPriceMinorUnits: z.number().int().nonnegative(),
  quantity: z.number().int().positive().default(1),
  /** Optional override of the TTL in ms (capped at 1h). */
  ttlMs: z.number().int().positive().max(60 * 60 * 1000).optional(),
});

// POST /api/intent — build, canonicalize, hash, and issue an auth challenge bound to the hash.
intentRouter.post("/", async (req, res) => {
  sweepPending();
  const parsed = IntentRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    log("INTENT", "rejected malformed intent", { issues: parsed.error.issues.map((i) => i.path.join(".") + ": " + i.message) });
    return res.status(400).json({ error: "invalid intent", issues: parsed.error.flatten() });
  }
  const body = parsed.data;

  const user = users.get(body.userId);
  if (!user || user.credentials.length === 0) {
    log("INTENT", "user has no registered credential", { userId: body.userId });
    return res.status(404).json({ error: "user has no registered passkey — register first" });
  }

  const issuedAt = Date.now();
  const candidate = {
    userId: body.userId,
    merchant: body.merchant,
    category: body.category,
    itemDescription: body.itemDescription,
    maxPriceMinorUnits: body.maxPriceMinorUnits,
    currency: "INR" as const,
    quantity: body.quantity,
    nonce: randomUUID(),
    issuedAt,
    expiresAt: issuedAt + (body.ttlMs ?? DEFAULT_INTENT_TTL_MS),
  };
  const intentParsed = IntentSchema.safeParse(candidate);
  if (!intentParsed.success) {
    return res.status(400).json({ error: "invalid intent", issues: intentParsed.error.flatten() });
  }
  const intent = intentParsed.data;

  let canonical: string;
  let hash: string;
  try {
    canonical = canonicalIntent(intent);
    hash = hashIntent(intent);
  } catch (err) {
    logError("INTENT", "canonicalization failed", err);
    return res.status(400).json({ error: (err as Error).message });
  }

  const intentId = randomUUID();
  const options = await generateAuthenticationOptions({
    rpID: config.rpID,
    challenge: hash, // hex string → utf8 bytes → base64url in options
    userVerification: "required",
    allowCredentials: user.credentials.map((c) => ({ id: c.id, transports: c.transports })),
    timeout: 120_000,
  });
  const expectedChallenge = challengeForHash(hash);
  if (options.challenge !== expectedChallenge) {
    // Defensive: if the library ever changes its string handling we must know immediately.
    logError("INTENT", "challenge encoding mismatch", new Error(`${options.challenge} != ${expectedChallenge}`));
    return res.status(500).json({ error: "internal challenge encoding error" });
  }

  pendingIntents.set(intentId, { intentId, userId: intent.userId, intent, hash, expectedChallenge, createdAt: issuedAt });

  log("INTENT", "canonicalized", { intentId, canonical });
  log("INTENT", "hashed + challenge issued", {
    intentId,
    userId: intent.userId,
    hash,
    challenge: options.challenge,
    allowCredentials: options.allowCredentials?.map((c) => c.id),
    expiresAt: new Date(intent.expiresAt).toISOString(),
  });

  return res.json({ intentId, intent, canonical, hash, options });
});

const AttestSchema = z.object({ intentId: z.string().uuid(), response: z.any() });

// POST /api/intent/attest — verify the assertion and mint the Signed Intent Certificate.
intentRouter.post("/attest", async (req, res) => {
  const parsed = AttestSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "intentId and response required" });
  const { intentId, response } = parsed.data;

  const pending = pendingIntents.get(intentId);
  pendingIntents.delete(intentId); // one-time use, success or fail
  if (!pending) {
    log("ATTEST", "no pending intent (already used, expired, or unknown)", { intentId });
    return res.status(400).json({ error: "no pending intent for this id — challenges are single-use" });
  }
  log("ATTEST", "received assertion", { intentId, credentialID: response?.id, hash: pending.hash });

  if (Date.now() >= pending.intent.expiresAt) {
    log("ATTEST", "intent expired before attestation", { intentId });
    return res.status(400).json({ error: "intent expired before it was attested" });
  }

  const user = users.get(pending.userId);
  const credential = user && typeof response?.id === "string" ? findCredential(user, response.id) : undefined;
  if (!user || !credential) {
    log("ATTEST", "assertion used an unknown credential", { intentId, credentialID: response?.id });
    return res.status(400).json({ error: "assertion credential is not registered to this user" });
  }

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: pending.expectedChallenge,
      expectedOrigin: config.expectedOrigin,
      expectedRPID: config.rpID,
      credential,
      requireUserVerification: true,
    });
  } catch (err) {
    logError("ATTEST", "verifyAuthenticationResponse threw", err);
    return res.status(400).json({ error: (err as Error).message });
  }
  if (!verification.verified) {
    log("ATTEST", "✗ assertion did not verify", { intentId });
    return res.status(400).json({ error: "assertion could not be verified" });
  }
  const { authenticationInfo } = verification;
  credential.counter = authenticationInfo.newCounter;
  log("ATTEST", "✓ assertion verified", {
    intentId,
    origin: authenticationInfo.origin,
    rpID: authenticationInfo.rpID,
    userVerified: authenticationInfo.userVerified,
    counter: authenticationInfo.newCounter,
  });

  const cert: SignedIntentCertificate = {
    intentId,
    intent: pending.intent,
    hash: pending.hash,
    signature: response.response.signature,
    authenticatorData: response.response.authenticatorData,
    clientDataJSON: response.response.clientDataJSON,
    credentialID: credential.id,
    rpID: authenticationInfo.rpID,
    origin: authenticationInfo.origin,
    issuedAt: Date.now(),
    status: "active",
    consumedAt: null,
  };

  // Belt and braces: independently re-verify the certificate with the pure verifier before persisting.
  const recheck = await verifyCertificate(cert, pending.hash, credential.publicKey, {
    rpID: config.rpID,
    origin: config.expectedOrigin,
  });
  if (!recheck.valid) {
    log("VERIFY", "✗ certificate self-check failed; refusing to persist", { intentId, reasons: recheck.reasons });
    return res.status(500).json({ error: "certificate self-check failed", reasons: recheck.reasons });
  }
  log("VERIFY", "✓ certificate self-check passed", { intentId, signatureValid: recheck.details.signatureValid });

  certificates.set(intentId, cert);
  usedNonces.add(cert.intent.nonce);
  log("ATTEST", "✓ SIGNED INTENT CERTIFICATE issued", {
    intentId,
    hash: cert.hash,
    credentialID: cert.credentialID,
    status: cert.status,
    expiresAt: new Date(cert.intent.expiresAt).toISOString(),
  });

  return res.json({ certificate: cert });
});

// GET /api/intent/certificate/:id — fetch a certificate (for the viewer / later demo steps).
intentRouter.get("/certificate/:id", (req, res) => {
  const cert = certificates.get(req.params.id);
  if (!cert) return res.status(404).json({ error: "certificate not found" });
  const status = cert.status === "active" && Date.now() >= cert.intent.expiresAt ? "expired" : cert.status;
  return res.json({ certificate: { ...cert, status } });
});

// POST /api/intent/certificate/:id/verify — re-run the pure verifier against the stored public key.
intentRouter.post("/certificate/:id/verify", async (req, res) => {
  const cert = certificates.get(req.params.id);
  if (!cert) return res.status(404).json({ error: "certificate not found" });
  const user = users.get(cert.intent.userId);
  const credential = user && findCredential(user, cert.credentialID);
  if (!credential) return res.status(404).json({ error: "signing credential no longer registered" });
  const result = await verifyCertificate(cert, cert.hash, credential.publicKey, {
    rpID: config.rpID,
    origin: config.expectedOrigin,
  });
  log("VERIFY", result.valid ? "✓ certificate verified" : "✗ certificate invalid", { intentId: cert.intentId, reasons: result.reasons });
  return res.json(result);
});

const CheckSchema = z.object({
  merchant: z.string(),
  priceMinorUnits: z.number(),
  currency: z.string().default("INR"),
  quantity: z.number().int().positive().optional(),
});

// POST /api/intent/certificate/:id/check — evaluate a proposed transaction against the certificate's constraints.
intentRouter.post("/certificate/:id/check", (req, res) => {
  const cert = certificates.get(req.params.id);
  if (!cert) return res.status(404).json({ error: "certificate not found" });
  const parsed = CheckSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "merchant, priceMinorUnits, currency required" });
  // The certificate's own nonce is "used" only once it has been consumed by a payment.
  const consumed = new Set(cert.status === "consumed" ? [cert.intent.nonce] : []);
  const result = verifyConstraints(cert.intent, parsed.data, { usedNonces: consumed });
  log("VERIFY", `constraint check hard=${result.hardPass} soft=${result.softMatch}`, { intentId: cert.intentId, reasons: result.reasons });
  return res.json({ ...result, status: cert.status });
});
