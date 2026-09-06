import { useEffect, useState } from "react";
import { getNews } from "./api";

function timeAgo(iso) {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export default function NewsFeed({ onBack }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [disclaimer, setDisclaimer] = useState("");
  const [openId, setOpenId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const data = await getNews();
        if (cancelled) return;
        const next = data.items || [];
        setItems(next);
        setDisclaimer(data.disclaimer || "");
        setOpenId(next[0]?.id ?? null);
      } catch (err) {
        if (!cancelled) setError(err.message || "Could not load news");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="news-feed">
      <div className="market-toolbar">
        <button type="button" className="ghost-btn" data-click="select" onClick={onBack}>
          ← Markets
        </button>
        <h3>Classroom news</h3>
      </div>

      {loading && <p className="empty">Loading classroom briefs…</p>}
      {error && <p className="empty">{error}</p>}

      {!loading && !error && (
        <ul className="news-list">
          {items.map((item) => {
            const open = openId === item.id;
            const markets = Array.isArray(item.markets) ? item.markets : [];
            return (
              <li key={item.id} className={`news-item${open ? " is-open" : ""}`}>
                <button
                  type="button"
                  className="news-card"
                  data-click="select"
                  aria-expanded={open}
                  onClick={() => setOpenId(open ? null : item.id)}
                >
                  <div className="news-meta">
                    <span className="news-source">Ledger Lab</span>
                    {item.published_at && (
                      <span className="news-time">{timeAgo(item.published_at)}</span>
                    )}
                  </div>
                  <strong className="news-title">{item.title}</strong>
                  {markets.length > 0 && (
                    <div className="news-markets">
                      {markets.map((label) => (
                        <span key={label} className="news-market-chip">
                          {label}
                        </span>
                      ))}
                    </div>
                  )}
                  {open && (
                    <div className="news-body">
                      <p className="news-summary">{item.body || item.summary}</p>
                      {item.takeaway && (
                        <p className="news-takeaway">
                          <span>Think about it:</span> {item.takeaway}
                        </p>
                      )}
                    </div>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {!loading && !error && disclaimer && (
        <p className="news-disclaimer">{disclaimer}</p>
      )}
    </div>
  );
}
