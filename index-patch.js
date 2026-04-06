/* ============================================================
   PATCH FOR index.html — add these 3 functions after
   the existing openFortuneSpinModal() function block
   ============================================================ */

// FIND this existing function in index.html:
//   function openFortuneSpinModal(){ ... }

// ADD these 3 functions immediately AFTER it:

function openRocketCrashModal(){
  _pendingGame='rocket';
  const user=PH.getUser();
  document.getElementById('gm-title').textContent='🚀 Rocket Crash';
  document.getElementById('gm-sub').textContent=user
    ?'Balance: '+PH.fmt(PH.getWallet())+'  ·  Demo: '+PH.fmt(PH.getDemoBal())
    :'Real Play requires login';
  openModal('game-mode-modal');
}

function openDiceModal(){
  _pendingGame='dice';
  const user=PH.getUser();
  document.getElementById('gm-title').textContent='🎲 Dice Roll';
  document.getElementById('gm-sub').textContent=user
    ?'Balance: '+PH.fmt(PH.getWallet())+'  ·  Demo: '+PH.fmt(PH.getDemoBal())
    :'Real Play requires login';
  openModal('game-mode-modal');
}

function openMinesModal(){
  _pendingGame='mines';
  const user=PH.getUser();
  document.getElementById('gm-title').textContent='💣 Mines';
  document.getElementById('gm-sub').textContent=user
    ?'Balance: '+PH.fmt(PH.getWallet())+'  ·  Demo: '+PH.fmt(PH.getDemoBal())
    :'Real Play requires login';
  openModal('game-mode-modal');
}

/* ============================================================
   ALSO UPDATE pickGameMode() — find the existing function:

   function pickGameMode(m){
     if(m==='play'&&!PH.getUser()){closeModal('game-mode-modal');openModal('login-modal');return;}
     PH.setMode(m); if(m==='demo') PH.resetDemo();
     closeModal('game-mode-modal'); updateNavBal(); renderNav();
     if(_pendingGame==='fortunespin') launchFortuneSpin();
     _pendingGame=null;
   }

   REPLACE the entire function with this:
   ============================================================ */

function pickGameMode(m){
  if(m==='play'&&!PH.getUser()){closeModal('game-mode-modal');openModal('login-modal');return;}
  PH.setMode(m); if(m==='demo') PH.resetDemo();
  closeModal('game-mode-modal'); updateNavBal(); renderNav();
  if(_pendingGame==='fortunespin'){
    launchFortuneSpin();
  } else if(_pendingGame==='rocket'||_pendingGame==='dice'||_pendingGame==='mines'){
    // Navigate to Bets tab and pre-select the correct game pill
    const game=_pendingGame;
    navTo('bets');
    setTimeout(()=>{
      try{
        const fr=document.getElementById('fr-bets');
        if(fr&&fr.contentWindow&&fr.contentWindow.setGame){
          fr.contentWindow.setGame(game);
        } else {
          // fallback: click the pill directly
          const pill=fr&&fr.contentWindow&&fr.contentWindow.document.getElementById('gp-'+game);
          if(pill) pill.click();
        }
      }catch(e){}
    },150);
  }
  _pendingGame=null;
}
