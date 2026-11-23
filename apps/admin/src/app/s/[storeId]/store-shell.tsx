"use client";

import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { BrandMark, ChevronDownIcon, CloseIcon, ExternalIcon, EyeIcon, LogoutIcon, MenuIcon, MoreIcon, PlusIcon, PRODUCT_NAME, StoreIcon } from "@workeasy/ui/react";
import { ThemeToggle } from "@workeasy/ui/theme-toggle";
import { api, ApiError, setServerInfo, storefrontUrl, type Me, type Store, type StoreResponse, type StoreRole } from "../../../lib/api";
import { moduleByKey, MODULES, sectionOf, SECTIONS, type AdminSection, type ModuleKey } from "../../../lib/modules";
import { AssistantPanel } from "./assistant-panel";
import { GlobalSearch, Notifications } from "./shell-tools";

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
 * The admin frame for one store, as in the Commerce designs: a deep teal
 * sidebar with the WorkEasy360 wordmark, the Commerce badge, the eight
 * sections and a "Your store is live" card; a top bar with the store
 * switcher, search, notifications and the signed-in person;
 * pill tabs for sections with several pages; and on phones a bottom tab bar.
 */
export function StoreShell({ storeId, children }: { storeId: string; children: ReactNode }) {
  const pathname = usePathname();
  const [state, setState] = useState<State>({ kind: "loading" });
  // Orders waiting to be packed and sent, for the count beside Orders.
  const [toFulfil, setToFulfil] = useState(0);
  const canOrders = state.kind === "ready" && state.detail.permissions.includes("orders.read");
  useEffect(() => {
    if (!canOrders) return;
    let cancelled = false;
    api<{ counts: { unfulfilled: number } }>(`/api/v1/stores/${storeId}/orders?limit=1`)
      .then((r) => !cancelled && setToFulfil(r.counts.unfulfilled))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [storeId, canOrders]);
  // The drawer belongs to the page it was opened on, so navigating closes it.
  const [navOpenOn, setNavOpenOn] = useState<string | null>(null);
  const navOpen = navOpenOn === pathname;

  useEffect(() => {
    let cancelled = false;
    Promise.all([api<Me>("/api/v1/me").then((me) => (setServerInfo(me), me)), api<StoreResponse>(`/api/v1/stores/${storeId}`)])
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
      error: { title: "We couldn't reach Workeasy", text: "Check your connection and try again.", action: "Try again" },
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
  const allowed = (key: ModuleKey) => {
    const m = MODULES.find((x) => x.key === key)!;
    return !m.permission || can(m.permission);
  };
  const isCurrent = (path: string) => (path === "" ? pathname === base : pathname === `${base}${path}` || pathname.startsWith(`${base}${path}/`));
  // The most specific module this page belongs to (Customers over Orders on /orders/customers).
  const here = MODULES.filter((m) => isCurrent(m.path)).toSorted((a, b) => b.path.length - a.path.length)[0];
  const currentSection = here ? sectionOf(here.key) : undefined;
  // Sections the member can open, each linking to its first page they may see.
  const sections = SECTIONS.map((s) => ({ ...s, first: s.modules.find(allowed) })).filter((s): s is AdminSection & { first: ModuleKey } => s.first !== undefined);
  const hrefOf = (key: ModuleKey) => `${base}${moduleByKey(key).path}`;
  // Pill tabs above the page for sections with more than one page (Media Library and AI Studio open from the editors instead).
  const subpages = currentSection ? currentSection.modules.filter((k) => allowed(k) && !moduleByKey(k).under) : [];
  const otherStores = ready?.me.stores.filter((s) => s.id !== storeId) ?? [];
  const live = ready ? storefrontUrl(ready.detail.store.slug) : undefined;

  return (
    <div className="c-app" data-nav-open={navOpen ? "true" : undefined}>
      <a className="c-skip" href="#main">
        Skip to main content
      </a>
      <nav className="c-sidebar" aria-label="Store">
        <a className="c-sidebar-brand" href={base} aria-label={`${PRODUCT_NAME} home`}>
          <BrandMark size={34} />
          <span>
            WorkEasy<b>360</b>
          </span>
        </a>
        <a className="c-brand-badge" href={base} tabIndex={-1} aria-hidden="true">
          <StoreIcon size={22} /> Commerce
        </a>
        {ready && (
          <ul className="c-nav" style={{ marginTop: 14 }}>
            {sections.map((s) => (
              <li key={s.key}>
                <a href={hrefOf(s.first)} aria-current={s.key === currentSection?.key ? "page" : undefined}>
                  {s.icon(22)}
                  {s.label}
                  {s.key === "orders" && toFulfil > 0 && (
                    <span className="c-nav-count" aria-label={`${toFulfil} to fulfil`}>
                      {toFulfil > 99 ? "99+" : toFulfil}
                    </span>
                  )}
                </a>
              </li>
            ))}
          </ul>
        )}
        {ready && live && (
          <div className="c-live-card" style={{ marginTop: "auto" }}>
            <span className="c-live-art" aria-hidden="true">
              <StoreIcon size={30} />
            </span>
            <strong>Your store is live!</strong>
            <a className="c-live-url" href={live} target="_blank" rel="noreferrer">
              {live.replace(/^https?:\/\//, "")} <ExternalIcon size={13} />
            </a>
            <a className="c-btn" href={live} target="_blank" rel="noreferrer">
              <EyeIcon size={18} /> View Store
            </a>
          </div>
        )}
      </nav>

      <header className="c-topbar">
        <div className="c-topbar-start">
          <button type="button" className="c-btn c-btn-ghost c-btn-icon c-menu-toggle" aria-label={navOpen ? "Close menu" : "Open menu"} aria-expanded={navOpen} onClick={() => setNavOpenOn(navOpen ? null : pathname)}>
            {navOpen ? <CloseIcon /> : <MenuIcon />}
          </button>
          <a className="c-topbar-brand" href={base} aria-label={`${PRODUCT_NAME} home`}>
            <BrandMark size={28} />
            <span>
              WorkEasy<b>360</b>
              <small>Commerce</small>
            </span>
          </a>
          {ready ? (
            <details className="c-menu c-store-menu">
              <summary className="c-btn c-btn-ghost c-store-switch" style={{ maxWidth: "52vw" }}>
                <span className="c-store-chip">
                  <span className="c-store-initial" aria-hidden="true">
                    <StoreIcon size={16} />
                  </span>
                  <span>{ready.detail.store.name}</span>
                  <ChevronDownIcon size={16} />
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
          {context && <GlobalSearch base={base} can={can} stores={otherStores} />}
        </div>
        <div className="c-topbar-end" style={{ gap: 8 }}>
          {context && <Notifications storeId={storeId} base={base} can={can} />}
          <ThemeToggle className="c-btn c-btn-ghost c-btn-icon c-theme-toggle" />
          {context && (
            <details className="c-menu">
              <summary className="c-btn c-btn-ghost c-user-chip" aria-label={`Account: ${context.userName}`}>
                <span className="c-avatar" aria-hidden="true">
                  {initials(context.userName)}
                </span>
                <span aria-hidden="true">
                  <strong>{context.userName}</strong>
                  <small>Store {context.role}</small>
                </span>
                <ChevronDownIcon size={16} />
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
          <StoreContext.Provider value={context}>
            {subpages.length > 1 && (
              <nav className="c-subnav" aria-label={currentSection?.label}>
                {subpages.map((k) => (
                  <a key={k} href={hrefOf(k)} aria-current={here?.key === k || here?.under === k ? "page" : undefined}>
                    {moduleByKey(k).label}
                  </a>
                ))}
              </nav>
            )}
            {children}
          </StoreContext.Provider>
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
      {context && <AssistantPanel storeId={storeId} can={can} userName={context.userName} />}
      {ready && (
        <nav className="c-tabbar" aria-label="Main sections">
          {sections
            .filter((s) => ["home", "orders", "catalog", "storefront"].includes(s.key))
            .map((s) => (
              <a key={s.key} href={hrefOf(s.first)} aria-current={s.key === currentSection?.key ? "page" : undefined}>
                {s.icon(22)}
                {s.short ?? s.label}
              </a>
            ))}
          <button type="button" aria-expanded={navOpen} onClick={() => setNavOpenOn(navOpen ? null : pathname)}>
            <MoreIcon size={22} />
            More
          </button>
        </nav>
      )}
    </div>
  );
}
