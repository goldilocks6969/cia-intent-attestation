import { useMemo, useState, type FormEvent } from "react";
import { paiseToRupees, rupeesToPaise } from "../lib/format";
import type { IntentRequest } from "../lib/api";
import { ErrorBanner } from "./ErrorBanner";
import { Spinner } from "./RegisterStep";

interface Props {
  userId: string;
  busy: boolean;
  error: string | null;
  onClearError: () => void;
  onSubmit: (req: IntentRequest) => void;
}

const CATEGORIES = ["electronics", "groceries", "fashion", "travel", "food-delivery", "subscriptions", "other"];

export function IntentStep({ userId, busy, error, onClearError, onSubmit }: Props) {
  const [merchant, setMerchant] = useState("Amazon.in");
  const [category, setCategory] = useState("electronics");
  const [itemDescription, setItemDescription] = useState("");
  const [priceInput, setPriceInput] = useState("1999.90");
  const [quantity, setQuantity] = useState(1);
  const [ttlMin, setTtlMin] = useState(10);
  const [localError, setLocalError] = useState<string | null>(null);

  const paise = useMemo(() => {
    try {
      return rupeesToPaise(priceInput);
    } catch {
      return null;
    }
  }, [priceInput]);

  function submit(e: FormEvent) {
    e.preventDefault();
    setLocalError(null);
    onClearError();
    if (paise === null) return setLocalError("Max price must be a rupee amount with at most two decimals");
    if (!merchant.trim()) return setLocalError("Merchant is required");
    if (!Number.isInteger(quantity) || quantity < 1) return setLocalError("Quantity must be a whole number ≥ 1");
    onSubmit({
      userId,
      merchant: merchant.trim(),
      category,
      itemDescription: itemDescription.trim(),
      maxPriceMinorUnits: paise,
      quantity,
      ttlMs: ttlMin * 60 * 1000,
    });
  }

  return (
    <form onSubmit={submit} className="card animate-fadeUp">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Declare your intent</h2>
          <p className="mt-1 text-sm text-slate-400">
            Hard constraints are enforced cryptographically. Soft constraints are advisory.
          </p>
        </div>
        <span className="rounded-full border border-line px-2.5 py-1 text-[11px] font-mono text-slate-400">as {userId}</span>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="merchant">
            Merchant <Tag soft />
          </label>
          <input id="merchant" className="input" value={merchant} onChange={(e) => setMerchant(e.target.value)} disabled={busy} placeholder="Amazon.in" />
        </div>
        <div>
          <label className="label" htmlFor="category">
            Category <Tag soft />
          </label>
          <select id="category" className="input" value={category} onChange={(e) => setCategory(e.target.value)} disabled={busy}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="item">
            Item description <span className="ml-1 normal-case tracking-normal text-slate-500">(informational)</span>
          </label>
          <input id="item" className="input" value={itemDescription} onChange={(e) => setItemDescription(e.target.value)} disabled={busy} placeholder="USB-C cable, 1m, braided" />
        </div>
        <div>
          <label className="label" htmlFor="price">
            Max price (₹) <Tag />
          </label>
          <div className="relative">
            <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-slate-500">₹</span>
            <input
              id="price"
              className="input pl-8 font-mono"
              inputMode="decimal"
              value={priceInput}
              onChange={(e) => setPriceInput(e.target.value)}
              disabled={busy}
              placeholder="1999.90"
            />
          </div>
          <p className="mt-1.5 text-[11px] font-mono text-slate-500">
            {paise === null ? "—" : `${paise.toLocaleString("en-IN")} paise · ${paiseToRupees(paise)}`}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label" htmlFor="qty">
              Quantity <Tag />
            </label>
            <input id="qty" type="number" min={1} step={1} className="input font-mono" value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} disabled={busy} />
          </div>
          <div>
            <label className="label" htmlFor="ttl">
              Valid for <Tag />
            </label>
            <select id="ttl" className="input" value={ttlMin} onChange={(e) => setTtlMin(Number(e.target.value))} disabled={busy}>
              {[2, 5, 10, 30, 60].map((m) => (
                <option key={m} value={m}>{m} min</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {paise !== null && (
        <p className="mt-4 rounded-lg border border-line bg-black/30 px-3.5 py-2.5 text-xs text-slate-400">
          Total cap: <span className="font-mono text-slate-200">{paiseToRupees(paise)}</span> for{" "}
          <span className="font-mono text-slate-200">{quantity}×</span> at <span className="text-slate-200">{merchant || "…"}</span>.
          Any charge above this fails the hard check regardless of what the merchant page says.
        </p>
      )}

      <ErrorBanner message={localError ?? error} onDismiss={() => { setLocalError(null); onClearError(); }} />

      <div className="mt-5 flex items-center justify-end gap-3">
        <button className="btn-primary" disabled={busy || paise === null}>
          {busy ? <Spinner /> : null}
          {busy ? "Hashing intent…" : "Continue to approval"}
        </button>
      </div>
    </form>
  );
}

function Tag({ soft = false }: { soft?: boolean }) {
  return (
    <span
      className={`ml-1.5 rounded px-1.5 py-px text-[9px] font-mono normal-case tracking-normal ${
        soft ? "bg-amber/15 text-amber" : "bg-mint/15 text-mint"
      }`}
    >
      {soft ? "soft" : "hard"}
    </span>
  );
}
