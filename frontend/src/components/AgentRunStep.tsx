import { useEffect, useRef, useState } from "react";
import type { SignedIntentCertificate } from "@cia/shared/core";
import { agentApi, errorMessage, type AgentRun, type TraceEntry } from "../lib/api";
import { paiseToRupees } from "../lib/format";
import { ErrorBanner } from "./ErrorBanner";
import { Spinner } from "./RegisterStep";

interface Props {
  certificate: SignedIntentCertificate;
  gateEnabled: boolean;
  onGateChange: (on: boolean) => void;
  onRunComplete?: (run: AgentRun) => void;
  onBack: () => void;
}

const REVEAL_MS = 400;
const FLASH_MS = 2000;

type Phase = "idle" | "fetching" | "streaming" | "done";

export function AgentRunStep({ certificate: cert, gateEnabled, onGateChange, onRunComplete, onBack }: Props) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [attack, setAttack] = useState(false);
  const [run, setRun] = useState<AgentRun | null>(null);
  const [shown, setShown] = useState<TraceEntry[]>([]);
  const [flash, setFlash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const timers = useRef<number[]>([]);

  function clearTimers() {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  }
  useEffect(() => clearTimers, []);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [shown.length]);

  async function start(withAttack: boolean) {
    clearTimers();
    setError(null);
    setRun(null);
    setShown([]);
    setFlash(null);
    setAttack(withAttack);
    setPhase("fetching");
    try {
      const result = await agentApi.shop(cert.intentId, withAttack);
      setRun(result);
      setPhase("streaming");
      // Staged reveal: one trace line every REVEAL_MS. The attacker line also triggers the payload flash.
      result.decision_trace.forEach((entry, i) => {
        const t = window.setTimeout(() => {
          setShown((prev) => [...prev, entry]);
          if (entry.role === "attacker" && result.injectedPayload) {
            setFlash(result.injectedPayload);
            timers.current.push(window.setTimeout(() => setFlash(null), FLASH_MS));
          }
          if (i === result.decision_trace.length - 1) {
            setPhase("done");
            onRunComplete?.(result);
          }
        }, i * REVEAL_MS + 150);
        timers.current.push(t);
      });
    } catch (e) {
      setError(errorMessage(e));
      setPhase("idle");
    }
  }

  const busy = phase === "fetching" || phase === "streaming";
  const showCart = phase === "done" && run;

  return (
    <div className="animate-fadeUp space-y-5">
      {/* controls */}
      <div className="card">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">Hand off to the shopping agent</h2>
            <p className="mt-1 text-sm text-slate-400">
              An autonomous agent shops on your behalf. It reads merchant pages as tool results — and merchant pages are attacker-controlled.
            </p>
          </div>
          <GateToggle on={gateEnabled} onChange={onGateChange} />
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button className="btn-primary" disabled={busy} onClick={() => start(false)}>
            {busy && !attack ? <Spinner /> : <span aria-hidden>▶</span>} Run Agent (clean)
          </button>
          <button
            className="inline-flex items-center gap-2 rounded-lg border border-red-500/50 bg-red-500/10 px-4 py-2.5 text-sm font-semibold text-red-200 hover:bg-red-500/20 disabled:opacity-40 transition"
            disabled={busy}
            onClick={() => start(true)}
          >
            {busy && attack ? <Spinner /> : <span aria-hidden>⚠</span>} Run Agent (with attacker content)
          </button>
          {run && (
            <span className="ml-auto font-mono text-[11px] text-slate-500">
              agent={run.mode} · {run.decision_trace.length} steps · {run.finishedAt - run.startedAt}ms
            </span>
          )}
        </div>

        {attack && busy && (
          <div className="mt-4 flex items-center gap-3 rounded-lg border border-red-500/30 bg-red-500/5 px-3.5 py-2.5 text-xs text-red-200 animate-fadeUp">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
            </span>
            Incoming page contains hidden instructions — flashing payload…
          </div>
        )}
        <ErrorBanner message={error} onDismiss={() => setError(null)} />
      </div>

      {/* terminal */}
      <div className="relative overflow-hidden rounded-2xl border border-line bg-[#05070d] shadow-xl shadow-black/50">
        <div className="flex items-center gap-2 border-b border-line bg-black/40 px-4 py-2">
          <span className="h-2.5 w-2.5 rounded-full bg-red-500/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-amber/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-mint/70" />
          <span className="ml-3 font-mono text-[11px] text-slate-500">agent://decision-trace{run ? ` · run ${run.runId.slice(0, 8)}` : ""}</span>
          <span className="ml-auto font-mono text-[11px] text-slate-500">
            {phase === "idle" && "idle"}
            {phase === "fetching" && "agent running…"}
            {phase === "streaming" && "replaying trace"}
            {phase === "done" && (run?.hijacked ? <span className="text-red-400">HIJACKED</span> : <span className="text-mint">clean</span>)}
          </span>
        </div>
        <div ref={logRef} className="h-80 overflow-y-auto p-4 font-mono text-[12.5px] leading-relaxed">
          {shown.length === 0 && (
            <p className="text-slate-600">
              {phase === "fetching" ? "▌ waiting for agent…" : "▌ press a run button to start the agent"}
            </p>
          )}
          {shown.map((e) => (
            <TraceLine key={e.step} e={e} />
          ))}
          {busy && shown.length > 0 && <span className="inline-block h-4 w-2 animate-pulse bg-mint/70 align-middle" />}
        </div>

        {/* injection flash overlay */}
        {flash && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-red-950/95 p-8 backdrop-blur-sm animate-fadeUp">
            <div className="max-w-2xl rounded-xl border-2 border-red-500 bg-black/90 p-6 shadow-[0_0_60px_rgba(239,68,68,.6)]">
              <div className="mb-2 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.25em] text-red-400">
                <span className="animate-pulse">⚠</span> hidden text in product page · style="position:absolute;left:-9999px"
              </div>
              <pre className="whitespace-pre-wrap font-mono text-sm leading-relaxed text-red-200">{`<!-- ${flash} -->`}</pre>
            </div>
          </div>
        )}
      </div>

      {/* comparison strip */}
      {showCart && (
        <div className="grid gap-4 md:grid-cols-2 animate-fadeUp">
          <CartPanel
            title="Approved Intent"
            tone="green"
            rows={[
              ["item", cert.intent.itemDescription || `(${cert.intent.category})`],
              ["merchant", cert.intent.merchant],
              ["max total", `${paiseToRupees(cert.intent.maxPriceMinorUnits)} · ${cert.intent.maxPriceMinorUnits} paise`],
              ["quantity", String(cert.intent.quantity)],
              ["hash", cert.hash.slice(0, 16) + "…"],
            ]}
            footer="signed by your passkey"
          />
          <CartPanel
            title="Agent Cart"
            tone={run.finalCart ? (run.hijacked ? "red" : "green") : "amber"}
            rows={
              run.finalCart
                ? [
                    ["item", `${run.finalCart.name} (${run.finalCart.sku})`],
                    ["merchant", run.finalCart.merchant],
                    ["total", `${paiseToRupees(run.finalCart.priceMinorUnits * run.finalCart.quantity)} · ${run.finalCart.priceMinorUnits * run.finalCart.quantity} paise`],
                    ["quantity", String(run.finalCart.quantity)],
                    ["source", run.hijacked ? "instruction found inside page HTML" : "search result matching intent"],
                  ]
                : [["item", "— nothing added —"]]
            }
            footer={run.hijacked ? `⚠ ${run.finalCart!.priceMinorUnits * run.finalCart!.quantity - cert.intent.maxPriceMinorUnits > 0 ? "over cap by " + paiseToRupees(run.finalCart!.priceMinorUnits * run.finalCart!.quantity - cert.intent.maxPriceMinorUnits) : "different item"}` : "matches approved intent"}
          />
        </div>
      )}

      <div className="flex items-center justify-between">
        <button className="btn-ghost" onClick={onBack} disabled={busy}>
          ← Certificate
        </button>
        {showCart && (
          <span className="text-xs text-slate-500">
            Verification gate is <span className={gateEnabled ? "text-mint" : "text-amber"}>{gateEnabled ? "ON" : "OFF"}</span> — this decides what happens at checkout.
          </span>
        )}
      </div>
    </div>
  );
}

const ICON: Record<TraceEntry["type"], string> = {
  thought: "🧠",
  tool_call: "💻",
  result: "📄",
  warning: "⚠️",
  decision: "🛒",
  info: "ℹ️",
};

const TONE: Record<TraceEntry["color"], string> = {
  green: "text-mint",
  cyan: "text-cyan-300",
  amber: "text-amber",
  red: "text-red-300",
  slate: "text-slate-400",
};

function TraceLine({ e }: { e: TraceEntry }) {
  const time = new Date(e.ts).toLocaleTimeString([], { hour12: false, minute: "2-digit", second: "2-digit" });
  const isAttack = e.role === "attacker";
  return (
    <div className={`flex gap-3 py-0.5 animate-fadeUp ${isAttack ? "-mx-2 rounded bg-red-500/10 px-2" : ""}`}>
      <span className="shrink-0 text-slate-600">{time}</span>
      <span className="w-[4.5rem] shrink-0 uppercase tracking-wider text-[10px] pt-0.5 text-slate-500">{e.role}</span>
      <span className="shrink-0">{ICON[e.type]}</span>
      <span className={`${TONE[e.color]} break-words`}>
        {e.type === "tool_call" && e.action ? (
          <>
            <span className="text-cyan-200">{e.action.tool}</span>
            <span className="text-slate-500">(</span>
            <span className="text-slate-300">{JSON.stringify(e.action.args)}</span>
            <span className="text-slate-500">)</span>
          </>
        ) : (
          e.text
        )}
      </span>
    </div>
  );
}

function CartPanel({ title, tone, rows, footer }: { title: string; tone: "green" | "red" | "amber"; rows: [string, string][]; footer?: string }) {
  const border = { green: "border-mint/60 shadow-[0_0_30px_-10px_rgba(52,245,197,.5)]", red: "border-red-500/70 shadow-[0_0_30px_-10px_rgba(239,68,68,.6)]", amber: "border-amber/60" }[tone];
  const head = { green: "text-mint", red: "text-red-300", amber: "text-amber" }[tone];
  return (
    <div className={`rounded-2xl border-2 bg-panel/80 p-5 ${border}`}>
      <div className={`font-mono text-[11px] uppercase tracking-[0.25em] ${head}`}>{title}</div>
      <dl className="kv mt-3">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="k">{k}</dt>
            <dd className="v">{v}</dd>
          </div>
        ))}
      </dl>
      {footer && <div className={`mt-3 border-t border-line pt-2 font-mono text-[11px] ${head}`}>{footer}</div>}
    </div>
  );
}

function GateToggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={`flex items-center gap-3 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
        on ? "border-mint/60 bg-mint/10 text-mint" : "border-amber/60 bg-amber/10 text-amber"
      }`}
    >
      <span aria-hidden>🛡️</span>
      Verification Gate: {on ? "ON" : "OFF"}
      <span className={`relative h-4 w-8 rounded-full transition ${on ? "bg-mint/60" : "bg-amber/50"}`}>
        <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-ink transition ${on ? "left-4" : "left-0.5"}`} />
      </span>
    </button>
  );
}
