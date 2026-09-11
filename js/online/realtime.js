// ============ ONLINE REALTIME SYNC ============
// Authoritative room state:
// - master can change the whole battlefield;
// - player can change only his/her own characters and their tokens;
// - camera (pan/zoom) stays local to each browser.
(function(){
  const online = {
    ws:null,
    meta:null,
    applyingRemote:false,
    lastSignature:'',
    timer:null,
    connected:false,
  };

  function toastSafe(text,type='success'){
    if(typeof toast==='function') toast(text,type);
  }
  function clone(v){ try{return JSON.parse(JSON.stringify(v));}catch{return null;} }
  function isMaster(){ return online.meta?.player?.role === 'master'; }
  function myId(){ return online.meta?.player?.id; }

  function buildSharedState(){
    return {
      version:2,
      map:clone(state.map),
      grid:clone(state.grid),
      tokens:clone(state.tokens),
      characters:clone(state.characters),
      monsters:clone(state.monsters),
      initiative:clone(state.initiative),
      initIndex:state.initIndex,
      initRound:state.initRound,
      nextId:state.nextId,
      shapes:clone(state.shapes),
      drawSettings:clone(state.drawSettings),
      shapeSettings:clone(state.shapeSettings),
      diceHistory:clone(state.diceHistory),
    };
  }
  function buildPlayerPatch(){
    const id=myId();
    const ownChars=state.characters.filter(c=>String(c.ownerId)===String(id));
    const ownIds=new Set(ownChars.map(c=>String(c.id)));
    const ownTokens=state.tokens.filter(t=>t.kind==='character' && ownIds.has(String(t.sourceId)));
    return { version:2, characters:clone(ownChars), characterTokens:clone(ownTokens) };
  }
  function signature(data){ try{return JSON.stringify(data);}catch{return '';} }
  function send(message){
    if(online.ws && online.ws.readyState===WebSocket.OPEN){ online.ws.send(JSON.stringify(message)); return true; }
    return false;
  }

  function sizeMapLayers(){
    const w=Number(state.map.width)||0, h=Number(state.map.height)||0;
    const layer=document.getElementById('map-layer');
    if(layer && w>0 && h>0){ layer.style.width=w+'px'; layer.style.height=h+'px'; }
    ['map-image','grid-canvas','draw-canvas','fog-canvas','shapes-back-canvas','shapes-canvas','tokens-layer'].forEach(id=>{
      const el=document.getElementById(id);
      if(!el || !w || !h) return;
      if(el.tagName==='IMG'){ el.style.width=w+'px'; el.style.height=h+'px'; }
      else { el.width=w; el.height=h; el.style.width=w+'px'; el.style.height=h+'px'; }
    });
  }

  function applyCanvas(data){
    if(!data?.canvas) return;
    const id=data.canvasType==='fog'?'fog-canvas':'draw-canvas';
    const canvas=document.getElementById(id);
    if(!canvas) return;
    const img=new Image();
    img.onload=()=>{
      const ctx=canvas.getContext('2d');
      ctx.clearRect(0,0,canvas.width,canvas.height);
      ctx.drawImage(img,0,0,canvas.width,canvas.height);
    };
    img.src=data.canvas;
  }

  function applyMapImage(src,width,height){
    const img=document.getElementById('map-image');
    const empty=document.getElementById('map-empty');
    if(!img) return;
    if(!src){
      img.onload=null; img.removeAttribute('src'); img.style.display='none';
      if(empty) empty.style.display='flex';
      return;
    }
    img.onload=()=>{
      state.map.width=Number(width)||img.naturalWidth||0;
      state.map.height=Number(height)||img.naturalHeight||0;
      img.style.display='block';
      sizeMapLayers();
      if(empty) empty.style.display='none';
      drawGrid?.(); renderShapes?.(); updateMapTransform?.();
    };
    img.onerror=()=>toastSafe('Не удалось загрузить карту из комнаты','error');
    img.src=src;
  }

  function applySharedState(shared){
    if(!shared || typeof shared!=='object') return;
    online.applyingRemote=true;
    try{
      if(shared.map) state.map=clone(shared.map)||state.map;
      if(shared.grid) state.grid=clone(shared.grid)||state.grid;
      if(Array.isArray(shared.tokens)) state.tokens=shared.tokens;
      if(Array.isArray(shared.characters)) state.characters=shared.characters;
      if(Array.isArray(shared.monsters)) state.monsters=shared.monsters;
      if(Array.isArray(shared.initiative)) state.initiative=shared.initiative;
      if(Number.isFinite(shared.initIndex)) state.initIndex=shared.initIndex;
      if(Number.isFinite(shared.initRound)) state.initRound=shared.initRound;
      if(Number.isFinite(shared.nextId)) state.nextId=shared.nextId;
      if(Array.isArray(shared.shapes)) state.shapes=shared.shapes;
      if(shared.drawSettings) state.drawSettings={...state.drawSettings,...shared.drawSettings};
      if(shared.shapeSettings) state.shapeSettings={...state.shapeSettings,...shared.shapeSettings};
      if(Array.isArray(shared.diceHistory)) state.diceHistory=shared.diceHistory;

      sizeMapLayers();
      if(shared.map?.src) applyMapImage(shared.map.src,shared.map.width,shared.map.height);
      else applyMapImage(null);
      renderAll?.(); drawGrid?.(); renderShapes?.(); updateMapTransform?.();
      online.lastSignature=signature(buildSharedState());
    }finally{
      setTimeout(()=>online.applyingRemote=false,0);
    }
  }

  function publishState(reason='change'){
    if(online.applyingRemote || !online.connected) return;
    if(!isMaster()){
      const patch=buildPlayerPatch();
      const sig=signature(patch);
      if(sig===online.lastSignature) return;
      online.lastSignature=sig;
      send({type:'player_state_update',patch,reason});
      return;
    }
    const shared=buildSharedState();
    const sig=signature(shared);
    if(sig===online.lastSignature) return;
    online.lastSignature=sig;
    send({type:'state_update',state:shared,reason});
  }

  function sendCanvas(canvasType){
    if(online.applyingRemote || !online.connected || !isMaster()) return;
    const canvas=document.getElementById(canvasType==='fog'?'fog-canvas':'draw-canvas');
    if(!canvas) return;
    try{ send({type:'canvas_update',canvasType,canvas:canvas.toDataURL('image/png')}); }catch(e){ console.warn('Canvas sync failed',e); }
  }

  function handleDiceRoll(m){
    if(!m.roll) return;
    const r=m.roll;
    state.diceHistory.unshift({time:r.time||Date.now(),sides:r.sides,modStr:r.modifierStr||r.modStr||'',total:r.total,isCrit:!!r.isCrit,isFail:!!r.isFail,playerName:m.playerName||'Игрок'});
    if(state.diceHistory.length>20) state.diceHistory.length=20;
    showDiceResult?.(r); renderLog?.();
  }

  online.handleConnected=function(ws,meta){
    online.ws=ws; online.meta=meta; online.connected=true;
    // Master immediately publishes his current local game. Players wait for snapshot.
    online.lastSignature=isMaster()?'':signature(buildPlayerPatch());
    if(isMaster()) publishState('master_connect');
    if(!online.timer) online.timer=setInterval(()=>publishState('periodic'),500);
    toastSafe(isMaster()?'Вы подключились как мастер':'Вы подключились как игрок');
  };
  online.handleDisconnected=function(){
    online.connected=false; online.ws=null;
    if(online.timer){clearInterval(online.timer);online.timer=null;}
  };
  online.handleMessage=function(m){
    if(m.type==='state_snapshot'){
      if(m.from && myId() && String(m.from)===String(myId())) return;
      applySharedState(m.state||{}); return;
    }
    if(m.type==='canvas_update'){
      if(m.from && myId() && String(m.from)===String(myId())) return;
      applyCanvas(m); return;
    }
    if(m.type==='dice_roll'){
      if(m.from && myId() && String(m.from)===String(myId())) return;
      handleDiceRoll(m); return;
    }
    if(m.type==='permission_error') toastSafe(m.message||'Недостаточно прав','error');
  };
  online.publishState=publishState;
  online.sendCanvas=sendCanvas;
  online.sendDice=function(result){
    if(!online.connected) return;
    send({type:'dice_roll',playerName:online.meta?.player?.name||'Игрок',roll:{...result,time:Date.now(),modifierStr:result.modifierStr||''}});
  };
  window.DND_ONLINE=online;
  window.dndOnlineSync=publishState;
  window.dndOnlineCanvasSync=sendCanvas;
  window.addEventListener('beforeunload',()=>{ if(online.connected && isMaster()) publishState('beforeunload'); });
})();
