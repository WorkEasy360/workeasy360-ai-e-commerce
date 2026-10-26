"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useId, useState } from "react";
import { Badge, Card, CopyIcon, EmptyState, Page, PageHeader, SparkleIcon } from "@workeasy/ui/react";
import { api, errorMessage } from "../../../../lib/api";
import { moduleByKey } from "../../../../lib/modules";
import { useStore } from "../store-shell";

type Task = "product_copy" | "collection_copy" | "review_summary" | "sales_insights";

interface Generation {
  id: string;
  task: Task;
  targetType: "product" | "collection" | null;
  targetId: string | null;
  input: { language?: string; tone?: string; data?: { title?: string } };
  status: "queued" | "running" | "succeeded" | "failed";
  output: Record<string, unknown> | null;
  errorCode: string | null;
  provider: string | null;
  createdAt: string;
  appliedAt: string | null;
  discardedAt: string | null;
}

interface GenerationList {
  items: Generation[];
  usedToday: number;
  dailyLimit: number;
  provider: "disabled" | "stub" | "openai" | "gemini";
}

const TASKS: Array<{ key: Task; title: string; text: string }> = [
  { key: "product_copy", title: "Product copy", text: "Description, search title and meta description, and tags." },
  { key: "collection_copy", title: "Collection copy", text: "An introduction and search listing for a collection." },
  { key: "review_summary", title: "Review summary", text: "What buyers say about a product, in a few lines." },
  { key: "sales_insights", title: "Sales insights", text: "What's working and what to try, from the last 30 days." },
];

const LANGUAGES: Array<[string, string]> = [
  ["en", "English"],
  ["hi", "Hindi"],
  ["ta", "Tamil"],
  ["te", "Telugu"],
  ["bn", "Bengali"],
  ["mr", "Marathi"],
  ["gu", "Gujarati"],
  ["kn", "Kannada"],
  ["ml", "Malayalam"],
  ["ar", "Arabic"],
  ["es", "Spanish"],
  ["fr", "French"],
  ["de", "German"],
];

const ERRORS: Record<string, string> = {
  ai_disabled: "AI Studio isn't set up on this server.",
  provider_refused: "The AI declined this request. Try rewording your notes.",
  invalid_json: "The AI's answer wasn't usable. Try again.",
  invalid_shape: "The AI's answer was missing parts. Try again.",
  output_truncated: "The answer was too long and got cut off. Try again.",
  provider_rate_limited: "The AI service is busy. Try again in a minute.",
  provider_unavailable: "The AI service is unavailable right now.",
  provider_auth: "The AI service rejected the server's key. Tell your administrator.",
};

function Proposal({ g, storeId, base, onChange }: { g: Generation; storeId: string; base: string; onChange: (g: Generation) => void }) {
  const [fields, setFields] = useState<Set<"description" | "seo" | "tags">>(new Set(["description", "seo"]));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const o = g.output ?? {};
  const toggle = (f: "description" | "seo" | "tags") => setFields((s) => (s.has(f) ? new Set([...s].filter((x) => x !== f)) : new Set([...s, f])));

  async function act(action: "apply" | "discard") {
    setBusy(true);
    setError(undefined);
    try {
      const r = await api<{ generation: Generation }>(`/api/v1/stores/${storeId}/ai/generations/${g.id}/${action}`, { method: "POST", ...(action === "apply" ? { body: { fields: [...fields] } } : {}) });
      onChange(r.generation);
    } catch (err) {
      setError(errorMessage(err));
    }
    setBusy(false);
  }

  if (g.task === "product_copy" || g.task === "collection_copy") {
    const done = g.appliedAt !== null || g.discardedAt !== null;
    const check = (f: "description" | "seo" | "tags", label: string) =>
      !done && (
        <label className="c-inline-check">
          <input type="checkbox" className="c-check-input" checked={fields.has(f)} onChange={() => toggle(f)} /> Use {label}
        </label>
      );
    return (
      <div className="c-ai-output">
        <div>
          {check("description", "description")}
          <p className="c-ai-text">{String(o.description ?? "")}</p>
        </div>
        <div>
          {check("seo", "search listing")}
          <div className="c-ai-serp">
            <strong>{String(o.seoTitle ?? "")}</strong>
            <span>{String(o.seoDescription ?? "")}</span>
          </div>
        </div>
        {Array.isArray(o.tags) && o.tags.length > 0 && (
          <div>
            {check("tags", "tags")}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {(o.tags as string[]).map((t) => (
                <Badge key={t}>{t}</Badge>
              ))}
            </div>
          </div>
        )}
        {error && <p className="c-error">{error}</p>}
        {g.appliedAt ? (
          <p className="c-muted" style={{ margin: 0 }}>
            Applied {new Date(g.appliedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}.{" "}
            {g.targetId && <a href={`${base}/${g.targetType === "collection" ? "collections" : "products"}/${g.targetId}`}>Open {g.targetType}</a>}
          </p>
        ) : g.discardedAt ? (
          <p className="c-muted" style={{ margin: 0 }}>
            Discarded.
          </p>
        ) : (
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="c-btn c-btn-primary c-btn-sm" disabled={busy || fields.size === 0} onClick={() => void act("apply")}>
              Apply to {g.targetType}
            </button>
            <button type="button" className="c-btn c-btn-sm" disabled={busy} onClick={() => void act("discard")}>
              Discard
            </button>
          </div>
        )}
      </div>
    );
  }
  const text =
    g.task === "review_summary"
      ? [String(o.summary ?? ""), ...((o.pros as string[] | undefined) ?? []).map((p) => `+ ${p}`), ...((o.cons as string[] | undefined) ?? []).map((c) => `– ${c}`)].join("\n")
      : ((o.insights as Array<{ title: string; detail: string }> | undefined) ?? []).map((i) => `${i.title}: ${i.detail}`).join("\n\n");
  return (
    <div className="c-ai-output">
      {g.task === "review_summary" ? (
        <>
          <p className="c-ai-text">{String(o.summary ?? "")}</p>
          <div className="c-grid-2 c-grid-even">
            <ul className="c-ai-list" aria-label="What buyers like">
              {((o.pros as string[] | undefined) ?? []).map((p) => (
                <li key={p}>👍 {p}</li>
              ))}
            </ul>
            <ul className="c-ai-list" aria-label="What buyers would change">
              {((o.cons as string[] | undefined) ?? []).map((c) => (
                <li key={c}>✋ {c}</li>
              ))}
            </ul>
          </div>
        </>
      ) : (
        <ol className="c-ai-insights">
          {((o.insights as Array<{ title: string; detail: string }> | undefined) ?? []).map((i) => (
            <li key={i.title}>
              <strong>{i.title}</strong>
              <span>{i.detail}</span>
            </li>
          ))}
        </ol>
      )}
      <button type="button" className="c-btn c-btn-sm" style={{ justifySelf: "start" }} onClick={() => void navigator.clipboard.writeText(text)}>
        <CopyIcon size={13} /> Copy
      </button>
    </div>
  );
}

/** AI Studio: ask for copy or analysis; every result is a proposal you apply or discard. */
export function AiView() {
  const ctx = useStore();
  const mod = moduleByKey("ai");
  const ids = { target: useId(), tone: useId(), lang: useId(), notes: useId() };
  // Arriving from a product's "Write it with AI Studio": the task and product are in the address.
  const params = useSearchParams();
  const asked = params.get("task");
  const [list, setList] = useState<GenerationList | undefined>();
  const [task, setTask] = useState<Task>(asked === "collection_copy" || asked === "review_summary" ? asked : "product_copy");
  const [targetId, setTargetId] = useState(params.get("target") ?? "");
  const [tone, setTone] = useState("friendly");
  const [language, setLanguage] = useState("en");
  const [notes, setNotes] = useState("");
  const [products, setProducts] = useState<Array<{ id: string; title: string }>>([]);
  const [collections, setCollections] = useState<Array<{ id: string; title: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const storeId = ctx?.store.id;

  const load = useCallback(() => {
    if (!storeId) return;
    api<GenerationList>(`/api/v1/stores/${storeId}/ai/generations`)
      .then(setList)
      .catch((err: unknown) => setError(errorMessage(err)));
  }, [storeId]);

  useEffect(() => {
    load();
    if (!storeId) return;
    api<{ items: Array<{ id: string; title: string }> }>(`/api/v1/stores/${storeId}/products?limit=100`)
      .then((r) => setProducts(r.items))
      .catch(() => undefined);
    api<{ items: Array<{ id: string; title: string }> }>(`/api/v1/stores/${storeId}/collections`)
      .then((r) => setCollections(r.items))
      .catch(() => undefined);
  }, [storeId, load]);

  // While anything is being worked on, check back every couple of seconds.
  const working = list?.items.some((g) => g.status === "queued" || g.status === "running") ?? false;
  useEffect(() => {
    if (!working) return;
    const t = setInterval(load, 1500);
    return () => clearInterval(t);
  }, [working, load]);

  if (!ctx) return null;
  const { store, base } = ctx;
  const needsTarget = task !== "sales_insights";
  const targets = task === "collection_copy" ? collections : products;

  async function generate() {
    setBusy(true);
    setError(undefined);
    try {
      await api(`/api/v1/stores/${store.id}/ai/generations`, { method: "POST", body: { task, targetId: needsTarget ? targetId : null, tone, language, notes: notes || null } });
      load();
    } catch (err) {
      setError(errorMessage(err));
    }
    setBusy(false);
  }

  const replace = (g: Generation) => setList((l) => (l ? { ...l, items: l.items.map((x) => (x.id === g.id ? g : x)) } : l));
  const disabled = list?.provider === "disabled";

  return (
    <Page>
      <PageHeader
        title={mod.label}
        eyebrow={mod.group}
        subtitle={mod.summary}
        actions={
          list && (
            <span className="c-muted" style={{ fontSize: 13.5 }}>
              {list.usedToday} of {list.dailyLimit} today{list.provider === "stub" ? " · Demo AI (no provider connected)" : ""}
            </span>
          )
        }
      />
      {disabled && (
        <p className="c-error" role="status">
          AI Studio isn&apos;t set up on this server. The operator sets AI_PROVIDER, AI_MODEL and the provider key.
        </p>
      )}
      <div className="c-grid-2">
        <div style={{ display: "grid", gap: 16, alignContent: "start" }}>
          {list && list.items.length === 0 && (
            <EmptyState icon={<SparkleIcon size={26} />} title="Nothing generated yet">
              Pick a task on the right. Results land here; nothing in your store changes until you press Apply.
            </EmptyState>
          )}
          {list?.items.map((g) => (
            <Card
              key={g.id}
              title={
                <span style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  {TASKS.find((t) => t.key === g.task)?.title}
                  {g.input.data?.title && <span className="c-muted">· {g.input.data.title}</span>}
                </span>
              }
              actions={
                <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                  {g.input.language && g.input.language !== "en" && <Badge>{LANGUAGES.find(([c]) => c === g.input.language)?.[1] ?? g.input.language}</Badge>}
                  <Badge tone={g.status === "succeeded" ? (g.appliedAt ? "success" : "info") : g.status === "failed" ? "danger" : "warning"}>
                    {g.status === "succeeded" ? (g.appliedAt ? "Applied" : g.discardedAt ? "Discarded" : "Ready") : g.status === "failed" ? "Failed" : "Writing…"}
                  </Badge>
                </span>
              }
            >
              {g.status === "succeeded" ? (
                <Proposal g={g} storeId={store.id} base={base} onChange={replace} />
              ) : g.status === "failed" ? (
                <p className="c-error" style={{ margin: 0 }}>
                  {ERRORS[g.errorCode ?? ""] ?? "Something went wrong. Try again."}
                </p>
              ) : (
                <div className="c-skeleton" role="status" aria-label="Writing" style={{ height: 60 }} />
              )}
            </Card>
          ))}
        </div>

        <Card title="New request">
          <div className="c-radio-row">
            {TASKS.map((t) => (
              <label key={t.key} className="c-radio-card">
                <input
                  type="radio"
                  className="c-check-input"
                  name="ai-task"
                  checked={task === t.key}
                  onChange={() => {
                    setTask(t.key);
                    setTargetId("");
                  }}
                />
                <span>
                  <strong>{t.title}</strong>
                  <span>{t.text}</span>
                </span>
              </label>
            ))}
          </div>
          <div className="c-form" style={{ marginTop: 14 }}>
            {needsTarget && (
              <div className="c-field">
                <label className="c-label" htmlFor={ids.target}>
                  {task === "collection_copy" ? "Collection" : "Product"}
                </label>
                <select id={ids.target} className="c-select" value={targetId} onChange={(e) => setTargetId(e.target.value)}>
                  <option value="">Choose…</option>
                  {targets.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.title}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="c-form-row">
              {(task === "product_copy" || task === "collection_copy") && (
                <div className="c-field">
                  <label className="c-label" htmlFor={ids.tone}>
                    Tone
                  </label>
                  <select id={ids.tone} className="c-select" value={tone} onChange={(e) => setTone(e.target.value)}>
                    <option value="friendly">Friendly</option>
                    <option value="premium">Premium</option>
                    <option value="playful">Playful</option>
                    <option value="minimal">Minimal</option>
                  </select>
                </div>
              )}
              <div className="c-field">
                <label className="c-label" htmlFor={ids.lang}>
                  Language
                </label>
                <select id={ids.lang} className="c-select" value={language} onChange={(e) => setLanguage(e.target.value)}>
                  {LANGUAGES.map(([c, n]) => (
                    <option key={c} value={c}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {(task === "product_copy" || task === "collection_copy") && (
              <div className="c-field">
                <label className="c-label" htmlFor={ids.notes}>
                  Anything to mention? <small>(optional)</small>
                </label>
                <textarea id={ids.notes} className="c-textarea" rows={2} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Hand-blended in small batches in Pune; great with milk." />
              </div>
            )}
            {error && (
              <p role="alert" className="c-error" style={{ margin: 0 }}>
                {error}
              </p>
            )}
            <button type="button" className="c-btn c-btn-brand" disabled={busy || disabled || (needsTarget && !targetId)} onClick={() => void generate()}>
              <SparkleIcon size={16} /> {busy ? "Asking…" : "Generate"}
            </button>
            <p className="c-hint" style={{ margin: 0 }}>
              The AI only sees the product, collection, reviews or store numbers it works on, never customer details. Check what it writes before you apply it.
            </p>
          </div>
        </Card>
      </div>
    </Page>
  );
}
