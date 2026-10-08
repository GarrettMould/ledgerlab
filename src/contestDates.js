/** Default classroom contest end (UTC calendar date). */
export const DEFAULT_CONTEST_END = "2027-05-15";
export const PEER_LOAN_DAYS_BEFORE_END = 5;

function pad(n) {
  return String(n).padStart(2, "0");
}

/** Calendar YYYY-MM-DD from a Date in local time. */
export function toDateInputValue(value) {
  const d = value instanceof Date ? value : parseContestEnd(value);
  if (!d) return DEFAULT_CONTEST_END;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseContestEnd(value) {
  if (!value) return null;
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }
  if (typeof value?.toDate === "function") {
    return parseContestEnd(value.toDate());
  }
  if (typeof value?.seconds === "number") {
    return parseContestEnd(new Date(value.seconds * 1000));
  }
  const raw = String(value).trim();
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  }
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) return null;
  const d = new Date(parsed);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function contestEndDate(value) {
  return parseContestEnd(value) || parseContestEnd(DEFAULT_CONTEST_END);
}

export function peerLoanDueDate(contestEnd) {
  const end = contestEndDate(contestEnd);
  return new Date(end.getFullYear(), end.getMonth(), end.getDate() - PEER_LOAN_DAYS_BEFORE_END);
}

export function formatContestLabel(value) {
  const d = contestEndDate(value);
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

export function formatShortDate(value) {
  const d = value instanceof Date ? value : contestEndDate(value);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function minContestEndInput() {
  const d = new Date();
  d.setDate(d.getDate() + PEER_LOAN_DAYS_BEFORE_END);
  return toDateInputValue(d);
}

export function contestEndIso(value) {
  return toDateInputValue(contestEndDate(value));
}
