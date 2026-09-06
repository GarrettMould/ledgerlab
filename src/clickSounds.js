/**
 * Classroom click language — 3 related sounds, one shared voice.
 *
 * Pattern (same soft wood/marimba timbre, same key of G):
 *   select  — single soft G4      → browse / pick / open
 *   adjust  — quick B4 tick       → steppers / +/- / nudge
 *   confirm — G4 → D5 chime       → buy/sell / commit / save
 *
 * Usage: add data-click="select|adjust|confirm" on interactive elements.
 * Sounds play via capture-phase delegation (works with React onClick).
 */

export const CLICK = {
  SELECT: "select",
  ADJUST: "adjust",
  CONFIRM: "confirm",
};

const NOTES = {
  // Shared G-major family so every click feels related
  select: [392.0], // G4
  adjust: [493.88], // B4
  confirm: [392.0, 587.33], // G4 → D5
};

let ctx = null;
let unlocked = false;
let installed = false;
let muted = false;

function getCtx() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  return ctx;
}

function unlock() {
  const audio = getCtx();
  if (!audio) return;
  if (audio.state === "suspended") {
    audio.resume().catch(() => {});
  }
  unlocked = true;
}

function tone(audio, freq, when, duration, gainPeak) {
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  // Soft triangle = gentle classroom UI, not harsh click
  osc.type = "triangle";
  osc.frequency.setValueAtTime(freq, when);

  gain.gain.setValueAtTime(0.0001, when);
  gain.gain.exponentialRampToValueAtTime(gainPeak, when + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);

  osc.connect(gain);
  gain.connect(audio.destination);
  osc.start(when);
  osc.stop(when + duration + 0.02);
}

export function playClick(kind = CLICK.SELECT) {
  if (muted) return;
  const audio = getCtx();
  if (!audio) return;
  unlock();

  const freqs = NOTES[kind] || NOTES.select;
  const now = audio.currentTime;

  if (kind === CLICK.ADJUST) {
    tone(audio, freqs[0], now, 0.07, 0.045);
    return;
  }

  if (kind === CLICK.CONFIRM) {
    tone(audio, freqs[0], now, 0.1, 0.055);
    tone(audio, freqs[1], now + 0.07, 0.16, 0.05);
    return;
  }

  // select
  tone(audio, freqs[0], now, 0.11, 0.05);
}

export function setClickMuted(next) {
  muted = Boolean(next);
}

export function isClickMuted() {
  return muted;
}

/** Install once — reads data-click on the clicked element or a parent. */
export function initClickSounds() {
  if (installed || typeof document === "undefined") return;
  installed = true;

  const unlockEvents = ["pointerdown", "keydown", "touchstart"];
  const unlockOnce = () => {
    unlock();
    unlockEvents.forEach((ev) => document.removeEventListener(ev, unlockOnce, true));
  };
  unlockEvents.forEach((ev) => document.addEventListener(ev, unlockOnce, true));

  document.addEventListener(
    "click",
    (event) => {
      const el = event.target.closest?.("[data-click]");
      if (!el) return;
      const kind = el.getAttribute("data-click");
      if (kind === CLICK.SELECT || kind === CLICK.ADJUST || kind === CLICK.CONFIRM) {
        playClick(kind);
      }
    },
    true,
  );
}
