/** Classroom country-lending destinations (placeholder rates — not live data). */
import { WORLD_MAP_VIEW, projectLonLat } from "./worldLandPath";

export { WORLD_MAP_VIEW, projectLonLat };

export const OCEAN_LABELS = [
  { id: "pacificW", text: "Pacific", x: 140, y: 260, rotate: -12 },
  { id: "pacificE", text: "Pacific", x: 880, y: 240, rotate: 12 },
  { id: "atlantic", text: "Atlantic", x: 380, y: 230, rotate: 0 },
  { id: "indian", text: "Indian Ocean", x: 680, y: 340, rotate: 0 },
];

/** Handful of lendable countries — rates are classroom placeholders. */
export const LENDING_COUNTRIES = [
  {
    id: "US",
    name: "United States",
    ratePct: 4.3,
    tenor: "1-year classroom note",
    blurb: "Practice lending to the U.S. Treasury-style classroom note.",
    lon: -98,
    lat: 39,
    labelSide: "right",
  },
  {
    id: "BR",
    name: "Brazil",
    ratePct: 10.5,
    tenor: "1-year classroom note",
    blurb: "Higher classroom rate reflecting emerging-market practice yield.",
    lon: -52,
    lat: -12,
    labelSide: "right",
  },
  {
    id: "GB",
    name: "United Kingdom",
    ratePct: 4.0,
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
    tenor: "1-year classroom note",
    blurb: "Lower classroom rate — euro-area style practice yield.",
    lon: 10,
    lat: 51,
    labelSide: "right",
  },
  {
    id: "NG",
    name: "Nigeria",
    ratePct: 18.0,
    tenor: "1-year classroom note",
    blurb: "High classroom rate for practice risk/return conversations.",
    lon: 8,
    lat: 9,
    labelSide: "right",
  },
  {
    id: "IN",
    name: "India",
    ratePct: 6.5,
    tenor: "1-year classroom note",
    blurb: "Classroom lending rate for India’s practice note.",
    lon: 78,
    lat: 22,
    labelSide: "right",
  },
  {
    id: "IL",
    name: "Israel",
    ratePct: 4.5,
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
    tenor: "1-year classroom note",
    blurb: "Australia practice lending rate for the classroom map.",
    lon: 134,
    lat: -25,
    labelSide: "left",
  },
];

export const LENDING_COUNTRIES_WITH_POINTS = LENDING_COUNTRIES.map((c) => ({
  ...c,
  point: projectLonLat(c.lon, c.lat),
}));
