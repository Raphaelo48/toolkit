// ============ ONLINE REALTIME SYNC ============
// Synchronizes map, tokens, shapes, characters, monsters, initiative and dice.
// Uses WebSocket for live changes and PostgreSQL-backed room_state on the server.
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

  function clone(v){
    try{return JSON.parse(JSON.stringify(v));}catch{return null;}
  }

  // Do not synchronize local-only UI state (selected token, pan/zoom, collapsed panels, modal data).
  function buildSharedState(){
    const shared={
      version: 1,
      map: clone(state.map),
      grid: clone(state.grid),
      tokens: clone(state.tokens),
      characters: clone(state.characters),
      monsters: clone(state.monsters),
      initiative: clone(state.initiative),
      initIndex: state.initIndex,
      initRound: state.initRound,
      nextId: state.nextId,
      shapes: clone(state.shapes),
      drawSettings: clone(state.drawSettings),
      shapeSettings: clone(state.shapeSettings),
      diceHistory: clone(state.diceHistory),
    };
    return shared;
  }

  function signature(data){
    try{return JSON.stringify(data);}
    catch{return '';}
  }

  function send(message){
    if(online.ws && online.ws.readyState===WebSocket.OPEN){
      online.ws.send(JSON.stringify(message));
      return true;
    }
    return false;
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
      ctx.drawImage(img,0,0);
    };
    img.src=data.canvas;
  }

  function applySharedState(shared){
    if(!shared) return;
    online.applyingRemote=true;
    try{
      state.map=shared.map||state.map;
      state.grid=shared.grid||state.grid;
      state.tokens=Array.isArray(shared.tokens)?shared.tokens:[];
      state.characters=Array.isArray(shared.characters)?shared.characters:[];
      state.monsters=Array.isArray(shared.monsters)?shared.monsters:[];
      state.initiative=Array.isArray(shared.initiative)?shared.initiative:[];
      state.initIndex=Number.isFinite(shared.initIndex)?shared.initIndex:0;
      state.initRound=Number.isFinite(shared.initRound)?shared.initRound:1;
      state.nextId=Number.isFinite(shared.nextId)?shared.nextId:1;
      state.shapes=Array.isArray(shared.shapes)?shared.shapes:[];
      state.drawSettings={...state.drawSettings,...(shared.drawSettings||{})};
      state.shapeSettings={...state.shapeSettings,...(shared.shapeSettings||{})};
      state.diceHistory=Array.isArray(shared.diceHistory)?shared.diceHistory:[];

      if(typeof renderAll==='function') renderAll();
      if(typeof drawGrid==='function') drawGrid();
      if(typeof renderShapes==='function') renderShapes();
      if(typeof updateMapTransform==='function') updateMapTransform();

      if(shared.map?.src){
        const img=document.getElementById('map-image');
        if(img && img.src!==shared.map.src){
          img.onload=()=>{
            state.map.width=img.naturalWidth||shared.map.width||0;
            state.map.height=img.naturalHeight||shared.map.height||0;
            img.style.display='block';
            ['grid-canvas','draw-canvas','fog-canvas','shapes-back-canvas','shapes-canvas'].forEach(id=>{
              const c=document.getElementById(id);
              if(c){c.width=state.map.width;c.height=state.map.height;}
            });
            document.getElementById('map-empty')?.style && (document.getElementById('map-empty').style.display='none');
            if(typeof drawGrid==='function') drawGrid();
            if(typeof renderShapes==='function') renderShapes();
          };
          img.src=shared.map.src;
        }
      }else{
        const img=document.getElementById('map-image');
        const empty=document.getElementById('map-empty');
        if(img) img.style.display='none';
        if(empty) empty.style.display='flex';
      }
    }finally{
      online.lastSignature=signature(buildSharedState());
      setTimeout(()=>{online.applyingRemote=false;},0);
    }
  }

  function publishState(reason='change'){
    if(online.applyingRemote || !online.connected) return;
    const shared=buildSharedState();
    const sig=signature(shared);
    if(sig===online.lastSignature) return;
    online.lastSignature=sig;
    send({type:'state_update',state:shared,reason});
  }

  function sendCanvas(canvasType){
    if(online.applyingRemote || !online.connected) return;
    const canvas=document.getElementById(canvasType==='fog'?'fog-canvas':'draw-canvas');
    if(!canvas) return;
    try{
      send({type:'canvas_update',canvasType,canvas:canvas.toDataURL('image/png')});
    }catch(e){
      console.warn('Canvas sync failed',e);
    }
  }

  function handleDiceRoll(m){
    if(!m.roll) return;
    // Do not add the remote roll twice: it is already in the sender's history.
    const r=m.roll;
    state.diceHistory.unshift({
      time:r.time||Date.now(),
      sides:r.sides,
      modStr:r.modifierStr||r.modStr||'',
      total:r.total,
      isCrit:!!r.isCrit,
      isFail:!!r.isFail,
      playerName:m.playerName||'Игрок'
    });
    if(state.diceHistory.length>20) state.diceHistory.length=20;

    if(typeof showDiceResult==='function'){
      showDiceResult(r);
    }
    if(typeof renderLog==='function') renderLog();
  }

  online.handleConnected=function(ws,meta){
    online.ws=ws;
    online.meta=meta;
    online.connected=true;
    online.lastSignature=signature(buildSharedState());
    // The server sends state_snapshot immediately after connection.
    if(!online.timer){
      online.timer=setInterval(()=>publishState('periodic'),700);
    }
    toastSafe('Онлайн-синхронизация подключена');
  };

  online.handleDisconnected=function(){
    online.connected=false;
    online.ws=null;
    if(online.timer){clearInterval(online.timer);online.timer=null;}
  };

  online.handleMessage=function(m){
    if(m.type==='state_snapshot'){
      // The sender receives its own state back too; applying it is harmless,
      // but skip it when it is clearly our own broadcast.
      if(m.from && online.meta?.player?.id && String(m.from)===String(online.meta.player.id)) return;
      applySharedState(m.state);
      return;
    }
    if(m.type==='canvas_update'){
      if(m.from && online.meta?.player?.id && String(m.from)===String(online.meta.player.id)) return;
      applyCanvas(m);
      return;
    }
    if(m.type==='dice_roll'){
      if(m.from && online.meta?.player?.id && String(m.from)===String(online.meta.player.id)) return;
      handleDiceRoll(m);
      return;
    }
  };

  online.publishState=publishState;
  online.sendCanvas=sendCanvas;
  online.sendDice=function(result){
    if(!online.connected) return;
    send({
      type:'dice_roll',
      playerName:online.meta?.player?.name||'Игрок',
      roll:{...result,time:Date.now(),modifierStr:result.modifierStr||''}
    });
  };

  window.DND_ONLINE=online;

  // Public hooks for existing code.
  window.dndOnlineSync=publishState;
  window.dndOnlineCanvasSync=sendCanvas;

  // Detect changes made by existing app code without rewriting every function.
  // This is intentionally low-frequency and only sends when state actually changed.
  window.addEventListener('beforeunload',()=>{
    if(online.connected) publishState('beforeunload');
  });
})();
