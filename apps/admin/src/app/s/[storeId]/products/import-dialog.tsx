"use client";

import { useState } from "react";
import { Badge, UploadIcon } from "@workeasy/ui/react";
import { Dialog } from "@workeasy/ui/client";
import { ApiError, errorMessage } from "../../../../lib/api";

interface ImportResult {
  products: Array<{ handle: string; title: string; variants: number; action: "create" | "update"; removesVariants: number }>;
  problems: Array<{ row: number; message: string }>;
  create: number;
  update: number;
  applied: boolean;
}

async function sendCsv(storeId: string, csv: string, dryRun: boolean): Promise<ImportResult> {
  const res = await fetch(`/api/v1/stores/${storeId}/products/import?dryRun=${dryRun}`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "text/csv", accept: "application/json" },
    body: csv,
  });
  const body = (await res.json().catch(() => ({}))) as ImportResult & { title?: string; status?: number; code?: string; errors?: Array<{ field: string; code: string; message: string }> };
  if (!res.ok) throw new ApiError({ status: res.status, code: body.code ?? "UNKNOWN", title: body.title ?? "The import didn't go through.", ...(body.errors ? { errors: body.errors } : {}) });
  return body;
}

/**
 * Product import: choose a spreadsheet, see exactly what would be created,
 * updated or skipped (with each problem's row), then import. Nothing changes
 * until the second step.
 */
export function ImportDialog({ storeId, onClose, onImported }: { storeId: string; onClose: () => void; onImported: () => void }) {
  const [csv, setCsv] = useState<string | undefined>();
  const [fileName, setFileName] = useState<string | undefined>();
  const [preview, setPreview] = useState<ImportResult | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [done, setDone] = useState<ImportResult | undefined>();

  async function choose(file: File) {
    setError(undefined);
    setPreview(undefined);
    if (file.size > 5 * 1024 * 1024) {
      setError("The file is larger than 5 MB. Split it into smaller files.");
      return;
    }
    const text = await file.text();
    setCsv(text);
    setFileName(file.name);
    setBusy(true);
    try {
      setPreview(await sendCsv(storeId, text, true));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (!csv) return;
    setBusy(true);
    setError(undefined);
    try {
      setDone(await sendCsv(storeId, csv, false));
      onImported();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const importable = (preview?.create ?? 0) + (preview?.update ?? 0);
  return (
    <Dialog
      open
      onClose={onClose}
      title="Import products"
      wide
      footer={
        done ? (
          <button type="button" className="c-btn c-btn-primary" onClick={onClose}>
            Done
          </button>
        ) : (
          <>
            <button type="button" className="c-btn" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="c-btn c-btn-primary" disabled={busy || importable === 0} onClick={() => void apply()}>
              {busy && preview ? "Importing…" : importable > 0 ? `Import ${importable} product${importable === 1 ? "" : "s"}` : "Import"}
            </button>
          </>
        )
      }
    >
      {done ? (
        <div className="c-empty" style={{ padding: 28 }}>
          <h2>Import complete</h2>
          <p>
            {done.create} created and {done.update} updated.
            {done.problems.length > 0 ? ` ${done.problems.length} row${done.problems.length === 1 ? " was" : "s were"} skipped.` : ""}
          </p>
        </div>
      ) : (
        <>
          <p className="c-hint" style={{ fontSize: 14 }}>
            Use one row per variant. <strong>Handle</strong>, <strong>Title</strong> and <strong>Price</strong> are required; rows with the same handle belong to one product. Products whose
            handle already exists are updated, and blank Stock cells leave stock unchanged. Export your products first to get a ready-made template.
          </p>
          <label className="c-dropzone">
            <UploadIcon size={22} />
            <span>{busy && !preview ? "Reading…" : fileName ? <strong>{fileName}</strong> : <><strong>Choose a CSV file</strong> (up to 5 MB)</>}</span>
            <input
              type="file"
              accept=".csv,text/csv"
              className="c-visually-hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void choose(file);
                e.target.value = "";
              }}
            />
          </label>
          {error && (
            <p role="alert" className="c-error">
              {error}
            </p>
          )}
          {preview && (
            <>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <Badge tone="success">{preview.create} new</Badge>
                <Badge tone="info">{preview.update} to update</Badge>
                {preview.problems.length > 0 && <Badge tone="danger">{preview.problems.length} problem{preview.problems.length === 1 ? "" : "s"}</Badge>}
              </div>
              {preview.products.some((p) => p.removesVariants > 0) && (
                <p role="alert" className="c-error">
                  Some updates remove variants that aren&apos;t in this file, along with their stock. Add those rows to the file to keep them.
                </p>
              )}
              {preview.problems.length > 0 && (
                <div className="c-table-wrap" style={{ boxShadow: "none", maxHeight: 200, overflowY: "auto" }}>
                  <table className="c-table c-table-compact">
                    <caption className="c-visually-hidden">Problems, by row</caption>
                    <thead>
                      <tr>
                        <th scope="col">Row</th>
                        <th scope="col">Problem (this product won&apos;t be imported)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.problems.map((p, i) => (
                        <tr key={i}>
                          <td className="c-num" style={{ width: 60 }}>
                            {p.row}
                          </td>
                          <td>{p.message}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {preview.products.length > 0 && (
                <div className="c-table-wrap" style={{ boxShadow: "none", maxHeight: 260, overflowY: "auto" }}>
                  <table className="c-table c-table-compact">
                    <caption className="c-visually-hidden">Products to import</caption>
                    <thead>
                      <tr>
                        <th scope="col">Product</th>
                        <th scope="col" className="c-num">
                          Variants
                        </th>
                        <th scope="col">Will be</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.products.map((p) => (
                        <tr key={p.handle}>
                          <td>
                            <span className="c-cell-title">{p.title}</span>
                            <span className="c-cell-sub">{p.handle}</span>
                          </td>
                          <td className="c-num">{p.variants}</td>
                          <td>
                            <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
                              {p.action === "create" ? <Badge tone="success">Created</Badge> : <Badge tone="info">Updated</Badge>}
                              {p.removesVariants > 0 && <Badge tone="danger">Removes {p.removesVariants} variant{p.removesVariants === 1 ? "" : "s"}</Badge>}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </>
      )}
    </Dialog>
  );
}
