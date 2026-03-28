// ─── PepetaHigh Utils ────────────────────────────────────────────────
const PH = {
  getUser:    () => { try { return JSON.parse(sessionStorage.getItem('ph_user')); } catch { return null; } },
  setUser:    (u) => sessionStorage.setItem('ph_user', JSON.stringify(u)),
  clearUser:  () => ['ph_user','ph_wallet','ph_demo','ph_mode','ph_txns'].forEach(k => sessionStorage.removeItem(k)),
  getWallet:  () => parseFloat(sessionStorage.getItem('ph_wallet') || '0'),
  setWallet:  (v) => sessionStorage.setItem('ph_wallet', Math.max(0, parseFloat(v)).toFixed(2)),
  getMode:    () => sessionStorage.getItem('ph_mode') || 'play',
  setMode:    (m) => sessionStorage.setItem('ph_mode', m),
  getDemoBal: () => parseFloat(sessionStorage.getItem('ph_demo') || '5000'),
  setDemoBal: (v) => sessionStorage.setItem('ph_demo', Math.max(0, parseFloat(v)).toFixed(2)),
  resetDemo:  () => sessionStorage.setItem('ph_demo', '5000'),
  balance:    () => PH.getMode() === 'demo' ? PH.getDemoBal() : PH.getWallet(),
  deduct:     (a) => { if (PH.getMode() === 'demo') PH.setDemoBal(PH.getDemoBal() - a); else PH.setWallet(PH.getWallet() - a); },
  credit:     (a) => { if (PH.getMode() === 'demo') PH.setDemoBal(PH.getDemoBal() + a); else PH.setWallet(PH.getWallet() + a); },
  fmt:        (v) => 'KSh ' + parseFloat(v).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  getTxns:    () => { try { return JSON.parse(sessionStorage.getItem('ph_txns') || '[]'); } catch { return []; } },
  saveTxn:    (t) => { const a = PH.getTxns(); a.unshift({ ...t, ts: Date.now(), id: 'T' + Date.now() }); sessionStorage.setItem('ph_txns', JSON.stringify(a.slice(0, 150))); },
};

// ─── Player Count ────────────────────────────────────────────────────
const PlayerCount = (() => {
  const TIERS = [{ min:5500, max:8000 }, { min:3000, max:5800 }, { min:1500, max:3200 }];
  let tier = 0, current = 6200, target = 6200, ticks = 0;
  const tlen = () => Math.floor(Math.random() * 180) + 120;
  let tLen = tlen();
  return {
    next() {
      ticks++;
      if (ticks >= tLen) { tier = Math.max(0, Math.min(2, tier + (Math.random() < .5 ? 1 : -1))); tLen = tlen(); ticks = 0; }
      const t = TIERS[tier];
      if (Math.random() < .12) target = t.min + Math.floor(Math.random() * (t.max - t.min));
      const diff = target - current;
      current = Math.max(t.min, Math.min(t.max, current + Math.sign(diff) * Math.min(Math.abs(diff), Math.floor(Math.random() * 35) + 10)));
      return current;
    },
    get() { return current; }
  };
})();

// ─── Toast ────────────────────────────────────────────────────────────
function showToast(msg, type = 'info', dur = 3200) {
  let c = document.getElementById('_tc');
  if (!c) { c = document.createElement('div'); c.id = '_tc'; c.style.cssText = 'position:fixed;bottom:72px;right:12px;z-index:9999;display:flex;flex-direction:column;gap:7px;pointer-events:none;'; document.body.appendChild(c); }
  const cols = { success:'#29d980', error:'#f24e4e', info:'#4f6ef7', warning:'#f5c542' };
  const ics  = { success:'✓', error:'✕', info:'i', warning:'!' };
  const t = document.createElement('div');
  t.style.cssText = `background:#141520;border:1px solid ${cols[type]};border-left:3px solid ${cols[type]};border-radius:9px;padding:10px 13px;font-size:.8rem;color:#eef0ff;display:flex;align-items:center;gap:9px;max-width:280px;animation:fadeInUp .28s ease;box-shadow:0 6px 20px rgba(0,0,0,.5);pointer-events:auto;font-family:'Exo 2',sans-serif;`;
  t.innerHTML = `<span style="width:17px;height:17px;border-radius:50%;background:${cols[type]};display:flex;align-items:center;justify-content:center;font-size:.62rem;color:#000;font-weight:700;flex-shrink:0">${ics[type]}</span><span>${msg}</span>`;
  c.appendChild(t);
  setTimeout(() => { t.style.transition = 'opacity .4s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 420); }, dur);
}

// ─── Fake phone numbers ───────────────────────────────────────────────
// Format: [prefix][4 digits][last digit]
// Kenya (254) is common; other prefixes appear rarely (~15% of players)
const _PREFIXES = [
  {p:'254', w:0.85},  // Kenya — majority
  {p:'255', w:0.04},  // Tanzania
  {p:'256', w:0.03},  // Uganda
  {p:'251', w:0.02},  // Ethiopia
  {p:'234', w:0.03},  // Nigeria
  {p:'27',  w:0.02},  // South Africa
  {p:'44',  w:0.01},  // UK
];
function _pickPrefix(){
  const r=Math.random(); let cum=0;
  for(const {p,w} of _PREFIXES){ cum+=w; if(r<cum) return p; }
  return '254';
}
function fakeName(){
  const prefix=_pickPrefix();
  // Middle 4 digits random
  const mid=String(Math.floor(Math.random()*9000)+1000);
  // Last digit 0-9
  const last=String(Math.floor(Math.random()*10));
  return prefix+mid+last;
}
// maskName: keep first char (prefix initial) + mask middle + show last digit
// e.g. 254712349 → 2***9,  447123456 → 4***6
function maskName(n){
  if(!n||n.length<2) return (n||'?')+'***';
  return n[0]+'***'+n[n.length-1];
}
// fakeInitial: derives a letter A-Z from a phone number for the avatar circle
// Uses a simple sum of char codes mod 26 so the same number always gives the same letter
function fakeInitial(n){
  if(!n) return '?';
  let s=0; for(let i=0;i<n.length;i++) s+=n.charCodeAt(i);
  return String.fromCharCode(65+(s%26));
}

// ─── Base animations ──────────────────────────────────────────────────
(()=>{ const s=document.createElement('style'); s.textContent=`@keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}@keyframes fadeInUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}@keyframes spin{to{transform:rotate(360deg)}}`; document.head.appendChild(s); })();
