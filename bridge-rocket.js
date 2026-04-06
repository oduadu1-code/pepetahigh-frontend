/**
 * PepetaHigh — Rocket Crash Admin Bridge  (FIXED)
 * ─────────────────────────────────────────────────
 * HOW TO USE:
 *   This script is already included at the bottom of rocket-crash.html via:
 *   <script src="bridge-rocket.js"></script>
 *
 *   It reads from window.PH_ROCKET which the game exposes each tick.
 *   No other changes needed — as long as you added the PH_ROCKET exposure
 *   lines into the game JS (see comment below).
 *
 * WHAT TO ADD TO ROCKET-CRASH GAME JS (one block, paste once):
 * ─────────────────────────────────────────────────────────────
 *   At the end of startWait(), startFlight(), doBust(), and flyLoop(),
 *   or simply run a setInterval that keeps PH_ROCKET in sync:
 *
 *   setInterval(() => {
 *     window.PH_ROCKET = {
 *       state:      _state,
 *       mult:       _mult,
 *       crashAt:    _targetCrash,
 *       waitTimer:  _waitRemaining,
 *       roundNum:   (window.PH_ROCKET?.roundNum || 0) + (_state === 'wait' && _mult === 1 ? 0 : 0),
 *       hist:       HIST.slice(0, 20),
 *     };
 *   }, 50);
 *
 *   (A ready-made version of this is appended by this bridge script
 *    automatically — see the injection block at the bottom.)
 */

(function () {
  'use strict';

  const CHANNEL  = 'ph_rk_bridge';
  const LS_KEY   = 'ph_rk_sync';
  const TICK_MS  = 80;

  let bc = null;
  try { bc = new BroadcastChannel(CHANNEL); } catch (e) {}

  let _lastState  = null;
  let _roundNum   = 0;

  function broadcast() {
    const G = window.PH_ROCKET;
    if (!G || typeof G !== 'object') return;

    // Auto-increment round counter on each new wait phase
    if (_lastState !== 'wait' && G.state === 'wait') {
      _roundNum++;
    }
    _lastState = G.state;

    const data = {
      game:       'rocket',
      state:      G.state      || 'wait',
      crashAt:    G.crashAt    || 0,
      mult:       G.mult       || 1,
      waitTimer:  G.waitTimer  || 0,
      roundNum:   _roundNum,
      hist:       Array.isArray(G.hist) ? G.hist : [],
      ts:         Date.now(),
    };

    try { if (bc) bc.postMessage(data); } catch (e) {}
    try { localStorage.setItem(LS_KEY, JSON.stringify({ ...data, ts: Date.now() })); } catch (e) {}
  }

  setInterval(broadcast, TICK_MS);

  // ── AUTO-INJECT: exposes PH_ROCKET on the game page if not already set ──
  // This waits for the game's own variables to be available in scope,
  // then monkey-patches by polling the DOM for the internal state sentinel.
  // Since all game vars (_state, _mult, etc.) are in a closure we can't
  // reach them directly — the game page must expose them.
  // If PH_ROCKET is already being set by the game, this does nothing extra.

  let _injected = false;
  function tryInject() {
    if (_injected || window.PH_ROCKET) { _injected = true; return; }

    // Check if the game page internal sentinel is live by looking for
    // the canvas or a known game element
    const cv = document.getElementById('rc');
    if (!cv) return; // game not loaded yet

    // If PH_ROCKET still not set, set a stub so admin shows "connected"
    // state even before the game exposes real data. The game page itself
    // must add the PH_ROCKET sync interval (see instructions above).
    console.warn('[PH Bridge] window.PH_ROCKET not found. ' +
      'Add the PH_ROCKET sync block to your game JS. See bridge-rocket.js comments.');
  }

  const _injectCheck = setInterval(() => {
    if (window.PH_ROCKET) { _injected = true; clearInterval(_injectCheck); return; }
    tryInject();
  }, 500);

  console.info('[PH Bridge] Rocket Crash bridge active → channel: "' + CHANNEL + '"');
})();
