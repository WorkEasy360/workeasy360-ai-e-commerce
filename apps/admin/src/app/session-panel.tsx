"use client";

import { useEffect, useState } from "react";
import { ArrowRightIcon, PlusIcon } from "@workeasy/ui/react";
import { api, ApiError, setStorefrontOrigin, type Me } from "../lib/api";
import { CreateStore } from "./create-store";
import { SignIn } from "./sign-in";

type State = { kind: "loading" } | { kind: "signed-out" } | { kind: "error" } | { kind: "signed-in"; me: Me };

/**
 * The landing page: sign in, then pick a store or create the first one.
 * Someone with exactly one store goes straight to its dashboard, unless they
 * came here to create another (`?new=1`).
 */
export function SessionPanel({ signInFailed, returnTo, createNew }: { signInFailed: boolean; returnTo?: string; createNew: boolean }) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [creating, setCreating] = useState(createNew);

  useEffect(() => {
    let cancelled = false;
    api<Me>("/api/v1/me").then((me) => (setStorefrontOrigin(me.storefrontOrigin), me))
      .then((me) => {
        if (cancelled) return;
        if (returnTo) window.location.replace(returnTo);
        else if (me.stores.length === 1 && !createNew) window.location.replace(`/s/${me.stores[0]!.id}`);
        else setState({ kind: "signed-in", me });
      })
      .catch((err: unknown) => {
        if (!cancelled) setState(err instanceof ApiError && err.problem.status === 401 ? { kind: "signed-out" } : { kind: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [returnTo, createNew]);

  if (state.kind === "loading") {
    return (
      <div className="c-card" role="status" style={{ display: "grid", gap: 10 }}>
        <span className="c-visually-hidden">Checking your session…</span>
        <div className="c-skeleton" style={{ width: "60%" }} />
        <div className="c-skeleton" />
        <div className="c-skeleton" style={{ width: "80%" }} />
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <p className="c-card" role="alert">
        We couldn&apos;t reach Workeasy360. Check your connection and <a href="/">try again</a>.
      </p>
    );
  }

  if (state.kind === "signed-out") {
    return <SignIn signInFailed={signInFailed} {...(returnTo ? { returnTo } : {})} />;
  }

  const { me } = state;
  const name = me.user.displayName ?? "there";
  if (me.stores.length === 0 || creating) {
    return (
      <>
        <CreateStore first={me.stores.length === 0} greeting={name} />
        {me.stores.length > 0 && (
          <button type="button" className="c-link-btn" style={{ justifySelf: "center" }} onClick={() => setCreating(false)}>
            Back to your stores
          </button>
        )}
        <SignOut />
      </>
    );
  }

  return (
    <>
      <section className="c-card" style={{ display: "grid", gap: 14 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20 }}>Welcome back, {name}</h1>
          <p className="c-subtitle" style={{ marginTop: 4 }}>
            Choose a store to manage.
          </p>
        </div>
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
          {me.stores.map((store) => (
            <li key={store.id}>
              <a href={`/s/${store.id}`} className="c-btn" style={{ width: "100%", justifyContent: "flex-start", padding: "10px 12px" }}>
                <span className="c-store-initial" aria-hidden="true">
                  {store.name.slice(0, 1).toUpperCase()}
                </span>
                <span style={{ display: "grid", textAlign: "left", minWidth: 0 }}>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{store.name}</span>
                  <span className="c-cell-sub">
                    /s/{store.slug} · {store.role}
                  </span>
                </span>
                <ArrowRightIcon size={16} />
              </a>
            </li>
          ))}
        </ul>
        <button type="button" className="c-btn c-btn-ghost" onClick={() => setCreating(true)}>
          <PlusIcon size={16} /> Create another store
        </button>
      </section>
      <SignOut />
    </>
  );
}

function SignOut() {
  return (
    <form method="post" action="/auth/logout" style={{ justifySelf: "center" }}>
      <button type="submit" className="c-btn c-btn-ghost c-btn-sm">
        Sign out
      </button>
    </form>
  );
}
