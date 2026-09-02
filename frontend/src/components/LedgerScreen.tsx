import { useCallback, useEffect, useState } from "react";
import { checkoutApi, errorMessage, type LedgerEntry, type LedgerVerify, type StoredResult } from "../lib/api";
import { paiseToRupees, truncateMiddle } from "../lib/format";
import { ErrorBanner } from "./ErrorBanner";
import { Spinner } from "./RegisterStep";

interface Props {
  results: StoredResult[];
  onBack: () => void;
  onNewIntent: () => void;
}

export function LedgerScreen({ results, onBack, onNewIntent }: Props) {
  const [chain, setChain] = useState<LedgerEntry[]>([]);
  const [head, setHead] = useState<string>("");
  const [verify, setVerify] = useState<LedgerVerify | null>(null);
  const [busy, setBusy] = useState<"load" | "verify" | "tamper" | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy("load");
    try {
      const r = await checkoutApi.audit();
      setChain(r.chain);
      setHead(r.head);
      setLoaded(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function runVerify() {
    setBusy("verify");
    setError(null);
    try {
      setVerify(await checkoutApi.verify());
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }
  async function tamper() {
    setBusy("tamper");
    setError(null);
    try {
      await checkoutApi.tamper();
      await load();
      setVerify(await checkoutApi.verify());
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  const allowed = chain.filter((e) => e.entry.decision === "ALLOWED").length;
  const blocked = chain.length - allowed;

  return (
    <div className="animate-fadeUp space-y-5">
      {/* header strip */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[0.25em] text-slate-500">audit · hash-chained ledger</div>
          <h2 className="mt-1 text-lg font-semibold">Payment decisions</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn-ghost" onClick={load} disabled={busy !== null}>{busy === "load" ? <Spinner /> : "↻"} Refresh</button>
          <button className="btn-ghost border-red-500/40 text-red-200 hover:bg-red-500/10" onClick={tamper} disabled={busy !== null || chain.length === 0} title="DEV: mutate the latest entry in place">
            {busy === "tamper" ? <Spinner /> : "🧪"} Tamper (dev)
          </button>
          <button className="btn-primary" onClick={runVerify} disabled={busy !== null}>
            {busy === "verify" ? <Spinner /> : "🔒"} Verify Ledger Integrity
          </button>
        </div>
      </div>

      {verify && (
        <div
          role="status"
          className={`flex items-center gap-3 rounded-xl border px-4 py-3 font-mono text-sm animate-fadeUp ${
            verify.valid ? "border-mint/60 bg-mint/10 text-mint" : "border-red-500/60 bg-red-500/10 text-red-200"
          }`}
        >
          <span className="text-lg">{verify.valid ? "🔒" : "⛓️‍💥"}</span>
          {verify.valid ? (
            <span>Chain intact — {verify.length} entries verified · head {truncateMiddle(head, 10, 8)}</span>
          ) : (
            <span>
              Chain broken at entry #{verify.brokenAt} — {verify.reason}
            </span>
          )}
        </div>
      )}
      <ErrorBanner message={error} onDismiss={() => setError(null)} />

      {/* stats */}
      <div className="grid grid-cols-3 gap-3 font-mono">
        <Stat label="entries" value={loaded ? String(chain.length) : "…"} />
        <Stat label="allowed" value={String(allowed)} tone="green" />
        <Stat label="blocked" value={String(blocked)} tone="red" />
      </div>

      {/* table */}
      <div className="overflow-hidden rounded-2xl border border-line bg-[#05070d]">
        <div className="flex items-center gap-2 border-b border-line bg-black/40 px-4 py-2 font-mono text-[11px] text-slate-500">
          <span className="h-2.5 w-2.5 rounded-full bg-red-500/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-amber/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-mint/70" />
          <span className="ml-3">audit://ledger · head {head ? truncateMiddle(head, 12, 8) : "—"}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full font-mono text-[12px]">
            <thead className="bg-black/30 text-[10px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left font-medium">#</th>
                <th className="px-3 py-2 text-left font-medium">timestamp</th>
                <th className="px-3 py-2 text-left font-medium">intent</th>
                <th className="px-3 py-2 text-left font-medium">decision</th>
                <th className="px-3 py-2 text-left font-medium">amount</th>
                <th className="px-3 py-2 text-left font-medium">failed check</th>
                <th className="px-3 py-2 text-left font-medium">chain</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {!loaded && busy === "load" &&
                [0, 1, 2].map((i) => (
                  <tr key={`sk-${i}`}>
                    {[3, 10, 6, 5, 6, 14, 8].map((w, j) => (
                      <td key={j} className="px-3 py-2.5"><div className="skeleton h-3" style={{ width: `${w * 0.5}rem` }} /></td>
                    ))}
                  </tr>
                ))}
              {loaded && chain.length === 0 && (
                <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-600">▌ no decisions yet — run a checkout</td></tr>
              )}
              {[...chain].reverse().map((e) => {
                const failed = e.entry.checks.find((c) => !c.passed);
                const broken = verify && !verify.valid && verify.brokenAt !== undefined && e.seq >= verify.brokenAt;
                const isBreak = verify && !verify.valid && verify.brokenAt === e.seq;
                return (
                  <tr key={e.seq} className={`${broken ? "bg-red-500/5" : ""} ${isBreak ? "outline outline-1 outline-red-500/60" : ""} hover:bg-white/[.02]`}>
                    <td className="px-3 py-2 text-slate-500">{String(e.seq).padStart(3, "0")}</td>
                    <td className="px-3 py-2 text-slate-300 whitespace-nowrap">{new Date(e.entry.timestamp).toISOString().replace("T", " ").slice(0, 19)}</td>
                    <td className="px-3 py-2 text-slate-300" title={e.entry.intentId}>{e.entry.intentId.slice(0, 8)}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wider ${e.entry.decision === "ALLOWED" ? "bg-mint/15 text-mint" : "bg-red-500/15 text-red-300"}`}>
                        {e.entry.decision}
                      </span>
                      {e.entry.gate === "off" && <span className="ml-1 rounded bg-amber/15 px-1 py-0.5 text-[9px] text-amber">unfenced</span>}
                    </td>
                    <td className="px-3 py-2 text-slate-300 whitespace-nowrap">{e.entry.amountMinorUnits != null ? paiseToRupees(e.entry.amountMinorUnits) : "—"}</td>
                    <td className="px-3 py-2 text-red-300/90 max-w-[22rem] truncate" title={failed?.detail}>{failed ? `${failed.name}: ${failed.detail}` : <span className="text-slate-600">—</span>}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span className={isBreak ? "text-red-400" : broken ? "text-red-300/70" : "text-mint/80"} title={`prev ${e.prevHash}\nhash ${e.hash}`}>
                        {isBreak ? "⛓️‍💥" : "⛓"} {e.prevHash.slice(0, 6)}→{e.hash.slice(0, 6)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {results.length > 0 && (
        <p className="font-mono text-[11px] text-slate-500">
          this session: {results.length} decision(s) · {results.filter((r) => r.decision === "BLOCKED").length} blocked
        </p>
      )}

      <div className="flex items-center justify-between">
        <button className="btn-ghost" onClick={onBack}>← Verdict</button>
        <button className="btn-primary" onClick={onNewIntent}>New intent</button>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "green" | "red" }) {
  const c = tone === "green" ? "text-mint" : tone === "red" ? "text-red-300" : "text-slate-100";
  return (
    <div className="rounded-xl border border-line bg-panel/60 px-4 py-3">
      <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl ${c}`}>{value}</div>
    </div>
  );
}
