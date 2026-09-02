import { useState, type FormEvent } from "react";
import { startRegistration, browserSupportsWebAuthn, platformAuthenticatorIsAvailable } from "@simplewebauthn/browser";
import { api, errorMessage, type RegisterVerifyResponse } from "../lib/api";
import { ErrorBanner } from "./ErrorBanner";
import { useEffect } from "react";

interface Props {
  onRegistered: (username: string, result: RegisterVerifyResponse) => void;
}

export function RegisterStep({ onRegistered }: Props) {
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RegisterVerifyResponse | null>(null);
  const [platformOk, setPlatformOk] = useState<boolean | null>(null);

  useEffect(() => {
    if (!browserSupportsWebAuthn()) {
      setPlatformOk(false);
      return;
    }
    platformAuthenticatorIsAvailable().then(setPlatformOk).catch(() => setPlatformOk(false));
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const name = username.trim();
    if (!name) return setError("Enter a username");
    setBusy(true);
    try {
      const options = await api.registerBegin(name);
      const attResp = await startRegistration({ optionsJSON: options });
      const verified = await api.registerVerify(name, attResp);
      setResult(verified);
      onRegistered(name, verified);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <div className="card animate-fadeUp">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-mint/15 text-mint text-xl">✓</span>
          <div>
            <h2 className="text-lg font-semibold">Passkey registered</h2>
            <p className="text-sm text-slate-400">
              <span className="text-slate-200">{result.username}</span> is bound to a{" "}
              {result.credentialDeviceType === "multiDevice" ? "synced" : "device-bound"} passkey
              {result.credentialBackedUp ? " (backed up)" : ""}.
            </p>
          </div>
        </div>
        <dl className="kv mt-5">
          <dt className="k">Credential ID</dt>
          <dd className="v text-slate-300">{result.credentialID}</dd>
        </dl>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="card animate-fadeUp">
      <h2 className="text-lg font-semibold">Register a passkey</h2>
      <p className="mt-1 text-sm text-slate-400">
        Your device's authenticator generates a key pair. The public key is stored server-side; the private key never leaves the
        secure enclave.
      </p>
      <div className="mt-5">
        <label className="label" htmlFor="username">Username</label>
        <input
          id="username"
          className="input"
          placeholder="alice"
          autoComplete="username webauthn"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          disabled={busy}
        />
      </div>
      {platformOk === false && (
        <p className="mt-3 text-xs text-amber">
          No platform authenticator detected. You can still use a security key or a phone via QR.
        </p>
      )}
      <ErrorBanner message={error} onDismiss={() => setError(null)} />
      <div className="mt-5 flex items-center gap-3">
        <button className="btn-primary" disabled={busy || !username.trim()}>
          {busy ? <Spinner /> : <FingerprintIcon />}
          {busy ? "Waiting for authenticator…" : "Create passkey"}
        </button>
      </div>
    </form>
  );
}

export function Spinner() {
  return <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />;
}

export function FingerprintIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
      <path d="M12 11a3 3 0 0 0-3 3c0 2.5.5 4.5 1.5 6.5" />
      <path d="M15 14c0 2-.3 4-1 6" />
      <path d="M6.5 8.5A7 7 0 0 1 19 12c0 1.5-.2 3-.5 4.5" />
      <path d="M4.5 12a7.5 7.5 0 0 1 .8-3.4" />
      <path d="M9 20a12 12 0 0 1-.9-3" />
      <path d="M8.5 5.2A9 9 0 0 1 21 12" />
    </svg>
  );
}
