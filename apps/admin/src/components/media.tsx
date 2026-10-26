"use client";

import { useCallback, useEffect, useId, useRef, useState, type DragEvent } from "react";
import { Badge, FileIcon, MediaIcon as ImageIcon, SearchIcon, UploadIcon, VideoIcon } from "@workeasy/ui/react";
import { Dialog } from "@workeasy/ui/client";
import { api, errorMessage } from "../lib/api";
import { formatBytes, mediaUrl, REJECT_REASONS, uploadMedia, type MediaAsset, type MediaKind } from "../lib/catalog";

/** A square preview of a media asset, or an icon for files and assets still being checked. */
export function Thumb({ media, mediaId, alt = "", size = "md" }: { media?: Pick<MediaAsset, "id" | "kind" | "status" | "altText">; mediaId?: string | null; alt?: string; size?: "sm" | "md" | "lg" }) {
  const cls = size === "sm" ? "c-thumb c-thumb-sm" : size === "lg" ? "c-thumb c-thumb-lg" : "c-thumb";
  const id = media?.id ?? mediaId ?? null;
  const showImage = id && (!media || (media.kind === "image" && media.status === "ready"));
  if (showImage) return <img className={cls} src={mediaUrl(id)} alt={media?.altText ?? alt} loading="lazy" />;
  const Icon = media?.kind === "file" ? FileIcon : media?.kind === "video" ? VideoIcon : ImageIcon;
  return (
    <span className={cls} aria-hidden="true">
      <Icon size={size === "lg" ? 32 : 18} />
    </span>
  );
}

export function MediaStatus({ media }: { media: MediaAsset }) {
  if (media.status === "ready") return null;
  if (media.status === "rejected") return <Badge tone="danger">Rejected</Badge>;
  return <Badge tone="info">{media.status === "uploading" ? "Uploading" : "Checking"}</Badge>;
}

export function rejectText(media: MediaAsset): string {
  return REJECT_REASONS[media.rejectReason ?? ""] ?? "This file was refused";
}

const ACCEPT: Record<"media" | "file", string> = {
  media: "image/jpeg,image/png,image/gif,image/webp,video/mp4,video/webm,video/quicktime",
  file: ".pdf,.epub,.zip,.mp3,.mp4,.jpg,.jpeg,.png,.txt",
};

/**
 * Click or drop files to upload them. Each file is sent straight to storage
 * and checked; `onDone` receives every asset, ready or rejected.
 */
export function DropZone({
  storeId,
  purpose = "media",
  onDone,
  compact,
}: {
  storeId: string;
  purpose?: "media" | "file";
  onDone: (assets: MediaAsset[]) => void;
  compact?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();

  const send = useCallback(
    async (files: FileList | File[]) => {
      const list = [...files];
      if (list.length === 0) return;
      setError(undefined);
      const done: MediaAsset[] = [];
      for (const [i, file] of list.entries()) {
        try {
          const media = await uploadMedia(storeId, file, {
            purpose,
            onStage: (stage) => setBusy(`${stage === "uploading" ? "Uploading" : "Checking"} ${list.length > 1 ? `${i + 1} of ${list.length}` : file.name}…`),
          });
          done.push(media);
        } catch (err) {
          setError(`${file.name}: ${err instanceof Error && !("problem" in err) ? err.message : errorMessage(err)}`);
        }
      }
      setBusy(undefined);
      if (done.length > 0) onDone(done);
    },
    [storeId, purpose, onDone],
  );

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setOver(false);
    void send(e.dataTransfer.files);
  }

  return (
    <div style={{ display: "grid", gap: 6 }}>
      <label
        htmlFor={id}
        className="c-dropzone"
        data-over={over ? "true" : undefined}
        style={compact ? { padding: 14 } : undefined}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        <UploadIcon size={22} />
        {busy ? (
          <span role="status">{busy}</span>
        ) : (
          <span>
            <strong>Click to upload</strong> or drag files here
            <br />
            {purpose === "file" ? "PDF, EPUB, ZIP, MP3, MP4, images or text · up to 25 MB" : "JPEG, PNG, GIF, WebP up to 20 MB · MP4, WebM up to 25 MB"}
          </span>
        )}
      </label>
      <input
        ref={input}
        id={id}
        type="file"
        multiple
        accept={ACCEPT[purpose]}
        className="c-visually-hidden"
        disabled={busy !== undefined}
        onChange={(e) => {
          if (e.target.files) void send(e.target.files);
          e.target.value = "";
        }}
      />
      {error && (
        <p role="alert" className="c-error">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Choose assets from the Media Library, or upload new ones on the spot.
 * Only ready assets of the wanted kinds are offered. Render it only while
 * open (`{open && <MediaPicker …/>}`) so each opening starts from `initial`.
 */
export function MediaPicker({
  storeId,
  open,
  onClose,
  onPick,
  kind,
  title,
  initial = [],
}: {
  storeId: string;
  open: boolean;
  onClose: () => void;
  onPick: (ids: string[], assets: MediaAsset[]) => void;
  kind: "media" | "file";
  title: string;
  initial?: string[];
}) {
  const [items, setItems] = useState<MediaAsset[] | undefined>();
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<string[]>(initial);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const kinds: MediaKind[] = kind === "file" ? ["file"] : ["image", "video"];
    const params = (k: MediaKind) => `/api/v1/stores/${storeId}/media?ready=true&limit=100&kind=${k}${q ? `&q=${encodeURIComponent(q)}` : ""}`;
    const timer = setTimeout(() => {
      Promise.all(kinds.map((k) => api<{ items: MediaAsset[] }>(params(k))))
        .then((pages) => {
          if (!cancelled) setItems(pages.flatMap((p) => p.items).toSorted((a, b) => b.createdAt.localeCompare(a.createdAt)));
        })
        .catch((err: unknown) => {
          if (!cancelled) setError(errorMessage(err));
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, storeId, kind, q]);

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      wide
      footer={
        <>
          <span className="c-muted" style={{ marginRight: "auto", alignSelf: "center", fontSize: 14 }}>
            {picked.length} selected
          </span>
          <button type="button" className="c-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="c-btn c-btn-primary"
            onClick={() => {
              onPick(picked, (items ?? []).filter((m) => picked.includes(m.id)));
              onClose();
            }}
          >
            Use selected
          </button>
        </>
      }
    >
      <DropZone
        storeId={storeId}
        purpose={kind}
        compact
        onDone={(assets) => {
          const ready = assets.filter((a) => a.status === "ready");
          setItems((prev) => [...ready, ...(prev ?? []).filter((m) => !ready.some((r) => r.id === m.id))]);
          setPicked((p) => [...p, ...ready.map((a) => a.id).filter((id) => !p.includes(id))]);
          const refused = assets.find((a) => a.status === "rejected");
          setError(refused ? `${refused.filename}: ${rejectText(refused)}` : undefined);
        }}
      />
      <div className="c-search" style={{ maxWidth: "none" }}>
        <SearchIcon size={16} />
        <input className="c-input" type="search" placeholder="Search by name, alt text or folder" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search media" />
      </div>
      {error && (
        <p role="alert" className="c-error">
          {error}
        </p>
      )}
      {items === undefined ? (
        <div className="c-skeleton" role="status" aria-label="Loading media" style={{ height: 120 }} />
      ) : items.length === 0 ? (
        <p className="c-muted" style={{ textAlign: "center", margin: "12px 0" }}>
          {q ? "Nothing matches that search." : "Nothing here yet. Upload above."}
        </p>
      ) : (
        <div className="c-media-grid">
          {items.map((m) => (
            <button key={m.id} type="button" className="c-media-card" aria-pressed={picked.includes(m.id)} onClick={() => toggle(m.id)}>
              {picked.includes(m.id) && <Badge tone="brand">{picked.indexOf(m.id) + 1}</Badge>}
              <Thumb media={m} size="lg" />
              <strong title={m.filename}>{m.filename}</strong>
              <small>{m.width && m.height ? `${m.width}×${m.height} · ` : ""}{formatBytes(m.byteSize)}</small>
            </button>
          ))}
        </div>
      )}
    </Dialog>
  );
}
