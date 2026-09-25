/** Classroom country-lending destinations (placeholder rates — not live data). */
import { WORLD_MAP_VIEW, projectLonLat } from "./worldLandPath";

export { WORLD_MAP_VIEW, projectLonLat };

/** Matches classroom bond horizon (interest earned through this date). */
export const LENDING_HORIZON_LABEL = "May 15, 2027";
export const LENDING_HORIZON = new Date(Date.UTC(2027, 4, 15));
export const LENDING_FACE_VALUE = 1000;

export const OCEAN_LABELS = [
  { id: "pacificW", text: "Pacific", x: 140, y: 260, rotate: -12 },
  { id: "pacificE", text: "Pacific", x: 880, y: 240, rotate: 12 },
  { id: "atlantic", text: "Atlantic", x: 380, y: 230, rotate: 0 },
  { id: "indian", text: "Indian Ocean", x: 680, y: 340, rotate: 0 },
];

/**
 * Lendable countries — loans are in U.S. dollars, so ratePct is roughly each
 * country's dollar-bond yield. Keep in sync with backend/lending.py COUNTRIES.
 * defaultPct = chance each monthly payment is missed (rerolled every month).
 * A miss skips that month's interest; missing the final payment also returns
 * only LENDING_RECOVERY_PCT of the principal.
 */
export const LENDING_RECOVERY_PCT = 75;
export const LENDING_SALE_DISCOUNT_PER_MISS_PCT = 5;
export const LENDING_COUNTRIES = [
  {
    id: "US",
    name: "United States",
    ratePct: 4.3,
    defaultPct: 1.0,
    tenor: "1-year classroom note",
    blurb: "Practice lending to the U.S. Treasury-style classroom note.",
    lon: -98,
    lat: 39,
    labelSide: "right",
  },
  {
    id: "BR",
    name: "Brazil",
    ratePct: 7.0,
    defaultPct: 6.0,
    tenor: "1-year classroom note",
    blurb: "Emerging market — pays more than the U.S. because repayment is less certain.",
    lon: -52,
    lat: -12,
    labelSide: "right",
  },
  {
    id: "AR",
    name: "Argentina",
    ratePct: 11.0,
    defaultPct: 10.0,
    tenor: "1-year classroom note",
    blurb: "Highest rate on the map — Argentina has defaulted on its debt nine times.",
    lon: -64,
    lat: -34,
    labelSide: "left",
  },
  {
    id: "GB",
    name: "United Kingdom",
    ratePct: 4.0,
    defaultPct: 2.0,
    tenor: "1-year classroom note",
    blurb: "U.K. practice lending rate for the classroom bond market.",
    lon: -2,
    lat: 54,
    labelSide: "left",
  },
  {
    id: "DE",
    name: "Germany",
    ratePct: 2.8,
    defaultPct: 1.5,
    tenor: "1-year classroom note",
    blurb: "Lower classroom rate — euro-area style practice yield.",
    lon: 10,
    lat: 51,
    labelSide: "right",
  },
  {
    id: "NG",
    name: "Nigeria",
    ratePct: 9.5,
    defaultPct: 8.0,
    tenor: "1-year classroom note",
    blurb: "High rate for dollar loans — oil-dependent economy with a shakier repayment record.",
    lon: 8,
    lat: 9,
    labelSide: "right",
  },
  {
    id: "IN",
    name: "India",
    ratePct: 6.0,
    defaultPct: 4.0,
    tenor: "1-year classroom note",
    blurb: "Classroom lending rate for India’s practice note.",
    lon: 78,
    lat: 22,
    labelSide: "right",
  },
  {
    id: "TR",
    name: "Turkey",
    ratePct: 8.0,
    defaultPct: 7.0,
    tenor: "1-year classroom note",
    blurb: "Fast inflation at home makes paying back dollars harder — so lenders demand more.",
    lon: 35,
    lat: 39,
    labelSide: "left",
  },
  {
    id: "IL",
    name: "Israel",
    ratePct: 5.5,
    defaultPct: 3.0,
    tenor: "1-year classroom note",
    blurb: "Israel practice lending rate for the classroom bond market.",
    lon: 35,
    lat: 31.5,
    labelSide: "right",
  },
  {
    id: "JP",
    name: "Japan",
    ratePct: 0.5,
    defaultPct: 1.2,
    tenor: "1-year classroom note",
    blurb: "Very low classroom rate — good contrast with higher-yield countries.",
    lon: 138,
    lat: 36,
    labelSide: "left",
  },
  {
    id: "AU",
    name: "Australia",
    ratePct: 4.1,
    defaultPct: 2.2,
    tenor: "1-year classroom note",
    blurb: "Australia practice lending rate for the classroom map.",
    lon: 134,
    lat: -25,
    labelSide: "left",
  },
];

function addMonthsUtc(d, months) {
  const total = d.getUTCMonth() + months;
  const year = d.getUTCFullYear() + Math.floor(total / 12);
  const month = total % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(d.getUTCDate(), lastDay)));
}

/**
 * Interest a $face loan made today pays by the class horizon if every monthly
 * payment comes through (same schedule as backend/lending.py).
 */
export function interestToHorizon(ratePct, { today = new Date(), face = LENDING_FACE_VALUE } = {}) {
  const rate = Number(ratePct);
  if (!Number.isFinite(rate)) {
    return { interest: null, months: 0, face };
  }
  const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const horizonEnd = LENDING_HORIZON.getTime() + 86400000 - 1;
  let months = 0;
  while (addMonthsUtc(start, months + 1).getTime() <= horizonEnd) months += 1;
  const monthly = Math.round(face * (rate / 100 / 12) * 100) / 100;
  const interest = Math.round(monthly * months * 100) / 100;
  return { interest, monthly, months, face };
}

export const LENDING_COUNTRIES_WITH_POINTS = LENDING_COUNTRIES.map((c) => {
  const income = interestToHorizon(c.ratePct);
  return {
    ...c,
    point: projectLonLat(c.lon, c.lat),
    interestByHorizon: income.interest,
    monthsToHorizon: income.months,
  };
});
