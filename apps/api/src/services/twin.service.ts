// Twin service returns a stable 24-hour thermal response for a throttle profile.
import { clamp, facilities, indoorTemperature, mockSource } from "../mock/mockData.js";

export function simulateTwin(input: {
  facilityId: string;
  throttleProfile?: number[] | undefined;
  setpoint: number;
  window: number;
}) {
  if (!facilities.some((facility) => facility.id === input.facilityId)) return undefined;
  const tempCurve = Array.from({ length: 96 }, (_, index) => {
    const throttle = input.throttleProfile?.[index] ?? 100;
    const unconditionedDrift = ((100 - throttle) / 100) * Math.sin((index / 96) * Math.PI * 2) * 3.5;
    return Math.round(clamp(indoorTemperature(index, input.setpoint) + unconditionedDrift, 15, 35) * 10) / 10;
  });
  const activeCurve = tempCurve.slice(0, input.window);
  const comfortViolations = activeCurve.filter((temp) => temp < 21 || temp > 26).length;
  return { tempCurve, comfortViolations, source: mockSource };
}
