const API = "/api";

async function request(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

export function listStudents(refresh = false) {
  return request(`/students${refresh ? "?refresh=1" : ""}`);
}

export function createStudent(name, cash = 0) {
  return request("/students", {
    method: "POST",
    body: JSON.stringify({ name, cash }),
  });
}

export function deleteStudent(id) {
  return request(`/students/${id}`, { method: "DELETE" });
}

export function getStudent(id) {
  return request(`/students/${id}`);
}

export function adjustCash(id, amount) {
  return request(`/students/${id}/adjust`, {
    method: "POST",
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

export function getPortfolioHistory(studentId) {
  return request(`/students/${studentId}/history`);
}

export function buyShares(id, ticker, shares) {
  return request(`/students/${id}/buy`, {
    method: "POST",
    body: JSON.stringify({ ticker, shares }),
  });
}

export function buyHome(id, ticker) {
  return request(`/students/${id}/buy-home`, {
    method: "POST",
    body: JSON.stringify({ ticker }),
  });
}

export function sellShares(id, ticker, shares) {
  return request(`/students/${id}/sell`, {
    method: "POST",
    body: JSON.stringify({ ticker, shares }),
  });
}

export function getNews() {
  return request("/news");
}
