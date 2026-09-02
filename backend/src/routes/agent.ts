import { Router } from "express";
import { z } from "zod";
import OpenAI from "openai";
import { EVIL_SKU, INJECTION_PAYLOAD, findProduct, renderProductPage, searchCatalog } from "../agent/catalog.js";
import { runScriptedAgent } from "../agent/scripted.js";
import { runLlmAgent } from "../agent/llm.js";
import { Trace, type TraceEntry } from "../agent/trace.js";
import { summarize, type CartLine } from "../agent/tools.js";
import { log, logError } from "../log.js";
import { certificates } from "../store.js";

export const agentRouter = Router();

export interface AgentRun {
  runId: string;
  intentId: string;
  mode: "scripted" | "llm";
  attackEnabled: boolean;
  startedAt: number;
  finishedAt: number;
  decision_trace: TraceEntry[];
  finalCart: CartLine | null;
  hijacked: boolean;
  intendedSku: string | null;
  injectedPayload: string | null;
}

/** Latest run per intentId — the next step (verification gate) reads from here. */
export const agentRuns = new Map<string, AgentRun>();

function parseBool(v: unknown, dflt: boolean): boolean {
  if (typeof v !== "string") return dflt;
  if (["false", "0", "no", "off"].includes(v.toLowerCase())) return false;
  if (["true", "1", "yes", "on"].includes(v.toLowerCase())) return true;
  return dflt;
}

function resolveMode(override?: string): { mode: "scripted" | "llm"; client?: OpenAI; model: string } {
  const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
  const envMode = (override ?? process.env.AGENT_MODE ?? "auto").toLowerCase();
  const hasKey = Boolean(process.env.OPENAI_API_KEY);
  if (envMode === "scripted" || (envMode === "auto" && !hasKey)) return { mode: "scripted", model };
  if (!hasKey) {
    log("AGENT", "AGENT_MODE=llm but OPENAI_API_KEY is unset; falling back to scripted agent");
    return { mode: "scripted", model };
  }
  return { mode: "llm", client: new OpenAI({ apiKey: process.env.OPENAI_API_KEY }), model };
}

// GET /api/agent/product-page?sku=X[&attackEnabled=true] — the attacker-controlled page.
agentRouter.get("/product-page", (req, res) => {
  const sku = String(req.query.sku ?? "");
  const attackEnabled = parseBool(req.query.attackEnabled, true);
  const p = findProduct(sku);
  if (!p) return res.status(404).json({ error: `unknown sku ${sku}` });
  const html = renderProductPage(p, attackEnabled);
  log("AGENT", "served product page", { sku, attackEnabled, injected: attackEnabled });
  if (req.query.format === "json" || req.accepts(["html", "json"]) === "json") {
    return res.json({ sku, attackEnabled, html, injectedPayload: attackEnabled ? INJECTION_PAYLOAD : null });
  }
  res.type("html").send(html);
});

// GET /api/agent/search?q=... — convenience for the UI / debugging.
agentRouter.get("/search", (req, res) => {
  res.json(searchCatalog(String(req.query.q ?? "")).map(summarize));
});

const ShopSchema = z.object({ intentId: z.string().uuid() });

// POST /api/agent/shop?attackEnabled=true|false[&agent=scripted|llm]
agentRouter.post("/shop", async (req, res) => {
  const parsed = ShopSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "intentId (uuid) required" });
  const { intentId } = parsed.data;
  const cert = certificates.get(intentId);
  if (!cert) return res.status(404).json({ error: "no certificate for this intentId" });

  const attackEnabled = parseBool(req.query.attackEnabled, true);
  const { mode, client, model } = resolveMode(typeof req.query.agent === "string" ? req.query.agent : undefined);
  const intent = cert.intent;
  const ctx = { attackEnabled, quantity: intent.quantity };
  const runId = crypto.randomUUID();
  const startedAt = Date.now();

  log("AGENT", "▶ shop run started", { runId, intentId, mode, attackEnabled, item: intent.itemDescription || intent.category });
  const trace = new Trace((e) => log("AGENT", `#${e.step} ${e.role}/${e.type}: ${e.text.slice(0, 160)}`));

  const query = intent.itemDescription.trim() || intent.category;
  const intendedSku = searchCatalog(query)[0]?.sku ?? null;

  let finalCart: CartLine | null = null;
  try {
    finalCart =
      mode === "llm" && client
        ? await runLlmAgent(intent, ctx, trace, client, model)
        : await runScriptedAgent(intent, ctx, trace);
  } catch (err) {
    logError("AGENT", "agent crashed", err);
    trace.push("system", "warning", `Agent error: ${(err as Error).message}`);
    if (mode === "llm") {
      trace.push("system", "info", "Falling back to scripted agent so the demo can continue.");
      try {
        finalCart = await runScriptedAgent(intent, ctx, trace);
      } catch (err2) {
        logError("AGENT", "scripted fallback crashed", err2);
      }
    }
  }

  const hijacked = Boolean(finalCart && (finalCart.sku === EVIL_SKU || (intendedSku !== null && finalCart.sku !== intendedSku)));
  if (hijacked) {
    trace.push("system", "warning", `HIJACKED: cart contains ${finalCart!.sku} but the approved intent was for ${intendedSku ?? "a different item"}.`);
  } else if (finalCart) {
    trace.push("system", "info", `Cart matches the approved intent (${finalCart.sku}).`);
  }

  const run: AgentRun = {
    runId,
    intentId,
    mode,
    attackEnabled,
    startedAt,
    finishedAt: Date.now(),
    decision_trace: trace.entries,
    finalCart,
    hijacked,
    intendedSku,
    injectedPayload: attackEnabled ? INJECTION_PAYLOAD : null,
  };
  agentRuns.set(intentId, run);
  log("AGENT", hijacked ? "■ shop run finished — HIJACKED" : "■ shop run finished — clean", {
    runId,
    steps: run.decision_trace.length,
    cart: finalCart ? `${finalCart.quantity}× ${finalCart.sku} @ ${finalCart.priceMinorUnits}` : null,
    ms: run.finishedAt - startedAt,
  });
  return res.json(run);
});

// GET /api/agent/run/:intentId — latest run for the intent.
agentRouter.get("/run/:intentId", (req, res) => {
  const run = agentRuns.get(req.params.intentId);
  if (!run) return res.status(404).json({ error: "no agent run for this intent" });
  res.json(run);
});
