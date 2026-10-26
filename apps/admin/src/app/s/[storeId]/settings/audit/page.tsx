"use client";

import { useEffect, useState } from "react";
import { AuditIcon, EmptyState } from "@workeasy/ui/react";
import { api, errorMessage } from "../../../../../lib/api";
import { useStore } from "../../store-shell";

interface Entry {
  id: string;
  actor: { type: "user" | "system"; id: string | null; displayName: string | null };
  action: string;
  resourceType: string;
  metadata: Record<string, unknown>;
  occurredAt: string;
}

const ACTION_LABELS: Record<string, string> = {
  "store.created": "Created the store",
  "store.updated": "Changed store settings",
};

function describe(entry: Entry): string {
  const label = ACTION_LABELS[entry.action] ?? entry.action;
  const fields = Array.isArray(entry.metadata.fields) ? (entry.metadata.fields as string[]) : [];
  return fields.length > 0 ? `${label}: ${fields.join(", ")}` : label;
}

function fetchPage(storeId: string, after?: string) {
  return api<{ entries: Entry[]; nextCursor?: string }>(`/api/v1/stores/${storeId}/audit?limit=50${after ? `&cursor=${encodeURIComponent(after)}` : ""}`);
}

/** Who changed what in this store, newest first. */
export default function AuditPage() {
  const ctx = useStore();
  const [entries, setEntries] = useState<Entry[] | undefined>();
  const [cursor, setCursor] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const storeId = ctx?.store.id;
  const allowed = ctx?.can("audit.read") ?? false;

  useEffect(() => {
    if (!storeId || !allowed) return;
    let cancelled = false;
    fetchPage(storeId)
      .then((page) => {
        if (cancelled) return;
        setEntries(page.entries);
        setCursor(page.nextCursor);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [storeId, allowed]);

  async function showOlder(after: string) {
    if (!storeId) return;
    setLoading(true);
    try {
      const page = await fetchPage(storeId, after);
      setEntries((prev) => [...(prev ?? []), ...page.entries]);
      setCursor(page.nextCursor);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  if (!ctx) return null;
  if (!allowed) {
    return (
      <EmptyState icon={<AuditIcon size={26} />} title="Only owners and admins can read the audit log" />
    );
  }
  if (error) return <p role="alert" className="c-error">{error}</p>;
  if (entries && entries.length === 0) {
    return <EmptyState icon={<AuditIcon size={26} />} title="Nothing recorded yet">Changes to your store will appear here.</EmptyState>;
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div className="c-table-wrap">
        <table className="c-table c-table-stack">
          <caption className="c-visually-hidden">Audit log</caption>
          <thead>
            <tr>
              <th scope="col">When</th>
              <th scope="col">Who</th>
              <th scope="col">What</th>
            </tr>
          </thead>
          <tbody>
            {(entries ?? []).map((e) => (
              <tr key={e.id}>
                <td data-label="When" style={{ whiteSpace: "nowrap" }}>
                  {new Date(e.occurredAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                </td>
                <td data-label="Who">{e.actor.type === "system" ? "Workeasy360" : (e.actor.displayName ?? "Former staff member")}</td>
                <td data-label="What">{describe(e)}</td>
              </tr>
            ))}
            {entries === undefined && (
              <tr>
                <td colSpan={3}>
                  <div className="c-skeleton" role="status" aria-label="Loading audit log" />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {cursor && (
        <button type="button" className="c-btn" style={{ justifySelf: "center" }} disabled={loading} onClick={() => void showOlder(cursor)}>
          {loading ? "Loading…" : "Show older"}
        </button>
      )}
    </div>
  );
}
