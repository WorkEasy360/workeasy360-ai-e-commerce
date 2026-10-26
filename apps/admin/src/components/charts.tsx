"use client";

import { useId, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";

/**
 * Small, dependency-free charts for the admin, drawn in SVG with the
 * validated brand series colours (--we-chart-1…3). Each chart is one
 * series; two measures get two charts, never two y-axes. Every chart has a
 * hover (and keyboard) tooltip and a table view, so nothing depends on
 * seeing the colour or the shape.
 */

export interface Point {
  /** Shown on the x axis and in the tooltip: "23 Oct". */
  label: string;
  value: number;
}

const W = 640;
const H = 200;
const PAD = { top: 12, right: 12, bottom: 26, left: 52 };

/** A round axis maximum: 1, 2 or 5 × 10^n at or above the data's maximum. */
function niceMax(max: number): number {
  if (max <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(max));
  for (const step of [1, 2, 2.5, 5, 10]) if (step * pow >= max) return step * pow;
  return 10 * pow;
}

/**
 * A single-series line over time, with a crosshair tooltip. `format` writes
 * values for the axis and tooltip; `name` titles the series in the tooltip
 * and the table.
 */
export function LineChart({ points, name, format, color = "var(--we-chart-1)", height = H }: { points: readonly Point[]; name: string; format: (v: number) => string; color?: string; height?: number }) {
  const id = useId();
  const [active, setActive] = useState<number | undefined>();
  const [table, setTable] = useState(false);
  const ref = useRef<SVGSVGElement>(null);
  const max = niceMax(Math.max(0, ...points.map((p) => p.value)));
  const innerW = W - PAD.left - PAD.right;
  const innerH = height - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (points.length <= 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH;
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join("");
  const ticks = [0, 0.5, 1].map((f) => f * max);
  // About six x labels, whatever the range.
  const every = Math.max(1, Math.ceil(points.length / 6));

  function pick(e: PointerEvent<SVGSVGElement>) {
    const box = ref.current?.getBoundingClientRect();
    if (!box || points.length === 0) return;
    const px = ((e.clientX - box.left) / box.width) * W;
    const i = Math.round(((px - PAD.left) / innerW) * (points.length - 1));
    setActive(Math.max(0, Math.min(points.length - 1, i)));
  }

  function keys(e: KeyboardEvent<SVGSVGElement>) {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      setActive((a) => Math.max(0, Math.min(points.length - 1, (a ?? (e.key === "ArrowRight" ? -1 : points.length)) + (e.key === "ArrowRight" ? 1 : -1))));
    }
    if (e.key === "Escape") setActive(undefined);
  }

  const a = active === undefined ? undefined : points[active];
  return (
    <figure className="c-chart" aria-labelledby={`${id}-cap`}>
      <figcaption id={`${id}-cap`} className="c-visually-hidden">
        {name}, {points[0]?.label} to {points.at(-1)?.label}
      </figcaption>
      {table ? (
        <ChartTable rows={points.map((p) => [p.label, format(p.value)])} headers={["Day", name]} />
      ) : (
        <div className="c-chart-plot">
          <svg
            ref={ref}
            viewBox={`0 0 ${W} ${height}`}
            role="img"
            aria-label={`${name}. Use the arrow keys to read each day.`}
            tabIndex={0}
            onPointerMove={pick}
            onPointerLeave={() => setActive(undefined)}
            onKeyDown={keys}
            onBlur={() => setActive(undefined)}
          >
            {ticks.map((t) => (
              <g key={t}>
                <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} className="c-chart-grid" />
                <text x={PAD.left - 8} y={y(t)} className="c-chart-axis" textAnchor="end" dominantBaseline="middle">
                  {format(t)}
                </text>
              </g>
            ))}
            {points.map((p, i) =>
              i % every === 0 || i === points.length - 1 ? (
                <text key={p.label} x={x(i)} y={height - 6} className="c-chart-axis" textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"}>
                  {p.label}
                </text>
              ) : null,
            )}
            <path d={path} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            {a && (
              <g>
                <line x1={x(active!)} x2={x(active!)} y1={PAD.top} y2={PAD.top + innerH} className="c-chart-cross" />
                <circle cx={x(active!)} cy={y(a.value)} r={5} fill={color} className="c-chart-dot" />
              </g>
            )}
          </svg>
          {a && (
            <div className="c-chart-tip" style={{ left: `${(x(active!) / W) * 100}%` }} role="status">
              <span>{a.label}</span>
              <strong>{format(a.value)}</strong>
            </div>
          )}
        </div>
      )}
      <button type="button" className="c-chart-toggle" onClick={() => setTable((t) => !t)}>
        {table ? "Show chart" : "Show as table"}
      </button>
    </figure>
  );
}

/**
 * Horizontal bars for a ranked list (top products, traffic sources). Values
 * are written beside each bar, so the bar length is a reading aid, not the
 * only way to get the number.
 */
export function BarList({ rows, format, color = "var(--we-chart-1)", empty }: { rows: ReadonlyArray<{ key: string; label: ReactNode; value: number; detail?: ReactNode }>; format: (v: number) => string; color?: string; empty: ReactNode }) {
  if (rows.length === 0) return <p className="c-muted" style={{ margin: 0 }}>{empty}</p>;
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <ul className="c-barlist">
      {rows.map((r) => (
        <li key={r.key} title={`${typeof r.label === "string" ? r.label : ""} ${format(r.value)}`.trim()}>
          <div className="c-barlist-text">
            <span className="c-barlist-label">{r.label}</span>
            <strong>{format(r.value)}</strong>
          </div>
          <div className="c-barlist-track" aria-hidden="true">
            <i style={{ width: `${Math.max(2, (r.value / max) * 100)}%`, background: color }} />
          </div>
          {r.detail && <span className="c-cell-sub">{r.detail}</span>}
        </li>
      ))}
    </ul>
  );
}

/** The shopping funnel: each step's sessions, and the share that went on from the step before. */
export function Funnel({ steps }: { steps: ReadonlyArray<{ label: string; value: number }> }) {
  const top = Math.max(steps[0]?.value ?? 0, 1);
  return (
    <ol className="c-funnel">
      {steps.map((s, i) => {
        const prev = i > 0 ? steps[i - 1]!.value : undefined;
        const rate = prev ? s.value / prev : undefined;
        return (
          <li key={s.label}>
            <div className="c-barlist-text">
              <span className="c-barlist-label">{s.label}</span>
              <strong>{s.value.toLocaleString()}</strong>
            </div>
            <div className="c-barlist-track" aria-hidden="true">
              <i style={{ width: `${Math.max(1.5, (s.value / top) * 100)}%`, background: "var(--we-chart-2)" }} />
            </div>
            {i > 0 && <span className="c-cell-sub">{prev ? `${Math.round((rate ?? 0) * 100)}% of the step before` : "—"}</span>}
          </li>
        );
      })}
    </ol>
  );
}

function ChartTable({ headers, rows }: { headers: [string, string]; rows: Array<[string, string]> }) {
  return (
    <div className="c-table-wrap" style={{ maxHeight: 240, overflowY: "auto" }}>
      <table className="c-table">
        <thead>
          <tr>
            <th scope="col">{headers[0]}</th>
            <th scope="col" className="c-num">
              {headers[1]}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([a, b]) => (
            <tr key={a}>
              <td>{a}</td>
              <td className="c-num">{b}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** "↑ 12% vs the previous 30 days", or nothing when there's no earlier figure to compare. */
export function change(current: number, previous: number, days: number): { text: string; tone: "up" | "down" | "flat" } | undefined {
  if (previous === 0) return current > 0 ? { text: `New in the last ${days} days`, tone: "up" } : undefined;
  const pct = Math.round(((current - previous) / previous) * 100);
  if (pct === 0) return { text: `Same as the previous ${days} days`, tone: "flat" };
  return { text: `${pct > 0 ? "↑" : "↓"} ${Math.abs(pct)}% vs the previous ${days} days`, tone: pct > 0 ? "up" : "down" };
}
