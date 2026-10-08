import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import AdvisorChat, { AdvisorChatFab } from "./AdvisorChat";
import "./App.css";

const portfolio = {
  cash: 4200,
  total_value: 10850,
  holdings: [
    { ticker: "AAPL", name: "Apple", shares: 8 },
    { ticker: "VOO", name: "Vanguard S&P 500 ETF", shares: 5 },
  ],
};

function Preview() {
  const [open, setOpen] = useState(new URLSearchParams(location.search).has("open"));
  useEffect(() => {
    document.body.classList.toggle("advisor-open", open);
  }, [open]);
  return (
    <div className="app-shell">
      <div className={open ? "student-workspace is-advisor-open" : "student-workspace"}>
      <section className="panel student-panel" style={{ minHeight: 600, padding: "1.5rem" }}>
        <h2 className="student-dash-name">test</h2>
        <div className="balance-strip">
          <div>
            <span>Cash</span>
            <strong>$4,200</strong>
          </div>
          <div>
            <span>Portfolio</span>
            <strong>$6,650</strong>
          </div>
          <div>
            <span>Total</span>
            <strong>$10,850</strong>
          </div>
        </div>
      </section>
      <AdvisorChat
        open={open}
        onClose={() => setOpen(false)}
        classId="r9BV8oyyYk5aDiE1CJVt"
        studentId="Gt9akAmAYj2Uc6KCqG1s"
        portfolio={portfolio}
      />
      </div>
      <AdvisorChatFab open={open} onClick={() => setOpen(true)} />
    </div>
  );
}

createRoot(document.getElementById("root")).render(<Preview />);
