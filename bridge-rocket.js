/**
 * PepetaHigh — Rocket Crash Admin Bridge
 * ───────────────────────────────────────
 * HOW TO USE:
 *   Add this ONE line just before </body> in your Rocket Crash game page:
 *   <script src="bridge-rocket.js"></script>
 *
 * It tries the most common global variable names for the Rocket engine.
 * If your game uses a different variable name, set it at the top below.
 */

(function () {
  'use strict';

  // ── ✏️  IF YOUR ROCKET ENGINE USES A DIFFERENT GLOBAL NAME, SET IT HERE ──
  //  e.g. const CUSTOM_VAR = 'MyRocketState';
  const CUSTOM_VAR = null; // leave null to auto-detect
  // ─────────────────────────────────────────────────────────────────────────

  const CHANNEL = 'ph_rk_bridge';
  const LS_KEY  = 'ph_rk_sync';
  const TICK_MS = 50;

  let bc = null;
  try { bc = new BroadcastChannel(CHANNEL); } catch (e) {}

  // Common global names to probe (in order of priority)
  const PROBE_NAMES = ['RK', 'G_rk', 'rocketState', 'ROCKET', 'RocketGame', 'rk'];

  function readEngine() {
    try {
      let G = null;

      if (CUSTOM_VAR) {
        G = window[CUSTOM_VAR];
      } else {
        for (const name of PROBE_NAMES) {
          if (window[name] && typeof window[name] === 'object' && 'state' in window[name]) {
            G = window[name];
            break;
          }
        }
      }

      if (!G) return null;

      return {
        game:     'rocket',
        state:    G.state    || 'wait',
        crashAt:  G.crashAt  || 0,
        mult:     G.mult     || 1,
        roundNum: G.roundNum || 1,
        hist:     G.hist     || [],
        ts:       Date.now()
      };
    } catch (e) {
      return null;
    }
  }

  function broadcast() {
    const data = readEngine();
    if (!data) return;
    try { if (bc) bc.postMessage(data); } catch (e) {}
    try { localStorage.setItem(LS_KEY, JSON.stringify(data)); } catch (e) {}
  }

  setInterval(broadcast, TICK_MS);

  console.info('[PH Bridge] Rocket Crash bridge active — broadcasting on "' + CHANNEL + '"');
})();
