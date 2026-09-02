import { useCallback, useEffect, useState } from "react";
import { startAuthentication } from "@simplewebauthn/browser";
import type { SignedIntentCertificate } from "@cia/shared/core";
import {
  api,
  errorMessage,
  type AgentRun,
  type CreateIntentResponse,
  type IntentRequest,
  type RegisterVerifyResponse,
} from "./lib/api";
import { Stepper, type StepKey } from "./components/Stepper";
import { RegisterStep } from "./components/RegisterStep";
import { IntentStep } from "./components/IntentStep";
import { ApproveCard } from "./components/ApproveCard";
import { CertificateView } from "./components/CertificateView";
import { AgentRunStep } from "./components/AgentRunStep";

/**
 * Single-page state machine:
 *   register → intent → (creating) → approve → (prompting → verifying) → certificate
 */
type State =
  | { step: "register" }
  | { step: "intent"; userId: string; busy: boolean; error: string | null }
  | {
      step: "approve";
      userId: string;
      pending: CreateIntentResponse;
      phase: "ready" | "prompting" | "verifying";
      error: string | null;
    }
  | {
      step: "certificate";
      userId: string;
      certificate: SignedIntentCertificate;
    }
  | {
      step: "agent";
      userId: string;
      certificate: SignedIntentCertificate;
      lastRun: AgentRun | null;
    };

const GATE_KEY = "cia.gateEnabled";
function loadGate(): boolean {
  try {
    const v = localStorage.getItem(GATE_KEY);
    return v === null ? true : v === "true";
  } catch {
    return true;
  }
}

/** `?preview=certificate` renders a sample certificate so the final screen can be styled/rehearsed without a passkey. */
function initialState(): State {
  const preview = new URLSearchParams(window.location.search).get("preview");
  if (preview === "certificate" || preview === "agent") {
    const issuedAt = Date.now();
    const certificate: SignedIntentCertificate = {
      intentId: "3f2c9c4e-8f2a-4c2e-9b6d-2a1e4d7c8b90",
      intent: {
        userId: "alice",
        merchant: "Amazon.in",
        category: "electronics",
        itemDescription: "USB-C cable, 1m, braided",
        maxPriceMinorUnits: 199990,
        currency: "INR",
        quantity: 1,
        nonce: "5a3e2c0e-4c1e-4f7a-9c2f-0b1d2e3f4a5b",
        issuedAt,
        expiresAt: issuedAt + 10 * 60 * 1000,
      },
      hash: "46ed18fee6b79c2b63a65e65bad08ee8b607f43b59f4f076a2a07f4f155572d0",
      signature:
        "MEUCIQDq4v7k2Z0mF0f9Yw7Q8yG5r1X3Kp2sT4uV6wX8yZ0aBQIgC1dE2fG3hI4jK5lM6nO7pQ8rS9tU0vW1xY2zA3bC4dE",
      authenticatorData: "SZYN5YgOjGh0NBcPZHZgW4_krrmihjLHmVzzuoMdl2MFAAAAAQ",
      clientDataJSON:
        "eyJ0eXBlIjoid2ViYXV0aG4uZ2V0IiwiY2hhbGxlbmdlIjoiTkRabFpERTRabVZsTm1JM09XTXlZall6WVRZMVpUWTFZbUZrTURobFpUaGlOakEzWmpRelpqVTVaalJtTURjMllUSmhNRGRtTkdZeE5UVTFOekprTUEiLCJvcmlnaW4iOiJodHRwOi8vbG9jYWxob3N0OjUxNzMiLCJjcm9zc09yaWdpbiI6ZmFsc2V9",
      credentialID: "pQECAyYgASFYIGx0aGlzLWlzLWEtZGVtby1jcmVkZW50aWFsLWlk",
      rpID: "localhost",
      origin: "http://localhost:5173",
      issuedAt,
      status: "active",
      consumedAt: null,
    };
    return preview === "agent"
      ? { step: "agent", userId: "alice", certificate, lastRun: null }
      : { step: "certificate", userId: "alice", certificate };
  }
  return { step: "register" };
}

export default function App() {
  const [state, setState] = useState<State>(initialState);
  const [gateEnabled, setGateEnabled] = useState<boolean>(loadGate);
  useEffect(() => {
    try {
      localStorage.setItem(GATE_KEY, String(gateEnabled));
    } catch {
      /* ignore */
    }
  }, [gateEnabled]);
  const [health, setHealth] = useState<
    { rpID: string; expectedOrigin: string } | null | "down"
  >(null);

  useEffect(() => {
    api
      .health()
      .then(setHealth)
      .catch(() => setHealth("down"));
  }, []);

  const onRegistered = useCallback(
    (username: string, _r: RegisterVerifyResponse) => {
      // Small pause so the success card is visible before moving on.
      setTimeout(
        () =>
          setState({
            step: "intent",
            userId: username,
            busy: false,
            error: null,
          }),
        900,
      );
    },
    [],
  );

  async function createIntent(req: IntentRequest) {
    if (state.step !== "intent") return;
    setState({ ...state, busy: true, error: null });
    try {
      const pending = await api.createIntent(req);
      setState({
        step: "approve",
        userId: state.userId,
        pending,
        phase: "ready",
        error: null,
      });
    } catch (e) {
      setState({
        step: "intent",
        userId: state.userId,
        busy: false,
        error: errorMessage(e),
      });
    }
  }

  async function approve() {
    if (state.step !== "approve") return;
    const { userId, pending } = state;
    setState({ ...state, phase: "prompting", error: null });
    try {
      const assertion = await startAuthentication({
        optionsJSON: pending.options,
      });
      setState({
        step: "approve",
        userId,
        pending,
        phase: "verifying",
        error: null,
      });
      const { certificate } = await api.attestIntent(
        pending.intentId,
        assertion,
      );
      setState({ step: "certificate", userId, certificate });
    } catch (e) {
      // Challenges are single-use: after any failed attest the pending intent is gone server-side,
      // so send the user back to re-issue rather than letting them retry a dead challenge.
      const msg = errorMessage(e);
      const cancelled = (e as { name?: string })?.name === "NotAllowedError";
      if (cancelled && state.phase !== "verifying") {
        // The prompt was cancelled before any server call — the challenge is still live; allow retry.
        setState({
          step: "approve",
          userId,
          pending,
          phase: "ready",
          error: msg,
        });
      } else {
        setState({
          step: "intent",
          userId,
          busy: false,
          error: `${msg} — please re-submit the intent to get a fresh challenge.`,
        });
      }
    }
  }

  const step: StepKey = state.step;
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [step]);
  const userId = "userId" in state ? state.userId : null;

  return (
    <div className="mx-auto flex min-h-screen max-w-4xl flex-col px-4 py-8 sm:px-6">
      <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="rounded-md bg-mint/15 px-2 py-0.5 font-mono text-xs font-semibold tracking-widest text-mint">
              CIA
            </span>
            <h1 className="text-lg font-semibold tracking-tight">
              Cryptographic Intent Attestation
            </h1>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Sign what you mean, not what the page shows. RFC 8785 · SHA-256 ·
            WebAuthn.
          </p>
        </div>
        <div className="flex items-center gap-3 text-[11px] font-mono text-slate-500">
          {userId && (
            <span className="rounded-full border border-line px-2 py-0.5 text-slate-300">
              {userId}
            </span>
          )}
          <span className="flex items-center gap-1.5">
            <span
              className={`h-1.5 w-1.5 rounded-full ${health === "down" ? "bg-red-500" : health ? "bg-mint" : "bg-slate-600"}`}
            />
            {health === "down"
              ? "backend offline"
              : health
                ? `rp=${health.rpID}`
                : "…"}
          </span>
        </div>
      </header>

      <div className="mb-6">
        <Stepper current={step} />
      </div>

      <main className="flex-1">
        {state.step === "register" && (
          <RegisterStep onRegistered={onRegistered} />
        )}
        {state.step === "intent" && (
          <IntentStep
            userId={state.userId}
            busy={state.busy}
            error={state.error}
            onClearError={() => setState({ ...state, error: null })}
            onSubmit={createIntent}
          />
        )}
        {state.step === "approve" && (
          <ApproveCard
            pending={state.pending}
            phase={state.phase}
            error={state.error}
            onApprove={approve}
            onClearError={() => setState({ ...state, error: null })}
            onBack={() =>
              setState({
                step: "intent",
                userId: state.userId,
                busy: false,
                error: null,
              })
            }
          />
        )}
        {state.step === "certificate" && (
          <CertificateView
            certificate={state.certificate}
            onNewIntent={() =>
              setState({
                step: "intent",
                userId: state.userId,
                busy: false,
                error: null,
              })
            }
            onRunAgent={() =>
              setState({
                step: "agent",
                userId: state.userId,
                certificate: state.certificate,
                lastRun: null,
              })
            }
          />
        )}
        {state.step === "agent" && (
          <AgentRunStep
            certificate={state.certificate}
            gateEnabled={gateEnabled}
            onGateChange={setGateEnabled}
            onRunComplete={(run) => setState({ ...state, lastRun: run })}
            onBack={() =>
              setState({
                step: "certificate",
                userId: state.userId,
                certificate: state.certificate,
              })
            }
          />
        )}
      </main>

      <footer className="mt-10 text-center text-[11px] text-slate-600">
        Hackathon demo · in-memory storage · challenges are single-use
      </footer>
    </div>
  );
}
