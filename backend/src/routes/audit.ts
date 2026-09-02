import { Router } from "express";
import { z } from "zod";
import { ledger } from "../ledger.js";
import { certificates, pendingIntents, registrationChallenges, usedNonces, users } from "../store.js";
import { agentRuns } from "./agent.js";
import { log } from "../log.js";

export const auditRouter = Router();

// GET /api/audit — full hash chain
auditRouter.get("/", (_req, res) => {
  res.json({ length: ledger.length, head: ledger.head(), chain: ledger.all() });
});

// GET /api/audit/verify — recompute every link
auditRouter.get("/verify", (_req, res) => {
  const result = ledger.verify();
  log("GATE", result.valid ? `✓ ledger intact (${result.length} entries)` : `✗ ledger BROKEN at #${result.brokenAt}: ${result.reason}`);
  res.json(result);
});

export const devRouter = Router();

const TamperSchema = z.object({
  seq: z.number().int().nonnegative().optional(),
  /** Which field to flip; default flips the decision. */
  field: z.enum(["decision", "amountMinorUnits", "computedHash"]).default("decision"),
});

// POST /api/dev/tamper — DEV ONLY: mutate a ledger entry in place to demo detection.
devRouter.post("/tamper", (req, res) => {
  if (process.env.NODE_ENV === "production") return res.status(404).end();
  const parsed = TamperSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "bad body" });
  if (ledger.length === 0) return res.status(409).json({ error: "ledger is empty — make a checkout first" });
  const seq = parsed.data.seq ?? Math.max(0, ledger.length - 1);
  const before = JSON.parse(JSON.stringify(ledger.all()[seq]?.entry ?? null));
  const entry = ledger.tamper(seq, (body) => {
    switch (parsed.data.field) {
      case "decision":
        body.decision = body.decision === "ALLOWED" ? "BLOCKED" : "ALLOWED";
        break;
      case "amountMinorUnits":
        body.amountMinorUnits = (body.amountMinorUnits ?? 0) + 1;
        break;
      case "computedHash":
        body.computedHash = "f".repeat(64);
        break;
    }
  });
  if (!entry) return res.status(404).json({ error: `no entry #${seq}` });
  log("GATE", `⚠ DEV: tampered ledger entry #${seq} (${parsed.data.field})`);
  res.json({ tampered: seq, field: parsed.data.field, before, after: entry.entry });
});

// POST /api/dev/reset — DEV ONLY: wipe every in-memory store so a rehearsal starts from a clean slate.
devRouter.post("/reset", (_req, res) => {
  if (process.env.NODE_ENV === "production") return res.status(404).end();
  const counts = { users: users.size, certificates: certificates.size, runs: agentRuns.size, ledger: ledger.length };
  users.clear();
  registrationChallenges.clear();
  pendingIntents.clear();
  certificates.clear();
  usedNonces.clear();
  agentRuns.clear();
  ledger.reset();
  log("STORE", "⚠ DEV: reset all in-memory state", counts);
  res.json({ ok: true, cleared: counts });
});
