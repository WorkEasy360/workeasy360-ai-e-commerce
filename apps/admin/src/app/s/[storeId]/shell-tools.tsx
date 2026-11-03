"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { BellIcon, SearchIcon, SettingsIcon, StoreIcon } from "@workeasy/ui/react";
import { api } from "../../../lib/api";
import { MODULES } from "../../../lib/modules";

interface Destination {
  key: string;
  label: string;
  href: string;
  /** Where it lives, shown on the right. */
  where: string;
  icon: ReactNode;
  /** Extra words that should find it. */
  keywords?: string;
}

/** Pages inside a module worth jumping to directly, each with the permission that opens it. */
const SUBPAGES: ReadonlyArray<{ path: string; label: string; where: string; permission: string; keywords?: string }> = [
  { path: "/products/new", label: "Add product", where: "Products", permission: "products.manage", keywords: "new create" },
  { path: "/collections/new", label: "Create collection", where: "Collections", permission: "products.manage", keywords: "new" },
  { path: "/orders/customers", label: "Customers", where: "Orders", permission: "customers.read", keywords: "buyers people" },
  { path: "/orders/abandoned", label: "Abandoned checkouts", where: "Orders", permission: "orders.read", keywords: "carts" },
  { path: "/orders/bookings", label: "Bookings", where: "Orders", permission: "orders.read", keywords: "calendar appointments slots" },
  { path: "/design/pages", label: "Content pages", where: "Store Design", permission: "design.manage", keywords: "about privacy terms policy" },
  { path: "/settings/checkout", label: "Checkout settings", where: "Settings", permission: "settings.manage", keywords: "whatsapp telegram pickup" },
  { path: "/settings/staff", label: "Staff and invitations", where: "Settings", permission: "members.manage", keywords: "team members roles invite" },
  { path: "/settings/domain", label: "Custom domain", where: "Settings", permission: "store.manage", keywords: "dns url address" },
  { path: "/settings/audit", label: "Audit log", where: "Settings", permission: "audit.read", keywords: "history activity" },
];

/**
 * Search in the top bar: a combobox that jumps to any module or page the
 * user's role can open, and to their other stores. "/" or Ctrl+K focuses it.
 */
export function GlobalSearch({ base, can, stores }: { base: string; can: (permission: string) => boolean; stores: ReadonlyArray<{ id: string; name: string }> }) {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const all: Destination[] = [
    ...MODULES.filter((m) => !m.permission || can(m.permission)).map((m) => ({ key: m.key, label: m.label, href: `${base}${m.path}`, where: m.group, icon: m.icon(16), keywords: m.summary })),
    ...SUBPAGES.filter((p) => can(p.permission)).map((p) => ({ key: p.path, label: p.label, href: `${base}${p.path}`, where: p.where, icon: <SettingsIcon size={16} />, keywords: p.keywords })),
    ...stores.map((s) => ({ key: s.id, label: s.name, href: `/s/${s.id}`, where: "Switch store", icon: <StoreIcon size={16} /> })),
  ];
  const q = query.trim().toLowerCase();
  const results = q ? all.filter((d) => `${d.label} ${d.where} ${d.keywords ?? ""}`.toLowerCase().includes(q)).slice(0, 8) : all.slice(0, 8);
  const current = Math.min(active, Math.max(results.length - 1, 0));

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const typing = target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
      if ((e.key === "k" && (e.ctrlKey || e.metaKey)) || (e.key === "/" && !typing)) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const go = (d: Destination | undefined) => {
    if (d) window.location.assign(d.href);
  };

  return (
    <div className="c-topsearch">
      <SearchIcon size={16} />
      <input
        ref={inputRef}
        className="c-input"
        type="text"
        role="combobox"
        aria-label="Search pages and modules"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && results[current] ? `${listId}-${current}` : undefined}
        placeholder="Search"
        value={query}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setOpen(true);
            if (results.length) setActive((current + (e.key === "ArrowDown" ? 1 : results.length - 1)) % results.length);
          } else if (e.key === "Enter" && open) {
            e.preventDefault();
            go(results[current]);
          } else if (e.key === "Escape") {
            if (open) setOpen(false);
            else setQuery("");
          }
        }}
      />
      {!open && (
        <kbd className="c-kbd" aria-hidden="true">
          /
        </kbd>
      )}
      {open && (
        <ul className="c-listbox" id={listId} role="listbox" aria-label="Results">
          {results.length === 0 && <li className="c-listbox-empty">Nothing matches “{query.trim()}”.</li>}
          {results.map((d, i) => (
            <li
              key={d.key}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === current}
              // Pressing keeps focus in the input, so the list stays open until the page changes.
              onMouseDown={(e) => {
                e.preventDefault();
                go(d);
              }}
              onMouseMove={() => setActive(i)}
            >
              {d.icon}
              {d.label}
              <small>{d.where}</small>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface Notice {
  key: string;
  title: string;
  detail: string;
  href: string;
  tone: "warning" | "error" | "info";
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * What needs attention in this store, from the same counts the Orders,
 * Reviews and Inventory pages show: unpaid and unfulfilled orders, reviews
 * waiting for moderation, and stock that is low or gone. Each role sees only
 * what it can act on. Counts refresh whenever the menu opens.
 */
export function Notifications({ storeId, base, can }: { storeId: string; base: string; can: (permission: string) => boolean }) {
  const [notices, setNotices] = useState<Notice[] | undefined>();
  const canOrders = can("orders.read");
  const canReviews = can("reviews.manage");
  const canStock = can("inventory.read");

  const load = useCallback(async (): Promise<Notice[]> => {
    const store = `/api/v1/stores/${storeId}`;
    const [orders, reviews, stock] = await Promise.all([
      canOrders ? api<{ counts: { unpaid: number; unfulfilled: number } }>(`${store}/orders?limit=1`).catch(() => undefined) : undefined,
      canReviews ? api<{ counts: { pending: number } }>(`${store}/reviews?status=pending`).catch(() => undefined) : undefined,
      canStock ? api<{ summary: { low: number; out: number } }>(`${store}/inventory?limit=1`).catch(() => undefined) : undefined,
    ]);
    const list: Notice[] = [];
    if (orders?.counts.unpaid)
      list.push({ key: "unpaid", tone: "warning", href: `${base}/orders`, title: plural(orders.counts.unpaid, "order awaiting payment", "orders awaiting payment"), detail: "Mark chat and offline orders as paid when the money arrives." });
    if (orders?.counts.unfulfilled)
      list.push({ key: "unfulfilled", tone: "info", href: `${base}/orders`, title: plural(orders.counts.unfulfilled, "order to fulfil", "orders to fulfil"), detail: "Pack, ship and add tracking." });
    if (reviews?.counts.pending)
      list.push({ key: "reviews", tone: "info", href: `${base}/reviews`, title: plural(reviews.counts.pending, "review to moderate", "reviews to moderate"), detail: "Publish, hide or reply." });
    if (stock?.summary.out)
      list.push({ key: "out", tone: "error", href: `${base}/inventory`, title: plural(stock.summary.out, "item out of stock", "items out of stock"), detail: "Shoppers can't buy these until you restock." });
    if (stock?.summary.low)
      list.push({ key: "low", tone: "warning", href: `${base}/inventory`, title: plural(stock.summary.low, "item running low", "items running low"), detail: "At or below the low-stock threshold." });
    return list;
  }, [storeId, base, canOrders, canReviews, canStock]);

  useEffect(() => {
    let cancelled = false;
    void load().then((list) => {
      if (!cancelled) setNotices(list);
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  if (!canOrders && !canReviews && !canStock) return null;
  const count = notices?.length ?? 0;
  return (
    <details
      className="c-menu"
      onToggle={(e) => {
        if (e.currentTarget.open) void load().then(setNotices);
      }}
    >
      <summary className="c-btn c-btn-ghost c-btn-icon c-icon-count" aria-label={count ? `Notifications: ${count} need attention` : "Notifications"}>
        <BellIcon />
        {count > 0 && (
          <span className="c-count" aria-hidden="true">
            {count}
          </span>
        )}
      </summary>
      <div className="c-menu-list c-notices">
        <span className="c-menu-title">Needs attention</span>
        {notices === undefined && <span className="c-menu-note">Checking…</span>}
        {notices?.length === 0 && <span className="c-menu-note">You&apos;re all caught up.</span>}
        {notices?.map((n) => (
          <a key={n.key} href={n.href}>
            <i className="c-notice-dot" data-tone={n.tone} aria-hidden="true" />
            <span>
              {n.title}
              <small>{n.detail}</small>
            </span>
          </a>
        ))}
      </div>
    </details>
  );
}
