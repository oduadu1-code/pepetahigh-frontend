/**
 * PepetaHigh — Aviator Admin Bridge  v5 (FIXED)
 * ─────────────────────────────────────────────
 * Drop this at the bottom of aviator.html:
 *   <script src="bridge-aviator.js"></script>
 *
 * Broadcasts every 80 ms via BroadcastChannel + localStorage.
 * The admin page listens on both channels simultaneously.
 *
 * KEY FIX: crashAt is always broadcast — including during 'wait'
 * so the admin can show the NEXT round prediction before it starts.
 */

(function () {
  'use strict';

  const CHANNEL = 'ph_av_bridge';
  const LS_KEY  = 'ph_av_sync';
  const TICK_MS = 80;

  // ── BroadcastChannel setup ────────────────────────────────────────
  let bc = null;
  try { bc = new BroadcastChannel(CHANNEL); } catch (e) {
    console.warn('[PH Bridge] BroadcastChannel unavailable, using localStorage only.');
  }

  let _lastState  = null;
  let _ownRound   = 0;
  let _lastCrashAt = 0;  // remember last valid crashAt across phase transitions

  // ── Read engine state ─────────────────────────────────────────────
  function readEngine() {
    const G = window.G || window.G_real || window.G_demo;
    if (!G || typeof G !== 'object') return null;

    const state = G.state;
    if (!state || state === 'idle') return null;

    // crashAt is set in doWait() and stays valid through fly & crash.
    // Cache it so we never send 0 to the admin.
    const rawCrash = parseFloat((G.crashAt || 0).toFixed(2));
    if (rawCrash > 0) _lastCrashAt = rawCrash;

    return {
      game:      'aviator',
      state:     state,
      crashAt:   _lastCrashAt,          // always the upcoming/current crash point
      mult:      parseFloat((G.mult    || 1.00).toFixed(2)),
      waitTimer: G.waitTimer || 0,
      fillPct:   G.fillPct   || 0,
      mode:      G.mode      || 'real',
      roundNum:  G.roundNum  || _ownRound,
      roundHist: Array.isArray(G.roundHist) ? G.roundHist.slice(0, 30) : [],
    };
  }

  // ── Broadcast ─────────────────────────────────────────────────────
  function broadcast() {
    const raw = readEngine();
    if (!raw) return;

    // Track round transitions
    if (_lastState !== 'wait' && raw.state === 'wait') _ownRound++;
    _lastState = raw.state;

    const payload = {
      ...raw,
      roundNum: raw.roundNum || _ownRound,
      ts: Date.now(),
    };

    // 1. BroadcastChannel (fastest, same-origin tabs)
    try { if (bc) bc.postMessage(payload); } catch (e) {}

    // 2. localStorage (cross-tab fallback, works even if BC fails)
    try { localStorage.setItem(LS_KEY, JSON.stringify(payload)); } catch (e) {}
  }

  setInterval(broadcast, TICK_MS);

  // ── Sanity check after 3 s ────────────────────────────────────────
  setTimeout(() => {
    const G = window.G || window.G_real || window.G_demo;
    if (!G) {
      console.error(
        '[PH Bridge] window.G / G_real / G_demo not found.\n' +
        'Ensure engine.js loads BEFORE bridge-aviator.js.'
      );
    } else {
      console.info('[PH Bridge] Engine found. State:', G.state, '| CrashAt:', G.crashAt);
    }
  }, 3000);

  console.info('[PH Bridge] Aviator bridge v5 active → channel: "' + CHANNEL + '"');
})();
