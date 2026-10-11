// Deterministic demo fixtures keep the API repeatable while timestamps stay current.
export const facilities = [
  { id: "office-tower-01", name: "Office Tower A", region: "US-CAL-CISO", type: "office" },
  { id: "distribution-02", name: "North Distribution Center", region: "US-NY-NYIS", type: "warehouse" },
  { id: "campus-03", name: "Riverside Campus", region: "US-TEX-ERCO", type: "campus" },
  { id: "retail-04", name: "Market Street Retail", region: "GB", type: "retail" }
] as const;

export const mockSource = "mock" as const;

export function alignedQuarterHourStart(now = new Date()): Date {
  const date = new Date(now);
  date.setUTCSeconds(0, 0);
  date.setUTCMinutes(Math.floor(date.getUTCMinutes() / 15) * 15);
  return date;
}

export function quarterHourTimestamp(index: number, start = alignedQuarterHourStart()): string {
  return new Date(start.getTime() + index * 15 * 60_000).toISOString();
}

export function dailyValue(index: number, base: number, amplitude: number, phase = 0): number {
  return base + amplitude * Math.sin(((index + phase) / 96) * Math.PI * 2);
}

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function facilityPower(index: number, facilityIndex = 0): number {
  const base = [178, 126, 242, 91][facilityIndex % 4] ?? 160;
  const dailySwing = dailyValue(index, 0, 45, -28);
  const shortCycle = 12 * Math.sin(index * Math.PI / 8);
  return Math.round(clamp(base + dailySwing + shortCycle, 50, 300) * 10) / 10;
}

export function carbonIntensity(index: number, phase = 0): number {
  return Math.round(clamp(dailyValue(index, 510, 185, phase), 200, 800));
}

export function indoorTemperature(index: number, setpoint = 23): number {
  const drift = 1.2 * Math.sin((index / 96) * Math.PI * 2 - 0.8);
  return Math.round(clamp(setpoint + drift, 20, 26) * 10) / 10;
}
