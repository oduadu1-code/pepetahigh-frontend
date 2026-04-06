// ═══════════════════════════════════════════════════════════════════
//  bridge-aviator.js  — runs inside the aviator iframe
//
//  IMPORTANT: Always reads from G_real — the admin predictor only
//  tracks real-money rounds. Demo mode runs independently and is
//  never broadcast to the admin page.
//
//  Publishes to:
//    1. BroadcastChannel('ph_av_bridge')  — same-browser tabs
//    2. localStorage('ph_av_sync')        — fallback / cross-tab
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

    // 2. localStorage (storage event fires in OTHER tabs; same tab polls)
    try { localStorage.setItem(LS_KEY, json); } catch (e) {}
  }

  function tick() {
    // ── Always read from G_real, NEVER from window.G or G_demo ──
    // window.G switches between worlds when the user toggles mode,
    // so reading it would cause demo odds to appear in the predictor.
    // G_real runs independently at all times with its own crashAt.
    let G;
    try { G = parent.window.G_real; } catch (e) { return; }
    if (!G) return;

    // Engine hasn't initialised G_real yet — wait
    if (!G.state || G.state === 'idle') return;

    const payload = {
      game:      'aviator',
      ts:        Date.now(),
      mode:      'real',                          // always real
      state:     G.state      || 'idle',
      mult:      G.mult       || 1,
      crashAt:   G.crashAt    || 0,
      waitTimer: G.waitTimer  || 0,
      fillPct:   G.fillPct    || 0,
      roundNum:  G.roundNum   || 1,
      roundHist: (G.roundHist || []).slice(0, 40),
    };

    publish(payload);
  }

  setInterval(tick, TICK_MS);
  tick(); // immediate first publish
})();
