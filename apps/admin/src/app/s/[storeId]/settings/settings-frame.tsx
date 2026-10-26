"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { EmptyState, Page, PageHeader, SettingsIcon } from "@workeasy/ui/react";
import { moduleByKey } from "../../../../lib/modules";
import { useStore } from "../store-shell";

/** Settings' page header and tabs; each tab shows only to roles that can use it. */
export function SettingsFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const ctx = useStore();
  const mod = moduleByKey("settings");
  if (!ctx) return null;
  if (!ctx.can("settings.manage")) {
    return (
      <Page>
        <PageHeader title={mod.label} eyebrow={mod.group} />
        <EmptyState icon={<SettingsIcon size={26} />} title="You don't have access to Settings">
          Ask a store owner or admin to change your role if you need it.
        </EmptyState>
      </Page>
    );
  }
  const base = `${ctx.base}/settings`;
  const tabs = [
    { href: base, label: "General", show: true },
    { href: `${base}/checkout`, label: "Checkout", show: true },
    { href: `${base}/staff`, label: "Staff", show: ctx.can("members.manage") },
    { href: `${base}/domain`, label: "Domain", show: ctx.can("store.manage") },
    { href: `${base}/audit`, label: "Audit log", show: ctx.can("audit.read") },
  ];
  return (
    <Page narrow>
      <PageHeader title={mod.label} eyebrow={mod.group} subtitle={mod.summary} />
      <nav className="c-tabs" aria-label="Settings sections">
        {tabs
          .filter((t) => t.show)
          .map((t) => (
            <a key={t.href} href={t.href} aria-current={pathname === t.href ? "page" : undefined}>
              {t.label}
            </a>
          ))}
      </nav>
      {children}
    </Page>
  );
}
