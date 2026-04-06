// ═══════════════════════════════════════════════════════════════════
//  bridge-aviator.js  — runs inside the aviator iframe
//  Reads G (the active world) every 80ms and publishes state to:
//    1. BroadcastChannel('ph_av_bridge')  — same-browser tabs
//    2. localStorage('ph_av_sync')        — fallback / cross-tab
//  The admin page (admin-aviator.html) listens on both channels.
// ═══════════════════════════════════════════════════════════════════
'use strict';

(function () {
  const CHANNEL  = 'ph_av_bridge';
  const LS_KEY   = 'ph_av_sync';
  const TICK_MS  = 80;

  // BroadcastChannel — works when both pages are open in same browser
  let bc = null;
  try { bc = new BroadcastChannel(CHANNEL); } catch (e) {}

  let _lastPayload = '';   // stringify cache — only publish when changed

  function publish(data) {
    const json = JSON.stringify(data);
    if (json === _lastPayload) return;   // nothing changed — skip
    _lastPayload = json;

    // 1. BroadcastChannel
    if (bc) { try { bc.postMessage(data); } catch (e) {} }

    // 2. localStorage  (storage event fires in OTHER tabs; same tab polls)
    try { localStorage.setItem(LS_KEY, json); } catch (e) {}
  }

  function tick() {
    // G lives on the parent window (engine.js sets window.G)
    let G;
    try { G = parent.window.G; } catch (e) { return; }
    if (!G) return;

    const payload = {
      game:      'aviator',
      ts:        Date.now(),
      mode:      G.mode      || 'real',
      state:     G.state     || 'idle',
      mult:      G.mult      || 1,
      crashAt:   G.crashAt   || 0,
      waitTimer: G.waitTimer || 0,
      fillPct:   G.fillPct   || 0,
      roundNum:  G.roundNum  || 1,
      roundHist: (G.roundHist || []).slice(0, 40),
    };

    publish(payload);
  }

  setInterval(tick, TICK_MS);
  tick(); // immediate first publish
})();
