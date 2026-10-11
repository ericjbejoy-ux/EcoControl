// Service tests verify the mock generators stay inside required physical bounds.
import { describe, expect, it } from "vitest";
import { carbonIntensity, facilityPower, indoorTemperature } from "../mock/mockData.js";

describe("mock generators", () => {
  it("keeps power, carbon intensity, and indoor temperature in realistic ranges", () => {
    for (let index = 0; index < 96; index += 1) {
      expect(facilityPower(index)).toBeGreaterThanOrEqual(50);
      expect(facilityPower(index)).toBeLessThanOrEqual(300);
      expect(carbonIntensity(index)).toBeGreaterThanOrEqual(200);
      expect(carbonIntensity(index)).toBeLessThanOrEqual(800);
      expect(indoorTemperature(index)).toBeGreaterThanOrEqual(15);
      expect(indoorTemperature(index)).toBeLessThanOrEqual(35);
    }
  });
});
