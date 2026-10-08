import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  DEFAULT_CONTEST_END,
  contestEndDate,
  contestEndIso,
  formatContestLabel,
  formatShortDate,
  minContestEndInput,
  peerLoanDueDate,
  toDateInputValue,
} from "./contestDates";

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function sameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function monthCells(cursor) {
  const first = startOfMonth(cursor);
  const lead = first.getDay();
  const days = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < lead; i += 1) cells.push(null);
  for (let day = 1; day <= days; day += 1) {
    cells.push(new Date(cursor.getFullYear(), cursor.getMonth(), day));
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function CalendarIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3.5" y="5" width="17" height="15.5" rx="3.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8 3.5v3.5M16 3.5v3.5M3.5 10h17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <rect x="7.2" y="13" width="3.2" height="3.2" rx="0.8" fill="currentColor" />
    </svg>
  );
}

export default function ContestDatePicker({
  value,
  onChange,
  id = "contest-end",
}) {
  const selected = contestEndDate(value);
  const minDate = contestEndDate(minContestEndInput());
  const loanDue = peerLoanDueDate(selected);
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(() => startOfMonth(selected));

  const cells = useMemo(() => monthCells(cursor), [cursor]);
  const monthLabel = cursor.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
  const selectedLabel = selected.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const isDefault = contestEndIso(selected) === DEFAULT_CONTEST_END;
  const canResetDefault = contestEndDate(DEFAULT_CONTEST_END) >= minDate;

  function openModal() {
    setCursor(startOfMonth(selected));
    setOpen(true);
  }

  function closeModal() {
    setOpen(false);
  }

  function pick(day) {
    if (!day || day < minDate) return;
    onChange?.(toDateInputValue(day));
    setOpen(false);
  }

  function resetDefault() {
    if (!canResetDefault) return;
    onChange?.(DEFAULT_CONTEST_END);
    setCursor(startOfMonth(contestEndDate(DEFAULT_CONTEST_END)));
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") closeModal();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="class-date-picker">
      <span className="class-date-picker-label" id={`${id}-label`}>
        Contest end date
      </span>
      <button
        type="button"
        className="class-date-summary"
        data-click="select"
        aria-labelledby={`${id}-label`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={openModal}
      >
        <span className="class-date-summary-icon">
          <CalendarIcon />
        </span>
        <span className="class-date-summary-copy">
          <strong>{selectedLabel}</strong>
          <span>Loans due {formatShortDate(loanDue)} · Change date</span>
        </span>
      </button>
      <p className="class-date-hint">
        Classmate loans are always due five days before the game ends.
      </p>

      {open
        ? createPortal(
            <div
              className="transfer-overlay class-date-overlay"
              role="dialog"
              aria-modal="true"
              aria-labelledby={`${id}-title`}
              onClick={closeModal}
            >
              <div
                className="transfer-modal class-date-modal"
                onClick={(e) => e.stopPropagation()}
              >
                <p className="transfer-kicker">Contest end</p>
                <h3 id={`${id}-title`}>Choose a date</h3>
                <p className="class-date-modal-lead">
                  {selectedLabel}. Classmate loans will be due{" "}
                  {formatShortDate(loanDue)}.
                </p>

                <div className="class-date-cal" role="group" aria-label={monthLabel}>
                  <div className="class-date-cal-nav">
                    <button
                      type="button"
                      className="class-date-cal-shift"
                      data-click="select"
                      aria-label="Previous month"
                      onClick={() =>
                        setCursor(
                          (prev) =>
                            new Date(prev.getFullYear(), prev.getMonth() - 1, 1)
                        )
                      }
                    >
                      ‹
                    </button>
                    <strong>{monthLabel}</strong>
                    <button
                      type="button"
                      className="class-date-cal-shift"
                      data-click="select"
                      aria-label="Next month"
                      onClick={() =>
                        setCursor(
                          (prev) =>
                            new Date(prev.getFullYear(), prev.getMonth() + 1, 1)
                        )
                      }
                    >
                      ›
                    </button>
                  </div>
                  <div className="class-date-cal-week" aria-hidden="true">
                    {WEEKDAYS.map((d) => (
                      <span key={d}>{d}</span>
                    ))}
                  </div>
                  <div className="class-date-cal-grid" role="grid" aria-label={monthLabel}>
                    {cells.map((day, i) => {
                      if (!day) {
                        return (
                          <span key={`e-${i}`} className="class-date-cal-day is-empty" />
                        );
                      }
                      const iso = toDateInputValue(day);
                      const disabled = day < minDate;
                      const selectedDay = sameDay(day, selected);
                      const loanDay = sameDay(day, loanDue);
                      const today = sameDay(day, new Date());
                      return (
                        <button
                          key={iso}
                          type="button"
                          role="gridcell"
                          aria-selected={selectedDay}
                          aria-label={`${formatContestLabel(day)}${
                            selectedDay
                              ? ", contest end"
                              : loanDay
                                ? ", classmate loans due"
                                : ""
                          }`}
                          disabled={disabled}
                          className={[
                            "class-date-cal-day",
                            selectedDay ? "is-end" : "",
                            loanDay ? "is-loan" : "",
                            today ? "is-today" : "",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                          data-click="select"
                          onClick={() => pick(day)}
                        >
                          {day.getDate()}
                        </button>
                      );
                    })}
                  </div>
                  <div className="class-date-cal-legend">
                    <span>
                      <i className="is-end" /> Game ends {formatShortDate(selected)}
                    </span>
                    <span>
                      <i className="is-loan" /> Loans due {formatShortDate(loanDue)}
                    </span>
                  </div>
                </div>

                <div className="class-date-modal-actions">
                  {!isDefault && canResetDefault ? (
                    <button
                      type="button"
                      className="ghost-btn"
                      data-click="select"
                      onClick={resetDefault}
                    >
                      Use May 15
                    </button>
                  ) : (
                    <span />
                  )}
                  <button
                    type="button"
                    className="primary-btn"
                    data-click="select"
                    onClick={closeModal}
                  >
                    Done
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
