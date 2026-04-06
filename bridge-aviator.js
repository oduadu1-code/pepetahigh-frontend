/**
 * PepetaHigh — Aviator Admin Bridge
 * ─────────────────────────────────
 * HOW TO USE:
 *   Add this ONE line just before </body> in your Aviator game page:
 *   <script src="bridge-aviator.js"></script>
 *
 * It reads your live G_real / G_demo engine globals and broadcasts
 * the state to the admin panel every 50 ms via BroadcastChannel
 * (fast, same-tab-group) AND localStorage (reliable cross-tab fallback).
 *
 * Nothing else needs to change in your game.
 */

(function () {
  'use strict';

  const CHANNEL = 'ph_av_bridge';
  const LS_KEY  = 'ph_av_sync';
  const TICK_MS = 50;

  // Open BroadcastChannel (same origin, all tabs/windows)
  let bc = null;
  try { bc = new BroadcastChannel(CHANNEL); } catch (e) { /* unsupported */ }

  /**
   * Read from whichever engine object is active.
   * Matches the pattern already in your admin (G_real / G_demo).
   */
  function readEngine() {
    try {
      const isDemo = window.PH && window.PH.getMode
        ? window.PH.getMode() === 'demo'
        : false;

      const G = isDemo
        ? (window.G_demo || window.G_real)
        : (window.G_real || window.G_demo);

      if (!G) return null;

      return {
        game:      'aviator',
        state:     G.state      || 'wait',
        crashAt:   G.crashAt    || 0,
        mult:      G.mult       || 1,
        roundNum:  G.roundNum   || 1,
        waitTimer: G.waitTimer  || 0,
        roundHist: G.roundHist  || [],
        mode:      isDemo ? 'demo' : 'real',
        ts:        Date.now()
      };
    } catch (e) {
      return null;
    }
  }

  function broadcast() {
    const data = readEngine();
    if (!data) return;

    // 1. BroadcastChannel — instant, no storage overhead
    try { if (bc) bc.postMessage(data); } catch (e) {}

    // 2. localStorage — survives tab switches / reconnects
    try { localStorage.setItem(LS_KEY, JSON.stringify(data)); } catch (e) {}
  }

  setInterval(broadcast, TICK_MS);

  console.info('[PH Bridge] Aviator bridge active — broadcasting on "' + CHANNEL + '"');
})();
