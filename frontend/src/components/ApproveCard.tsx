import type { CreateIntentResponse } from "../lib/api";
import { paiseToRupees, truncateMiddle } from "../lib/format";
import { ErrorBanner } from "./ErrorBanner";
import { FingerprintIcon, Spinner } from "./RegisterStep";

interface Props {
  pending: CreateIntentResponse;
  phase: "ready" | "prompting" | "verifying";
  error: string | null;
  onApprove: () => void;
  onBack: () => void;
  onClearError: () => void;
}

export function ApproveCard({ pending, phase, error, onApprove, onBack, onClearError }: Props) {
  const { intent, hash } = pending;
  const busy = phase !== "ready";
  return (
    <div className="card animate-fadeUp">
      <div className="flex flex-col items-center text-center">
        <div className="relative mb-5 flex h-24 w-24 items-center justify-center">
          {busy && <span className="absolute inset-0 rounded-full border border-mint/50 animate-pulseRing" />}
          {busy && <span className="absolute inset-0 rounded-full border border-mint/30 animate-pulseRing [animation-delay:.5s]" />}
          <span className="flex h-20 w-20 items-center justify-center rounded-full border border-mint/40 bg-mint/10 text-mint shadow-glow">
            <FingerprintIcon className="h-10 w-10" />
          </span>
        </div>
        <h2 className="text-xl font-semibold">Approve with fingerprint</h2>
        <p className="mt-1 max-w-md text-sm text-slate-400">
          Your authenticator will sign the SHA-256 hash of this intent. Nothing else — not the page, not a session — is being signed.
        </p>
      </div>

      <div className="mt-6 rounded-xl border border-line bg-black/30 p-4">
        <dl className="kv">
          <dt className="k">Merchant</dt>
          <dd className="v">{intent.merchant}</dd>
          <dt className="k">Category</dt>
          <dd className="v">{intent.category}</dd>
          {intent.itemDescription && (
            <>
              <dt className="k">Item</dt>
              <dd className="v text-slate-300">{intent.itemDescription}</dd>
            </>
          )}
          <dt className="k">Max total</dt>
          <dd className="v text-mint">
            {paiseToRupees(intent.maxPriceMinorUnits)} <span className="text-slate-500">({intent.maxPriceMinorUnits} paise · {intent.quantity}×)</span>
          </dd>
          <dt className="k">Expires</dt>
          <dd className="v">{new Date(intent.expiresAt).toLocaleTimeString()}</dd>
          <dt className="k">Intent hash</dt>
          <dd className="v text-slate-300" title={hash}>{truncateMiddle(hash, 16, 12)}</dd>
        </dl>
      </div>

      <ErrorBanner message={error} onDismiss={onClearError} />

      <div className="mt-6 flex items-center justify-between gap-3">
        <button type="button" className="btn-ghost" onClick={onBack} disabled={busy}>
          ← Edit intent
        </button>
        <button type="button" className="btn-primary px-6" onClick={onApprove} disabled={busy}>
          {busy ? <Spinner /> : <FingerprintIcon />}
          {phase === "prompting" ? "Touch sensor…" : phase === "verifying" ? "Verifying signature…" : "Sign intent"}
        </button>
      </div>
    </div>
  );
}
