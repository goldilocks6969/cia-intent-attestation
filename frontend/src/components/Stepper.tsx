export type StepKey = "register" | "intent" | "approve" | "certificate";

const STEPS: { key: StepKey; label: string; hint: string }[] = [
  { key: "register", label: "Register", hint: "Bind a passkey" },
  { key: "intent", label: "Intent", hint: "Declare constraints" },
  { key: "approve", label: "Approve", hint: "Biometric signature" },
  { key: "certificate", label: "Certificate", hint: "Signed attestation" },
];

export function Stepper({ current }: { current: StepKey }) {
  const idx = STEPS.findIndex((s) => s.key === current);
  return (
    <ol className="flex items-center gap-2 text-xs">
      {STEPS.map((s, i) => {
        const state = i < idx ? "done" : i === idx ? "active" : "todo";
        return (
          <li key={s.key} className="flex items-center gap-2">
            <div className="flex items-center gap-2">
              <span
                className={[
                  "flex h-6 w-6 items-center justify-center rounded-full border font-mono text-[11px]",
                  state === "done" && "border-mint/60 bg-mint/15 text-mint",
                  state === "active" && "border-mint bg-mint text-ink font-semibold shadow-[0_0_20px_rgba(52,245,197,.5)]",
                  state === "todo" && "border-line text-slate-500",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                {state === "done" ? "✓" : i + 1}
              </span>
              <div className="hidden sm:block leading-tight">
                <div className={state === "todo" ? "text-slate-500" : "text-slate-200 font-medium"}>{s.label}</div>
                <div className="text-[10px] text-slate-500">{s.hint}</div>
              </div>
            </div>
            {i < STEPS.length - 1 && <span className={`h-px w-6 sm:w-10 ${i < idx ? "bg-mint/60" : "bg-line"}`} />}
          </li>
        );
      })}
    </ol>
  );
}
