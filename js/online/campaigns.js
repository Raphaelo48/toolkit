// D&D Toolkit — online campaigns/rooms client
(function(){
  const API = window.DND_API;
  const state = { campaign:null, room:null, player:null, ws:null, poll:null };

  // Параметры переподключения
  const RECONNECT = { delay:2000, maxDelay:30000, attempts:0, maxAttempts:10, timer:null };

  const view = () => document.getElementById('online-view');

  const esc = s => String(s??'').replace(
    /[&<>"']/g,
    c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c])
  );

  function endpoint(){
    return API.baseUrl || `${location.protocol}//${location.hostname}:5000`;
  }

  function setBase(){
    API.configure(endpoint());
  }

  window.openOnlinePanel = function(){
    document.getElementById('online-overlay').classList.remove('hidden');
    // Если уже подключены — показываем комнату
    if(state.room && state.player){ enterRoom(); return; }
    // Пробуем восстановить сессию из sessionStorage
    if(loadSession()){ enterRoom(); return; }
    renderHome();
  };

  window.dndOnlineGetRole = function(){
    return state.player?.role || null;
  };

  window.dndOnlineCan = function(action){
    const role = state.player?.role;
    if(!role) return true;
    if(role === 'master') return true;
    return ['view','dice','own_character','move_own_character'].includes(action);
  };

  window.closeOnlinePanel = function(){
    document.getElementById('online-overlay').classList.add('hidden');
  };

  async function req(path, opts={}){
    setBase();
    return API.request(path,opts);
  }

  function renderHome(){
    view().innerHTML = `
      <div class="online-grid">
        <div class="online-card">
          <h3>Создать кампанию</h3>
          <p>Мастер создаёт кампанию и получает код для друзей.</p>
          <form id="create-campaign" class="online-form">
            <input name="name" placeholder="Название кампании" required>
            <textarea name="description" placeholder="Описание (необязательно)"></textarea>
            <input name="masterName" placeholder="Имя мастера" required>
            <div class="online-actions">
              <button class="btn" type="submit">Создать</button>
            </div>
          </form>
        </div>
        <div class="online-card">
          <h3>Войти в комнату</h3>
          <p>Введи код, который дал мастер.</p>
          <form id="join-room" class="online-form">
            <input name="code" placeholder="Например X7K29P" maxlength="8" required>
            <input name="playerName" placeholder="Твоё имя" required>
            <div class="online-actions">
              <button class="btn" type="submit">Войти</button>
            </div>
          </form>
        </div>
      </div>
      <div id="online-msg"></div>
    `;
    document.getElementById('create-campaign').onsubmit = createCampaign;
    document.getElementById('join-room').onsubmit = joinRoom;
  }

  // ── сессия ──────────────────────────────────────────────
  const SESSION_KEY = 'dnd_online_session';

  function saveSession() {
    if (!state.campaign || !state.room || !state.player) return;
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({
        campaign: state.campaign,
        room: state.room,
        player: state.player
      }));
    } catch(e) {}
  }

  function loadSession() {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) return false;
      const s = JSON.parse(raw);
      if (!s?.room?.id || !s?.player?.id) return false;
      state.campaign = s.campaign;
      state.room = s.room;
      state.player = s.player;
      return true;
    } catch(e) { return false; }
  }

  function clearSession() {
    try { sessionStorage.removeItem(SESSION_KEY); } catch(e) {}
  }
  // ────────────────────────────────────────────────────────

  async function createCampaign(e){
    e.preventDefault();
    const f = new FormData(e.target);
    try{
      const r = await req('/api/campaigns',{
        method:'POST',
        body:JSON.stringify({ name:f.get('name'), description:f.get('description'), masterName:f.get('masterName') })
      });
      state.campaign = r.campaign;
      state.room = r.room;
      state.player = r.player;
      saveSession();
      enterRoom();
    }catch(err){ msg(err.message,true); }
  }

  async function joinRoom(e){
    e.preventDefault();
    const f = new FormData(e.target);
    try{
      const r = await req('/api/rooms/join',{
        method:'POST',
        body:JSON.stringify({ code:f.get('code').trim().toUpperCase(), playerName:f.get('playerName') })
      });
      state.campaign = r.campaign;
      state.room = r.room;
      state.player = r.player;
      saveSession();
      enterRoom();
    }catch(err){ msg(err.message,true); }
  }

  function msg(t,error=false){
    const el = document.getElementById('online-msg');
    if(el){
      el.innerHTML = `<div class="${error?'online-error':'online-ok'}">${esc(t)}</div>`;
    }
  }

  function setWsStatus(text){
    const s = document.getElementById('ws-status');
    if(s) s.textContent = text;
  }

  function enterRoom(){
    view().innerHTML = `
      <div class="online-room">
        <div class="online-room-head">
          <div>
            <h3>${esc(state.campaign.name)}</h3>
            <div>Комната: <span class="online-code">${esc(state.room.code)}</span></div>
            <div id="ws-status">Подключение…</div>
            <div class="online-role">${state.player.role === 'master' ? '👑 Мастер' : '🎲 Игрок'}</div>
          </div>
          <button class="btn" onclick="closeOnlinePanel()">Закрыть</button>
        </div>
        <div>
          <h4>Игроки</h4>
          <div id="online-players" class="online-players"></div>
        </div>
        <div class="online-actions">
          <button class="btn" onclick="copyRoomCode()">Скопировать код</button>
          <button class="btn" onclick="leaveRoom()">Выйти</button>
        </div>
      </div>
    `;
    RECONNECT.attempts = 0;
    connect();
    loadPlayers();
  }

  window.copyRoomCode = () =>
    navigator.clipboard?.writeText(state.room.code)
      .then(() => msg('Код скопирован'))
      .catch(() => msg(state.room.code));

  async function loadPlayers(){
    try{
      const r = await req(`/api/rooms/${state.room.id}/players`);
      const el = document.getElementById('online-players');
      if(el){
        el.innerHTML = r.players
          .map(p=>`<div class="online-player">${esc(p.name)}${p.role==='master'?'👑':''}</div>`)
          .join('') || 'Нет игроков';
      }
    }catch(e){}
  }

  // =========================
  // WEBSOCKET + RECONNECT
  // =========================

  function scheduleReconnect(){
    if(!state.room || !state.player) return; // уже вышли из комнаты
    if(RECONNECT.attempts >= RECONNECT.maxAttempts){
      setWsStatus('🔴 Нет соединения. Обновите страницу.');
      return;
    }
    const delay = Math.min(RECONNECT.delay * Math.pow(1.5, RECONNECT.attempts), RECONNECT.maxDelay);
    RECONNECT.attempts++;
    setWsStatus(`🟡 Переподключение через ${Math.round(delay/1000)}с… (${RECONNECT.attempts}/${RECONNECT.maxAttempts})`);
    if(RECONNECT.timer) clearTimeout(RECONNECT.timer);
    RECONNECT.timer = setTimeout(()=>{ if(state.room && state.player) connect(); }, delay);
  }

  function connect(){
    disconnect(false); // закрыть старый сокет, но не трогать таймер reconnect
    setBase();

    const base = endpoint();
    const wsBase = base.replace(/^https:/,'wss:').replace(/^http:/,'ws:');
    const wsUrl = `${wsBase}/ws?roomId=${encodeURIComponent(state.room.id)}&playerId=${encodeURIComponent(state.player.id)}`;

    console.log('[D&D Online] WebSocket:', wsUrl);

    try{
      state.ws = new WebSocket(wsUrl);

      state.ws.onopen = () => {
        setWsStatus('🟢 Онлайн');
        console.log('[D&D Online] WebSocket connected');
        RECONNECT.attempts = 0; // сброс счётчика при успешном подключении
        if(RECONNECT.timer){ clearTimeout(RECONNECT.timer); RECONNECT.timer=null; }

        window.DND_ONLINE?.handleConnected(state.ws, {
          room: state.room,
          player: state.player,
          campaign: state.campaign
        });
        // Запускаем ping чтобы Render не убил соединение по idle-таймауту
        window.DND_ONLINE?.startPing?.();
        // Применяем видимость UI в зависимости от роли
        window.dndApplyRoleUI?.();
      };

      state.ws.onclose = (ev) => {
        console.log('[D&D Online] WebSocket disconnected', ev.code, ev.reason);
        window.DND_ONLINE?.handleDisconnected();
        // Не переподключаться если пользователь сам вышел (1000 = нормальное закрытие)
        if(ev.code === 1000 || ev.code === 1008) {
          setWsStatus('⚪ Отключено');
          return;
        }
        setWsStatus('🔴 Соединение потеряно');
        scheduleReconnect();
      };

      state.ws.onerror = (error) => {
        console.error('[D&D Online] WebSocket error:', error);
        // onclose сработает следом и запустит reconnect — здесь только логируем
      };

      state.ws.onmessage = e => {
        try{
          const m = JSON.parse(e.data);
          console.log('[D&D Online] WebSocket message:', m);
          if(m.type === 'players_updated') loadPlayers();
          window.DND_ONLINE?.handleMessage(m);
        }catch(error){
          console.error('[D&D Online] WebSocket message error:', error);
        }
      };

    }catch(error){
      console.error('[D&D Online] WebSocket connection failed:', error);
      setWsStatus('🔴 Не удалось подключиться');
      scheduleReconnect();
    }
  }

  function disconnect(fullStop=true){
    if(state.ws){
      // Снимаем обработчики перед закрытием, чтобы onclose не запустил reconnect
      state.ws.onclose = null;
      state.ws.onerror = null;
      state.ws.onmessage = null;
      state.ws.close(1000);
      state.ws = null;
    }
    if(fullStop){
      if(RECONNECT.timer){ clearTimeout(RECONNECT.timer); RECONNECT.timer=null; }
      if(state.poll){ clearInterval(state.poll); state.poll=null; }
      window.DND_ONLINE?.handleDisconnected();
    }
  }

  async function leaveRoom(){
    if(!state.player) return;
    try{
      await req(`/api/rooms/${state.room.id}/players/${state.player.id}`, { method:'DELETE' });
    }catch(e){}
    clearSession();
    state.campaign = null;
    state.room = null;
    state.player = null;
    disconnect(true);
    renderHome();
  }

  window.leaveRoom = leaveRoom;

})();
