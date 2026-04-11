// ═══════════════════════════════════════════════════════════════════
//  bridge-aviator.js  v2  — runs inside the aviator iframe
//
//  v1: read G_real from parent engine.js → relay to admin page
//  v2: connect to game-server WebSocket → relay to admin page
//       AND keep G_real in sync for the frontend UI
//
//  TWO JOBS:
//    1. Relay game-server state to admin-aviator.html via
//       BroadcastChannel('ph_av_bridge') + localStorage('ph_av_sync')
//       (admin-aviator.html and its predictor work UNCHANGED)
//
//    2. Keep parent.window.G_real in sync with server state
//       so aviator.html UI (canvas, bet panel, history bar) still works.
//       The frontend reads G_real as before — we just update it here
//       instead of the old engine.js loop.
//
//  IMPORTANT:
//    - Admin relay uses 'real' game state only (never demo).
//    - Demo mode still runs locally via the old engine.js world.
//    - If WebSocket drops, falls back to local engine temporarily.
// ═══════════════════════════════════════════════════════════════════
'use strict';

(function () {

  // ── Config ──────────────────────────────────────────────────────────
  // NOTE: Change this to your deployed game-server URL before going live.
  // During local dev: ws://localhost:4000
  const GAME_SERVER_WS = (function() {
    try { return parent.window.GAME_SERVER_URL || 'wss://pepetahigh-server.onrender.com'; }
    catch(e) { return 'wss://pepetahigh-server.onrender.com'; }
  })(); 

  const CHANNEL = 'ph_av_bridge';
  const LS_KEY  = 'ph_av_sync';

  // ── BroadcastChannel for admin relay ────────────────────────────────
  let bc = null;
  try { bc = new BroadcastChannel(CHANNEL); } catch (e) {}

  let _lastPayload = '';

  function relayToAdmin(data) {
    const json = JSON.stringify(data);
    if (json === _lastPayload) return;
    _lastPayload = json;
    if (bc) { try { bc.postMessage(data); } catch (e) {} }
    try { localStorage.setItem(LS_KEY, json); } catch (e) {}
  }

  // ── Get JWT from parent ──────────────────────────────────────────────
  function getJWT() {
    try { return parent.sessionStorage.getItem('ph_jwt') || ''; }
    catch (e) { return ''; }
  }

  // ── Get admin secret from parent config ─────────────────────────────
  function getAdminSecret() {
    try { return parent.window.ADMIN_SECRET || ''; }
    catch (e) { return ''; }
  }

  // ── Sync server state into parent.window.G_real ─────────────────────
  // This is what makes the aviator.html frontend UI work:
  // instead of engine.js running the loop, we push server state here.
  function syncToGReal(serverMsg) {
    let G;
    try { G = parent.window.G_real; } catch (e) { return; }
    if (!G) return;

    switch (serverMsg.type) {

      case 'state':
      case 'round_waiting':
        G.state     = 'wait';
        G.mult      = 1.00;
        G.waitTimer = serverMsg.waitRemaining || serverMsg.waitMs || 5000;
        G.fillPct   = 0;
        G.roundNum  = serverMsg.roundNum || G.roundNum;
        if (serverMsg.history) G.roundHist = serverMsg.history;
        if (G.onWait) G.onWait();
        break;

      case 'round_start':
        G.state    = 'fly';
        G.mult     = 1.00;
        G.elapsed  = 0;
        G.roundNum = serverMsg.roundNum || G.roundNum;
        if (G.onFly) G.onFly();
        break;

      case 'tick':
        G.state = 'fly';
        G.mult  = serverMsg.mult;
        break;

      case 'round_crash':
        G.state   = 'crash';
        G.mult    = serverMsg.crashPoint || G.mult;
        G.crashAt = serverMsg.crashPoint || G.mult;
        if (serverMsg.roundNum) G.roundNum = serverMsg.roundNum;
        // Update round history
        if (G.onCrash) G.onCrash(parseFloat(G.crashAt.toFixed(2)));
        break;

      case 'cashout_success':
        // Server confirmed a cashout — update the bet slot
        try {
          const myBets = G.myBets || [];
          myBets.forEach((b, i) => {
            if (b.active && !b.cashedOut && b._serverBetId === serverMsg.betId) {
              b.cashedOut = true; b.active = false; b.placed = false;
              b.won = serverMsg.payout;
              parent.PH.credit(serverMsg.payout);
              if (typeof parent.updateNavBal === 'function') parent.updateNavBal();
            }
          });
        } catch(e) {}
        break;

      case 'bet_lost':
        // Round ended and this bet didn't cash out
        try {
          const myBets = G.myBets || [];
          myBets.forEach(b => {
            if (b.active && !b.cashedOut) {
              b.active = false; b.placed = false; b.cashedOut = false; b.won = 0;
            }
          });
        } catch(e) {}
        break;
    }
  }

  // ── Admin relay payload builder ──────────────────────────────────────
  // Shapes the server's admin message to match what bridge-aviator.js v1
  // was sending, so admin-aviator.html works with zero changes.
  function buildAdminPayload(msg) {
    let G;
    try { G = parent.window.G_real; } catch (e) { G = {}; }

    return {
      game      : 'aviator',
      ts        : Date.now(),
      mode      : 'real',
      state     : msg.state     || G.state     || 'idle',
      mult      : msg.mult      || G.mult      || 1,
      crashAt   : msg.crashAt   || G.crashAt   || 0,
      waitTimer : msg.waitTimer || G.waitTimer || 0,
      fillPct   : msg.fillPct   || G.fillPct   || 0,
      roundNum  : msg.roundNum  || G.roundNum  || 1,
      roundHist : msg.roundHist || (G.roundHist || []).slice(0, 40),
    };
  }

  // ── WebSocket connection ─────────────────────────────────────────────
  let _ws       = null;
  let _reconnect = null;
  let _adminWs  = null;  // separate admin-only connection

  function connect() {
    const jwt = getJWT();
    const url = `${GAME_SERVER_WS}?game=aviator${jwt ? '&token=' + encodeURIComponent(jwt) : ''}`;

    _ws = new WebSocket(url);

    _ws.onopen = function () {
      console.log('[bridge-aviator] Connected to game server');
      clearTimeout(_reconnect);
      // Stop local engine's real-world loop — server drives it now
      try {
        parent.window.G_real.running = false;
        if (parent.window.GameSync && parent.window.GameSync.isLeader()) {
          // Tell GameSync we're now server-driven
          parent.window.G_real.running = false;
        }
      } catch(e) {}
    };

    _ws.onmessage = function (evt) {
      let msg;
      try { msg = JSON.parse(evt.data); } catch (e) { return; }

      // Update frontend state
      syncToGReal(msg);

      // Relay to admin (admin WebSocket handles this separately,
      // but keep localStorage relay for same-browser admin tabs)
      if (msg.state !== undefined && msg.crashAt !== undefined) {
        relayToAdmin(buildAdminPayload(msg));
      }
    };

    _ws.onerror = function (err) {
      console.warn('[bridge-aviator] WS error:', err.message || err);
    };

    _ws.onclose = function () {
      console.warn('[bridge-aviator] Disconnected — reconnecting in 3s…');
      // Re-enable local engine as fallback
      try { parent.window.G_real.running = true; } catch(e) {}
      _reconnect = setTimeout(connect, 3000);
    };
  }

  // ── Admin WebSocket connection ───────────────────────────────────────
  // Separate connection that receives crashAt during waiting phase.
  // Only used if ADMIN_SECRET is available (admin-aviator.html environment).
  function connectAdmin() {
    const secret = getAdminSecret();
    if (!secret) return; // not an admin page — skip

    const url = `${GAME_SERVER_WS}?game=aviator&admin=1&secret=${encodeURIComponent(secret)}`;
    _adminWs = new WebSocket(url);

    _adminWs.onopen  = () => console.log('[bridge-aviator] Admin WebSocket connected');
    _adminWs.onclose = () => { setTimeout(connectAdmin, 4000); };
    _adminWs.onerror = () => {};

    _adminWs.onmessage = function (evt) {
      let msg;
      try { msg = JSON.parse(evt.data); } catch (e) { return; }
      // Admin messages already have the right shape from getAdminState()
      relayToAdmin(msg);
    };
  }

  // ── Fallback relay (when WS unavailable, read from G_real) ──────────
  // Keeps admin page working even if game-server is not yet deployed.
  let _fallbackActive = false;
  function startFallback() {
    if (_fallbackActive) return;
    _fallbackActive = true;
    setInterval(() => {
      let G;
      try { G = parent.window.G_real; } catch (e) { return; }
      if (!G || !G.state || G.state === 'idle') return;

      relayToAdmin({
        game      : 'aviator',
        ts        : Date.now(),
        mode      : 'real',
        state     : G.state,
        mult      : G.mult      || 1,
        crashAt   : G.crashAt   || 0,
        waitTimer : G.waitTimer || 0,
        fillPct   : G.fillPct   || 0,
        roundNum  : G.roundNum  || 1,
        roundHist : (G.roundHist || []).slice(0, 40),
      });
    }, 80);
  }

  // ── Init ─────────────────────────────────────────────────────────────
  // Try to connect to game server. If it fails, fall back to G_real relay.
  try {
    connect();
    connectAdmin();
  } catch (e) {
    console.warn('[bridge-aviator] WebSocket not available — using local fallback');
    startFallback();
  }

  // If game-server is not running locally, ensure admin relay still works
  setTimeout(() => {
    if (!_ws || _ws.readyState !== WebSocket.OPEN) {
      startFallback();
    }
  }, 3000);

})();
