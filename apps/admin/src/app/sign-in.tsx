"use client";

import { useEffect, useId, useState, type FormEvent } from "react";
import { EyeIcon, LockIcon, MailIcon, StoreIcon, Wordmark } from "@workeasy/ui/react";
import { api, errorMessage } from "../lib/api";

type Mode = "sign-in" | "sign-up";

/**
 * Email and password sign-in and sign-up, plus single sign-on when the
 * server has an identity provider. After success the browser goes to
 * `returnTo` (an invitation link) or the landing page.
 */
export function SignIn({ signInFailed, returnTo }: { signInFailed: boolean; returnTo?: string }) {
  const ids = { email: useId(), password: useId(), name: useId() };
  const [mode, setMode] = useState<Mode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(signInFailed ? "Sign-in didn't complete. Please try again." : undefined);
  const [sso, setSso] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    api<{ sso: boolean }>("/auth/methods")
      .then((m) => setSso(m.sso))
      .catch(() => setSso(false));
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const body = mode === "sign-up" ? { email, password, ...(name.trim() ? { name } : {}) } : { email, password };
      await api(`/auth/password/${mode === "sign-up" ? "signup" : "login"}`, { method: "POST", body });
      window.location.assign(returnTo ?? "/");
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  function switchTo(next: Mode) {
    setMode(next);
    setError(undefined);
  }

  const signingUp = mode === "sign-up";
  return (
    <form className="c-card c-form" onSubmit={submit} style={{ gap: 18 }}>
      <div className="c-auth-wordmark">
        <Wordmark size={36} />
        <span className="c-brand-badge">
          <StoreIcon size={20} /> Commerce
        </span>
        <h1 style={{ margin: "6px 0 0", fontSize: 30, fontWeight: 800, letterSpacing: "-.02em" }}>{signingUp ? "Create Commerce Account" : "Commerce Login"}</h1>
        <p className="c-subtitle" style={{ margin: 0 }}>
          {signingUp ? "Create your account, then set up your store in a minute." : "Manage your store, products, orders and customers."}
        </p>
      </div>
      {signingUp && (
        <div className="c-field">
          <label className="c-label" htmlFor={ids.name}>
            Your name <small>(optional)</small>
          </label>
          <input id={ids.name} className="c-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} autoComplete="name" />
        </div>
      )}
      <div className="c-field">
        <label className="c-label" htmlFor={ids.email}>
          Email Address
        </label>
        <span className="c-input-icon">
          <MailIcon size={20} />
          <input id={ids.email} className="c-input" type="email" placeholder="Enter your email" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={254} autoComplete="email" />
        </span>
      </div>
      <div className="c-field">
        <label className="c-label" htmlFor={ids.password}>
          Password
        </label>
        <span className="c-input-icon c-password">
          <LockIcon size={20} />
          <input
            id={ids.password}
            className="c-input"
            type={showPassword ? "text" : "password"}
            placeholder="Enter your password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={signingUp ? 10 : 1}
            maxLength={200}
            autoComplete={signingUp ? "new-password" : "current-password"}
            aria-describedby={signingUp ? `${ids.password}-hint` : undefined}
          />
          <button type="button" className="c-btn c-btn-ghost c-btn-icon" aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword} onClick={() => setShowPassword(!showPassword)}>
            <EyeIcon size={20} />
          </button>
        </span>
        {signingUp && (
          <p id={`${ids.password}-hint`} className="c-hint">
            At least 10 characters.
          </p>
        )}
      </div>
      {error && (
        <p role="alert" className="c-error">
          {error}
        </p>
      )}
      <button type="submit" className="c-btn c-btn-brand c-btn-lg" disabled={busy || email === "" || password === ""}>
        {busy ? (signingUp ? "Creating account…" : "Logging in…") : signingUp ? "Create Commerce Account" : "Log In to Commerce"}
      </button>
      <span className="c-auth-or">OR</span>
      <button type="button" className="c-btn c-btn-outline-brand c-btn-lg" onClick={() => switchTo(signingUp ? "sign-in" : "sign-up")}>
        {signingUp ? "I already have an account" : "Create Commerce Account"}
      </button>
      {sso && (
        <p style={{ margin: 0, fontSize: 14, textAlign: "center" }}>
          <a href={`/auth/login${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ""}`}>Sign in with single sign-on</a>
        </p>
      )}
    </form>
  );
}
