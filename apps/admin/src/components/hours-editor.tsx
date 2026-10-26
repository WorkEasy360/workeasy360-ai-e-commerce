"use client";

import { hoursProblems, WEEKDAYS, type Weekday, type WeeklyHours } from "@workeasy/commerce";
import { PlusIcon, TrashIcon } from "@workeasy/ui/react";

const DAY_LABEL: Record<Weekday, string> = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };

/** Weekly opening hours for bookings: up to four periods a day; a day with none is closed. */
export function HoursEditor({ value, onChange, disabled, idPrefix }: { value: WeeklyHours; onChange: (next: WeeklyHours) => void; disabled?: boolean; idPrefix: string }) {
  const problems = hoursProblems(value);
  const setDay = (day: Weekday, periods: Array<[string, string]>) => onChange({ ...value, [day]: periods });

  return (
    <div className="c-hours" role="group" aria-label="Booking hours">
      {WEEKDAYS.map((day) => {
        const periods = value[day] ?? [];
        return (
          <div key={day} className="c-hours-day">
            <strong>{DAY_LABEL[day]}</strong>
            <div>
              {periods.length === 0 && <span className="c-muted">Closed</span>}
              {periods.map(([from, to], i) => (
                <span key={i} style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
                  <input
                    className="c-input"
                    type="time"
                    aria-label={`${DAY_LABEL[day]} period ${i + 1} opens`}
                    id={`${idPrefix}-${day}-${i}-from`}
                    value={from}
                    disabled={disabled}
                    onChange={(e) => setDay(day, periods.map((p, n) => (n === i ? [e.target.value, p[1]] : p)))}
                  />
                  –
                  <input
                    className="c-input"
                    type="time"
                    aria-label={`${DAY_LABEL[day]} period ${i + 1} closes`}
                    value={to}
                    disabled={disabled}
                    onChange={(e) => setDay(day, periods.map((p, n) => (n === i ? [p[0], e.target.value] : p)))}
                  />
                  <button type="button" className="c-btn c-btn-sm c-btn-ghost" aria-label={`Remove ${DAY_LABEL[day]} period ${i + 1}`} disabled={disabled} onClick={() => setDay(day, periods.filter((_, n) => n !== i))}>
                    <TrashIcon size={13} />
                  </button>
                </span>
              ))}
              {periods.length < 4 && (
                <button
                  type="button"
                  className="c-btn c-btn-sm c-btn-ghost"
                  disabled={disabled}
                  aria-label={`Add hours on ${DAY_LABEL[day]}`}
                  onClick={() => setDay(day, [...periods, periods.length === 0 ? ["09:00", "18:00"] : [periods.at(-1)![1], "20:00"]])}
                >
                  <PlusIcon size={13} /> {periods.length === 0 ? "Open" : "Add"}
                </button>
              )}
            </div>
          </div>
        );
      })}
      {problems.length > 0 && (
        <p className="c-error" role="alert">
          {problems[0]}
        </p>
      )}
    </div>
  );
}
