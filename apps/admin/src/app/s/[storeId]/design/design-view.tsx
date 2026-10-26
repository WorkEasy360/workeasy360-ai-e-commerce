"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  contrast,
  MAX_LINKS,
  MAX_SECTIONS,
  newSection,
  SECTION_LABELS,
  SECTION_TYPES,
  STORE_LANGUAGES,
  textOn,
  themeProblems,
  type SectionType,
  type StoreLanguage,
  type Theme,
  type ThemeLink,
  type ThemeSection,
} from "@workeasy/commerce";
import { ArrowDownIcon, ArrowUpIcon, Badge, Card, ExternalIcon, Page, PageHeader, PlusIcon, TrashIcon } from "@workeasy/ui/react";
import { Dialog } from "@workeasy/ui/client";
import { MediaPicker, Thumb } from "../../../../components/media";
import { api, errorMessage, storefrontUrl } from "../../../../lib/api";
import { moduleByKey } from "../../../../lib/modules";
import { useStore } from "../store-shell";

interface DesignState {
  draft: Theme;
  published: Theme | null;
  publishedAt: string | null;
  unpublished: boolean;
  previewToken: string;
}

type Tab = "home" | "theme" | "menus";

function Field({ label, hint, children, id }: { label: ReactNode; hint?: ReactNode; children: ReactNode; id: string }) {
  return (
    <div className="c-field">
      <label className="c-label" htmlFor={id}>
        {label}
      </label>
      {children}
      {hint && <p className="c-hint">{hint}</p>}
    </div>
  );
}

/** One colour: swatch picker plus the hex value, with a note when white text won't read on it. */
function ColorField({ id, label, value, onChange, hint }: { id: string; label: string; value: string; onChange: (v: string) => void; hint: string }) {
  // Remounted (by key) when the colour changes elsewhere, e.g. from the picker.
  const [text, setText] = useState(value);
  const ratio = contrast(value, textOn(value));
  return (
    <Field id={id} label={label} hint={ratio < 4.5 ? `Text on this colour is hard to read (contrast ${ratio.toFixed(1)}:1). Try a deeper shade.` : hint}>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input type="color" aria-label={`${label} picker`} value={value} onChange={(e) => onChange(e.target.value.toUpperCase())} style={{ width: 44, height: 40, padding: 2, border: "1px solid var(--we-color-border)", borderRadius: 10, background: "none" }} />
        <input
          id={id}
          className="c-input"
          value={text}
          maxLength={7}
          style={{ maxWidth: 120, fontFamily: "var(--we-font-mono)" }}
          onChange={(e) => {
            setText(e.target.value);
            if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) onChange(e.target.value.toUpperCase());
          }}
        />
        <span className="c-design-chip" style={{ background: value, color: textOn(value) }}>
          Aa
        </span>
      </div>
    </Field>
  );
}

function LinksEditor({ id, links, onChange, collections, pages }: { id: string; links: ThemeLink[]; onChange: (l: ThemeLink[]) => void; collections: Array<{ handle: string; title: string }>; pages: Array<{ handle: string; title: string }> }) {
  const set = (i: number, patch: Partial<ThemeLink>) => onChange(links.map((l, n) => (n === i ? { ...l, ...patch } : l)));
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {links.map((l, i) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1.3fr auto", gap: 6 }}>
          <input className="c-input" aria-label={`Link ${i + 1} label`} value={l.label} maxLength={40} onChange={(e) => set(i, { label: e.target.value })} placeholder="Label" />
          <input className="c-input" aria-label={`Link ${i + 1} address`} list={`${id}-paths`} value={l.href} maxLength={500} onChange={(e) => set(i, { href: e.target.value })} placeholder="/products or https://…" />
          <button type="button" className="c-btn c-btn-sm c-btn-ghost" aria-label={`Remove link ${i + 1}`} onClick={() => onChange(links.filter((_, n) => n !== i))}>
            <TrashIcon size={13} />
          </button>
        </div>
      ))}
      <datalist id={`${id}-paths`}>
        <option value="/">Home</option>
        <option value="/products">All products</option>
        {collections.map((c) => (
          <option key={c.handle} value={`/c/${c.handle}`}>
            {c.title}
          </option>
        ))}
        {pages.map((p) => (
          <option key={p.handle} value={`/pages/${p.handle}`}>
            {p.title}
          </option>
        ))}
      </datalist>
      {links.length < MAX_LINKS && (
        <button type="button" className="c-btn c-btn-sm" style={{ justifySelf: "start" }} onClick={() => onChange([...links, { label: "", href: "/products" }])}>
          <PlusIcon size={13} /> Add link
        </button>
      )}
    </div>
  );
}

/** The fields for one section, by type. */
function SectionFields({ section, onChange, storeId, collections }: { section: ThemeSection; onChange: (s: ThemeSection) => void; storeId: string; collections: Array<{ handle: string; title: string }> }) {
  const id = useId();
  const [picking, setPicking] = useState(false);
  const set = (patch: Record<string, unknown>) => onChange({ ...section, ...patch } as ThemeSection);
  const heading = (
    <Field id={`${id}-h`} label={section.type === "hero" ? "Heading (blank: your store name)" : "Heading"}>
      <input id={`${id}-h`} className="c-input" value={section.heading} maxLength={120} onChange={(e) => set({ heading: e.target.value })} />
    </Field>
  );
  switch (section.type) {
    case "hero":
    case "banner":
      return (
        <div className="c-form">
          {heading}
          <Field id={`${id}-t`} label="Text">
            <textarea id={`${id}-t`} className="c-textarea" rows={2} maxLength={400} value={section.text} onChange={(e) => set({ text: e.target.value })} />
          </Field>
          <div className="c-form-row">
            <Field id={`${id}-bl`} label="Button">
              <input id={`${id}-bl`} className="c-input" value={section.buttonLabel} maxLength={40} onChange={(e) => set({ buttonLabel: e.target.value })} placeholder="Blank: no button" />
            </Field>
            <Field id={`${id}-bh`} label="Button link">
              <input id={`${id}-bh`} className="c-input" value={section.buttonHref} maxLength={500} onChange={(e) => set({ buttonHref: e.target.value })} />
            </Field>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            {section.imageId && <Thumb mediaId={section.imageId} size="sm" />}
            <button type="button" className="c-btn c-btn-sm" onClick={() => setPicking(true)}>
              {section.imageId ? "Change image" : "Add image"}
            </button>
            {section.imageId && (
              <button type="button" className="c-btn c-btn-sm c-btn-ghost" onClick={() => set({ imageId: null })}>
                Remove
              </button>
            )}
          </div>
          {picking && (
            <MediaPicker
              storeId={storeId}
              open
              kind="media"
              title="Choose an image"
              initial={section.imageId ? [section.imageId] : []}
              onClose={() => setPicking(false)}
              onPick={(ids, assets) => {
                const img = assets.find((a) => a.kind === "image");
                set({ imageId: img?.id ?? ids[0] ?? null });
                setPicking(false);
              }}
            />
          )}
        </div>
      );
    case "featured_products":
      return (
        <div className="c-form">
          {heading}
          <div className="c-form-row">
            <Field id={`${id}-c`} label="Products from">
              <select id={`${id}-c`} className="c-select" value={section.collectionHandle ?? ""} onChange={(e) => set({ collectionHandle: e.target.value || null })}>
                <option value="">Newest products</option>
                {collections.map((c) => (
                  <option key={c.handle} value={c.handle}>
                    {c.title}
                  </option>
                ))}
              </select>
            </Field>
            <Field id={`${id}-n`} label="How many">
              <select id={`${id}-n`} className="c-select" value={section.limit} onChange={(e) => set({ limit: Number(e.target.value) })}>
                {[4, 6, 8, 12, 16].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </div>
      );
    case "collection_list":
      return <div className="c-form">{heading}</div>;
    case "rich_text":
      return (
        <div className="c-form">
          {heading}
          <Field id={`${id}-t`} label="Text">
            <textarea id={`${id}-t`} className="c-textarea" rows={5} maxLength={4000} value={section.text} onChange={(e) => set({ text: e.target.value })} />
          </Field>
        </div>
      );
    case "testimonials":
    case "faq": {
      const faq = section.type === "faq";
      const items = section.items as Array<Record<string, string>>;
      const keys = faq ? (["question", "answer"] as const) : (["quote", "author"] as const);
      return (
        <div className="c-form">
          {heading}
          {items.map((it, i) => (
            <div key={i} className="c-design-item">
              <input className="c-input" aria-label={`${faq ? "Question" : "Quote"} ${i + 1}`} value={it[keys[0]] ?? ""} maxLength={faq ? 200 : 400} onChange={(e) => set({ items: items.map((x, n) => (n === i ? { ...x, [keys[0]]: e.target.value } : x)) })} placeholder={faq ? "Question" : "Quote"} />
              <textarea className="c-textarea" rows={faq ? 2 : 1} aria-label={`${faq ? "Answer" : "Who said it"} ${i + 1}`} value={it[keys[1]] ?? ""} maxLength={faq ? 1000 : 60} onChange={(e) => set({ items: items.map((x, n) => (n === i ? { ...x, [keys[1]]: e.target.value } : x)) })} placeholder={faq ? "Answer" : "Who said it"} />
              <button type="button" className="c-btn c-btn-sm c-btn-ghost" aria-label={`Remove item ${i + 1}`} disabled={items.length === 1} onClick={() => set({ items: items.filter((_, n) => n !== i) })}>
                <TrashIcon size={13} />
              </button>
            </div>
          ))}
          {items.length < 12 && (
            <button type="button" className="c-btn c-btn-sm" style={{ justifySelf: "start" }} onClick={() => set({ items: [...items, faq ? { question: "", answer: "" } : { quote: "", author: "" }] })}>
              <PlusIcon size={13} /> Add {faq ? "question" : "testimonial"}
            </button>
          )}
        </div>
      );
    }
  }
}

/** Store Design: edit the home page, colours, logo, menus and languages, see it live, then publish. */
export function DesignView() {
  const ctx = useStore();
  const mod = moduleByKey("design");
  const ids = { accent: useId(), dark: useId(), font: useId(), buttons: useId(), ann: useId(), annHref: useId(), footer: useId(), add: useId() };
  const [state, setState] = useState<DesignState | undefined>();
  const [draft, setDraft] = useState<Theme | undefined>();
  const [tab, setTab] = useState<Tab>("home");
  const [open, setOpen] = useState<string | undefined>();
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [status, setStatus] = useState<"saved" | "saving" | "error" | "idle">("idle");
  const [error, setError] = useState<string | undefined>();
  const [frameKey, setFrameKey] = useState(0);
  const [collections, setCollections] = useState<Array<{ handle: string; title: string }>>([]);
  const [pages, setPages] = useState<Array<{ handle: string; title: string }>>([]);
  const [pickingLogo, setPickingLogo] = useState(false);
  const [confirm, setConfirm] = useState<"publish" | "discard" | undefined>();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const storeId = ctx?.store.id;

  useEffect(() => {
    if (!storeId) return;
    api<DesignState>(`/api/v1/stores/${storeId}/design`)
      .then((s) => {
        setState(s);
        setDraft(s.draft);
      })
      .catch((err: unknown) => setError(errorMessage(err)));
    api<{ items: Array<{ handle: string; title: string }> }>(`/api/v1/stores/${storeId}/collections`)
      .then((r) => setCollections(r.items))
      .catch(() => undefined);
    api<{ items: Array<{ handle: string; title: string; published: boolean }> }>(`/api/v1/stores/${storeId}/pages`)
      .then((r) => setPages(r.items.filter((p) => p.published)))
      .catch(() => undefined);
  }, [storeId]);

  const save = useCallback(
    (next: Theme) => {
      if (!storeId) return;
      clearTimeout(timer.current);
      const problems = themeProblems(next);
      if (problems.length > 0) {
        setStatus("error");
        setError(`Not saved yet: ${problems[0]}`);
        return;
      }
      setStatus("saving");
      timer.current = setTimeout(() => {
        api<DesignState>(`/api/v1/stores/${storeId}/design/draft`, { method: "PUT", body: { theme: next } })
          .then((s) => {
            setState(s);
            setStatus("saved");
            setError(undefined);
            setFrameKey((k) => k + 1);
          })
          .catch((err: unknown) => {
            setStatus("error");
            setError(errorMessage(err));
          });
      }, 700);
    },
    [storeId],
  );

  if (!ctx) return null;
  const { store } = ctx;
  if (!draft || !state) {
    return (
      <Page>
        <PageHeader title={mod.label} eyebrow={mod.group} subtitle={mod.summary} />
        {error ? <p className="c-error">{error}</p> : <div className="c-skeleton" role="status" aria-label="Loading design" style={{ height: 300 }} />}
      </Page>
    );
  }

  const update = (next: Theme) => {
    setDraft(next);
    save(next);
  };
  const setSection = (i: number, s: ThemeSection) => update({ ...draft, sections: draft.sections.map((x, n) => (n === i ? s : x)) });
  const move = (i: number, by: number) => {
    const next = [...draft.sections];
    const [s] = next.splice(i, 1);
    next.splice(i + by, 0, s!);
    update({ ...draft, sections: next });
  };
  const addSection = (type: SectionType) => {
    const sid = `${type.replace(/_/g, "-")}-${Date.now().toString(36)}`;
    update({ ...draft, sections: [...draft.sections, newSection(type, sid)] });
    setOpen(sid);
  };

  async function act(action: "publish" | "discard") {
    try {
      const s = await api<DesignState>(`/api/v1/stores/${store.id}/design/${action}`, { method: "POST" });
      setState(s);
      setDraft(s.draft);
      setConfirm(undefined);
      setFrameKey((k) => k + 1);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const shop = storefrontUrl(store.slug);
  const previewSrc = frameKey === 0 ? `${shop}/preview?token=${encodeURIComponent(state.previewToken)}` : `${shop}?v=${frameKey}`;
  const pending = state.unpublished || status === "saving";

  return (
    <Page>
      <PageHeader
        title={mod.label}
        eyebrow={
          <>
            {mod.group}
            <Badge tone={pending ? "warning" : "success"}>{pending ? "Unpublished changes" : state.publishedAt ? "Published" : "Default design"}</Badge>
          </>
        }
        subtitle={status === "saving" ? "Saving draft…" : status === "saved" ? "Draft saved. Shoppers still see the published design until you publish." : "Changes save as a draft automatically. Publish when you're happy."}
        actions={
          <>
            <a className="c-btn" href={`${shop}/preview?token=${encodeURIComponent(state.previewToken)}`} target="_blank" rel="noreferrer">
              <ExternalIcon size={15} /> Preview
            </a>
            {state.unpublished && (
              <button type="button" className="c-btn" onClick={() => setConfirm("discard")}>
                Discard changes
              </button>
            )}
            <button type="button" className="c-btn c-btn-primary" disabled={!state.unpublished || status === "saving" || status === "error"} onClick={() => setConfirm("publish")}>
              Publish
            </button>
          </>
        }
      />
      {error && (
        <p role="alert" className="c-error" style={{ marginBottom: 12 }}>
          {error}
        </p>
      )}
      <div className="c-design">
        <div className="c-design-panel">
          <nav className="c-tabs" aria-label="Design areas">
            {(
              [
                ["home", "Home page"],
                ["theme", "Look"],
                ["menus", "Menus & languages"],
              ] as const
            ).map(([k, label]) => (
              <a
                key={k}
                href="#"
                aria-current={tab === k ? "page" : undefined}
                onClick={(e) => {
                  e.preventDefault();
                  setTab(k);
                }}
              >
                {label}
              </a>
            ))}
            <a href={`/s/${store.id}/design/pages`}>Pages</a>
          </nav>

          {tab === "home" && (
            <div style={{ display: "grid", gap: 10 }}>
              {draft.sections.map((s, i) => (
                <div key={s.id} className="c-design-section" data-open={open === s.id ? "true" : undefined}>
                  <div className="c-design-section-head">
                    <button type="button" className="c-design-toggle" aria-expanded={open === s.id} onClick={() => setOpen(open === s.id ? undefined : s.id)}>
                      <strong>{SECTION_LABELS[s.type]}</strong>
                      <span className="c-muted">{s.heading || (s.type === "hero" ? store.name : "")}</span>
                    </button>
                    <span>
                      <button type="button" className="c-btn c-btn-sm c-btn-ghost" aria-label={`Move ${SECTION_LABELS[s.type]} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                        <ArrowUpIcon size={13} />
                      </button>
                      <button type="button" className="c-btn c-btn-sm c-btn-ghost" aria-label={`Move ${SECTION_LABELS[s.type]} down`} disabled={i === draft.sections.length - 1} onClick={() => move(i, 1)}>
                        <ArrowDownIcon size={13} />
                      </button>
                      <button type="button" className="c-btn c-btn-sm c-btn-ghost" aria-label={`Remove ${SECTION_LABELS[s.type]}`} onClick={() => update({ ...draft, sections: draft.sections.filter((_, n) => n !== i) })}>
                        <TrashIcon size={13} />
                      </button>
                    </span>
                  </div>
                  {open === s.id && <SectionFields section={s} storeId={store.id} collections={collections} onChange={(x) => setSection(i, x)} />}
                </div>
              ))}
              {draft.sections.length < MAX_SECTIONS && (
                <div className="c-field" style={{ marginTop: 6 }}>
                  <label className="c-label" htmlFor={ids.add}>
                    Add a section
                  </label>
                  <select
                    id={ids.add}
                    className="c-select"
                    value=""
                    onChange={(e) => {
                      if (e.target.value) addSection(e.target.value as SectionType);
                    }}
                  >
                    <option value="">Choose a section…</option>
                    {SECTION_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {SECTION_LABELS[t]}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}

          {tab === "theme" && (
            <div className="c-form">
              <ColorField key={`a${draft.colors.accent}`} id={ids.accent} label="Brand colour" value={draft.colors.accent} onChange={(accent) => update({ ...draft, colors: { ...draft.colors, accent } })} hint="Buttons, links and highlights." />
              <ColorField key={`d${draft.colors.dark}`} id={ids.dark} label="Dark colour" value={draft.colors.dark} onChange={(dark) => update({ ...draft, colors: { ...draft.colors, dark } })} hint="The hero and announcement bar." />
              <div className="c-form-row">
                <Field id={ids.font} label="Font">
                  <select id={ids.font} className="c-select" value={draft.font} onChange={(e) => update({ ...draft, font: e.target.value as Theme["font"] })}>
                    <option value="modern">Modern (sans-serif)</option>
                    <option value="classic">Classic (serif)</option>
                    <option value="rounded">Rounded</option>
                  </select>
                </Field>
                <Field id={ids.buttons} label="Buttons">
                  <select id={ids.buttons} className="c-select" value={draft.buttons} onChange={(e) => update({ ...draft, buttons: e.target.value as Theme["buttons"] })}>
                    <option value="rounded">Rounded</option>
                    <option value="pill">Pill</option>
                    <option value="square">Square</option>
                  </select>
                </Field>
              </div>
              <div className="c-field">
                <span className="c-label">Logo</span>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  {draft.logoMediaId ? <Thumb mediaId={draft.logoMediaId} size="sm" /> : <span className="c-muted">Your store name is shown instead.</span>}
                  <button type="button" className="c-btn c-btn-sm" onClick={() => setPickingLogo(true)}>
                    {draft.logoMediaId ? "Change" : "Choose logo"}
                  </button>
                  {draft.logoMediaId && (
                    <button type="button" className="c-btn c-btn-sm c-btn-ghost" onClick={() => update({ ...draft, logoMediaId: null })}>
                      Remove
                    </button>
                  )}
                </div>
              </div>
              <label className="c-inline-check">
                <input
                  type="checkbox"
                  className="c-check-input"
                  checked={draft.announcement !== null}
                  onChange={(e) => update({ ...draft, announcement: e.target.checked ? { text: "Free delivery on orders over ₹999", href: null } : null })}
                />
                Announcement bar
              </label>
              {draft.announcement && (
                <div className="c-form-row">
                  <Field id={ids.ann} label="Message">
                    <input id={ids.ann} className="c-input" maxLength={120} value={draft.announcement.text} onChange={(e) => update({ ...draft, announcement: { ...draft.announcement!, text: e.target.value } })} />
                  </Field>
                  <Field id={ids.annHref} label="Link (optional)">
                    <input id={ids.annHref} className="c-input" maxLength={500} value={draft.announcement.href ?? ""} onChange={(e) => update({ ...draft, announcement: { ...draft.announcement!, href: e.target.value || null } })} placeholder="/products" />
                  </Field>
                </div>
              )}
              {pickingLogo && (
                <MediaPicker
                  storeId={store.id}
                  open
                  kind="media"
                  title="Choose your logo"
                  initial={draft.logoMediaId ? [draft.logoMediaId] : []}
                  onClose={() => setPickingLogo(false)}
                  onPick={(pickedIds, assets) => {
                    update({ ...draft, logoMediaId: assets.find((a) => a.kind === "image")?.id ?? pickedIds[0] ?? null });
                    setPickingLogo(false);
                  }}
                />
              )}
            </div>
          )}

          {tab === "menus" && (
            <div className="c-form">
              <div className="c-field">
                <span className="c-label">Header menu</span>
                <p className="c-hint" style={{ marginTop: 0 }}>
                  Empty: &ldquo;Shop all&rdquo; and your collections.
                </p>
                <LinksEditor id="header" links={draft.header.links} collections={collections} pages={pages} onChange={(links) => update({ ...draft, header: { links } })} />
              </div>
              <div className="c-field">
                <span className="c-label">Footer links</span>
                <LinksEditor id="footer" links={draft.footer.links} collections={collections} pages={pages} onChange={(links) => update({ ...draft, footer: { ...draft.footer, links } })} />
              </div>
              <Field id={ids.footer} label="Footer text">
                <textarea id={ids.footer} className="c-textarea" rows={2} maxLength={300} value={draft.footer.text} onChange={(e) => update({ ...draft, footer: { ...draft.footer, text: e.target.value } })} placeholder="Handpicked tea from Assam and Darjeeling, packed in Pune." />
              </Field>
              <div className="c-field">
                <span className="c-label">Languages</span>
                <p className="c-hint" style={{ marginTop: 0 }}>
                  Shoppers see the storefront in their browser&apos;s language when it&apos;s one of these, and can switch. The first is the default.
                </p>
                {STORE_LANGUAGES.map((l) => {
                  const on = draft.languages.includes(l.code);
                  return (
                    <label key={l.code} className="c-inline-check" style={{ display: "flex", marginBottom: 6 }}>
                      <input
                        type="checkbox"
                        className="c-check-input"
                        checked={on}
                        disabled={on && draft.languages.length === 1}
                        onChange={(e) => update({ ...draft, languages: e.target.checked ? [...draft.languages, l.code as StoreLanguage] : draft.languages.filter((x) => x !== l.code) })}
                      />
                      {l.name} <span className="c-muted">{l.native}</span>
                      {l.rtl && <Badge>Right to left</Badge>}
                      {draft.languages[0] === l.code && <Badge tone="info">Default</Badge>}
                      {on && draft.languages[0] !== l.code && (
                        <button type="button" className="c-btn c-btn-sm c-btn-ghost" onClick={() => update({ ...draft, languages: [l.code as StoreLanguage, ...draft.languages.filter((x) => x !== l.code)] })}>
                          Make default
                        </button>
                      )}
                    </label>
                  );
                })}
                <p className="c-hint">Your product names and descriptions show as you wrote them; AI Studio can draft them in other languages.</p>
              </div>
            </div>
          )}
        </div>

        <Card
          title="Preview"
          actions={
            <div className="c-range" role="group" aria-label="Preview size">
              <button type="button" aria-pressed={device === "desktop"} onClick={() => setDevice("desktop")}>
                Desktop
              </button>
              <button type="button" aria-pressed={device === "mobile"} onClick={() => setDevice("mobile")}>
                Mobile
              </button>
            </div>
          }
          flush
        >
          <div className="c-design-frame" data-device={device}>
            <iframe key={frameKey} title="Store preview" src={previewSrc} sandbox="allow-same-origin" />
          </div>
        </Card>
      </div>

      {confirm && (
        <Dialog
          open
          onClose={() => setConfirm(undefined)}
          title={confirm === "publish" ? "Publish your design?" : "Discard your changes?"}
          footer={
            <>
              <button type="button" className="c-btn" onClick={() => setConfirm(undefined)}>
                Cancel
              </button>
              <button type="button" className={`c-btn ${confirm === "publish" ? "c-btn-primary" : "c-btn-danger"}`} onClick={() => void act(confirm)}>
                {confirm === "publish" ? "Publish" : "Discard changes"}
              </button>
            </>
          }
        >
          <p style={{ margin: 0 }}>{confirm === "publish" ? "Shoppers will see the new design straight away." : "The draft goes back to what's published now. This can't be undone."}</p>
        </Dialog>
      )}
    </Page>
  );
}
