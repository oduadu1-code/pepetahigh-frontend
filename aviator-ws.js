'use strict';
/**
 * aviator-ws.js  —  PepetaHigh Aviator WebSocket client
 * ─────────────────────────────────────────────────────────────────────
 * Manages the REAL MODE connection to game-server.
 * Demo mode is completely unaffected — engine.js handles it as before.
 *
 * WHAT THIS FILE DOES:
 *  • Opens a WebSocket to game-server (?game=aviator&token=JWT)
 *  • Receives round lifecycle events: round_waiting, round_start, tick,
 *    round_crash, bet_accepted, cashout_success, bet_lost
 *  • Exposes AviatorWS.placeBet(amount, autoCashout) and AviatorWS.cashout()
 *  • Mirrors state into window.G_real so aviator.html's gameLoop works
 *    with ZERO changes — it still reads parent.window.G as before
 *  • Handles reconnection automatically (exponential back-off, max 30s)
 *
 * PLACEMENT: frontend/ (same folder as aviator.html, engine.js, etc.)
 * LOAD ORDER in aviator.html (or index.html before aviator iframe loads):
 *   <script src="config.js"></script>      ← defines GAME_SERVER_URL
 *   <script src="utils.js"></script>
 *   <script src="game-sync.js"></script>
 *   <script src="aviator-ws.js"></script>  ← before engine.js
 *   <script src="engine.js"></script>
 *
 * CONFIG (add to config.js):
 *   const GAME_SERVER_URL = 'wss://your-game-server.onrender.com';
 */

(function(global) {

  // ── Config ────────────────────────────────────────────────────────
  // Falls back to localhost for local dev if config.js hasn't defined it
  const WS_BASE = (typeof GAME_SERVER_URL !== 'undefined')
    ? GAME_SERVER_URL
    : 'ws://localhost:4000';
      // G_real lives in the parent frame (engine.js loads in index.html).
  // aviator-ws.js runs inside the aviator.html iframe, so
  // window.G_real here is undefined — we must reach up to parent.
  function _G() {
    try { return global.parent.G_real || global.G_real; } catch(e) { return global.G_real; }
  }

  // ── Internal state ────────────────────────────────────────────────
  let _ws            = null;
  let _connected     = false;
  let _reconnectMs   = 1000;   // starts at 1s, doubles up to 30s
  let _reconnectTimer= null;
  let _intentClose   = false;  // true when WE closed (e.g. mode switch)

  // Active bet tracking (only one real bet at a time per tab)
  // betId is assigned by server on bet_accepted
  let _activeBetId   = null;
  let _activeBetAmt  = 0;

  // Callbacks registered by aviator.html (optional — loop handles most)
  const _cb = {
    onConnected    : null,
    onDisconnected : null,
    onError        : null,
    onTick         : null,   // (multiplier) called every server tick
    onCrash        : null,   // (crashPoint) called on round_crash
    onWait         : null,   // (waitMs, roundNum) called on round_waiting
    onFly          : null,   // (roundNum) called on round_start
    onBetAccepted  : null,   // (betId, amount, autoCashout)
    onCashoutDone  : null,   // (payout, mult)
    onBetLost      : null,   // (amount)
  };

  // ── Mirror helpers — keep G_real in sync so gameLoop renders ──────
  // aviator.html's gameLoop reads parent.window.G, which points to
  // G_real in real mode. We update only the fields the loop uses.
  function _mirrorWait(waitMs, roundNum) {
    const G = _G();
    if (!G) return;
    G.state      = 'wait';
    G.mult       = 1.00;
    G.waitTimer  = waitMs;
    G.fillPct    = 0;
    G.roundNum   = roundNum || (G.roundNum + 1);
    G.elapsed    = 0;
    G.lastTs     = 0;
    G.roundBets  = [];
    // myBets: reset placed/active flags but keep amounts & auto settings
    G.myBets.forEach(b => {
      b.placed    = false;
      b.active    = false;
      b.cashedOut = false;
      b.won       = 0;
    });
    // Drive the wait countdown locally (server doesn't tick during wait)
    _startWaitCountdown(waitMs);
    if (G.onWait) G.onWait();
  }

  function _mirrorFly(roundNum) {
    const G = _G();
    if (!G) return;
    _stopWaitCountdown();
    G._serverControlled = true;
    G.state    = 'fly';
    G.elapsed  = 0;
    G.lastTs   = 0;
    G.mult     = 1.00;
    G.fillPct  = 1;
    // Mark any placed bets as active
    G.myBets.forEach(b => { if (b.placed) b.active = true; });
    if (G.onFly) G.onFly();
  }

  function _mirrorTick(mult) {
    const G = _G();
    if (!G || G.state !== 'fly') return;
    G.mult    = mult;
    G.elapsed = Math.log(mult) * 5800;  // reverse of e^(elapsed/5800)
  }

  function _mirrorCrash(crashPoint) {
    const G = _G();
    if (!G) return;
    _stopWaitCountdown();
    G.state   = 'crash';
    G.mult    = crashPoint;
    G.crashAt = crashPoint;

    // Record in history
    G.roundHist.unshift(parseFloat(crashPoint.toFixed(2)));
    if (G.roundHist.length > 30) G.roundHist.pop();
    try { localStorage.setItem('ph_av_hist_real', JSON.stringify(G.roundHist.slice(0, 50))); } catch(e) {}

    // Mark any still-active bets as lost
    G.myBets.forEach(b => {
      if (b.active && !b.cashedOut) {
        b.active  = false;
        b.placed  = false;
      }
    });

    if (G.onCrash) G.onCrash(parseFloat(crashPoint.toFixed(2)));
  }

  // ── Wait countdown (local timer, mirrors server's 8s window) ─────
  // The server says "waiting for Xms" — we count down locally so the
  // fill bar and countdown text animate smoothly.
  let _waitInterval = null;
  let _waitEnd      = 0;

  function _startWaitCountdown(waitMs) {
    _stopWaitCountdown();
    _waitEnd = Date.now() + waitMs;
    _waitInterval = setInterval(() => {
      const G = _G();
      if (!G) return;
      const remaining = Math.max(0, _waitEnd - Date.now());
      G.waitTimer = remaining;
      G.fillPct   = Math.min(1, (waitMs - remaining) / waitMs);
      if (remaining <= 0) _stopWaitCountdown();
    }, 50);
  }

  function _stopWaitCountdown() {
    if (_waitInterval) { clearInterval(_waitInterval); _waitInterval = null; }
  }

  // ── Message handler ───────────────────────────────────────────────
  function _onMessage(raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch(e) { return; }

    switch (msg.type) {

      // ── A player placed a bet (broadcast to whole room) ──
      case 'bet_placed': {
        const G = _G();
        if (!G) break;
        // Add a fake-name entry so the live bets panel shows activity
        G.roundBets = G.roundBets || [];
        G.roundBets.push({
          nm       : 'Player',
          masked   : '****',
          bet      : msg.amount,
          autoPt   : null,
          cashedAt : null,
          won      : 0,
          isUser   : false,
          si       : -1,
        });
        break;
      }

      // ── Server sent initial state on connect ──
      case 'state':
        if (msg.phase === 'waiting') {
          _mirrorWait(msg.waitRemaining || 8000, msg.roundNum);
        } else if (msg.phase === 'flying') {
          _mirrorFly(msg.roundNum);
          if (msg.multiplier) _mirrorTick(msg.multiplier);
        } else if (msg.phase === 'crashed') {
          const G = _G();
          if (G) { G.state = 'crash'; G.mult = msg.multiplier || 1; }
        }
        break;

      // ── New round about to start — accept bets ──
      case 'round_waiting':
        _activeBetId  = null;
        _activeBetAmt = 0;
        _mirrorWait(msg.waitMs, msg.roundNum);
        if (_cb.onWait) _cb.onWait(msg.waitMs, msg.roundNum);
        // Auto-bet: if the user had autoBet on, place it now
        _tryAutoBet();
        break;

      // ── Plane takes off ──
      case 'round_start':
        _mirrorFly(msg.roundNum);
        if (_cb.onFly) _cb.onFly(msg.roundNum);
        break;

      // ── Multiplier update (every 50ms from server) ──
      case 'tick':
        _mirrorTick(msg.mult);
        if (_cb.onTick) _cb.onTick(msg.mult);
        break;

      // ── Round crashed ──
      case 'round_crash':
        _mirrorCrash(msg.crashPoint);
        _activeBetId  = null;
        _activeBetAmt = 0;
        if (_cb.onCrash) _cb.onCrash(msg.crashPoint);
        break;

      // ── Our bet was accepted by server ──
      case 'bet_accepted':
        _activeBetId  = msg.betId;
        _activeBetAmt = msg.amount;
        // Mark bet as placed in G_real
        const G = _G();
        if (G && G.myBets[0] && !G.myBets[0].placed) {
          G.myBets[0].placed = true;
          G.myBets[0].amt    = msg.amount;
        }
        if (_cb.onBetAccepted) _cb.onBetAccepted(msg.betId, msg.amount, msg.autoCashout);
        // Notify wallet update
        if (typeof global.updateNavBal === 'function') global.updateNavBal();
        break;

      // ── We cashed out successfully ──
      case 'cashout_success':
        const payout = msg.payout;
        const mult   = msg.mult;
        // Credit locally so balance shows immediately
        if (typeof PH !== 'undefined') PH.credit(payout);
        // Mark bet as cashed out in G_real
        const Gc = _G();
        if (Gc) {
          Gc.myBets.forEach(b => {
            if (b.active && !b.cashedOut) {
              b.cashedOut = true;
              b.active    = false;
              b.placed    = false;
              b.won       = payout;
            }
          });
          // Update roundBets entry
          const rb = (Gc.roundBets || []).find(r => r.isUser && !r.cashedAt);
          if (rb) { rb.cashedAt = mult; rb.won = payout; }
        }
        _activeBetId  = null;
        _activeBetAmt = 0;
        if (typeof global.updateNavBal === 'function') global.updateNavBal();
        if (_cb.onCashoutDone) _cb.onCashoutDone(payout, mult);
        // Save transaction record
        if (typeof PH !== 'undefined') {
          PH.saveTxn({ type:'win', amount:payout, cashoutAt:mult, mode:'real', status:'completed' });
        }
        break;

      // ── Our bet lost (plane flew away) ──
      case 'bet_lost':
        _activeBetId  = null;
        _activeBetAmt = 0;
        if (typeof PH !== 'undefined') {
          PH.saveTxn({ type:'bet', amount:msg.amount, cashoutAt:null, wonAmount:0, mode:'real', status:'loss' });
        }
        if (_cb.onBetLost) _cb.onBetLost(msg.amount);
        break;

      // ── Server-side error ──
      case 'error':
        console.warn('[AviatorWS] Server error:', msg.code, msg.msg);
        if (msg.code === 'AUTH_REQUIRED') {
          // Prompt login
          try { global.parent.openModal('login-modal'); } catch(e) {}
        }
        if (typeof global.showToast === 'function') {
          global.showToast(msg.msg || 'Game error', 'error');
        }
        break;

      case 'connected':
        console.log('[AviatorWS] Connected to game-server, authenticated:', msg.authenticated);
        break;

      default:
        // Unknown message type — ignore
        break;
    }
  }

  // ── Auto-bet helper ───────────────────────────────────────────────
  function _tryAutoBet() {
    const G = _G();
    if (!G) return;
    G.myBets.forEach((b, i) => {
      if (!b.autoBet) return;
      if (b.amt < 20 || b.amt > 20000) return;
      const user = (typeof PH !== 'undefined') ? PH.getUser() : null;
      if (!user) return;
      const bal = PH.getWallet();
      if (b.amt > bal) { console.warn('[AviatorWS] Auto-bet skipped: insufficient balance'); return; }
      // Only slot 0 in real mode for now (single real bet at a time)
      if (i === 0 && !_activeBetId) {
        AviatorWS.placeBet(b.amt, b.autoOn && b.auto ? parseFloat(b.auto) : null);
      }
    });
  }

  // ── WebSocket connection ──────────────────────────────────────────
  function _connect() {
    if (_intentClose) return;
    const token = sessionStorage.getItem('ph_jwt') || '';
    const url   = `${WS_BASE}?game=aviator${token ? '&token=' + token : ''}`;

    console.log('[AviatorWS] Connecting to', url);
    _ws = new WebSocket(url);

    _ws.onopen = () => {
      console.log('[AviatorWS] Connected');
      _connected   = true;
      _reconnectMs = 1000;
      // Tell engine.js to stop driving G_real — server owns it now
      if (_G()) _G()._serverControlled = true;
      if (_cb.onConnected) _cb.onConnected();
      try { global.parent.hideReconnectScreen && global.parent.hideReconnectScreen(); } catch(e) {}
    };

    _ws.onmessage = (evt) => _onMessage(evt.data);

    _ws.onerror = (err) => {
      console.warn('[AviatorWS] WS error', err);
      if (_cb.onError) _cb.onError(err);
    };

    _ws.onclose = (evt) => {
      console.warn('[AviatorWS] Disconnected. Code:', evt.code, 'Reason:', evt.reason);
      _connected = false;
      _ws        = null;
      // Release the lock so the local loop can drive G_real as a fallback
      if (_G()) _G()._serverControlled = false;
      if (_intentClose) return;

      // Show reconnect screen in parent shell
      try {
        global.parent.showReconnectScreen && global.parent.showReconnectScreen(
          'Reconnecting to game server… (' + Math.round(_reconnectMs / 1000) + 's)'
        );
      } catch(e) {}

      // Exponential back-off: 1s → 2s → 4s → 8s → 16s → 30s max
      _reconnectTimer = setTimeout(() => {
        _reconnectMs = Math.min(_reconnectMs * 2, 30000);
        _connect();
      }, _reconnectMs);
    };
  }

  function _disconnect() {
    _intentClose = true;
    _stopWaitCountdown();
    if (_reconnectTimer) { clearTimeout(_reconnectTimer); _reconnectTimer = null; }
    if (_ws) { _ws.close(); _ws = null; }
    _connected = false;
    if (_G()) _G()._serverControlled = false;
  }

  // ── Send helpers ──────────────────────────────────────────────────
  function _send(obj) {
    if (!_ws || _ws.readyState !== WebSocket.OPEN) {
      console.warn('[AviatorWS] Cannot send — not connected:', obj.type);
      return false;
    }
    _ws.send(JSON.stringify(obj));
    return true;
  }

  // ─────────────────────────────────────────────────────────────────
  // PUBLIC API
  // ─────────────────────────────────────────────────────────────────
  const AviatorWS = {

    /**
     * Call once when entering real-mode aviator.
     * Closes any existing connection and opens a fresh one.
     */
    connect() {
      _intentClose = false;
      if (_ws && _ws.readyState === WebSocket.OPEN) return; // already connected
      _connect();
    },

    /**
     * Call when leaving aviator (nav away, mode switch to demo).
     * Stops reconnection attempts.
     */
    disconnect() {
      _disconnect();
    },

    /**
     * Place a real-money bet.
     * @param {number} amount       - Bet amount in KSh (min 20)
     * @param {number|null} autoCashout - Auto-cashout multiplier, or null
     * @returns {boolean} false if not connected
     */
    placeBet(amount, autoCashout) {
      if (!_connected) {
        if (typeof global.showToast === 'function') {
          global.showToast('Not connected to game server', 'error');
        }
        return false;
      }
      // Deduct from local wallet immediately (server will also verify)
      // This keeps the UI snappy — if server rejects, it re-credits
      if (typeof PH !== 'undefined') {
        const bal = PH.getWallet();
        if (amount > bal) {
          if (typeof global.showToast === 'function') {
            global.showToast('Insufficient balance', 'error');
          }
          return false;
        }
        PH.deduct(amount);
        PH.saveTxn({ type:'bet', amount, cashoutAt:null, wonAmount:0, mode:'real', status:'pending' });
        if (typeof global.updateNavBal === 'function') global.updateNavBal();
      }
      return _send({
        type       : 'bet',
        amount,
        autoCashout: autoCashout || null,
      });
    },

    /**
     * Cash out the active bet at the current multiplier.
     * @returns {boolean} false if no active bet or not connected
     */
    cashout() {
      if (!_activeBetId) {
        if (typeof global.showToast === 'function') {
          global.showToast('No active bet to cash out', 'info');
        }
        return false;
      }
      return _send({ type: 'cashout' });
    },

    /**
     * Register event callbacks.
     * Any callback key from _cb above can be set here.
     * Example: AviatorWS.on('onCrash', (cp) => console.log('crashed at', cp))
     */
    on(event, fn) {
      if (event in _cb) _cb[event] = fn;
    },

    /** True if WebSocket is currently open */
    isConnected() { return _connected; },

    /** True if user has a pending real bet this round */
    hasBet() { return !!_activeBetId; },

    /** Current active bet amount */
    betAmount() { return _activeBetAmt; },
  };

  global.AviatorWS = AviatorWS;

})(window);
