/** SI internally; display adapters for UI. unitsVersion = 1 */

export const AU_M = 1.495_978_707e11;
export const AU_KM = AU_M / 1000;
export const DAY_S = 86_400;
export const SOLAR_MASS_KG = 1.988_47e30;
export const EARTH_MASS_KG = 5.972_2e24;
export const EARTH_RADIUS_KM = 6371.0;

export function kgToEarthMasses(kg: number): number {
  return kg / EARTH_MASS_KG;
}

export function kgToSolarMasses(kg: number): number {
  return kg / SOLAR_MASS_KG;
}

export function kmToEarthRadii(km: number): number {
  return km / EARTH_RADIUS_KM;
}

export function auToKm(au: number): number {
  return au * AU_KM;
}

export function formatMass(kg: number): string {
  if (kg >= SOLAR_MASS_KG * 0.01) {
    return `${kgToSolarMasses(kg).toPrecision(4)} M☉`;
  }
  const me = kgToEarthMasses(kg);
  if (me >= 0.01) return `${me.toPrecision(4)} M⊕`;
  return `${kg.toExponential(3)} kg`;
}

export function formatRadius(km: number): string {
  const re = kmToEarthRadii(km);
  if (re >= 0.05) {
    return `${km.toLocaleString(undefined, { maximumFractionDigits: 0 })} km (${re.toPrecision(3)} R⊕)`;
  }
  return `${km.toLocaleString(undefined, { maximumFractionDigits: 1 })} km`;
}

export function formatAu(au: number): string {
  if (au < 0.01) return `${au.toExponential(2)} AU`;
  return `${au.toPrecision(4)} AU`;
}

export function formatPeriodDays(d: number): string {
  if (d >= 365.25) {
    const y = d / 365.25;
    return `${y.toPrecision(4)} yr`;
  }
  return `${d.toPrecision(4)} d`;
}

export function formatDensity(gcm3: number): string {
  return `${gcm3.toPrecision(3)} g/cm³`;
}
