"use client";

import { useEffect, useId, useState, type FormEvent } from "react";
import { EyeIcon, LockIcon, MailIcon, StoreIcon, Wordmark } from "@workeasy/ui/react";
import { api, errorMessage } from "../lib/api";
import { SSO_ERROR_MESSAGES } from "./workeasy360";

type Mode = "sign-in" | "sign-up";

interface Methods {
  password: boolean;
  sso: boolean;
  /** WorkEasy360 Accounts (docs/workeasy360-sso.md). */
  workeasy360?: boolean;
}

/**
 * Email and password sign-in and sign-up, plus "Continue with WorkEasy360"
 * and single sign-on when the server offers them. After success the browser
 * goes to `returnTo` (an invitation link) or the landing page. This page never
 * starts a WorkEasy360 sign-in by itself: the person chooses.
 */
export function SignIn({ signInFailed, returnTo, ssoError }: { signInFailed: boolean; returnTo?: string; ssoError?: string }) {
  const ids = { email: useId(), password: useId(), name: useId() };
  const [mode, setMode] = useState<Mode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(
    ssoError ? (SSO_ERROR_MESSAGES[ssoError] ?? "Sign-in didn't complete. Please try again.") : signInFailed ? "Sign-in didn't complete. Please try again." : undefined,
  );
  const [methods, setMethods] = useState<Methods>({ password: true, sso: false });
  const { sso, workeasy360 } = methods;
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    api<Methods>("/auth/methods")
      .then(setMethods)
      .catch(() => setMethods({ password: true, sso: false }));
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
  const workeasy360Button = workeasy360 && (
    <a className="c-btn c-btn-brand" href="/auth/workeasy360/start">
      Continue with WorkEasy360
    </a>
  );
  if (!methods.password) {
    // WorkEasy360 is the only way in (WORKEASY360_SSO_ONLY).
    return (
      <div className="c-card c-form">
        <div>
          <h1 style={{ margin: 0, fontSize: "var(--we-font-size-xl)" }}>Sign in</h1>
          <p className="c-subtitle" style={{ marginTop: 4 }}>
            Sign in with your WorkEasy360 account to manage your stores.
          </p>
        </div>
        {error && (
          <p role="alert" className="c-error" style={{ margin: 0 }}>
            {error}
          </p>
        )}
        {workeasy360Button}
      </div>
    );
  }
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
      {!signingUp && workeasy360Button}
      {!signingUp && workeasy360 && <p style={{ margin: 0, fontSize: 14 }}>Or with your email and password:</p>}
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
