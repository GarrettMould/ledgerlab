import { getActiveClassId, getStudentSession } from "./classStore";

const API = "/api";

function isLocalDevHost() {
  if (typeof window === "undefined") return Boolean(import.meta.env.DEV);
  const host = window.location.hostname;
  return host === "localhost" || host === "127.0.0.1";
}

function apiUnreachableMessage(kind = "down") {
  if (isLocalDevHost() || import.meta.env.DEV) {
    if (kind === "timeout") {
      return "API request timed out. Check that npm run dev:api is running.";
    }
    return "API is not running. In another terminal run: npm run dev:api";
  }
  if (kind === "timeout") {
    return "The server took too long to respond. Try again in a moment.";
  }
  return "Couldn’t reach the classroom API. Try again, or ask your teacher if the site is having issues.";
}

function ledgerHeaders(extra = {}) {
  const classId =
    extra.classId || getStudentSession()?.classId || getActiveClassId() || "";
  const headers = { "Content-Type": "application/json" };
  if (classId) headers["X-Class-Id"] = classId;
  return headers;
}

async function request(path, options = {}) {
  const { classId, headers: optHeaders, timeoutMs = 20000, ...rest } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(`${API}${path}`, {
      ...rest,
      headers: { ...ledgerHeaders({ classId }), ...(optHeaders || {}) },
      signal: controller.signal,
    });
  } catch (err) {
    if (err?.name === "AbortError") {
      throw new Error(apiUnreachableMessage("timeout"));
    }
    throw new Error(apiUnreachableMessage("down"));
  } finally {
    clearTimeout(timer);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (data.error) {
      throw new Error(data.error);
    }
    // Local Vite proxy returns a bare 500 when nothing is listening on the API port.
    // On the live site the same statuses usually mean the hosted backend crashed or timed out.
    if (
      res.status === 500 ||
      res.status === 502 ||
      res.status === 503 ||
      res.status === 504
    ) {
      throw new Error(apiUnreachableMessage("down"));
    }
    throw new Error(`Request failed (${res.status})`);
  }
  return data;
}

export function listStudents(refresh = false, classId) {
  const q = refresh ? "?refresh=1" : "";
  return request(`/students${q}`, { classId });
}

export function createStudent(name, cash = 0, { classId, studentId, authUid } = {}) {
  return request("/students", {
    method: "POST",
    classId,
    timeoutMs: 8000,
    body: JSON.stringify({
      name,
      cash,
      ...(classId ? { classId } : {}),
      ...(studentId ? { studentId } : {}),
      ...(authUid ? { authUid } : {}),
    }),
  });
}

export function deleteStudent(id, classId) {
  return request(`/students/${id}`, { method: "DELETE", classId });
}

export function getStudent(id, classId) {
  return request(`/students/${id}`, { classId, timeoutMs: 10000 });
}

export function adjustCash(id, amount, classId) {
  return request(`/students/${id}/adjust`, {
    method: "POST",
    classId,
    body: JSON.stringify({ amount }),
  });
}

export function getQuote(ticker) {
  return request(`/quote/${encodeURIComponent(ticker)}`);
}

export function getMarket(category, refresh = false, { catalog = false } = {}) {
  const params = new URLSearchParams();
  if (refresh) params.set("refresh", "1");
  if (catalog) params.set("catalog", "1");
  const q = params.toString() ? `?${params}` : "";
  return request(`/market/${encodeURIComponent(category)}${q}`);
}

export function getChart(ticker, range = "1y") {
  return request(`/chart/${encodeURIComponent(ticker)}?range=${encodeURIComponent(range)}`);
}

export function getPortfolioHistory(studentId, classId) {
  return request(`/students/${studentId}/history`, { classId });
}

export function buyShares(id, ticker, shares, classId) {
  return request(`/students/${id}/buy`, {
    method: "POST",
    classId,
    body: JSON.stringify({ ticker, shares }),
  });
}

export function buyHome(id, ticker, classId) {
  return request(`/students/${id}/buy-home`, {
    method: "POST",
    classId,
    body: JSON.stringify({ ticker }),
  });
}

export function sellShares(id, ticker, shares, classId) {
  return request(`/students/${id}/sell`, {
    method: "POST",
    classId,
    body: JSON.stringify({ ticker, shares }),
  });
}

export function getNews() {
  return request("/news");
}

export function getHealth() {
  return request("/health");
}
