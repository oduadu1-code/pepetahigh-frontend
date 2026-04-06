/**
 * PepetaHigh — Aviator Admin Bridge  (FIXED)
 * ─────────────────────────────────────────────
 * HOW TO USE:
 *   Already included at the bottom of aviator.html via:
 *   <script src="bridge-aviator.js"></script>
 *
 *   NO changes needed to engine.js or aviator.html —
 *   window.G, window.G_real, and window.G_demo are already exposed
 *   by engine.js. This bridge reads them directly.
 *
 * WHAT IT BROADCASTS:
 *   - game:       'aviator'
 *   - state:      'wait' | 'fly' | 'crash'
 *   - crashAt:    the crash multiplier (generated at start of fly)
 *   - mult:       current live multiplier
 *   - waitTimer:  ms remaining in countdown (during wait)
 *   - mode:       'real' | 'demo'
 *   - roundNum:   round counter
 *   - roundHist:  last 30 crash values
 *   - ts:         timestamp
 *
 * CHANNEL:  'ph_av_bridge'
 * LS_KEY:   'ph_av_sync'
 */

(function () {
  'use strict';

  const CHANNEL = 'ph_av_bridge';
  const LS_KEY  = 'ph_av_sync';
  const TICK_MS = 80;

  // ── BroadcastChannel setup ────────────────────────────────────────
  let bc = null;
  try { bc = new BroadcastChannel(CHANNEL); } catch (e) {}

  let _lastState = null;
  let _roundNum  = 0;

  // ── Main read function ────────────────────────────────────────────
  // Aviator's engine.js exposes:
  //   window.G        → active world (switches on mode change)
  //   window.G_real   → real-money world
  //   window.G_demo   → demo world
  //
  // Each world has: state, mult, crashAt, waitTimer, fillPct,
  //                 roundNum, roundHist, mode

  function readEngine() {
    // Try the active world first, then fall back to real, then demo
    const G = window.G || window.G_real || window.G_demo;
    if (!G || typeof G !== 'object' || !G.state) return null;

    return {
      game:      'aviator',
      state:     G.state,                              // 'wait'|'fly'|'crash'
      crashAt:   parseFloat((G.crashAt || 0).toFixed(2)),
      mult:      parseFloat((G.mult    || 1).toFixed(2)),
      waitTimer: G.waitTimer || 0,                     // ms left in countdown
      mode:      G.mode      || 'real',                // 'real'|'demo'
      roundNum:  G.roundNum  || _roundNum,
      roundHist: Array.isArray(G.roundHist) ? G.roundHist.slice(0, 30) : [],
    };
  }

  // ── Broadcast ─────────────────────────────────────────────────────
  function broadcast() {
    const raw = readEngine();
    if (!raw) return;

    // Auto-increment our own round counter on each new wait phase
    if (_lastState !== 'wait' && raw.state === 'wait') {
      _roundNum++;
    }
    _lastState = raw.state;

    const data = { ...raw, roundNum: raw.roundNum || _roundNum, ts: Date.now() };

    try { if (bc) bc.postMessage(data); } catch (e) {}
    try { localStorage.setItem(LS_KEY, JSON.stringify(data)); } catch (e) {}
  }

  setInterval(broadcast, TICK_MS);

  // ── Health check: warn if G not found after 3 s ───────────────────
  setTimeout(() => {
    if (!window.G && !window.G_real && !window.G_demo) {
      console.warn(
        '[PH Bridge] Aviator: window.G / G_real / G_demo not found after 3 s.\n' +
        'Make sure engine.js is loaded BEFORE bridge-aviator.js.'
      );
    }
  }, 3000);

  console.info('[PH Bridge] Aviator bridge active → channel: "' + CHANNEL + '"');
})();
