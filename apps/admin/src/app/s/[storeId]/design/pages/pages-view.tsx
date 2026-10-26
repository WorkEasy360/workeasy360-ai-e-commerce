"use client";

import { useCallback, useEffect, useState } from "react";
import { PAGE_TEMPLATES } from "@workeasy/commerce";
import { ArrowLeftIcon, Badge, EmptyState, ExternalIcon, FileIcon, Page, PageHeader, PlusIcon } from "@workeasy/ui/react";
import { Dialog } from "@workeasy/ui/client";
import { api, errorMessage, storefrontUrl } from "../../../../../lib/api";
import { useStore } from "../../store-shell";

export interface StorePage {
  id: string;
  handle: string;
  title: string;
  body: string;
  seoTitle: string | null;
  seoDescription: string | null;
  published: boolean;
  updatedAt: string;
}

/** Store Design → Pages: About us, policies and other pages, started from templates. */
export function PagesView() {
  const ctx = useStore();
  const [items, setItems] = useState<StorePage[] | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [choosing, setChoosing] = useState(false);
  const [busy, setBusy] = useState<string | undefined>();
  const storeId = ctx?.store.id;
  const allowed = ctx?.can("design.manage") ?? false;

  const refresh = useCallback(() => {
    if (!storeId || !allowed) return;
    api<{ items: StorePage[] }>(`/api/v1/stores/${storeId}/pages`)
      .then((r) => setItems(r.items))
      .catch((err: unknown) => setError(errorMessage(err)));
  }, [storeId, allowed]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (!ctx) return null;
  const { store } = ctx;
  const base = `/s/${store.id}/design`;
  if (!allowed) {
    return (
      <EmptyState icon={<FileIcon size={26} />} title="You can't edit the store's pages">
        Ask an owner or admin for access to Store Design.
      </EmptyState>
    );
  }

  const taken = new Set(items?.map((p) => p.handle));
  const missing = PAGE_TEMPLATES.filter((t) => !taken.has(t.handle));

  /** Creates a draft (from a template, or blank) and opens it. */
  async function create(handle: string | null) {
    setBusy(handle ?? "blank");
    setError(undefined);
    try {
      const t = PAGE_TEMPLATES.find((x) => x.handle === handle);
      const body = t
        ? { title: t.title, handle: t.handle, body: t.body({ name: store.name, email: store.contactEmail }) }
        : { title: "Untitled page", handle: `page-${Date.now().toString(36)}`, body: "" };
      const r = await api<{ page: StorePage }>(`/api/v1/stores/${store.id}/pages`, { method: "POST", body });
      window.location.assign(`${base}/pages/${r.page.id}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(undefined);
    }
  }

  /** Adds every standard page that's missing, as drafts. */
  async function addStandard() {
    setBusy("all");
    setError(undefined);
    try {
      for (const t of missing) {
        await api(`/api/v1/stores/${store.id}/pages`, { method: "POST", body: { title: t.title, handle: t.handle, body: t.body({ name: store.name, email: store.contactEmail }) } });
      }
      refresh();
    } catch (err) {
      setError(errorMessage(err));
    }
    setBusy(undefined);
  }

  const add = (
    <button type="button" className="c-btn c-btn-primary" onClick={() => setChoosing(true)}>
      <PlusIcon size={16} /> Add page
    </button>
  );

  return (
    <Page>
      <a className="c-back" href={base}>
        <ArrowLeftIcon size={14} /> Store Design
      </a>
      <PageHeader title="Pages" eyebrow="Store Design" subtitle="About us, shipping and returns policies, contact details: pages you can link from your menus." actions={items && items.length > 0 ? add : undefined} />
      {error && (
        <p role="alert" className="c-error">
          {error}
        </p>
      )}
      {items && items.length === 0 ? (
        <EmptyState
          icon={<FileIcon size={26} />}
          title="No pages yet"
          actions={
            <>
              <button type="button" className="c-btn c-btn-primary" disabled={busy !== undefined} onClick={() => void addStandard()}>
                {busy === "all" ? "Adding…" : "Add the standard pages"}
              </button>
              {add}
            </>
          }
        >
          Start with About us, Shipping, Returns, Privacy, Terms and Contact, filled in with your store&apos;s name. They stay as drafts until you publish them.
        </EmptyState>
      ) : (
        <div className="c-table-wrap">
          <table className="c-table c-table-stack">
            <caption className="c-visually-hidden">Pages</caption>
            <thead>
              <tr>
                <th scope="col">Page</th>
                <th scope="col">Status</th>
                <th scope="col">Updated</th>
                <th scope="col">
                  <span className="c-visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {items === undefined ? (
                <tr>
                  <td colSpan={4}>
                    <div className="c-skeleton" role="status" aria-label="Loading pages" />
                  </td>
                </tr>
              ) : (
                items.map((p) => (
                  <tr key={p.id}>
                    <td data-label="Page">
                      <a className="c-cell-title" href={`${base}/pages/${p.id}`}>
                        {p.title}
                      </a>
                      <span className="c-cell-sub">/pages/{p.handle}</span>
                    </td>
                    <td data-label="Status">
                      <Badge tone={p.published ? "success" : "neutral"}>{p.published ? "Published" : "Draft"}</Badge>
                    </td>
                    <td data-label="Updated">{new Date(p.updatedAt).toLocaleDateString(undefined, { dateStyle: "medium" })}</td>
                    <td data-label="Actions" className="c-num">
                      {p.published && (
                        <a className="c-btn c-btn-sm c-btn-ghost" href={`${storefrontUrl(store.slug)}/pages/${p.handle}`} target="_blank" rel="noreferrer">
                          <ExternalIcon size={13} /> View
                        </a>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
      {items && items.length > 0 && (
        <p className="c-hint" style={{ marginTop: 12 }}>
          To show a page in your shop&apos;s header or footer, add it under Store Design → Menus &amp; languages. Published pages are listed there.
        </p>
      )}
      {choosing && (
        <Dialog
          open
          wide
          onClose={() => setChoosing(false)}
          title="Add a page"
          footer={
            <button type="button" className="c-btn" onClick={() => setChoosing(false)}>
              Cancel
            </button>
          }
        >
          <div className="c-radio-row" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
            <button type="button" className="c-template" disabled={busy !== undefined} onClick={() => void create(null)}>
              <strong>Blank page</strong>
              <span>Start from scratch.</span>
            </button>
            {PAGE_TEMPLATES.map((t) => (
              <button key={t.handle} type="button" className="c-template" disabled={busy !== undefined || taken.has(t.handle)} onClick={() => void create(t.handle)}>
                <strong>{t.title}</strong>
                <span>{taken.has(t.handle) ? "Already added" : t.note}</span>
              </button>
            ))}
          </div>
        </Dialog>
      )}
    </Page>
  );
}
