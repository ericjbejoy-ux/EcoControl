/**
 * Time helpers built on Luxon — timezone & DST aware (FR-1, validators/timezone).
 */

import { DateTime } from 'luxon';

/** Round a UTC timestamp down to the nearest `minutes` boundary. */
export function floorToInterval(date: Date, minutes = 15): Date {
  const ms = minutes * 60 * 1000;
  return new Date(Math.floor(date.getTime() / ms) * ms);
}

/** Round a UTC timestamp to the nearest `minutes` boundary. */
export function roundToInterval(date: Date, minutes = 15): Date {
  const ms = minutes * 60 * 1000;
  return new Date(Math.round(date.getTime() / ms) * ms);
}

/** Inclusive list of UTC timestamps on a regular grid. */
export function gridTimestamps(start: Date, end: Date, minutes = 15): Date[] {
  const step = minutes * 60 * 1000;
  const first = floorToInterval(start, minutes);
  const out: Date[] = [];
  for (let t = first.getTime(); t <= end.getTime(); t += step) {
    out.push(new Date(t));
  }
  return out;
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

export function diffMinutes(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / 60000;
}

export function toUtcIso(date: Date): string {
  return date.toISOString();
}

/** Convert a wall-clock string in a given IANA zone to a UTC ISO string. */
export function zonedToUtcIso(
  value: string,
  zone: string,
  formats: string[] = ['yyyy-MM-dd HH:mm:ss', 'yyyy-MM-dd HH:mm', "yyyy-MM-dd'T'HH:mm:ss", "yyyy-MM-dd'T'HH:mm"]
): string | null {
  for (const format of formats) {
    const dt = DateTime.fromFormat(value, format, { zone });
    if (dt.isValid) return dt.toUTC().toISO();
  }
  // Fall back to ISO parsing (handles offsets like 2024-01-01T00:00:00+05:30)
  const iso = DateTime.fromISO(value, { zone });
  if (iso.isValid) return iso.toUTC().toISO();
  return null;
}

/** Convert a UTC ISO string to a wall-clock string in a zone. */
export function utcIsoToZoned(iso: string, zone: string, format = 'yyyy-MM-dd HH:mm'): string {
  return DateTime.fromISO(iso, { zone: 'utc' }).setZone(zone).toFormat(format);
}

export function isValidZone(zone: string): boolean {
  return DateTime.local().setZone(zone).isValid || zone === 'UTC';
}

/** Midpoint between two Date objects. */
export function midpoint(a: Date, b: Date): Date {
  return new Date((a.getTime() + b.getTime()) / 2);
}

export function isWeekend(date: Date, zone = 'UTC'): boolean {
  const dt = DateTime.fromJSDate(date, { zone });
  return dt.weekday > 5;
}

export function hourOfDay(date: Date, zone = 'UTC'): number {
  return DateTime.fromJSDate(date, { zone }).hour;
}

export function isWeekday(date: Date, zone = 'UTC'): boolean {
  return !isWeekend(date, zone);
}

/** First and last instant of a calendar day in a zone, as UTC dates. */
export function dayBounds(date: Date, zone: string): { start: Date; end: Date } {
  const dt = DateTime.fromJSDate(date, { zone }).startOf('day');
  return { start: dt.toUTC().toJSDate(), end: dt.plus({ days: 1 }).toUTC().toJSDate() };
}

/** Enumerate each 15-minute slot between two UTC instants. */
export function eachInterval(start: Date, end: Date, minutes = 15): Date[] {
  return gridTimestamps(start, end, minutes);
}
