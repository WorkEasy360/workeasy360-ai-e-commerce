"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { CopyIcon, DownloadIcon, EmptyState, MediaIcon, Page, PageHeader, SearchIcon, TrashIcon } from "@workeasy/ui/react";
import { Dialog } from "@workeasy/ui/client";
import { api, errorMessage } from "../../../../lib/api";
import { formatBytes, mediaUrl, type MediaAsset, type MediaKind } from "../../../../lib/catalog";
import { moduleByKey } from "../../../../lib/modules";
import { DropZone, MediaStatus, rejectText, Thumb } from "../../../../components/media";
import { useStore } from "../store-shell";

interface MediaPage {
  items: MediaAsset[];
  nextCursor?: string;
}

interface Usage {
  products: Array<{ id: string; title: string; as: "media" | "file" }>;
  collections: Array<{ id: string; title: string }>;
}

const KIND_LABELS: Record<MediaKind, string> = { image: "Image", video: "Video", file: "Download file" };

/** One asset's details: preview, alt text, where it's used, and download or delete. */
function MediaDetails({ storeId, base, media, canDelete, onClose, onChange, onDelete }: {
  storeId: string;
  base: string;
  media: MediaAsset;
  canDelete: boolean;
  onClose: () => void;
  onChange: (m: MediaAsset) => void;
  onDelete: (id: string) => void;
}) {
  const ids = { name: useId(), alt: useId(), folder: useId() };
  const [filename, setFilename] = useState(media.filename);
  const [altText, setAltText] = useState(media.altText);
  const [folder, setFolder] = useState(media.folder);
  const [usage, setUsage] = useState<Usage | undefined>();
  const [status, setStatus] = useState<{ ok: boolean; text: string } | undefined>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ media: MediaAsset; usage: Usage }>(`/api/v1/stores/${storeId}/media/${media.id}`)
      .then((r) => setUsage(r.usage))
      .catch(() => setUsage({ products: [], collections: [] }));
  }, [storeId, media.id]);

  const dirty = filename !== media.filename || altText !== media.altText || folder !== media.folder;
  async function save() {
    setBusy(true);
    try {
      const r = await api<{ media: MediaAsset }>(`/api/v1/stores/${storeId}/media/${media.id}`, { method: "PATCH", body: { filename, altText, folder } });
      onChange(r.media);
      setStatus({ ok: true, text: "Saved." });
    } catch (err) {
      setStatus({ ok: false, text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  async function download() {
    try {
      const r = await api<{ url: string }>(`/api/v1/stores/${storeId}/media/${media.id}/download`);
      window.location.assign(r.url);
    } catch (err) {
      setStatus({ ok: false, text: errorMessage(err) });
    }
  }

  async function remove() {
    const used = (usage?.products.length ?? 0) + (usage?.collections.length ?? 0);
    if (!window.confirm(used > 0 ? `This file is used in ${used} place${used === 1 ? "" : "s"}. Delete it anyway? Products lose this image.` : `Delete ${media.filename}?`)) return;
    try {
      await api(`/api/v1/stores/${storeId}/media/${media.id}`, { method: "DELETE" });
      onDelete(media.id);
      onClose();
    } catch (err) {
      setStatus({ ok: false, text: errorMessage(err) });
    }
  }

  const used = usage ? [...usage.products.map((p) => ({ href: `${base}/products/${p.id}`, title: p.title, as: p.as === "file" ? "delivered file" : "product image" })), ...usage.collections.map((c) => ({ href: `${base}/collections/${c.id}`, title: c.title, as: "collection image" }))] : undefined;

  return (
    <Dialog
      open
      side
      onClose={onClose}
      title="File details"
      footer={
        <>
          {canDelete && (
            <button type="button" className="c-btn c-btn-danger" style={{ marginRight: "auto" }} onClick={() => void remove()}>
              <TrashIcon size={15} /> Delete
            </button>
          )}
          <button type="button" className="c-btn c-btn-primary" disabled={busy || !dirty || media.status !== "ready"} onClick={() => void save()}>
            {busy ? "Saving…" : "Save"}
          </button>
        </>
      }
    >
      {media.kind === "image" && media.status === "ready" ? (
        <img src={mediaUrl(media.id)} alt={media.altText} style={{ width: "100%", borderRadius: 14, border: "1px solid var(--we-color-border)", background: "var(--we-color-surface)" }} />
      ) : media.kind === "video" && media.status === "ready" ? (
        <video src={mediaUrl(media.id)} controls style={{ width: "100%", borderRadius: 14 }} />
      ) : (
        <Thumb media={media} size="lg" />
      )}
      {media.status === "rejected" && (
        <p role="alert" className="c-error">
          {rejectText(media)}
        </p>
      )}
      <dl className="c-kv">
        <dt>Type</dt>
        <dd>
          {KIND_LABELS[media.kind]} · {media.contentType ?? "checking…"}
        </dd>
        <dt>Size</dt>
        <dd>
          {formatBytes(media.byteSize)}
          {media.width && media.height ? ` · ${media.width}×${media.height}` : ""}
        </dd>
        <dt>Uploaded</dt>
        <dd>{new Date(media.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</dd>
        <dt>Access</dt>
        <dd>{media.visibility === "public" ? "Public: shown on your storefront" : "Private: buyers get a signed link after paying"}</dd>
      </dl>
      <div className="c-field">
        <label className="c-label" htmlFor={ids.name}>
          Name
        </label>
        <input id={ids.name} className="c-input" value={filename} maxLength={200} onChange={(e) => setFilename(e.target.value)} />
      </div>
      {media.kind !== "file" && (
        <div className="c-field">
          <label className="c-label" htmlFor={ids.alt}>
            Alt text
          </label>
          <textarea id={ids.alt} className="c-textarea" rows={2} maxLength={500} value={altText} onChange={(e) => setAltText(e.target.value)} placeholder="Describe the image for people using screen readers" />
          <p className="c-hint">Also helps your products show up in image search.</p>
        </div>
      )}
      <div className="c-field">
        <label className="c-label" htmlFor={ids.folder}>
          Folder <small>(optional)</small>
        </label>
        <input id={ids.folder} className="c-input" value={folder} maxLength={100} onChange={(e) => setFolder(e.target.value)} />
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {media.status === "ready" && media.visibility === "public" && (
          <button
            type="button"
            className="c-btn c-btn-sm"
            onClick={() => {
              void navigator.clipboard?.writeText(new URL(mediaUrl(media.id), window.location.origin).toString());
              setStatus({ ok: true, text: "Link copied." });
            }}
          >
            <CopyIcon size={14} /> Copy link
          </button>
        )}
        {media.status === "ready" && (
          <button type="button" className="c-btn c-btn-sm" onClick={() => void download()}>
            <DownloadIcon size={14} /> Download
          </button>
        )}
      </div>
      <div className="c-field">
        <span className="c-label">Used in</span>
        {used === undefined ? (
          <div className="c-skeleton" />
        ) : used.length === 0 ? (
          <p className="c-hint">Not used yet.</p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14 }}>
            {used.map((u) => (
              <li key={`${u.href}-${u.as}`}>
                <a href={u.href}>{u.title}</a> <span className="c-muted">({u.as})</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {status && (
        <p role={status.ok ? "status" : "alert"} className={status.ok ? "c-ok" : "c-error"}>
          {status.text}
        </p>
      )}
    </Dialog>
  );
}

/** Media Library: every image, video and download file in the store. */
export default function MediaLibraryPage() {
  const ctx = useStore();
  const mod = moduleByKey("media");
  const [kind, setKind] = useState<MediaKind | "">("");
  const [q, setQ] = useState("");
  const [data, setData] = useState<MediaPage | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [open, setOpen] = useState<MediaAsset | undefined>();
  const [uploadPurpose, setUploadPurpose] = useState<"media" | "file">("media");
  const storeId = ctx?.store.id;

  const url = useCallback(
    (cursor?: string) => {
      const params = new URLSearchParams({ limit: "60" });
      if (kind) params.set("kind", kind);
      if (q.trim()) params.set("q", q.trim());
      if (cursor) params.set("cursor", cursor);
      return `/api/v1/stores/${storeId}/media?${params.toString()}`;
    },
    [storeId, kind, q],
  );

  useEffect(() => {
    if (!storeId) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      api<MediaPage>(url())
        .then((r) => {
          if (!cancelled) setData(r);
        })
        .catch((err: unknown) => {
          if (!cancelled) setError(errorMessage(err));
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [storeId, url]);

  if (!ctx) return null;
  const { base, can, store } = ctx;
  const items = data?.items ?? [];
  const replace = (m: MediaAsset) => setData((d) => (d ? { ...d, items: d.items.map((x) => (x.id === m.id ? m : x)) } : d));

  async function loadMore() {
    if (!data?.nextCursor) return;
    try {
      const page = await api<MediaPage>(url(data.nextCursor));
      setData({ ...page, items: [...data.items, ...page.items] });
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <Page>
      <PageHeader title={mod.label} eyebrow={mod.group} subtitle={mod.summary} />
      <div className="c-card" style={{ marginBottom: 20, display: "grid", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>Upload</h2>
          <div className="c-segmented" role="group" aria-label="What are you uploading?">
            <button type="button" aria-pressed={uploadPurpose === "media"} onClick={() => setUploadPurpose("media")}>
              Images and video
            </button>
            <button type="button" aria-pressed={uploadPurpose === "file"} onClick={() => setUploadPurpose("file")}>
              Files to sell
            </button>
          </div>
        </div>
        <DropZone
          key={uploadPurpose}
          storeId={store.id}
          purpose={uploadPurpose}
          onDone={(assets) => setData((d) => ({ ...(d ?? { items: [] }), items: [...assets, ...(d?.items ?? []).filter((m) => !assets.some((a) => a.id === m.id))] }))}
        />
        {uploadPurpose === "file" && <p className="c-hint">Files to sell stay private: buyers of a digital product get a signed download link after paying.</p>}
      </div>

      <div className="c-toolbar">
        <div className="c-search">
          <SearchIcon size={16} />
          <input className="c-input" type="search" placeholder="Search by name, alt text or folder" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search media" />
        </div>
        <div className="c-segmented" role="group" aria-label="Kind">
          {(
            [
              ["", "All"],
              ["image", "Images"],
              ["video", "Videos"],
              ["file", "Files"],
            ] as const
          ).map(([k, label]) => (
            <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {error && (
        <p role="alert" className="c-error" style={{ marginBottom: 12 }}>
          {error}
        </p>
      )}
      {data === undefined ? (
        <div className="c-media-grid" role="status" aria-label="Loading media">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="c-skeleton" style={{ height: 180, borderRadius: 14 }} />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState icon={<MediaIcon size={26} />} title={q || kind ? "Nothing matches" : "Your library is empty"}>
          {q || kind ? "Try another search or kind." : "Upload product photos, videos and the files you sell. Everything is checked for malware before use."}
        </EmptyState>
      ) : (
        <div className="c-media-grid">
          {items.map((m) => (
            <button key={m.id} type="button" className="c-media-card" aria-current={open?.id === m.id ? "true" : undefined} onClick={() => setOpen(m)}>
              <MediaStatus media={m} />
              <Thumb media={m} size="lg" />
              <strong title={m.filename}>{m.filename}</strong>
              <small>
                {formatBytes(m.byteSize)}
                {m.width && m.height ? ` · ${m.width}×${m.height}` : ""}
                {m.usage ? ` · used ${m.usage}×` : ""}
              </small>
            </button>
          ))}
        </div>
      )}
      {data?.nextCursor && (
        <div className="c-pager">
          <button type="button" className="c-btn" onClick={() => void loadMore()}>
            Show more
          </button>
        </div>
      )}
      {open && (
        <MediaDetails
          key={open.id}
          storeId={store.id}
          base={base}
          media={open}
          canDelete={can("media.manage")}
          onClose={() => setOpen(undefined)}
          onChange={(m) => {
            replace(m);
            setOpen(m);
          }}
          onDelete={(id) => setData((d) => (d ? { ...d, items: d.items.filter((x) => x.id !== id) } : d))}
        />
      )}
    </Page>
  );
}
