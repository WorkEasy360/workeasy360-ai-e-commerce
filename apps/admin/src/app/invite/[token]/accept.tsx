"use client";

import { useEffect, useState } from "react";
import { api, ApiError, errorMessage } from "../../../lib/api";

type State =
  | { kind: "loading" }
  | { kind: "signed-out" }
  | { kind: "invalid"; message: string }
  | { kind: "ready"; storeName: string; role: string }
  | { kind: "error"; message: string };

const ROLE_NAME: Record<string, string> = { owner: "an owner", admin: "an admin", staff: "staff", fulfillment: "fulfilment staff", analyst: "an analyst" };

export function AcceptInvitation({ token }: { token: string }) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api<{ invitation: { storeName: string; role: string } }>(`/api/v1/invitations/${encodeURIComponent(token)}`)
      .then((r) => {
        if (!cancelled) setState({ kind: "ready", ...r.invitation });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.problem.status === 401) setState({ kind: "signed-out" });
        else if (err instanceof ApiError && err.problem.status === 404) setState({ kind: "invalid", message: err.problem.title });
        else setState({ kind: "error", message: errorMessage(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function accept() {
    setBusy(true);
    try {
      const r = await api<{ storeId: string }>(`/api/v1/invitations/${encodeURIComponent(token)}/accept`, { method: "POST" });
      window.location.assign(`/s/${r.storeId}`);
    } catch (err) {
      setState({ kind: err instanceof ApiError && err.problem.status === 409 ? "invalid" : "error", message: errorMessage(err) });
      setBusy(false);
    }
  }

  if (state.kind === "loading") return <div className="c-card c-skeleton" role="status" aria-label="Checking the invitation" style={{ height: 120 }} />;
  if (state.kind === "signed-out") {
    return (
      <div className="c-card" style={{ display: "grid", gap: 12, textAlign: "center" }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>You&apos;re invited</h1>
        <p className="c-muted" style={{ margin: 0 }}>
          Sign in, or create an account, to see the store and join it.
        </p>
        <a className="c-btn c-btn-primary" href={`/?returnTo=${encodeURIComponent(`/invite/${token}`)}`}>
          Sign in to continue
        </a>
      </div>
    );
  }
  if (state.kind === "invalid" || state.kind === "error") {
    return (
      <div className="c-card" role="alert" style={{ display: "grid", gap: 12, textAlign: "center" }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>This invitation can&apos;t be used</h1>
        <p className="c-muted" style={{ margin: 0 }}>
          {state.message} Ask the person who invited you for a new link.
        </p>
        <a className="c-btn" href="/">
          Go to your stores
        </a>
      </div>
    );
  }
  return (
    <div className="c-card" style={{ display: "grid", gap: 12, textAlign: "center" }}>
      <h1 style={{ margin: 0, fontSize: 22 }}>Join {state.storeName}</h1>
      <p className="c-muted" style={{ margin: 0 }}>
        You&apos;ve been invited to help run this store as {ROLE_NAME[state.role] ?? state.role}.
      </p>
      <button type="button" className="c-btn c-btn-primary" disabled={busy} onClick={() => void accept()}>
        {busy ? "Joining…" : `Join ${state.storeName}`}
      </button>
    </div>
  );
}
