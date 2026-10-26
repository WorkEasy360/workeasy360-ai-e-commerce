/**
 * Bookable services: weekly opening hours in the store's time zone, cut
 * into slots of the service's length. Shoppers pick a slot; the API checks
 * the slot is real and still has room before taking the booking.
 */

export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

/** Opening periods per weekday as "HH:MM" pairs; a day with none is closed. */
export type WeeklyHours = Record<Weekday, Array<[string, string]>>;

/** Used until the merchant sets hours: Monday to Saturday, 9 to 6. */
export const DEFAULT_HOURS: WeeklyHours = {
  mon: [["09:00", "18:00"]],
  tue: [["09:00", "18:00"]],
  wed: [["09:00", "18:00"]],
  thu: [["09:00", "18:00"]],
  fri: [["09:00", "18:00"]],
  sat: [["09:00", "18:00"]],
  sun: [],
};

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

const minutesOf = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/** Problems with hours a merchant entered, or an empty list. */
export function hoursProblems(hours: WeeklyHours): string[] {
  const problems: string[] = [];
  for (const day of WEEKDAYS) {
    const periods = hours[day] ?? [];
    if (periods.length > 4) problems.push(`${day}: at most 4 periods a day`);
    const sorted = periods.toSorted((a, b) => a[0].localeCompare(b[0]));
    sorted.forEach(([from, to], i) => {
      if (!TIME.test(from) || !TIME.test(to)) problems.push(`${day}: use times like 09:30`);
      else if (minutesOf(to) <= minutesOf(from)) problems.push(`${day}: ${from}–${to} ends before it starts`);
      else if (i > 0 && minutesOf(from) < minutesOf(sorted[i - 1]![1])) problems.push(`${day}: periods overlap`);
    });
  }
  return problems;
}

/** Minutes the time zone is ahead of UTC at an instant (330 for Asia/Kolkata). */
export function zoneOffsetMinutes(at: Date, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60_000);
}

/** The instant a wall-clock date and time happen in a time zone. */
export function zonedTime(date: string, time: string, timeZone: string): Date {
  const [, y, m, d] = DATE.exec(date) ?? [];
  const guess = Date.UTC(Number(y), Number(m) - 1, Number(d), Number(time.slice(0, 2)), Number(time.slice(3, 5)));
  // Two passes settle the offset across daylight-saving changes.
  let at = guess - zoneOffsetMinutes(new Date(guess), timeZone) * 60_000;
  at = guess - zoneOffsetMinutes(new Date(at), timeZone) * 60_000;
  return new Date(at);
}

/** The wall-clock date ("2026-10-23") and time ("14:30") of an instant in a time zone. */
export function localParts(at: Date, timeZone: string): { date: string; time: string } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
      .formatToParts(at)
      .map((x) => [x.type, x.value]),
  );
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

export function weekdayOf(date: string): Weekday {
  const [, y, m, d] = DATE.exec(date) ?? [];
  const sundayFirst = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d))).getUTCDay();
  return WEEKDAYS[(sundayFirst + 6) % 7]!;
}

export function isDate(value: string): boolean {
  const match = DATE.exec(value);
  if (!match) return false;
  const d = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return d.toISOString().slice(0, 10) === value;
}

export interface SlotRules {
  hours: WeeklyHours;
  durationMinutes: number;
  noticeHours: number;
  timeZone: string;
  /** How far ahead shoppers may book. */
  horizonDays?: number;
}

/** Start times on a date, as instants, that are open and far enough ahead. */
export function slotsOn(date: string, rules: SlotRules, now: Date): Date[] {
  if (!isDate(date)) return [];
  const earliest = now.getTime() + rules.noticeHours * 3_600_000;
  const latest = now.getTime() + (rules.horizonDays ?? 366) * 86_400_000;
  const slots: Date[] = [];
  for (const [from, to] of rules.hours[weekdayOf(date)] ?? []) {
    for (let m = minutesOf(from); m + rules.durationMinutes <= minutesOf(to); m += rules.durationMinutes) {
      const at = zonedTime(date, `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`, rules.timeZone);
      if (at.getTime() >= earliest && at.getTime() <= latest) slots.push(at);
    }
  }
  return slots;
}

/** Whether an instant is one of the bookable slot starts. */
export function isSlot(at: Date, rules: SlotRules, now: Date): boolean {
  const { date } = localParts(at, rules.timeZone);
  return slotsOn(date, rules, now).some((s) => s.getTime() === at.getTime());
}
