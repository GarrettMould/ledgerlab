import { getActiveClassId, getStudentSession } from "./classStore";

const API = "/api";

function ledgerHeaders(extra = {}) {
  const classId =
    extra.classId || getStudentSession()?.classId || getActiveClassId() || "";
  const headers = { "Content-Type": "application/json" };
  if (classId) headers["X-Class-Id"] = classId;
  return headers;
}

async function request(path, options = {}) {
  const { classId, headers: optHeaders, ...rest } = options;
  let res;
  try {
    res = await fetch(`${API}${path}`, {
      headers: { ...ledgerHeaders({ classId }), ...(optHeaders || {}) },
      ...rest,
    });
  } catch {
    throw new Error("Cannot reach the API. Start it with: npm run dev:api");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (data.error) {
      throw new Error(data.error);
    }
    if (res.status === 502 || res.status === 503 || res.status === 504) {
      throw new Error("API is not running. In another terminal run: npm run dev:api");
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
  return request(`/students/${id}`, { classId });
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

export function getMarket(category, refresh = false) {
  return request(`/market/${encodeURIComponent(category)}${refresh ? "?refresh=1" : ""}`);
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
