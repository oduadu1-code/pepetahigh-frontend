// ═══════════════════════════════════════════════════════════════════
//  PepetaHigh — engine.js  v6
//
//  Two FULLY INDEPENDENT worlds: G_real and G_demo
//  Each world has its own:
//    • crash generator  (real = house-edge weighted, demo = generous)
//    • round history    (saved to separate localStorage keys)
//    • bet state        (myBets, roundBets, pendingBets)
//    • round counter
//  window.G always points to the ACTIVE world (UI display only).
//  Both worlds run simultaneously in the background at all times.
//
//  v6 CHANGE: GameSync.init() is called at the bottom so that only
//  ONE tab (the "leader") runs the game loop. All other tabs are
//  "followers" that receive state via BroadcastChannel and only render.
//  This guarantees every tab/device shows the SAME multiplier.
// ═══════════════════════════════════════════════════════════════════
'use strict';

const TODAY       = () => new Date().toISOString().slice(0, 10);
const JACKPOT_MAX = 5000;

// ── Seeded PRNG — identical fake players across all devices ──────────
function _mulberry32(seed) {
  return function() {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function _dailySeed() {
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  let h = 0x811c9dc5;
  for (let i = 0; i < day.length; i++) { h ^= day.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h;
}
function _roundRNG(mode, roundNum) {
  const salt = mode === 'demo' ? 0xDEADF00D : 0xBEEFCAFE;
  return _mulberry32((_dailySeed() ^ salt ^ (roundNum * 0x9e3779b9)) >>> 0);
}
const jpKey       = () => 'ph_jp_'  + TODAY();
const bigKey      = () => 'ph_big_' + TODAY();
const bigCount    = () => parseInt(sessionStorage.getItem(bigKey()) || '0', 10);
const bigInc      = () => sessionStorage.setItem(bigKey(), bigCount() + 1);
const jpFired     = () => sessionStorage.getItem(jpKey()) === '1';
const jpMark      = () => sessionStorage.setItem(jpKey(), '1');

// Real house edge: 52–58% by hour
function realWinRate() {
  const h = new Date().getHours();
  if (h >= 21 || h <= 2)  return 0.52;
  if (h >= 6  && h <= 9)  return 0.58;
  if (h >= 14 && h <= 17) return 0.56;
  return 0.54;
}

// ── Crash generators ─────────────────────────────────────────────────
// REAL: house-edge weighted — more sub-2x results, rare big wins
function genCrashReal() {
  if (!jpFired() && Math.random() < 0.00008) { jpMark(); return JACKPOT_MAX; }
  if (bigCount() < 5 && Math.random() < 0.028) {
    bigInc();
    return parseFloat((2000 + Math.random() * 2999).toFixed(2));
  }
  const w = realWinRate(), r = Math.random();
  if (r < (1 - w) * 1.25) {
    const s = Math.random();
    if (s < 0.05) return 1.00;
    if (s < 0.55) return parseFloat((1.01 + Math.random() * 0.48).toFixed(2));
    return parseFloat((1.50 + Math.random() * 0.49).toFixed(2));
  }
  const r2 = Math.random();
  if (r2 < 0.30)  return parseFloat((2.00  + Math.random() * 2.99).toFixed(2));
  if (r2 < 0.58)  return parseFloat((5.00  + Math.random() * 4.99).toFixed(2));
  if (r2 < 0.78)  return parseFloat((10.00 + Math.random() * 9.99).toFixed(2));
  if (r2 < 0.91)  return parseFloat((20.00 + Math.random() * 29.99).toFixed(2));
  if (r2 < 0.97)  return parseFloat((50.00 + Math.random() * 49.99).toFixed(2));
  if (r2 < 0.995) return parseFloat((100.0 + Math.random() * 99.99).toFixed(2));
  return parseFloat((200.0 + Math.random() * 799).toFixed(2));
}

// DEMO: more generous — better odds to keep players engaged
function genCrashDemo() {
  if (Math.random() < 0.003) return parseFloat((500 + Math.random() * 500).toFixed(2));
  const r = Math.random();
  if (r < 0.02) return 1.00;
  if (r < 0.12) return parseFloat((1.01 + Math.random() * 0.48).toFixed(2));
  if (r < 0.26) return parseFloat((1.50 + Math.random() * 0.49).toFixed(2));
  if (r < 0.46) return parseFloat((2.00 + Math.random() * 2.99).toFixed(2));
  if (r < 0.64) return parseFloat((5.00 + Math.random() * 4.99).toFixed(2));
  if (r < 0.78) return parseFloat((10.0 + Math.random() * 9.99).toFixed(2));
  if (r < 0.90) return parseFloat((20.0 + Math.random() * 29.99).toFixed(2));
  if (r < 0.96) return parseFloat((50.0 + Math.random() * 49.99).toFixed(2));
  return parseFloat((100.0 + Math.random() * 99.99).toFixed(2));
}

// ── Stakes & fake cashouts ────────────────────────────────────────────
const CLEAN_STAKES = [50,100,150,200,250,300,400,500,750,1000,1500,2000,2500,3000,4000,5000,7500,10000];
const CLEAN_WEIGHTS = [.18,.16,.10,.10,.08,.07,.07,.08,.05,.05,.03,.02,.02,.02,.01,.01,.005,.005];
function randomStake(rng) {
  rng = rng || Math.random.bind(Math);
  const r = rng(); let cum = 0;
  for (let i = 0; i < CLEAN_STAKES.length; i++) {
    cum += CLEAN_WEIGHTS[i];
    if (r < cum) return CLEAN_STAKES[i];
  }
  return 100;
}
function randomCashoutTarget(rng) {
  rng = rng || Math.random.bind(Math);
  if (rng() < 0.08) return null;
  const r = rng();
  if (r < 0.30)  return parseFloat((1.10 + rng() * 0.88).toFixed(2));
  if (r < 0.60)  return parseFloat((1.99 + rng() * 2.00).toFixed(2));
  if (r < 0.78)  return parseFloat((4.00 + rng() * 5.99).toFixed(2));
  if (r < 0.98)  return parseFloat((10.0 + rng() * 9.99).toFixed(2));
  if (r < 0.995) return parseFloat((20.0 + rng() * 29.9).toFixed(2));
  return parseFloat((50.0 + rng() * 950).toFixed(2));
}

// ── World factory ─────────────────────────────────────────────────────
function makeWorld(mode) {
  const histKey = 'ph_hist_' + mode;
  const savedHist = (() => {
    try { return JSON.parse(localStorage.getItem(histKey) || '[]'); } catch(e) { return []; }
  })();
  return {
    mode,
    histKey,
    _serverControlled: false,
    state: 'idle', mult: 1.00, crashAt: 1.00, elapsed: 0, lastTs: 0,
    waitTimer: 0, fillPct: 0, roundNum: 1, roundHist: savedHist,
    roundBets: [], pendingBets: [], placementInt: null,
    myBets: [
      {amt:100,auto:'',autoOn:false,autoBet:false,placed:false,active:false,cashedOut:false,won:0},
      {amt:100,auto:'',autoOn:false,autoBet:false,placed:false,active:false,cashedOut:false,won:0}
    ],
    running: false, rafId: null, inAviator: false,
    onRoundBetsChange: null, onCrash: null, onFly: null, onWait: null, onAutoCashout: null,
  };
}

window.G_real = makeWorld('real');
window.G_demo = makeWorld('demo');
window.G      = PH.getMode() === 'demo' ? window.G_demo : window.G_real;

// ── Bet generation ────────────────────────────────────────────────────
function genRoundBets(G) {
  G.pendingBets = [];
  const rng = _roundRNG(G.mode, G.roundNum);
  const total = Math.max(60, Math.floor(60 * (0.8 + rng() * 0.4) + 30));  
  const used = new Set(); let added = 0;
  while (added < total) {
    const nm = fakeName(), stake = randomStake(rng), autoPt = randomCashoutTarget(rng);
    G.pendingBets.push({nm, masked: maskName(nm), bet: stake, autoPt, cashedAt: null, won: 0, isUser: false, si: -1});
    if (!used.has(nm) && rng() < 0.11) {
      used.add(nm);
      G.pendingBets.push({nm, masked: maskName(nm), bet: randomStake(rng), autoPt: randomCashoutTarget(rng), cashedAt: null, won: 0, isUser: false, si: -1});
      added += 2;
    } else added++;
  }
  G.pendingBets.sort(() => rng() - 0.5);
}

function sortBets(G) {
  G.roundBets.sort((a, b) => {
    if (b.bet !== a.bet) return b.bet - a.bet;
    if (a.isUser && !b.isUser) return -1;
    if (!a.isUser && b.isUser) return 1;
    return a.masked.localeCompare(b.masked);
  });
}

function startBetPlacement(G) {
  const totalBets = G.pendingBets.length;
  const totalMs   = 7200; // spread over 7.2s of the 8s wait window
  let elapsed     = 0;

  G.placementInt = setInterval(() => {
    if (!G.pendingBets.length || G.state !== 'wait') {
      clearInterval(G.placementInt); G.placementInt = null; return;
    }
    elapsed += 120;
    const progress = elapsed / totalMs; // 0 → 1

    // Slow start, steady middle, small rush near end
    // batch size: 1 early, 2-3 middle, 4-5 near end
    let batch;
    if (progress < 0.2)      batch = 1;
    else if (progress < 0.6) batch = Math.floor(Math.random() * 2) + 1;
    else if (progress < 0.85)batch = Math.floor(Math.random() * 2) + 2;
    else                     batch = Math.floor(Math.random() * 3) + 3;

    // Occasionally skip a tick entirely (player thinking, not instant)
    if (Math.random() < 0.25 && progress < 0.8) return;

    for (let i = 0; i < batch && G.pendingBets.length; i++) {
      G.roundBets.push(G.pendingBets.shift());
    }
    sortBets(G);
    if (G.onRoundBetsChange) G.onRoundBetsChange('placement');
  }, 120);
}

function stopBetPlacement(G) {
  if (G.placementInt) { clearInterval(G.placementInt); G.placementInt = null; }
  if (G.pendingBets.length) { G.roundBets.push(...G.pendingBets); G.pendingBets = []; sortBets(G); }
}

// Rolling fake cashouts — one ticker per world, completely independent
function startCashoutTicker(G) {
  setInterval(() => {
    if (G.state !== 'fly') return;
    // Followers skip cashout simulation — the leader's state already has it
    let changed = false;
    G.roundBets.forEach(b => {
      if (b.isUser || b.cashedAt !== null) return;
      if (b.autoPt !== null && G.mult >= b.autoPt - 0.04) {
        b.cashedAt = parseFloat(G.mult.toFixed(2));
        b.won      = parseFloat((b.bet * b.cashedAt).toFixed(2));
        changed    = true;
      }
    });
    if (changed && G.onRoundBetsChange) G.onRoundBetsChange('cashout');
  }, 100);
}
startCashoutTicker(window.G_real);
startCashoutTicker(window.G_demo);

// ── Phase functions ───────────────────────────────────────────────────
function doWait(G, dur) {
  G.state = 'wait'; G.waitTimer = dur; G.fillPct = 0;
  G.elapsed = 0; G.lastTs = 0; G.mult = 1.00;

  const newCrash = G.mode === 'demo' ? genCrashDemo() : genCrashReal();
  G.crashAt = Math.min(parseFloat(newCrash), JACKPOT_MAX);

  G.roundBets = []; G.pendingBets = [];
  stopBetPlacement(G);

  const u = PH.getUser();
  G.myBets.forEach((b, i) => {
    if (b.placed) G.roundBets.push({
      nm: u?.username || 'You', masked: u?.username || 'You',
      bet: b.amt, autoPt: b.auto ? parseFloat(b.auto) : null,
      cashedAt: null, won: 0, isUser: true, si: i
    });
  });

  G.myBets.forEach(b => { b.placed = false; b.cashedOut = false; b.active = false; b.won = 0; });

  genRoundBets(G);
  startBetPlacement(G);

  // Auto-bet
  G.myBets.forEach(b => {
    if (!b.autoBet) return;
    if (b.amt < 20) return;
    if (G.mode === 'real' && !PH.getUser()) return;
    if (b.amt > PH.balance()) return;
    PH.deduct(b.amt);
    b.placed = true;
  });

  if (typeof window.updateNavBal === 'function') window.updateNavBal();
  if (G.onWait) G.onWait();

  // Push new-round state to all follower tabs immediately
}

function doFly(G) {
  G.state = 'fly'; G.elapsed = 0; G.lastTs = 0;
  stopBetPlacement(G);
  const u = PH.getUser();
  G.myBets.forEach((b, i) => {
    if (b.placed) {
      b.active = true;
      if (!G.roundBets.find(r => r.isUser && r.si === i))
        G.roundBets.push({
          nm: u?.username || 'You', masked: u?.username || 'You',
          bet: b.amt, autoPt: b.auto ? parseFloat(b.auto) : null,
          cashedAt: null, won: 0, isUser: true, si: i
        });
    }
  });
  sortBets(G);
  if (G.onFly) G.onFly();

  // Push fly event to all follower tabs immediately
}

function doCrash(G) {
  G.state = 'crash';
  G.mult = G.crashAt;
  G.myBets.forEach(b => {
    if (b.active && !b.cashedOut) {
      b.active = false; b.placed = false;
      if (G.mode !== 'demo') {
        PH.saveTxn({type:'bet', amount: b.amt, cashoutAt: null, wonAmount: 0, mode:'real', status:'loss'});
      }
    }
  });

  const recorded = parseFloat(G.crashAt.toFixed(2));
  G.roundHist.unshift(recorded);
  if (G.roundHist.length > 30) G.roundHist.pop();

  try { localStorage.setItem(G.histKey, JSON.stringify(G.roundHist)); } catch(e) {}

  if (G.onCrash) G.onCrash(recorded);

  // Push crash state to all follower tabs immediately (zero lag)

  setTimeout(() => { G.roundNum++; doWait(G, 5000); }, 3200);
}

// ── Game loop ─────────────────────────────────────────────────────────
const TICK_MS = 50;

function _tick(G) {
  if (!G.running) return;
  // In real mode the WebSocket server is the single source of truth.
  // aviator-ws.js sets _serverControlled = true on connect so the local
  // loop never overwrites the server's multiplier.
  if (G._serverControlled) return;
  const dt = TICK_MS;

  if (G.state === 'wait') {
    G.waitTimer -= dt;
    G.fillPct = Math.max(0, 1 - G.waitTimer / 5000);
    if (G.waitTimer <= 0) doFly(G);
  }

  if (G.state === 'fly') {
    G.elapsed += dt;
    G.mult = Math.round(Math.pow(Math.E, G.elapsed / 5800) * 100) / 100;

    G.myBets.forEach((b, i) => {
      if (!b.active || b.cashedOut) return;
      const autoMult = (b.autoOn && b.auto) ? parseFloat(b.auto) : null;
      const maxMult  = Math.floor(2000000 / b.amt);
      const capMult  = Math.min(maxMult, JACKPOT_MAX);
      const shouldCash = (autoMult && G.mult >= autoMult) || G.mult >= capMult;
      if (shouldCash) {
        const won = _doCashoutWorld(G, i);
        if (won && G.onAutoCashout) G.onAutoCashout(i, won);
      }
    });

    if (G.mult >= G.crashAt) doCrash(G);
  }
}

// ── Shared worker — one worker drives both worlds ─────────────────────
let _worker = null;

function _initWorker() {
  if (_worker) return;
  try {
    _worker = new Worker('game-worker.js');
    _worker.onmessage = function(e) {
      if (e.data.type === 'tick') {
        _tick(window.G_real);
        _tick(window.G_demo);
      }
    };
    _worker.onerror = function(err) {
      console.warn('Worker error — falling back to setInterval:', err.message);
      _worker = null;
      _startFallback();
    };
    _worker.postMessage({ cmd: 'start' });
  } catch(e) {
    console.warn('Web Workers not available — using setInterval fallback');
    _startFallback();
  }
}

let _fallbackInterval = null;
function _startFallback() {
  if (_fallbackInterval) return;
  _fallbackInterval = setInterval(() => {
    _tick(window.G_real);
    _tick(window.G_demo);
  }, TICK_MS);
}
function _stopFallback() {
  if (_fallbackInterval) { clearInterval(_fallbackInterval); _fallbackInterval = null; }
}

function startWorld(G) {
  if (G.running) return;
  G.running = true;
  window.genRoundBets      = genRoundBets;
  window.startBetPlacement = startBetPlacement;
  window.stopBetPlacement  = stopBetPlacement;
  if (G.state === 'idle') doWait(G, 5000);
  _initWorker();
}
function stopWorld(G) {
  G.running = false;
}
function stopAllWorlds() {
  window.G_real.running = false;
  window.G_demo.running = false;
  if (_worker) { _worker.postMessage({ cmd: 'stop' }); _worker.terminate(); _worker = null; }
  _stopFallback();
}
function resumeAllWorlds() {
  window.G_real.running = true;
  window.G_demo.running = true;
  _initWorker();
}

function switchWorld() {
  const isDemo = PH.getMode() === 'demo';
  window.G = isDemo ? window.G_demo : window.G_real;
  startWorld(window.G_real);
  startWorld(window.G_demo);
}

// ── Public bet API ────────────────────────────────────────────────────
function G_placeBet(i) {
  const G = window.G;
  const b = G.myBets[i];
  if (b.placed)      return 'already';
  if (b.amt < 20)    return 'min';
  if (b.amt > 20000) return 'max';
  if (G.mode === 'real' && !PH.getUser()) return 'auth';
  if (b.amt > PH.balance()) return 'funds';
  PH.deduct(b.amt); b.placed = true;
  return 'ok';
}

function G_cancelBet(i) {
  const G = window.G, b = G.myBets[i];
  if (!b.placed || b.active) return false;
  PH.credit(b.amt); b.placed = false;
  return true;
}

function _doCashoutWorld(G, i) {
  const b = G.myBets[i];
  if (!b.active || b.cashedOut) return null;
  b.cashedOut = true; b.active = false; b.placed = false;
  b.won = parseFloat((b.amt * G.mult).toFixed(2));
  PH.credit(b.won);
  const rb = G.roundBets.find(r => r.isUser && r.si === i && !r.cashedAt);
  if (rb) { rb.cashedAt = parseFloat(G.mult.toFixed(2)); rb.won = b.won; }
  if (G.mode !== 'demo') {
    PH.saveTxn({type:'bet',  amount: b.amt, cashoutAt: parseFloat(G.mult.toFixed(2)), wonAmount: b.won, mode:'real', status:'win'});
    PH.saveTxn({type:'win',  amount: b.won, mode:'real', status:'completed'});
  }
  if (typeof window.updateNavBal === 'function') window.updateNavBal();
  // Push cashout immediately so all tabs show it
  return b.won;
}

function G_doCashout(i) { return _doCashoutWorld(window.G, i); }

// Expose on window
window.G_placeBet    = G_placeBet;
window.G_cancelBet   = G_cancelBet;
window.G_doCashout   = G_doCashout;
window.switchWorld   = switchWorld;
window.startWorld    = startWorld;
window.stopWorld     = stopWorld;
window.stopAllWorlds  = stopAllWorlds;
window.resumeAllWorlds = resumeAllWorlds;
window.JACKPOT_MAX   = JACKPOT_MAX;
startWorld(window.G_real);
startWorld(window.G_demo);
