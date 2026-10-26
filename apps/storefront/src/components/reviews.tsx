"use client";

import { useId, useState } from "react";
import { useI18n } from "./i18n";
import { ProductImage } from "./shop";

export interface ReviewableItem {
  productId: string;
  title: string;
  imageId: string | null;
  review: { rating: number; title: string | null; body: string; status: "pending" | "published" | "hidden" } | null;
}

export function StarsShown({ rating, size = 16, label }: { rating: number; size?: number; label?: string }) {
  const full = Math.round(rating);
  return (
    <span className="sf-stars" style={{ fontSize: size }} role="img" aria-label={label ?? `${rating} / 5`}>
      {"★".repeat(full)}
      <span className="sf-stars-empty">{"★".repeat(5 - full)}</span>
    </span>
  );
}

/** Five radio buttons drawn as stars: keyboard and screen readers get a plain choice of 1 to 5. */
function StarInput({ value, onChange, name }: { value: number; onChange: (v: number) => void; name: string }) {
  const [hover, setHover] = useState(0);
  const { t, tn } = useI18n();
  return (
    <fieldset className="sf-star-input" onMouseLeave={() => setHover(0)}>
      <legend className="c-visually-hidden">{t("reviews.yourRating")}</legend>
      {[1, 2, 3, 4, 5].map((n) => (
        <label key={n} data-on={(hover || value) >= n ? "true" : undefined} onMouseEnter={() => setHover(n)}>
          <input type="radio" name={name} value={n} checked={value === n} onChange={() => onChange(n)} />
          <span aria-hidden="true">★</span>
          <span className="c-visually-hidden">{tn("reviews.star", n)}</span>
        </label>
      ))}
    </fieldset>
  );
}

function ReviewForm({ item, postUrl, onDone }: { item: ReviewableItem; postUrl: string; onDone: (items: ReviewableItem[]) => void }) {
  const id = useId();
  const [rating, setRating] = useState(0);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const { t } = useI18n();

  async function submit() {
    if (rating === 0) {
      setError(t("reviews.chooseRating"));
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const res = await fetch(postUrl, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ productId: item.productId, rating, title: title || null, body }) });
      const out = (await res.json().catch(() => ({}))) as { items?: ReviewableItem[]; title?: string; errors?: Array<{ message: string }> };
      if (res.ok && out.items) onDone(out.items);
      else setError(out.errors?.[0]?.message ?? out.title ?? t("reviews.sendError"));
    } catch {
      setError(t("reviews.offline"));
    }
    setBusy(false);
  }

  return (
    <div className="sf-review-form">
      <StarInput value={rating} onChange={setRating} name={`${id}-stars`} />
      <label className="c-visually-hidden" htmlFor={`${id}-title`}>
        {t("reviews.headlineLabel")}
      </label>
      <input id={`${id}-title`} className="c-input" placeholder={t("reviews.headline")} maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} />
      <label className="c-visually-hidden" htmlFor={`${id}-body`}>
        {t("reviews.bodyLabel")}
      </label>
      <textarea id={`${id}-body`} className="c-textarea" rows={3} maxLength={4000} placeholder={t("reviews.body")} value={body} onChange={(e) => setBody(e.target.value)} />
      {error && (
        <p className="c-error" role="alert" style={{ margin: 0 }}>
          {error}
        </p>
      )}
      <button type="button" className="sf-btn sf-btn-brand sf-btn-sm" disabled={busy} onClick={() => void submit()}>
        {busy ? t("reviews.sending") : t("reviews.post")}
      </button>
    </div>
  );
}

/** Review forms for each product in an order, or the review already given. */
export function ReviewForms({ items: initial, postUrl, heading }: { items: ReviewableItem[]; postUrl: string; heading: string }) {
  const [items, setItems] = useState(initial);
  const { t } = useI18n();
  const done = items.filter((i) => i.review).length;
  return (
    <section className="sf-step" aria-labelledby="rev-h">
      <h2 id="rev-h">{heading}</h2>
      {done > 0 && done === items.length && <p className="c-muted" style={{ margin: 0 }}>{t("reviews.thanksAll")}</p>}
      <ul className="sf-reviewables">
        {items.map((i) => (
          <li key={i.productId}>
            <span className="sf-line-img" style={{ width: 56, height: 56 }}>
              <ProductImage id={i.imageId} alt="" />
            </span>
            <div style={{ minWidth: 0, display: "grid", gap: 8 }}>
              <strong>{i.title}</strong>
              {i.review ? (
                <span className="sf-line-sub">
                  <StarsShown rating={i.review.rating} size={14} label={t("reviews.stars", { n: i.review.rating })} /> {i.review.status === "published" ? t("reviews.live") : t("reviews.pending")}
                </span>
              ) : (
                <ReviewForm item={i} postUrl={postUrl} onDone={setItems} />
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
