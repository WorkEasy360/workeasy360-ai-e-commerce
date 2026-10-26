"use client";

import { useEffect, useState } from "react";
import { useI18n } from "../../../../../components/i18n";

interface Days {
  timeZone: string;
  durationMinutes: number;
  days: string[];
}

interface DaySlots {
  date: string;
  slots: Array<{ at: string; time: string; left: number }>;
}

/**
 * Picking a booking: the next open days, then that day's slots with the
 * places left. Times are the shop's local time, which is what the shop
 * and the shopper agree on.
 */
export function SlotPicker({ slug, handle, locale, value, onChange }: { slug: string; handle: string; locale: string; value: string; onChange: (at: string) => void }) {
  const [days, setDays] = useState<Days | undefined>();
  const [date, setDate] = useState<string | undefined>();
  const [day, setDay] = useState<DaySlots | undefined>();
  const [error, setError] = useState(false);
  const base = `/public/v1/stores/${slug}/products/${handle}/slots`;
  const { t, tn } = useI18n();

  useEffect(() => {
    let cancelled = false;
    fetch(base, { headers: { accept: "application/json" } })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const d = (await res.json()) as Days;
        if (!cancelled) {
          setDays(d);
          setDate(d.days[0]);
        }
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [base]);

  useEffect(() => {
    if (!date) return;
    let cancelled = false;
    fetch(`${base}?date=${date}`, { headers: { accept: "application/json" } })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const d = (await res.json()) as DaySlots;
        if (!cancelled) setDay(d);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [base, date]);

  if (error) return <p className="c-error">{t("slots.loadError")}</p>;
  if (!days) return <div className="c-skeleton" role="status" aria-label={t("slots.loading")} style={{ height: 64 }} />;
  if (days.days.length === 0) return <p className="c-muted">{t("slots.none")}</p>;

  const label = (d: string) => {
    const at = new Date(`${d}T12:00:00Z`);
    return { weekday: at.toLocaleDateString(locale, { weekday: "short", timeZone: "UTC" }), date: at.toLocaleDateString(locale, { day: "numeric", month: "short", timeZone: "UTC" }) };
  };
  const slots = day && day.date === date ? day.slots : undefined;

  return (
    <div className="c-field" role="group" aria-label={t("slots.group")}>
      <span className="c-label">{t("slots.date")}</span>
      <div className="sf-slots-days">
        {days.days.map((d) => (
          <button
            key={d}
            type="button"
            aria-pressed={d === date}
            onClick={() => {
              setDate(d);
              onChange("");
            }}
          >
            <small>{label(d).weekday}</small>
            {label(d).date}
          </button>
        ))}
      </div>
      <span className="c-label" style={{ marginTop: 8 }}>
        {t("slots.time")} <small className="c-muted">({t("slots.minutes", { n: days.durationMinutes })})</small>
      </span>
      {!slots ? (
        <div className="c-skeleton" role="status" aria-label={t("slots.loading")} style={{ height: 44 }} />
      ) : slots.length === 0 ? (
        <p className="c-muted" style={{ margin: 0 }}>
          {t("slots.noneToday")}
        </p>
      ) : (
        <div className="sf-slot-grid">
          {slots.map((s) => (
            <button key={s.at} type="button" className="sf-slot" aria-pressed={value === s.at} disabled={s.left === 0} onClick={() => onChange(s.at)}>
              {s.time}
              <small>{s.left === 0 ? t("slots.full") : tn("slots.left", s.left)}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
