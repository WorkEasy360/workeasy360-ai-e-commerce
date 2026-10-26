"use client";

import { useEffect, useId, useState } from "react";
import { handleize, MAX_PAGE_BODY, parseContent } from "@workeasy/commerce";
import { ArrowLeftIcon, Card, ExternalIcon, Page, PageHeader, RichContent, TrashIcon } from "@workeasy/ui/react";
import { Dialog } from "@workeasy/ui/client";
import { api, ApiError, errorMessage, storefrontUrl } from "../../../../../../lib/api";
import { useStore } from "../../../store-shell";
import type { StorePage } from "../pages-view";

type Form = Pick<StorePage, "title" | "handle" | "body" | "published"> & { seoTitle: string; seoDescription: string };

const formOf = (p: StorePage): Form => ({ title: p.title, handle: p.handle, body: p.body, published: p.published, seoTitle: p.seoTitle ?? "", seoDescription: p.seoDescription ?? "" });

/** Edits one content page: text with light formatting, its address, search listing, and whether shoppers can see it. */
export function PageEditor({ pageId }: { pageId: string }) {
  const ctx = useStore();
  const id = useId();
  const [page, setPage] = useState<StorePage | undefined>();
  const [form, setForm] = useState<Form | undefined>();
  const [mode, setMode] = useState<"write" | "preview">("write");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [removing, setRemoving] = useState(false);
  const storeId = ctx?.store.id;

  useEffect(() => {
    if (!storeId) return;
    api<{ page: StorePage }>(`/api/v1/stores/${storeId}/pages/${pageId}`)
      .then((r) => {
        setPage(r.page);
        setForm(formOf(r.page));
      })
      .catch((err: unknown) => setError(errorMessage(err)));
  }, [storeId, pageId]);

  if (!ctx) return null;
  const { store } = ctx;
  const base = `/s/${store.id}/design/pages`;
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => (f ? { ...f, [key]: value } : f));

  async function save(published = form!.published) {
    setBusy(true);
    setError(undefined);
    setErrors({});
    setNote(undefined);
    try {
      const r = await api<{ page: StorePage }>(`/api/v1/stores/${store.id}/pages/${pageId}`, { method: "PUT", body: { ...form!, published } });
      setPage(r.page);
      setForm(formOf(r.page));
      setNote(published && !page?.published ? "Published. Add it to a menu so shoppers can find it." : published ? "Saved. Shoppers see the new version." : "Saved as a draft.");
    } catch (err) {
      setErrors(err instanceof ApiError && err.problem.errors ? Object.fromEntries(err.problem.errors.map((e) => [e.field, e.message])) : {});
      setError(errorMessage(err));
    }
    setBusy(false);
  }

  async function remove() {
    try {
      await api(`/api/v1/stores/${store.id}/pages/${pageId}`, { method: "DELETE" });
      window.location.assign(base);
    } catch (err) {
      setError(errorMessage(err));
      setRemoving(false);
    }
  }

  const fieldError = (name: string) => errors[name] && <p className="c-error">{errors[name]}</p>;
  const shopUrl = `${storefrontUrl(store.slug)}/pages/${page?.handle ?? ""}`;
  const changed = page && form && JSON.stringify(formOf(page)) !== JSON.stringify(form);

  return (
    <Page>
      <a className="c-back" href={base}>
        <ArrowLeftIcon size={14} /> Pages
      </a>
      <PageHeader
        title={form?.title || "Untitled page"}
        eyebrow="Store Design"
        subtitle={page ? (page.published ? "Published: shoppers can open it." : "Draft: only you can see it.") : undefined}
        actions={
          page && form ? (
            <>
              {page.published && (
                <a className="c-btn" href={shopUrl} target="_blank" rel="noreferrer">
                  <ExternalIcon size={15} /> View
                </a>
              )}
              <button type="button" className="c-btn c-btn-ghost" onClick={() => setRemoving(true)}>
                <TrashIcon size={15} /> Delete
              </button>
              {page.published ? (
                <>
                  <button type="button" className="c-btn" disabled={busy} onClick={() => void save(false)}>
                    Unpublish
                  </button>
                  <button type="button" className="c-btn c-btn-primary" disabled={busy || !changed} onClick={() => void save()}>
                    {busy ? "Saving…" : "Save"}
                  </button>
                </>
              ) : (
                <>
                  <button type="button" className="c-btn" disabled={busy || !changed} onClick={() => void save()}>
                    Save draft
                  </button>
                  <button type="button" className="c-btn c-btn-primary" disabled={busy} onClick={() => void save(true)}>
                    {busy ? "Saving…" : "Publish"}
                  </button>
                </>
              )}
            </>
          ) : undefined
        }
      />
      {(note || (error && Object.keys(errors).length === 0)) && (
        <p role={error ? "alert" : "status"} className={error ? "c-error" : "c-hint"}>
          {error ?? note}
        </p>
      )}
      {!form ? (
        !error && <div className="c-skeleton" role="status" aria-label="Loading page" style={{ height: 320 }} />
      ) : (
        <div className="c-detail">
          <div className="c-detail-main">
            <Card>
              <div className="c-form">
                <div className="c-field">
                  <label className="c-label" htmlFor={`${id}-title`}>
                    Title
                  </label>
                  <input id={`${id}-title`} className="c-input" value={form.title} maxLength={150} onChange={(e) => set("title", e.target.value)} />
                  {fieldError("title")}
                </div>
                <div className="c-field">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span className="c-label" id={`${id}-body-label`} style={{ margin: 0 }}>
                      Content
                    </span>
                    <div className="c-segmented" role="group" aria-label="Editor view">
                      <button type="button" aria-pressed={mode === "write"} onClick={() => setMode("write")}>
                        Write
                      </button>
                      <button type="button" aria-pressed={mode === "preview"} onClick={() => setMode("preview")}>
                        Preview
                      </button>
                    </div>
                  </div>
                  {mode === "write" ? (
                    <>
                      <textarea
                        id={`${id}-body`}
                        aria-labelledby={`${id}-body-label`}
                        aria-describedby={`${id}-body-help`}
                        className="c-textarea"
                        style={{ minHeight: 380, fontFamily: "var(--we-font-mono, ui-monospace, monospace)", fontSize: 14 }}
                        value={form.body}
                        maxLength={MAX_PAGE_BODY}
                        onChange={(e) => set("body", e.target.value)}
                      />
                      <p className="c-hint" id={`${id}-body-help`} style={{ margin: 0 }}>
                        <code>## Heading</code> · <code>- list item</code> · <code>1. step</code> · <code>**bold**</code> · <code>*italic*</code> · <code>[link text](/products)</code> · <code>[email](mailto:you@shop.in)</code>. A blank line starts a new paragraph.
                      </p>
                    </>
                  ) : (
                    <div className="c-preview-pane" aria-labelledby={`${id}-body-label`}>
                      {form.body.trim() ? <RichContent blocks={parseContent(form.body)} /> : <p className="c-muted">Nothing written yet.</p>}
                    </div>
                  )}
                  {fieldError("body")}
                </div>
              </div>
            </Card>
          </div>
          <div className="c-detail-side">
            <Card title="Address">
              <div className="c-field">
                <label className="c-label" htmlFor={`${id}-handle`}>
                  Page address
                </label>
                <div className="c-input-group">
                  <span>/pages/</span>
                  <input id={`${id}-handle`} className="c-input" value={form.handle} maxLength={100} onChange={(e) => set("handle", e.target.value.toLowerCase())} onBlur={() => set("handle", handleize(form.handle) || handleize(form.title))} />
                </div>
                {fieldError("handle")}
                {page?.published && form.handle !== page.handle && <p className="c-hint">Links in your menus to the old address will stop working; update them under Menus.</p>}
              </div>
            </Card>
            <Card title="Search engine listing">
              <div className="c-form">
                <div className="c-field">
                  <label className="c-label" htmlFor={`${id}-seo-t`}>
                    Title <small>(optional)</small>
                  </label>
                  <input id={`${id}-seo-t`} className="c-input" value={form.seoTitle} maxLength={70} placeholder={form.title} onChange={(e) => set("seoTitle", e.target.value)} />
                </div>
                <div className="c-field">
                  <label className="c-label" htmlFor={`${id}-seo-d`}>
                    Description <small>(optional)</small>
                  </label>
                  <textarea id={`${id}-seo-d`} className="c-textarea" rows={3} value={form.seoDescription} maxLength={320} placeholder="The first paragraph is used when this is empty." onChange={(e) => set("seoDescription", e.target.value)} />
                </div>
              </div>
            </Card>
          </div>
        </div>
      )}
      {removing && page && (
        <Dialog
          open
          onClose={() => setRemoving(false)}
          title={`Delete ${page.title}?`}
          footer={
            <>
              <button type="button" className="c-btn" onClick={() => setRemoving(false)}>
                Keep it
              </button>
              <button type="button" className="c-btn c-btn-danger" onClick={() => void remove()}>
                Delete
              </button>
            </>
          }
        >
          <p style={{ margin: 0 }}>Shoppers following a link to it will see “page not found”. To hide it for now, unpublish it instead.</p>
        </Dialog>
      )}
    </Page>
  );
}
