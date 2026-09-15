import { useEffect, useState } from "react";
import { getFearGreed } from "./api";

const RATING_LABEL = {
  "extreme fear": "Extreme Fear",
  fear: "Fear",
  neutral: "Neutral",
  greed: "Greed",
  "extreme greed": "Extreme Greed",
};

function ratingClass(rating) {
  return String(rating || "neutral").replace(/\s+/g, "-");
}

/**
 * Compact CNN Fear & Greed bar for the market picker header.
 */
export default function FearGreedMeter() {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getFearGreed()
      .then((payload) => {
        if (cancelled) return;
        if (payload?.score == null) {
          setFailed(true);
          return;
        }
        setData(payload);
        setFailed(false);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const score = data?.score != null ? Number(data.score) : null;
  const rating = data?.rating || "neutral";
  const label = RATING_LABEL[rating] || "Market mood";
  const pct = score == null ? 0 : Math.max(0, Math.min(100, score));

  return (
    <aside
      className={`fear-greed${failed && !data ? " is-empty" : ""}`}
      aria-label={
        score != null
          ? `Fear and Greed index ${Math.round(score)}, ${label}`
          : "Fear and Greed index"
      }
    >
      <div className="fear-greed-top">
        <p className="fear-greed-kicker">Market mood</p>
        <div className="fear-greed-score-block">
          <strong className={`fear-greed-score is-${ratingClass(rating)}`}>
            {score == null ? "—" : Math.round(score)}
          </strong>
          <span className={`fear-greed-rating is-${ratingClass(rating)}`}>
            {failed && !data ? "Unavailable" : label}
          </span>
        </div>
      </div>

      <div className="fear-greed-track-wrap" aria-hidden="true">
        <div className="fear-greed-track">
          <span
            className="fear-greed-marker"
            style={{ left: `${pct}%` }}
          />
        </div>
        <div className="fear-greed-ends">
          <span>Fear</span>
          <span>Greed</span>
        </div>
      </div>
    </aside>
  );
}
