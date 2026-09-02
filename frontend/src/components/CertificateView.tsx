import { useEffect, useState } from "react";
import type { SignedIntentCertificate } from "@cia/shared/core";
import { api, errorMessage, type CertificateVerification } from "../lib/api";
import { formatCountdown, isoTime, paiseToRupees, truncateMiddle } from "../lib/format";

interface Props {
  certificate: SignedIntentCertificate;
  onNewIntent: () => void;
  onRunAgent?: () => void;
}

export function CertificateView({ certificate: cert, onNewIntent, onRunAgent }: Props) {
  const [now, setNow] = useState(Date.now());
  const [verification, setVerification] = useState<CertificateVerification | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);

  const remaining = cert.intent.expiresAt - now;
  const expired = remaining <= 0;
  const status = expired && cert.status === "active" ? "expired" : cert.status;
  const ttl = cert.intent.expiresAt - cert.intent.issuedAt;
  const pct = Math.max(0, Math.min(100, (remaining / ttl) * 100));

  async function reverify() {
    setVerifyError(null);
    try {
      setVerification(await api.verifyCertificate(cert.intentId));
    } catch (e) {
      setVerifyError(errorMessage(e));
    }
  }

  return (
    <div className="animate-fadeUp">
      <div className="cert-frame shadow-glow">
        <div className="cert-inner p-6 sm:p-8">
          {/* header */}
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-[0.25em] text-mint/80">
                <SealIcon />
                Signed Intent Certificate
              </div>
              <h2 className="mt-2 font-mono text-2xl font-semibold tracking-tight text-slate-50">
                {paiseToRupees(cert.intent.maxPriceMinorUnits)}
                <span className="ml-2 text-base font-normal text-slate-500">max · {cert.intent.quantity}×</span>
              </h2>
              <p className="mt-0.5 text-sm text-slate-400">
                at <span className="text-slate-200">{cert.intent.merchant}</span> · {cert.intent.category}
                {cert.intent.itemDescription ? ` · ${cert.intent.itemDescription}` : ""}
              </p>
            </div>
            <StatusBadge status={status} />
          </div>

          {/* countdown */}
          <div className="mt-6 rounded-xl border border-line bg-black/30 p-4">
            <div className="flex items-baseline justify-between">
              <span className="k">{expired ? "Expired" : "Valid for"}</span>
              <span className={`font-mono text-3xl tabular-nums ${expired ? "text-red-400" : remaining < 60_000 ? "text-amber" : "text-mint"}`}>
                {formatCountdown(remaining)}
              </span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line">
              <div
                className={`h-full rounded-full transition-[width] duration-300 ${expired ? "bg-red-500" : remaining < 60_000 ? "bg-amber" : "bg-mint"}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="mt-2 flex justify-between font-mono text-[10px] text-slate-500">
              <span>issued {isoTime(cert.intent.issuedAt)}</span>
              <span>expires {isoTime(cert.intent.expiresAt)}</span>
            </div>
          </div>

          {/* body */}
          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <section>
              <SectionTitle>Intent (canonical fields)</SectionTitle>
              <dl className="kv mt-3">
                <Row k="userId" v={cert.intent.userId} />
                <Row k="merchant" v={cert.intent.merchant} tag="soft" />
                <Row k="category" v={cert.intent.category} tag="soft" />
                <Row k="itemDescription" v={cert.intent.itemDescription || "—"} />
                <Row k="maxPriceMinorUnits" v={String(cert.intent.maxPriceMinorUnits)} tag="hard" />
                <Row k="currency" v={cert.intent.currency} tag="hard" />
                <Row k="quantity" v={String(cert.intent.quantity)} tag="hard" />
                <Row k="nonce" v={cert.intent.nonce} tag="hard" />
                <Row k="issuedAt" v={String(cert.intent.issuedAt)} />
                <Row k="expiresAt" v={String(cert.intent.expiresAt)} tag="hard" />
              </dl>
            </section>
            <section>
              <SectionTitle>Attestation</SectionTitle>
              <dl className="kv mt-3">
                <Row k="hash · sha256" v={cert.hash} copy truncate={[14, 12]} highlight />
                <Row k="signature" v={cert.signature} copy truncate={[18, 12]} />
                <Row k="authenticatorData" v={cert.authenticatorData} copy truncate={[18, 12]} />
                <Row k="clientDataJSON" v={cert.clientDataJSON} copy truncate={[18, 12]} />
                <Row k="credentialID" v={cert.credentialID} copy truncate={[14, 10]} />
                <Row k="rpID" v={cert.rpID} />
                <Row k="origin" v={cert.origin} />
                <Row k="intentId" v={cert.intentId} copy />
                <Row k="consumedAt" v={cert.consumedAt ? isoTime(cert.consumedAt) : "null"} />
              </dl>
            </section>
          </div>

          {/* verification */}
          <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-line pt-5">
            <button className="btn-ghost" onClick={reverify}>
              Re-verify signature
            </button>
            <button className="btn-ghost" onClick={() => setShowRaw((s) => !s)}>
              {showRaw ? "Hide raw JSON" : "Raw JSON"}
            </button>
            <button className="btn-ghost" onClick={() => copyText(JSON.stringify(cert, null, 2))}>
              Copy certificate
            </button>
            <div className="ml-auto text-xs">
              {verifyError && <span className="text-red-300">{verifyError}</span>}
              {verification && (
                <span className={`font-mono ${verification.valid ? "text-mint" : "text-red-300"}`}>
                  {verification.valid
                    ? `✓ signature valid · UV=${verification.details.userVerified ? 1 : 0} · counter=${verification.details.counter}`
                    : `✗ ${verification.reasons.join("; ")}`}
                </span>
              )}
            </div>
          </div>

          {showRaw && (
            <pre className="mt-4 max-h-96 overflow-auto rounded-xl border border-line bg-black/50 p-4 font-mono text-[12px] leading-relaxed text-slate-300">
              {JSON.stringify(cert, null, 2)}
            </pre>
          )}
        </div>
      </div>

      <div className="mt-5 flex justify-end gap-3">
        <button className="btn-ghost" onClick={onNewIntent}>
          New intent
        </button>
        {onRunAgent && (
          <button className="btn-primary" onClick={onRunAgent}>
            Hand off to shopping agent →
          </button>
        )}
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-[11px] font-mono uppercase tracking-[0.2em] text-slate-400">{children}</h3>;
}

function Row({
  k,
  v,
  copy = false,
  truncate,
  tag,
  highlight = false,
}: {
  k: string;
  v: string;
  copy?: boolean;
  truncate?: [number, number];
  tag?: "hard" | "soft";
  highlight?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const shown = truncate ? truncateMiddle(v, truncate[0], truncate[1]) : v;
  return (
    <>
      <dt className="k flex items-center gap-1.5">
        {k}
        {tag && (
          <span className={`rounded px-1 py-px text-[9px] normal-case tracking-normal ${tag === "hard" ? "bg-mint/15 text-mint" : "bg-amber/15 text-amber"}`}>
            {tag}
          </span>
        )}
      </dt>
      <dd className={`v flex items-center gap-2 ${highlight ? "text-mint" : ""}`} title={v}>
        <span>{shown}</span>
        {copy && (
          <button
            type="button"
            onClick={async () => {
              await copyText(v);
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            }}
            className="shrink-0 rounded border border-line px-1.5 py-0.5 text-[10px] text-slate-400 hover:text-slate-100 hover:border-slate-400"
            aria-label={`Copy ${k}`}
          >
            {copied ? "copied" : "copy"}
          </button>
        )}
      </dd>
    </>
  );
}

function StatusBadge({ status }: { status: SignedIntentCertificate["status"] }) {
  const styles: Record<string, string> = {
    active: "border-mint/50 bg-mint/10 text-mint",
    consumed: "border-sky-400/50 bg-sky-400/10 text-sky-300",
    expired: "border-red-500/50 bg-red-500/10 text-red-300",
    revoked: "border-slate-500/50 bg-slate-500/10 text-slate-300",
  };
  return (
    <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 font-mono text-[11px] uppercase tracking-[0.2em] ${styles[status]}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${status === "active" ? "bg-mint animate-pulse" : "bg-current"}`} />
      {status}
    </span>
  );
}

function SealIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <path d="M12 2l2.4 2.1 3.2-.3.9 3.1 2.8 1.6-1.2 3 1.2 3-2.8 1.6-.9 3.1-3.2-.3L12 22l-2.4-2.1-3.2.3-.9-3.1-2.8-1.6 1.2-3-1.2-3 2.8-1.6.9-3.1 3.2.3z" />
      <path d="M9 12l2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // clipboard may be blocked in insecure contexts; silently ignore
  }
}
