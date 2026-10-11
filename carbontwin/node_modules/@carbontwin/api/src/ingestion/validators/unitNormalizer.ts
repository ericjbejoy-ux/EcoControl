/**
 * Unit normalisation (FR-1, validators/unitNormalizer.ts).
 * Converts any of W / kW / MW / Wh / kWh / MWh into a canonical **average kW**
 * series. Energy values are converted to power using the sampling interval
 * (kW = kWh / interval_hours).
 */

import { POWER_UNIT_TO_KW, ENERGY_UNIT_TO_KWH, type PowerUnit, type EnergyUnit } from '@carbontwin/shared';

export type AnyUnit = PowerUnit | EnergyUnit;

export function isEnergyUnit(unit: AnyUnit): unit is EnergyUnit {
  return unit === 'Wh' || unit === 'kWh' || unit === 'MWh';
}

/** Convert a power value to kW. */
export function convertPowerToKw(value: number, unit: PowerUnit): number {
  return value * POWER_UNIT_TO_KW[unit];
}

/** Convert an energy value to kWh. */
export function convertEnergyToKwh(value: number, unit: EnergyUnit): number {
  return value * ENERGY_UNIT_TO_KWH[unit];
}

export interface NormalizeToKwOptions {
  unit: AnyUnit;
  /** True when the source column is energy (Wh/kWh/MWh) rather than power. */
  isEnergy?: boolean;
  /** Sampling interval in minutes — required for energy → power. */
  intervalMinutes?: number;
}

/**
 * Normalise a raw reading to average kW.
 * - Power units → simple scaling.
 * - Energy units → kWh / interval_hours.
 */
export function normalizeToKw(value: number, options: NormalizeToKwOptions): number {
  const { unit, isEnergy = isEnergyUnit(unit), intervalMinutes = 15 } = options;
  if (!Number.isFinite(value)) return NaN;

  if (isEnergy && isEnergyUnit(unit)) {
    const kwh = convertEnergyToKwh(value, unit);
    const intervalHours = intervalMinutes / 60;
    if (intervalHours <= 0) return NaN;
    return kwh / intervalHours;
  }
  return convertPowerToKw(value, unit as PowerUnit);
}

/** Human-readable description of the transformation applied. */
export function describeNormalization(options: NormalizeToKwOptions): string {
  const { unit, isEnergy = isEnergyUnit(unit), intervalMinutes = 15 } = options;
  if (isEnergy && isEnergyUnit(unit)) {
    return `Energy ${unit} → average kW (÷ ${(intervalMinutes / 60).toFixed(2)} h interval)`;
  }
  if (unit === 'kW') return 'Power kW (unchanged)';
  return `Power ${unit} → kW`;
}

/**
 * Detect the unit of a series from magnitudes when metadata is missing.
 * Kept intentionally conservative — explicit header detection wins.
 */
export function guessUnitFromHeader(header: string): AnyUnit | null {
  const h = header.toLowerCase();
  if (/kwh|kilowatt.?hour/.test(h)) return 'kWh';
  if (/mwh|megawatt.?hour/.test(h)) return 'MWh';
  if (/(?<![km])wh(?!h)|watt.?hour/.test(h)) return 'Wh';
  if (/kw|kilowatt/.test(h)) return 'kW';
  if (/mw|megawatt/.test(h)) return 'MW';
  if (/(?:^|[^kmg])w(?!h)|watt/.test(h)) return 'W';
  return null;
}
