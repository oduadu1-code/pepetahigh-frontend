// ── PepetaHigh Game Worker ────────────────────────────────────────────
// Runs in a dedicated Web Worker thread — never throttled by the browser
// even when the main tab is hidden, backgrounded, or the phone screen is locked.
// Sends a 'tick' message to the main thread at a fixed TICK_MS interval.
// The main thread's engine processes the tick and advances game state.

const TICK_MS = 50; // 20 ticks/sec

let _interval = null;
let _tickCount = 0;

self.onmessage = function(e) {
  const { cmd } = e.data;
  if (cmd === 'start') {
    if (_interval) return; // already running
    _interval = setInterval(() => {
      _tickCount++;
      self.postMessage({ type: 'tick', n: _tickCount });
    }, TICK_MS);
  } else if (cmd === 'stop') {
    if (_interval) { clearInterval(_interval); _interval = null; }
  }
};
