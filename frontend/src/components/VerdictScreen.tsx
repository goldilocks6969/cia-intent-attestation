import { useEffect, useState } from "react";
import type { SignedIntentCertificate } from "@cia/shared/core";
import type { StoredResult } from "../lib/api";
import { paiseToRupees, truncateMiddle } from "../lib/format";

interface Props {
  result: StoredResult;
  certificate: SignedIntentCertificate;
  onViewLedger: () => void;
  onBack: () => void;
}

export function VerdictScreen({ result, certificate: cert, onViewLedger, onBack }: Props) {
  const blocked = result.decision === "BLOCKED";
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setRevealed(true), 50);
    return () => clearTimeout(t);
  }, []);

  const cart = result.cart;
  const total = cart ? cart.priceMinorUnits * cart.quantity : 0;
  const failed = result.checks.find((c) => !c.passed);

  return (
    <div className="animate-fadeUp">
      {/* full-bleed verdict banner */}
      <section
        className={[
          "relative -mx-4 sm:-mx-6 overflow-hidden px-6 py-14 text-center transition-all duration-700",
          blocked
            ? "bg-[radial-gradient(900px_400px_at_50%_-20%,rgba(239,68,68,.55),transparent_70%),linear-gradient(180deg,#3b0a0a_0%,#12060a_100%)]"
            : "bg-[radial-gradient(900px_400px_at_50%_-20%,rgba(52,245,197,.45),transparent_70%),linear-gradient(180deg,#052e25_0%,#06120f_100%)]",
        ].join(" ")}
      >
        <div className={`mx-auto flex h-32 w-32 items-center justify-center rounded-full border-4 transition-transform duration-700 ${revealed ? "scale-100" : "scale-50"} ${blocked ? "border-red-400/70 bg-red-500/15 text-red-300 shadow-[0_0_80px_rgba(239,68,68,.6)]" : "border-mint/70 bg-mint/15 text-mint shadow-[0_0_80px_rgba(52,245,197,.6)]"}`}>
          {blocked ? <ShieldIcon /> : <CheckIcon animate={revealed} />}
        </div>
        <h2 className={`mt-8 font-mono text-3xl font-bold tracking-[0.15em] sm:text-5xl ${blocked ? "text-red-200" : "text-mint"}`}>
          {blocked ? "TRANSACTION BLOCKED" : "HUMAN-VERIFIED PURCHASE COMPLETE"}
        </h2>
        <p className={`mx-auto mt-4 max-w-2xl text-base sm:text-lg ${blocked ? "text-red-200/80" : "text-emerald-100/80"}`}>
          {blocked
            ? result.gate === "off" && failed?.name === "payment_provider"
              ? "Payment provider error — nothing was charged"
              : "Agent cart does not match signed human intent"
            : result.gate === "off"
              ? "Gate was OFF — the order went through with no verification"
              : "Every check passed: cart ⊆ signed intent, signature re-verified, certificate consumed"}
        </p>
        {result.gate === "off" && (
          <div className="mx-auto mt-5 inline-flex items-center gap-2 rounded-full border border-amber/60 bg-amber/10 px-3 py-1 font-mono text-[11px] uppercase tracking-[0.2em] text-amber">
            ⚠ verification gate was OFF
          </div>
        )}
      </section>

      {/* details */}
      <div className="mt-8 grid gap-6 lg:grid-cols-[1.1fr_1fr]">
        {/* checks */}
        <div className="card">
          <h3 className="text-[11px] font-mono uppercase tracking-[0.2em] text-slate-400">Gate checks · {result.checks.filter((c) => c.passed).length}/{result.checks.length} passed</h3>
          <ol className="mt-4 divide-y divide-line">
            {result.checks.map((c, i) => (
              <li key={c.name} className="flex gap-3 py-2.5 animate-fadeUp" style={{ animationDelay: `${i * 90}ms` }}>
                <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${c.passed ? "bg-mint/15 text-mint" : "bg-red-500/20 text-red-300"}`}>
                  {c.passed ? "✓" : "✗"}
                </span>
                <div className="min-w-0 flex-1">
                  <div className={`font-mono text-[13px] ${c.passed ? "text-slate-200" : "text-red-200"}`}>{c.name}</div>
                  <div className={`mt-0.5 break-words font-mono text-[11.5px] ${c.passed ? "text-slate-500" : "text-red-300/80"}`}>{c.detail}</div>
                </div>
              </li>
            ))}
          </ol>
          {failed && !failed.passed && (
            <p className="mt-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 font-mono text-[11.5px] text-red-200">
              short-circuited at <b>{failed.name}</b> — later checks were not run
            </p>
          )}
        </div>

        <div className="space-y-6">
          {/* intent vs cart diff */}
          <div className="card">
            <h3 className="text-[11px] font-mono uppercase tracking-[0.2em] text-slate-400">Signed intent vs agent cart</h3>
            <table className="mt-3 w-full font-mono text-[12px]">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-slate-500">
                  <th className="py-1 text-left font-medium">field</th>
                  <th className="py-1 text-left font-medium text-mint">intent</th>
                  <th className="py-1 text-left font-medium text-slate-300">cart</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                <DiffRow k="item" a={cert.intent.itemDescription || "(any)"} b={cart?.name ?? "—"} same={!failed?.detail.includes("item")} />
                <DiffRow k="merchant" a={cert.intent.merchant} b={cart?.merchant ?? "—"} same={!failed?.detail.includes("merchant")} />
                <DiffRow k="total" a={`≤ ${paiseToRupees(cert.intent.maxPriceMinorUnits)}`} b={cart ? paiseToRupees(total) : "—"} same={total <= cert.intent.maxPriceMinorUnits} />
                <DiffRow k="quantity" a={String(cert.intent.quantity)} b={cart ? String(cart.quantity) : "—"} same={cart?.quantity === cert.intent.quantity} />
                <DiffRow k="currency" a={cert.intent.currency} b={cart?.currency ?? "—"} same={cart?.currency === cert.intent.currency} />
              </tbody>
            </table>
          </div>

          {/* order / reference */}
          <div className="card">
            <h3 className="text-[11px] font-mono uppercase tracking-[0.2em] text-slate-400">{blocked ? "Reference" : "Order"}</h3>
            <dl className="kv mt-3">
              {result.razorpayOrder && (
                <>
                  <dt className="k">order id</dt>
                  <dd className="v text-mint">{result.razorpayOrder.id}{result.razorpayOrder.mock && <span className="ml-2 rounded bg-amber/15 px-1 text-[9px] text-amber">mock</span>}</dd>
                  <dt className="k">amount</dt>
                  <dd className="v">{paiseToRupees(result.razorpayOrder.amount)} <span className="text-slate-500">({result.razorpayOrder.amount} paise)</span></dd>
                  <dt className="k">status</dt>
                  <dd className="v">{result.razorpayOrder.status}</dd>
                </>
              )}
              <dt className="k">certificate</dt>
              <dd className="v" title={cert.hash}>{truncateMiddle(cert.hash, 14, 10)}</dd>
              <dt className="k">intent id</dt>
              <dd className="v">{truncateMiddle(result.intentId, 8, 8)}</dd>
              <dt className="k">ledger</dt>
              <dd className="v">#{result.ledger.seq} · {truncateMiddle(result.ledger.hash, 10, 8)}</dd>
              <dt className="k">decided</dt>
              <dd className="v">{new Date(result.at).toISOString()}</dd>
            </dl>
          </div>
        </div>
      </div>

      <div className="mt-6 flex items-center justify-between">
        <button className="btn-ghost" onClick={onBack}>← Agent run</button>
        <button className="btn-primary" onClick={onViewLedger}>Open audit ledger →</button>
      </div>
    </div>
  );
}

function DiffRow({ k, a, b, same }: { k: string; a: string; b: string; same: boolean }) {
  return (
    <tr>
      <td className="py-1.5 pr-2 text-slate-500">{k}</td>
      <td className="py-1.5 pr-2 text-slate-200">{a}</td>
      <td className={`py-1.5 ${same ? "text-slate-300" : "font-semibold text-red-300"}`}>{same ? b : `✗ ${b}`}</td>
    </tr>
  );
}

function ShieldIcon() {
  return (
    <svg className="h-16 w-16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 2l8 3.5v5.5c0 5-3.4 9.3-8 11-4.6-1.7-8-6-8-11V5.5L12 2z" />
      <path d="M9 9l6 6M15 9l-6 6" />
    </svg>
  );
}

function CheckIcon({ animate }: { animate: boolean }) {
  return (
    <svg className="h-16 w-16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path
        d="M4 12.5l5 5L20 6.5"
        style={{ strokeDasharray: 30, strokeDashoffset: animate ? 0 : 30, transition: "stroke-dashoffset .7s ease-out .2s" }}
      />
    </svg>
  );
}
