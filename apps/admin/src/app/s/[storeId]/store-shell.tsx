"use client";

import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { BrandMark, CloseIcon, ExternalIcon, LogoutIcon, MenuIcon, PlusIcon, StoreIcon } from "@workeasy/ui/react";
import { ThemeToggle } from "@workeasy/ui/theme-toggle";
import { api, ApiError, storefrontUrl, type Me, type Store, type StoreResponse, type StoreRole } from "../../../lib/api";
import { MODULE_GROUPS, MODULES } from "../../../lib/modules";

export interface StoreContextValue {
  store: Store;
  role: StoreRole;
  permissions: string[];
  userId: string;
  userName: string;
  /** Path prefix for this store's admin pages. */
  base: string;
  can: (permission: string) => boolean;
  /** Replaces the cached store after a settings change, so the shell updates too. */
  setStore: (store: Store) => void;
}

const StoreContext = createContext<StoreContextValue | undefined>(undefined);

/** The current store, role and user for pages inside the shell; undefined while loading. */
export function useStore(): StoreContextValue | undefined {
  return useContext(StoreContext);
}

type State =
  | { kind: "loading" }
  | { kind: "signed-out" }
  | { kind: "not-found" }
  | { kind: "error" }
  | { kind: "ready"; me: Me; detail: StoreResponse };

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts.at(-1)?.[0] ?? "") : "")).toUpperCase() || "?";
}

/**
 * The admin frame for one store: a navy sidebar of the modules the user may
 * open, grouped as in docs/01-design-system.md, and a top bar with the store switcher, a link
 * to the live storefront, the theme toggle and the account menu.
 */
export function StoreShell({ storeId, children }: { storeId: string; children: ReactNode }) {
  const pathname = usePathname();
  const [state, setState] = useState<State>({ kind: "loading" });
  // The drawer belongs to the page it was opened on, so navigating closes it.
  const [navOpenOn, setNavOpenOn] = useState<string | null>(null);
  const navOpen = navOpenOn === pathname;

  useEffect(() => {
    let cancelled = false;
    Promise.all([api<Me>("/api/v1/me"), api<StoreResponse>(`/api/v1/stores/${storeId}`)])
      .then(([me, detail]) => {
        if (!cancelled) setState({ kind: "ready", me, detail });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.problem.status === 401) setState({ kind: "signed-out" });
        else if (err instanceof ApiError && err.problem.status === 404) setState({ kind: "not-found" });
        else setState({ kind: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [storeId]);

  if (state.kind === "signed-out" || state.kind === "not-found" || state.kind === "error") {
    const copy = {
      "signed-out": { title: "Your session has ended", text: "Sign in again to continue where you left off.", action: "Sign in" },
      "not-found": { title: "Store not found", text: "It doesn't exist or you don't have access to it.", action: "Your stores" },
      error: { title: "We couldn't reach Workeasy360", text: "Check your connection and try again.", action: "Try again" },
    }[state.kind];
    return (
      <main className="c-center-page">
        <div className="c-empty" style={{ maxWidth: 440 }}>
          <span className="c-icon-tile c-icon-tile-lg">
            <BrandMark size={34} />
          </span>
          <h2>{copy.title}</h2>
          <p>{copy.text}</p>
          <a className="c-btn c-btn-primary" href={state.kind === "error" ? pathname : "/"}>
            {copy.action}
          </a>
        </div>
      </main>
    );
  }

  const base = `/s/${storeId}`;
  const ready = state.kind === "ready" ? state : undefined;
  const permissions = ready?.detail.permissions ?? [];
  const can = (p: string) => permissions.includes(p);
  const context: StoreContextValue | undefined = ready && {
    store: ready.detail.store,
    role: ready.detail.role,
    permissions,
    userId: ready.me.user.id,
    userName: ready.me.user.displayName ?? "Your account",
    base,
    can,
    setStore: (store) => setState({ ...ready, detail: { ...ready.detail, store } }),
  };
  const visible = MODULES.filter((m) => !m.permission || can(m.permission));
  const isCurrent = (path: string) => (path === "" ? pathname === base : pathname === `${base}${path}` || pathname.startsWith(`${base}${path}/`));
  const otherStores = ready?.me.stores.filter((s) => s.id !== storeId) ?? [];

  return (
    <div className="c-app" data-nav-open={navOpen ? "true" : undefined}>
      <a className="c-skip" href="#main">
        Skip to main content
      </a>
      <nav className="c-sidebar" aria-label="Store">
        <a className="c-sidebar-brand" href={base}>
          <BrandMark size={30} idPrefix="sidebar-mark" />
          <span>
            Workeasy360
            <small>AI Commerce</small>
          </span>
        </a>
        {ready &&
          MODULE_GROUPS.map((group) => {
            const items = visible.filter((m) => m.group === group);
            if (items.length === 0) return null;
            return (
              <div className="c-nav-group" key={group} style={group === "Store" ? { marginTop: "auto", paddingTop: 16 } : undefined}>
                {group !== "Overview" && group !== "Store" && <p className="c-nav-label">{group}</p>}
                <ul className="c-nav">
                  {items.map((m) => (
                    <li key={m.key}>
                      <a href={`${base}${m.path}`} aria-current={isCurrent(m.path) ? "page" : undefined}>
                        {m.icon(18)}
                        {m.label}
                        {m.key === "ai" && <span className="c-nav-tag">AI</span>}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
      </nav>

      <header className="c-topbar">
        <div className="c-topbar-start">
          <button type="button" className="c-btn c-btn-ghost c-btn-icon c-menu-toggle" aria-label={navOpen ? "Close menu" : "Open menu"} aria-expanded={navOpen} onClick={() => setNavOpenOn(navOpen ? null : pathname)}>
            {navOpen ? <CloseIcon /> : <MenuIcon />}
          </button>
          {ready ? (
            <details className="c-menu">
              <summary className="c-btn c-btn-ghost" style={{ maxWidth: "52vw" }}>
                <span className="c-store-chip">
                  <span className="c-store-initial" aria-hidden="true">
                    {ready.detail.store.name.slice(0, 1).toUpperCase()}
                  </span>
                  <span>{ready.detail.store.name}</span>
                </span>
              </summary>
              <div className="c-menu-list" style={{ left: 0, right: "auto" }}>
                <span className="c-menu-note">Your role: {ready.detail.role}</span>
                {otherStores.length > 0 && <hr />}
                {otherStores.map((s) => (
                  <a key={s.id} href={`/s/${s.id}`}>
                    <StoreIcon size={16} /> {s.name}
                  </a>
                ))}
                <hr />
                <a href="/?new=1">
                  <PlusIcon size={16} /> Create a store
                </a>
              </div>
            </details>
          ) : (
            <div className="c-skeleton" style={{ width: 160 }} />
          )}
        </div>
        <div className="c-topbar-end">
          {ready && (
            <a className="c-btn c-btn-sm c-hide-sm" href={storefrontUrl(ready.detail.store.slug)} target="_blank" rel="noreferrer">
              <ExternalIcon size={15} /> View store
            </a>
          )}
          <ThemeToggle />
          {context && (
            <details className="c-menu">
              <summary className="c-btn c-btn-ghost c-btn-icon" aria-label={`Account: ${context.userName}`}>
                <span className="c-avatar" aria-hidden="true">
                  {initials(context.userName)}
                </span>
              </summary>
              <div className="c-menu-list">
                <span className="c-menu-note">
                  Signed in as <strong>{context.userName}</strong>
                </span>
                <a href={storefrontUrl(context.store.slug)} target="_blank" rel="noreferrer">
                  <ExternalIcon size={16} /> View store
                </a>
                <a href="/">
                  <StoreIcon size={16} /> All stores
                </a>
                <hr />
                <form method="post" action="/auth/logout">
                  <button type="submit">
                    <LogoutIcon size={16} /> Sign out
                  </button>
                </form>
              </div>
            </details>
          )}
        </div>
      </header>

      <main className="c-main" id="main" tabIndex={-1}>
        {context ? (
          <StoreContext.Provider value={context}>{children}</StoreContext.Provider>
        ) : (
          <div className="c-page" role="status">
            <span className="c-visually-hidden">Loading your store…</span>
            <div className="c-skeleton" style={{ width: 220, height: 26, marginBottom: 24 }} />
            <div className="c-stats">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="c-card">
                  <div className="c-skeleton" style={{ width: "50%" }} />
                  <div className="c-skeleton" style={{ height: 26, marginTop: 12 }} />
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
