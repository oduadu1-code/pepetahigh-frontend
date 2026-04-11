'use strict';
(function(global) {

  const WS_BASE = (typeof GAME_SERVER_URL !== 'undefined') ? GAME_SERVER_URL : 'ws://localhost:4000';

  let _ws = null, _connected = false, _reconnectMs = 1000, _reconnectTimer = null, _intentClose = false;
  let _activeBetId = null;

  // ── Overwrite the client's local HIST with the server's authoritative list.
  //    This ensures every client — regardless of when they joined — shows
  //    identical history in the history bar.
  function _loadServerHistory(hist) {
    if (!Array.isArray(hist) || !hist.length) return;
    try {
      // HIST is declared in rocket.html's scope as a const array.
      // We can't reassign it, but we can splice it in place.
      eval('HIST.length = 0; hist.forEach(v => HIST.push(parseFloat(v.toFixed ? v.toFixed(2) : v)));');
      // Persist to localStorage so bets.html can also read it
      try { localStorage.setItem('ph_hist_rocket_real', JSON.stringify(hist.slice(0, 50))); } catch(e) {}
      // Re-render the history bar
      if (typeof renderHist === 'function') renderHist();
    } catch(e) {}
  }
  //    must be suppressed so rounds are driven entirely by the server.
  //    We do this by clearing them immediately after startWait() sets them.
  function _suppressLocalTimers() {
    // Clear the local 5-second countdown timer so the client doesn't
    // independently call startFlight() — the server sends round_start instead.
    if (typeof _waitTimer !== 'undefined' && _waitTimer) {
      clearTimeout(_waitTimer);
      try { eval('_waitTimer = null'); } catch(e) {}
    }
    if (typeof _countdownInt !== 'undefined' && _countdownInt) {
      clearInterval(_countdownInt);
      try { eval('_countdownInt = null'); } catch(e) {}
    }
  }

  // ── Drive the wait countdown purely from server's waitRemaining value
  let _waitInterval = null, _waitEnd = 0, _waitDur = 5000;

  function _startServerCountdown(waitMs) {
    _stopServerCountdown();
    _waitEnd = Date.now() + waitMs;
    _waitDur = waitMs;

    // Update the badge and countdown bar every 50ms using server time
    _waitInterval = setInterval(() => {
      const rem = Math.max(0, _waitEnd - Date.now());
      const secs = Math.ceil(rem / 1000);

      const badge = document.getElementById('stateBadge');
      const fill  = document.getElementById('countdownFill');

      if (badge && typeof _state !== 'undefined' && _state === 'wait') {
        badge.textContent = secs > 0 ? 'Next round in ' + secs + 's…' : 'Starting…';
      }
      if (fill) {
        fill.style.width = Math.min(100, ((_waitDur - rem) / _waitDur) * 100) + '%';
      }

      // Also keep _waitRemaining in sync for PH_ROCKET bridge
      try { eval('_waitRemaining = ' + rem); } catch(e) {}

      if (rem <= 0) _stopServerCountdown();
    }, 50);
  }

  function _stopServerCountdown() {
    if (_waitInterval) { clearInterval(_waitInterval); _waitInterval = null; }
  }

  function _onMessage(raw) {
    let msg; try { msg = JSON.parse(raw); } catch(e) { return; }

    switch (msg.type) {

      // Server sends current state on initial connect
      case 'state':
        // Load server history immediately — this is the single source of truth.
        // Server sends it as msg.history (from getState). Overwrite local HIST
        // so all clients show identical history regardless of when they joined.
        _loadServerHistory(msg.history || msg.hist);

        if (msg.phase === 'waiting') {
          if (typeof startWait === 'function') startWait();
          setTimeout(() => {
            _suppressLocalTimers();
            _startServerCountdown(msg.waitRemaining || 5000);
          }, 0);
        } else if (msg.phase === 'flying') {
          if (typeof startFlight === 'function') {
            try { eval('_targetCrash = ' + (msg.crashPoint || 99)); } catch(e) {}
            startFlight();
          }
        }
        break;

      // New round waiting period — all clients sync here
      case 'round_waiting':
        _activeBetId = null;
        if (typeof startWait === 'function') startWait();
        // After startWait() sets its own timers, kill them and use server time
        setTimeout(() => {
          _suppressLocalTimers();
          _startServerCountdown(msg.waitMs || 5000);
        }, 0);
        break;

      // Server says GO — start flight now, use server's crash point
      case 'round_start':
        _stopServerCountdown();
        // Override crash target with server's value so all clients crash together
        try { eval('_targetCrash = ' + (msg.crashPoint || generateCrash())); } catch(e) {}
        if (typeof startFlight === 'function') startFlight();
        break;

      // Server tick — keep multiplier in sync with server's authoritative value
      case 'tick':
        try { eval('_mult = ' + msg.mult); } catch(e) {}
        const mv = document.getElementById('multVal');
        if (mv && typeof _state !== 'undefined' && _state === 'fly') {
          mv.textContent = parseFloat(msg.mult).toFixed(2) + '×';
        }
        // Auto cashout check
        try {
          if (typeof _betPlaced !== 'undefined' && _betPlaced &&
              typeof _cashedOut !== 'undefined' && !_cashedOut &&
              typeof _autoCo !== 'undefined' && _autoCo > 1 &&
              msg.mult >= _autoCo) {
            if (typeof doCashout === 'function') doCashout();
          }
        } catch(e) {}
        break;

      // Server crashed the round — force bust at exact server crash point
      case 'round_crash':
        _stopServerCountdown();
        try { eval('_mult = ' + msg.crashPoint); } catch(e) {}
        try { eval('_targetCrash = ' + msg.crashPoint); } catch(e) {}
        if (typeof doBust === 'function') doBust();
        // If server echoes updated history after crash, sync it
        if (msg.history || msg.hist) _loadServerHistory(msg.history || msg.hist);
        _activeBetId = null;
        break;

      case 'bet_accepted':
        _activeBetId = msg.betId;
        break;

      case 'cashout_success':
        if (typeof credit === 'function') credit(msg.payout);
        if (typeof notifyNav === 'function') notifyNav();
        if (typeof updateBal === 'function') updateBal();
        if (typeof toast === 'function') toast('🚀 Cashed out ' + parseFloat(msg.mult).toFixed(2) + '× · +' + msg.payout + ' KSh');
        _activeBetId = null;
        break;

      case 'bet_lost':
        _activeBetId = null;
        break;
    }
  }

  function _connect() {
    if (_intentClose) return;
    const token = sessionStorage.getItem('ph_jwt') || '';
    const url = `${WS_BASE}?game=rocket${token ? '&token=' + token : ''}`;
    _ws = new WebSocket(url);

    _ws.onopen = () => {
      _connected = true;
      _reconnectMs = 1000;
      console.info('[RocketWS] Connected to server — server now drives all rounds');
    };

    _ws.onmessage = (evt) => _onMessage(evt.data);
    _ws.onerror = () => {};

    _ws.onclose = () => {
      _connected = false;
      _ws = null;
      _stopServerCountdown();
      console.warn('[RocketWS] Disconnected — falling back to local simulation');
      if (_intentClose) return;
      _reconnectTimer = setTimeout(() => {
        _reconnectMs = Math.min(_reconnectMs * 2, 30000);
        _connect();
      }, _reconnectMs);
    };
  }

  function _disconnect() {
    _intentClose = true;
    _stopServerCountdown();
    if (_reconnectTimer) { clearTimeout(_reconnectTimer); _reconnectTimer = null; }
    if (_ws) { _ws.close(); _ws = null; }
    _connected = false;
  }

  function _send(obj) {
    if (!_ws || _ws.readyState !== WebSocket.OPEN) return false;
    _ws.send(JSON.stringify(obj));
    return true;
  }

  global.RocketWS = {
    connect()              { _intentClose = false; if (_ws && _ws.readyState === WebSocket.OPEN) return; _connect(); },
    disconnect()           { _disconnect(); },
    isConnected()          { return _connected; },
    hasBet()               { return !!_activeBetId; },

    placeBet(amount, autoCashout) {
      if (!_connected) {
        if (typeof toast === 'function') toast('Not connected to server');
        return false;
      }
      return _send({ type: 'bet', amount, autoCashout: autoCashout || null });
    },

    cashout() {
      return _send({ type: 'cashout' });
    },
  };

})(window);
