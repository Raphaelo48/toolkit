// ============ ONLINE REALTIME SYNC ============
// Сервер хранит состояние комнаты и нумерует каждое изменение (version).
// - мастер меняет всё поле боя; игрок — только своих персонажей, их токены и инвентарь;
// - картинка карты, рисунки и туман передаются отдельно и только когда меняются;
// - камера (сдвиг/масштаб) у каждого своя;
// - пока пользователь тянет токен или рисует, входящие изменения ждут окончания действия.
(function(){
  const online = {
    ws:null, meta:null, connected:false,
    version:0,              // последняя известная версия состояния комнаты
    applyingRemote:false,
    lastSignature:'',       // что мы последний раз отправили/получили
    pending:null,           // снимок, отложенный до окончания перетаскивания/рисования
    roomEmpty:false,
    welcomed:false,
    dirtyOffline:false,     // были изменения, пока не было связи
    canvasDirty:{ draw:false, fog:false },
    canvasCache:{ draw:null, fog:null },
    mapSent:null,           // какая картинка карты уже есть на сервере
    synced:false,           // уже получали состояние этой комнаты
    replaceNext:false,      // следующая отправка заменяет состояние комнаты целиком (загрузка сохранения)
    publishTimer:null, periodicTimer:null, pingTimer:null, canvasTimers:{},
    seq:0
  };

  const PUBLISH_DEBOUNCE_MS = 120;
  const PERIODIC_CHECK_MS = 3000;
  const CANVAS_DEBOUNCE_MS = 250;

  const toastSafe = (text, type='success') => { if(typeof toast === 'function') toast(text, type); };
  const clone = v => { try{ return v == null ? v : JSON.parse(JSON.stringify(v)); }catch{ return null; } };
  const isMaster = () => online.meta?.player?.role === 'master';
  const myId = () => online.meta?.player?.id;
  const ready = () => online.connected && online.welcomed;
  const busy = () => !!(state.draggingToken || state.isDrawing || state.shapeStart || state.arrowMoving);

  function send(message){
    if(online.ws && online.ws.readyState === WebSocket.OPEN){
      online.ws.send(JSON.stringify(message));
      return true;
    }
    return false;
  }

  /* ---------- что отправляем ---------- */

  function buildSharedState(){
    const map = clone(state.map) || {};
    delete map.src; // картинка карты передаётся отдельным сообщением
    return {
      version:3,
      map,
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
      party:clone(state.party || {}),
      vision:clone(state.vision || {}),
      boards:clone(state.boards || []),
      eventLog:clone(state.eventLog),
    };
  }

  function buildPlayerPatch(){
    const id = String(myId());
    const ownChars = state.characters.filter(c => String(c.ownerId) === id);
    const ownIds = new Set(ownChars.map(c => String(c.id)));
    const ownTokens = state.tokens.filter(t => t.kind === 'character' && ownIds.has(String(t.sourceId)));
    // Вещи и деньги меняются только действиями инвентаря (см. sendInventoryAction), в патч не входят
    const chars = clone(ownChars).map(c => { delete c.inventory; delete c.coins; return c; });
    return { characters:chars, characterTokens:clone(ownTokens) };
  }

  const signature = data => { try{ return JSON.stringify(data); }catch{ return ''; } };
  const currentSignature = () => signature(isMaster() ? buildSharedState() : buildPlayerPatch());

  /* ---------- отправка ---------- */

  function publishState(reason='change'){
    if(online.applyingRemote) return;
    // Загруженное сохранение заменяет на сервере всё, включая инвентари
    if(reason === 'load_game' && isMaster()) online.replaceNext = true;
    clearTimeout(online.publishTimer);
    online.publishTimer = setTimeout(() => publishNow(reason), PUBLISH_DEBOUNCE_MS);
  }

  function publishNow(reason='change', force=false){
    clearTimeout(online.publishTimer);
    online.publishTimer = null;
    if(online.applyingRemote || !online.meta) return false;
    if(isMaster()) syncMapImage();
    const payload = isMaster() ? buildSharedState() : buildPlayerPatch();
    const sig = signature(payload);
    if(!force && sig === online.lastSignature) return false;
    if(!ready()){ if(online.synced) online.dirtyOffline = true; return false; }

    const replace = !!online.replaceNext;
    const message = isMaster()
      ? { type:'state_update', state:payload, baseVersion:online.version, seq:++online.seq, reason, replace }
      : { type:'player_state_update', patch:payload, baseVersion:online.version, seq:++online.seq, reason };
    if(!send(message)){ if(online.synced) online.dirtyOffline = true; return false; }
    online.lastSignature = sig;
    online.replaceNext = false;
    // Отложенный снимок устарел: сервер пришлёт итог слияния, если наша версия была не последней
    online.pending = null;
    return true;
  }

  function syncMapImage(){
    if(!isMaster() || !ready()) return;
    const src = state.map?.src || null;
    if(src === online.mapSent) return;
    if(send({ type:'map_image', src })) online.mapSent = src;
  }

  function sendCanvas(canvasType){
    if(!online.meta || !isMaster() || online.applyingRemote) return;
    const type = canvasType === 'fog' ? 'fog' : 'draw';
    clearTimeout(online.canvasTimers[type]);
    online.canvasTimers[type] = setTimeout(() => sendCanvasNow(type), CANVAS_DEBOUNCE_MS);
  }

  function sendCanvasNow(type){
    const canvas = document.getElementById(type === 'fog' ? 'fog-canvas' : 'draw-canvas');
    if(!canvas) return;
    let data = null;
    try{ data = isCanvasBlank(canvas) ? null : canvas.toDataURL('image/png'); }catch(e){ console.warn('Canvas sync failed', e); return; }
    online.canvasCache[type] = data;
    if(!ready() || !send({ type:'canvas_update', canvasType:type, canvas:data })) online.canvasDirty[type] = true;
    else online.canvasDirty[type] = false;
  }

  function isCanvasBlank(canvas){
    if(!canvas.width || !canvas.height) return true;
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    for(let i = 3; i < data.length; i += 4) if(data[i] !== 0) return false;
    return true;
  }

  /* ---------- применение входящего ---------- */

  function sizeMapLayers(){
    const w = Number(state.map.width) || 0, h = Number(state.map.height) || 0;
    if(!w || !h) return false;
    let resized = false;
    const layer = document.getElementById('map-layer');
    if(layer){ layer.style.width = w + 'px'; layer.style.height = h + 'px'; }
    ['map-image','grid-canvas','draw-canvas','fog-canvas','shapes-back-canvas','shapes-canvas','tokens-layer'].forEach(id => {
      const el = document.getElementById(id);
      if(!el) return;
      el.style.width = w + 'px'; el.style.height = h + 'px';
      // Менять width/height холста только при реальном изменении размера: это стирает рисунок
      if(el.tagName === 'CANVAS' && (el.width !== w || el.height !== h)){ el.width = w; el.height = h; resized = true; }
    });
    if(resized){ drawCanvasFromCache('draw'); drawCanvasFromCache('fog'); }
    return resized;
  }

  function drawCanvasFromCache(type){
    const canvas = document.getElementById(type === 'fog' ? 'fog-canvas' : 'draw-canvas');
    if(!canvas) return;
    const data = online.canvasCache[type];
    const ctx = canvas.getContext('2d');
    if(!data){ ctx.clearRect(0, 0, canvas.width, canvas.height); return; }
    const img = new Image();
    img.onload = () => {
      if(online.canvasCache[type] !== data) return; // пока грузилось, пришло более новое
      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      ctx.restore();
    };
    img.src = data;
  }

  function applyMapImage(src){
    const img = document.getElementById('map-image');
    const empty = document.getElementById('map-empty');
    if(!img) return;
    if(!src){
      img.onload = null; img.removeAttribute('src'); img.style.display = 'none';
      if(empty) empty.style.display = 'flex';
      return;
    }
    if(img.getAttribute('src') === src && img.complete){ img.style.display = 'block'; if(empty) empty.style.display = 'none'; return; }
    img.onload = () => {
      state.map.width = img.naturalWidth || state.map.width;
      state.map.height = img.naturalHeight || state.map.height;
      img.style.display = 'block';
      if(empty) empty.style.display = 'none';
      sizeMapLayers();
      drawGrid?.(); renderShapes?.(); updateMapTransform?.();
    };
    img.onerror = () => toastSafe('Не удалось загрузить карту из комнаты', 'error');
    img.src = src;
  }

  function applySharedState(shared){
    if(!shared || typeof shared !== 'object') return;
    online.applyingRemote = true;
    try{
      if(shared.map){
        const src = state.map?.src; // картинка приходит отдельно — не трогаем
        state.map = { ...clone(shared.map), src };
      }
      if(shared.grid) state.grid = clone(shared.grid) || state.grid;
      if(Array.isArray(shared.tokens)) state.tokens = shared.tokens;
      if(Array.isArray(shared.characters)) state.characters = shared.characters;
      if(Array.isArray(shared.monsters)) state.monsters = shared.monsters;
      if(Array.isArray(shared.initiative)) state.initiative = shared.initiative;
      if(Number.isFinite(shared.initIndex)) state.initIndex = shared.initIndex;
      if(Number.isFinite(shared.initRound)) state.initRound = shared.initRound;
      if(Number.isFinite(shared.nextId)) state.nextId = Math.max(state.nextId || 1, shared.nextId);
      if(Array.isArray(shared.shapes)) state.shapes = shared.shapes;
      if(shared.drawSettings && isMaster() === false) state.drawSettings = { ...state.drawSettings, ...shared.drawSettings };
      if(shared.shapeSettings && isMaster() === false) state.shapeSettings = { ...state.shapeSettings, ...shared.shapeSettings };
      if(Array.isArray(shared.diceHistory)) state.diceHistory = shared.diceHistory;
      if(Array.isArray(shared.eventLog)) state.eventLog = shared.eventLog;
      if(shared.party && typeof shared.party === 'object') state.party = shared.party;
      if(shared.vision && typeof shared.vision === 'object') state.vision = shared.vision;
      state.rollRequests = Array.isArray(shared.rollRequests) ? shared.rollRequests : [];
      if(Array.isArray(shared.boards)) state.boards = shared.boards;
      if(shared.inventory) state.inventory = shared.inventory; // старый формат
      window.InventoryCore?.migrate(state);
      if(state.selectedTokenId != null && !state.tokens.some(t => t.id === state.selectedTokenId)) state.selectedTokenId = null;

      sizeMapLayers();
      renderAll?.(); drawGrid?.(); renderShapes?.(); updateMapTransform?.(); renderLogFilters?.(); renderLog?.();
      window.dndInventoryRefresh?.();
      window.renderVisionPanel?.(); window.dndVisionRender?.(); window.dndBoardsChanged?.(); window.renderRollRequests?.(); window.updateDiceRerollButton?.();
      online.lastSignature = currentSignature();
    } catch(err){
      console.error('[D&D Online] apply state failed', err);
    } finally {
      online.applyingRemote = false;
    }
  }

  function handleSnapshot(m){
    const version = Number(m.version) || 0;

    if(m.initial){
      online.welcomed = true;
      const wasSynced = online.synced;
      online.synced = true;
      if(isMaster() && online.roomEmpty && hasLocalContent()){
        // Пустая комната — заполняем её тем, что у мастера на экране
        online.version = version;
        seedRoomFromLocal();
        return;
      }
      if(wasSynced && online.dirtyOffline){
        // Пока не было связи, что-то меняли — отправляем, сервер аккуратно сольёт с чужими изменениями
        online.dirtyOffline = false;
        if(publishNow('reconnect', true)) { resendDirtyCanvases(); return; }
      }
      online.version = version;
      online.pending = null;
      applySharedState(m.state || {});
      resendDirtyCanvases();
      return;
    }

    if(m.resync){
      // Сервер отклонил наше действие — возвращаемся к его состоянию
      online.version = Math.max(online.version, version);
      online.pending = null;
      applySharedState(m.state || {});
      return;
    }
    if(version && version <= online.version) return; // устаревший снимок
    if(busy()){ online.pending = m; return; }
    // Есть ещё не отправленные свои изменения — сначала отправляем их. Наша версия старше
    // этого снимка, поэтому сервер сольёт изменения и пришлёт итог; этот снимок пропускаем.
    if((online.publishTimer || currentSignature() !== online.lastSignature) && publishNow('flush_before_apply')) return;
    online.version = Math.max(online.version, version);
    applySharedState(m.state || {});
  }

  function hasLocalContent(){
    return !!(state.map?.src || state.tokens?.length || state.characters?.length || state.monsters?.length || state.shapes?.length);
  }

  function seedRoomFromLocal(){
    online.mapSent = undefined; // заставить отправить картинку карты
    online.replaceNext = true;  // комната пустая — наше состояние целиком, с инвентарями
    publishNow('seed', true);
    sendCanvasNow('draw');
    sendCanvasNow('fog');
    const walls = window.visionSaveData?.();
    if(walls) send({ type:'vision_walls', walls });
    window.dndBoardsResend?.();
    toastSafe('Комната заполнена текущей картой и токенами');
  }

  function resendDirtyCanvases(){
    if(!isMaster()) return;
    if(online.canvasDirty.draw) sendCanvasNow('draw');
    if(online.canvasDirty.fog) sendCanvasNow('fog');
  }

  function flushPending(){
    if(!online.pending || busy()) return;
    const m = online.pending;
    online.pending = null;
    handleSnapshot(m);
  }
  // После отпускания мыши: сначала свои изменения уходят на сервер (их отправляет код карты),
  // затем применяется отложенный чужой снимок, если он ещё актуален.
  window.addEventListener('mouseup', () => setTimeout(flushPending, 0));
  window.addEventListener('blur', () => setTimeout(flushPending, 0));

  function handleDiceRoll(m){
    if(!m.roll) return;
    const r = m.roll;
    // Бросок сделал сервер (по запросу мастера, атака): история и журнал придут в снимке состояния
    if(m.serverRoll){
      // Чужой бросок по запросу — короткое уведомление (итоги у мастера в панели), свой — окно с кубиком
      const mine = String(m.from) === String(online.meta?.player?.id);
      if(m.fromRequest && !mine){ toast?.(`${r.title} = ${r.total}${r.isCrit ? ' 🌟' : r.isFail ? ' 💀' : ''}`); return; }
      const ctx = !mine ? { type:'view' }
        : m.fromRequest ? { type:'request', id:m.requestId, charId:m.charId }
        : m.attack ? { type:'attack', charId:m.attack.charId, slot:m.attack.slot } : { type:'view' };
      showDiceResult?.(r, ctx); return;
    }
    state.diceHistory.unshift({ time:r.time || Date.now(), sides:r.sides, modStr:r.modifierStr || r.modStr || '', total:r.total, isCrit:!!r.isCrit, isFail:!!r.isFail, playerName:m.playerName || 'Игрок' });
    if(state.diceHistory.length > 20) state.diceHistory.length = 20;
    if(Number(m.version) > online.version && !online.pending) online.version = Number(m.version);
    showDiceResult?.(r, { type:'view' });
    const mod = r.modifierStr || r.modStr || '';
    online.applyingRemote = true;
    try{ logEvent?.('dice', `🎲 ${m.playerName || 'Игрок'}: d${r.sides} = ${r.total}${mod ? ` (${mod})` : ''}`); }
    finally{ online.applyingRemote = false; }
  }

  /* ---------- жизненный цикл соединения ---------- */

  online.handleConnected = function(ws, meta){
    online.ws = ws;
    online.meta = meta;
    online.connected = true;
    online.welcomed = false;
    if(!online.periodicTimer) online.periodicTimer = setInterval(() => { if(!busy()) publishNow('periodic'); }, PERIODIC_CHECK_MS);
    clearInterval(online.pingTimer);
    online.pingTimer = setInterval(() => send({ type:'ping' }), 25000);
  };

  online.handleDisconnected = function(){
    if(online.connected && online.synced && currentSignature() !== online.lastSignature) online.dirtyOffline = true;
    online.connected = false;
    online.welcomed = false;
    online.ws = null;
    clearInterval(online.pingTimer); online.pingTimer = null;
  };

  online.handleMessage = function(m){
    switch(m.type){
      case 'welcome': {
        const roomChanged = online.meta?.room && online.joinedRoomId !== online.meta.room.id;
        if(roomChanged){
          // Новая комната — забываем всё, что относилось к прошлой
          online.joinedRoomId = online.meta.room.id;
          online.version = 0; online.lastSignature = ''; online.dirtyOffline = false; online.synced = false;
          online.mapSent = null; online.canvasCache = { draw:null, fog:null }; online.canvasDirty = { draw:false, fog:false };
        }
        if(m.player && online.meta) online.meta.player = { ...online.meta.player, ...m.player };
        online.roomEmpty = !!m.roomEmpty;
        if(roomChanged) toastSafe(isMaster() ? 'Вы подключились как мастер' : 'Вы подключились как игрок');
        else toastSafe('Связь восстановлена');
        return;
      }
      case 'state_snapshot':
        handleSnapshot(m);
        return;
      case 'ack':
        if(Number(m.version) > online.version) online.version = Number(m.version);
        return;
      case 'map_image':
        // Мастер заходит в пустую комнату со своей картой — не стираем её, она уйдёт на сервер
        if(!m.src && isMaster() && online.roomEmpty && state.map?.src) return;
        state.map.src = m.src || null;
        online.mapSent = m.src || null;
        applyMapImage(m.src || null);
        return;
      case 'canvas_update': {
        const type = m.canvasType === 'fog' ? 'fog' : 'draw';
        online.canvasCache[type] = m.canvas || null;
        online.canvasDirty[type] = false;
        drawCanvasFromCache(type);
        return;
      }
      case 'dice_roll':
        handleDiceRoll(m);
        return;
      case 'initiative_rolled': {
        const e = m.entry || {};
        const sign = e.mod ? (e.mod > 0 ? ` + ${e.mod}` : ` − ${-e.mod}`) : '';
        toastSafe(`⚡ ${e.name}: инициатива ${e.value} (d20 ${e.roll}${sign})`);
        return;
      }
      case 'roll_requested':
        window.dndRollRequested?.(m.request);
        return;
      case 'board_image':
        window.dndBoardImage?.(m);
        return;
      case 'vision_walls':
        window.dndVisionSetWalls?.(m);
        return;
      case 'vision':
        window.dndVisionSetMasks?.(m);
        return;
      case 'action_error':
        toastSafe(m.message || 'Действие не выполнено', 'error');
        return;
      case 'permission_error':
        toastSafe(m.message || 'Недостаточно прав', 'error');
        return;
    }
  };

  /* ---------- API для остального кода ---------- */

  online.publishState = publishState;
  online.flushPending = () => setTimeout(flushPending, 0);
  online.sendCanvas = sendCanvas;
  online.sendRollRequest = request => ready() && send({ type:'roll_request_create', request });
  online.closeRollRequest = id => ready() && send({ type:'roll_request_close', id });
  online.rollForRequest = (id, charId, mod) => ready() && send({ type:'roll_request_roll', id, charId, mod });
  online.sendAttack = (charId, slot) => ready() && send({ type:'attack_roll', charId, slot });
  online.sendBoardImage = (id, src) => ready() && send({ type:'board_image', id, src });
  online.sendVisionWalls = walls => ready() && send({ type:'vision_walls', walls });
  online.sendInitiativeRoll = (tokenId, mod) => ready() && send({ type:'initiative_roll', tokenId, mod });
  online.inRoom = () => !!online.meta && !!window.dndOnlineGetRole?.();
  online.isReady = ready;
  online.signatureNow = currentSignature;
  /**
   * Отправить действие с инвентарём. Локально оно уже применено (мгновенный отклик),
   * сервер применит его окончательно и пришлёт всем новое состояние.
   * sigBefore — подпись состояния до локального применения: если других неотправленных
   * изменений не было, не отправляем лишний снимок.
   */
  online.sendInventoryAction = function(action, sigBefore){
    if(sigBefore != null && sigBefore === online.lastSignature) online.lastSignature = currentSignature();
    if(!ready() || !send({ type:'inventory_action', action, requestId:++online.seq })){
      toastSafe('Нет связи с сервером — действие не сохранится', 'error');
      return false;
    }
    return true;
  };
  online.sendDice = function(result){
    if(!ready()) return;
    send({ type:'dice_roll', playerName:online.meta?.player?.name || 'Игрок', roll:{ ...result, time:Date.now(), modifierStr:result.modifierStr || '' } });
  };

  window.DND_ONLINE = online;
  window.dndOnlineSync = publishState;
  window.dndOnlineCanvasSync = sendCanvas;
  window.addEventListener('beforeunload', () => { if(ready()) publishNow('beforeunload'); });
})();
