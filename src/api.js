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

export function getStandings(classId) {
  return request("/standings", { classId, timeoutMs: 12000 });
}

export function getFearGreed() {
  return request("/fear-greed", { timeoutMs: 10000 });
}

export function getPopularStocks(classId, { rebuild = false } = {}) {
  const q = rebuild ? "?rebuild=1" : "";
  return request(`/class/popular-stocks${q}`, { classId, timeoutMs: 20000 });
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

export function getQuotes(tickers = []) {
  const symbols = [
    ...new Set(
      (Array.isArray(tickers) ? tickers : [])
        .map((t) => String(t || "").trim().toUpperCase())
        .filter(Boolean)
    ),
  ].slice(0, 40);
  if (!symbols.length) {
    return Promise.resolve({ quotes: {} });
  }
  const params = new URLSearchParams({ symbols: symbols.join(",") });
  return request(`/quotes?${params}`, { timeoutMs: 45000 });
}

export function getMarket(category, refresh = false, { catalog = false } = {}) {
  const params = new URLSearchParams();
  if (refresh) params.set("refresh", "1");
  if (catalog) params.set("catalog", "1");
  const q = params.toString() ? `?${params}` : "";
  // Live quotes can take a bit on cold cache; catalog stays on the default timeout.
  return request(`/market/${encodeURIComponent(category)}${q}`, {
    timeoutMs: catalog ? 12000 : 45000,
  });
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

export function getClosetAiStatus(studentId, classId) {
  const q = new URLSearchParams({ studentId: String(studentId || "") });
  return request(`/closet/ai/status?${q}`, { classId });
}

export function startClosetAiDraft(studentId, prompt, classId, options = {}) {
  return request("/closet/ai/draft", {
    method: "POST",
    classId,
    timeoutMs: 90000,
    body: JSON.stringify({
      studentId,
      prompt,
      primaryColor: options.primaryColor || null,
      secondaryColor: options.secondaryColor || null,
      tertiaryColor: options.tertiaryColor || null,
      quaternaryColor: options.quaternaryColor || null,
      kind: options.kind || null,
      style: options.style || null,
    }),
  });
}

export function pollClosetAiJob(studentId, jobId, classId) {
  const q = new URLSearchParams({ studentId: String(studentId || "") });
  return request(`/closet/ai/jobs/${encodeURIComponent(jobId)}?${q}`, {
    classId,
    timeoutMs: 180000,
  });
}

export function publishClosetAiJob(studentId, jobId, classId, price, crewSlots = 0) {
  const body = { studentId, jobId, crewSlots: Number(crewSlots) || 0 };
  if (price != null && price !== "") body.price = Number(price);
  return request("/closet/ai/publish", {
    method: "POST",
    classId,
    timeoutMs: 180000,
    body: JSON.stringify(body),
  });
}

export function listCrewJobs(classId, studentId = "") {
  const q = studentId
    ? `?${new URLSearchParams({ studentId: String(studentId) })}`
    : "";
  return request(`/closet/crew/jobs${q}`, { classId, timeoutMs: 60000 });
}

export function inviteCrewPartner(classId, studentId, partnerId, crewJobId = "") {
  return request("/closet/crew/invite", {
    method: "POST",
    classId,
    timeoutMs: 60000,
    body: JSON.stringify({
      studentId,
      partnerId,
      ...(crewJobId ? { crewJobId } : {}),
    }),
  });
}

export function declineCrewInvite(classId, studentId, crewJobId) {
  return request("/closet/crew/decline", {
    method: "POST",
    classId,
    timeoutMs: 60000,
    body: JSON.stringify({ studentId, crewJobId }),
  });
}

export function joinCrewJob(classId, studentId, crewJobId) {
  return request("/closet/crew/join", {
    method: "POST",
    classId,
    timeoutMs: 60000,
    body: JSON.stringify({ studentId, crewJobId }),
  });
}

export function leaveCrewJob(classId, studentId, crewJobId) {
  return request("/closet/crew/leave", {
    method: "POST",
    classId,
    timeoutMs: 60000,
    body: JSON.stringify({ studentId, crewJobId }),
  });
}

export function activateClosetAiJob(studentId, jobId, classId, answers) {
  return request("/closet/ai/activate", {
    method: "POST",
    classId,
    timeoutMs: 60000,
    body: JSON.stringify({ studentId, jobId, answers }),
  });
}

/** Dev-only: seed a fake pending_review item for the teacher dashboard UI. */
export function seedClosetAiTestReview(studentId, classId, answers) {
  return request("/closet/ai/test-review", {
    method: "POST",
    classId,
    timeoutMs: 60000,
    body: JSON.stringify({ studentId, answers }),
  });
}

export function listClosetAiReviews(classId, teacherUid) {
  const q = new URLSearchParams({ teacherUid: String(teacherUid || "") });
  return request(`/closet/ai/reviews?${q}`, { classId, timeoutMs: 60000 });
}

export function reviewClosetAiJob(classId, teacherUid, jobId, action, note) {
  return request("/closet/ai/review", {
    method: "POST",
    classId,
    timeoutMs: 60000,
    body: JSON.stringify({ teacherUid, jobId, action, note: note || "" }),
  });
}

/** Teacher Finnhub search — find stocks/ETFs to add to the class market. */
export function searchMarketTickers(classId, query) {
  const q = new URLSearchParams({ q: String(query || "").trim() });
  return request(`/teacher/market/search?${q}`, {
    classId,
    timeoutMs: 15000,
  });
}

export function listMarketExtras(classId) {
  return request("/teacher/market/extras", { classId });
}

export function addMarketExtra(
  classId,
  teacherUid,
  { ticker, name, category = "stocks", industry } = {}
) {
  const body = {
    teacherUid,
    ticker,
    name,
    category,
  };
  if (industry) body.industry = industry;
  return request("/teacher/market/extras", {
    method: "POST",
    classId,
    timeoutMs: 20000,
    body: JSON.stringify(body),
  });
}

export function removeMarketExtra(classId, teacherUid, ticker) {
  const q = new URLSearchParams({ teacherUid: String(teacherUid || "") });
  return request(
    `/teacher/market/extras/${encodeURIComponent(ticker)}?${q}`,
    {
      method: "DELETE",
      classId,
    }
  );
}
