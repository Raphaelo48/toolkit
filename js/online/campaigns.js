// D&D Toolkit — онлайн-кампании и комнаты: вход, сессия, WebSocket и переподключение
(function(){
  const API = window.DND_API;
  const session = { campaign:null, room:null, player:null };
  const conn = { ws:null, retryTimer:null, attempts:0, status:'offline', stopped:true };

  const SESSION_KEY = 'dnd_online_session_v2';
  const PAUSED_KEY = 'dnd_online_paused_master';
  const view = () => document.getElementById('online-view');
  const esc = s => String(s??'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  const inRoom = () => !!(session.room && session.player);

  /* ---------- сессия (переживает перезагрузку страницы) ---------- */

  function saveSession(){
    if(!inRoom()) return;
    try{ localStorage.setItem(SESSION_KEY, JSON.stringify(session)); }catch(e){}
  }
  function loadSession(){
    try{
      const s = JSON.parse(localStorage.getItem(SESSION_KEY) || sessionStorage.getItem('dnd_online_session') || 'null');
      if(!s?.room?.id || !s?.player?.id) return false;
      Object.assign(session, { campaign:s.campaign, room:s.room, player:s.player });
      return true;
    }catch(e){ return false; }
  }
  function clearSession(){
    try{ localStorage.removeItem(SESSION_KEY); sessionStorage.removeItem('dnd_online_session'); }catch(e){}
    session.campaign = session.room = session.player = null;
  }
  function useSession(r){
    session.campaign = r.campaign; session.room = r.room; session.player = r.player;
    saveSession();
  }

  /* ---------- публичные функции для остального кода ---------- */

  window.dndOnlineGetRole = () => session.player?.role || null;
  window.dndOnlineCan = function(action){
    const role = session.player?.role;
    if(!role || role === 'master') return true;
    return ['view','dice','own_character','move_own_character'].includes(action);
  };

  window.openOnlinePanel = function(){
    document.getElementById('online-overlay').classList.remove('hidden');
    if(inRoom()) renderRoom(); else renderHome();
  };
  window.closeOnlinePanel = function(){
    document.getElementById('online-overlay').classList.add('hidden');
  };

  /* ---------- статус соединения ---------- */

  const STATUS_TEXT = {
    offline:'⚪ Не подключено', waking:'🟡 Сервер просыпается…', connecting:'🟡 Подключение…',
    online:'🟢 Онлайн', reconnecting:'🟡 Переподключение…', lost:'🔴 Нет связи — пробуем снова…'
  };
  function setStatus(status, extra=''){
    conn.status = status;
    const text = STATUS_TEXT[status] + (extra ? ` ${extra}` : '');
    const s = document.getElementById('ws-status');
    if(s) s.textContent = text;
    const btn = document.querySelector('.online-btn');
    if(btn){
      btn.textContent = inRoom()
        ? `${STATUS_TEXT[status].split(' ')[0]} ${session.room.code}`
        : '🌐 Онлайн';
      btn.title = text;
    }
  }

  /* ---------- экраны ---------- */

  function renderHome(message, isError){
    let paused = null;
    try{ paused = JSON.parse(localStorage.getItem(PAUSED_KEY) || 'null'); }catch(e){}
    view().innerHTML = (paused?.room ? `
      <div class="online-card online-resume">
        <div>👑 Ваша кампания <b>${esc(paused.campaign?.name || '')}</b> · комната <span class="online-code">${esc(paused.room.code)}</span></div>
        <button class="btn" onclick="resumePausedCampaign()">Вернуться</button>
      </div>` : '') + `
      <div class="online-grid">
        <div class="online-card">
          <h3>Создать кампанию</h3>
          <p>Мастер создаёт кампанию и получает код для друзей.</p>
          <form id="create-campaign" class="online-form">
            <input name="name" placeholder="Название кампании" maxlength="120" required>
            <textarea name="description" placeholder="Описание (необязательно)" maxlength="2000"></textarea>
            <input name="masterName" placeholder="Имя мастера" maxlength="80" required>
            <div class="online-actions"><button class="btn" type="submit">Создать</button></div>
          </form>
        </div>
        <div class="online-card">
          <h3>Войти в комнату</h3>
          <p>Введи код, который дал мастер. Если уже играл — введи то же имя, персонажи сохранятся.</p>
          <form id="join-room" class="online-form">
            <input name="code" placeholder="Например X7K29P" maxlength="8" required autocomplete="off">
            <input name="playerName" placeholder="Твоё имя" maxlength="80" required>
            <div class="online-actions"><button class="btn" type="submit">Войти</button></div>
          </form>
        </div>
      </div>
      <div id="online-msg"></div>`;
    document.getElementById('create-campaign').onsubmit = createCampaign;
    document.getElementById('join-room').onsubmit = joinRoom;
    if(message) msg(message, isError);
  }

  function renderRoom(){
    const isMaster = session.player.role === 'master';
    view().innerHTML = `
      <div class="online-room">
        <div class="online-room-head">
          <div>
            <h3>${esc(session.campaign?.name || 'Кампания')}</h3>
            <div>Код комнаты: <span class="online-code">${esc(session.room.code)}</span></div>
            <div id="ws-status"></div>
            <div class="online-role">${isMaster ? '👑 Мастер' : '🎲 Игрок'} · ${esc(session.player.name)}</div>
          </div>
          <button class="btn" onclick="closeOnlinePanel()">Закрыть</button>
        </div>
        <div>
          <h4>Игроки</h4>
          <div id="online-players" class="online-players"><div class="online-player">Загрузка…</div></div>
        </div>
        <div class="online-actions">
          <button class="btn" onclick="copyRoomCode()">Скопировать код</button>
          <button class="btn" onclick="copyResumeLink()" title="Откройте эту ссылку на другом устройстве, чтобы продолжить под своим именем">Ссылка для входа с другого устройства</button>
          <button class="btn" onclick="leaveRoom()">${isMaster ? 'Отключиться' : 'Выйти из комнаты'}</button>
        </div>
        ${isMaster ? '<div class="online-hint">Ссылку для входа не отправляйте игрокам: по ней входят как мастер. Игрокам нужен только код комнаты.</div>' : ''}
        <div id="online-msg"></div>
      </div>`;
    setStatus(conn.status);
    loadPlayers();
  }

  function msg(t, error=false){
    const el = document.getElementById('online-msg');
    if(el) el.innerHTML = `<div class="${error?'online-error':'online-ok'}">${esc(t)}</div>`;
  }

  function lockForm(form, locked){
    form.querySelectorAll('button,input,textarea').forEach(el => el.disabled = locked);
  }

  async function createCampaign(e){
    e.preventDefault();
    const form = e.target, f = new FormData(form);
    lockForm(form, true); msg('Создаём кампанию… (первый запуск сервера может занять до минуты)');
    try{
      const r = await API.request('/api/campaigns', {
        method:'POST', timeout:70000,
        body:JSON.stringify({ name:f.get('name'), description:f.get('description'), masterName:f.get('masterName') })
      });
      useSession(r);
      renderRoom();
      connect();
    }catch(err){ msg(err.message, true); lockForm(form, false); }
  }

  async function joinRoom(e){
    e.preventDefault();
    const form = e.target, f = new FormData(form);
    lockForm(form, true); msg('Подключаемся… (первый запуск сервера может занять до минуты)');
    try{
      const r = await API.request('/api/rooms/join', {
        method:'POST', timeout:70000,
        body:JSON.stringify({ code:String(f.get('code')).trim().toUpperCase(), playerName:f.get('playerName') })
      });
      useSession(r);
      renderRoom();
      connect();
    }catch(err){ msg(err.message, true); lockForm(form, false); }
  }

  window.copyRoomCode = () => copy(session.room.code, 'Код скопирован');
  window.copyResumeLink = () => {
    const link = `${location.origin}${location.pathname}#join=${encodeURIComponent(session.player.token || '')}`;
    copy(link, 'Ссылка скопирована');
  };
  function copy(text, done){
    (navigator.clipboard?.writeText(text) || Promise.reject())
      .then(() => msg(done))
      .catch(() => msg(text));
  }

  function renderPlayers(players){
    const el = document.getElementById('online-players');
    if(!el) return;
    const isMaster = session.player?.role === 'master';
    el.innerHTML = players.map(p => `
      <div class="online-player">
        <span class="online-dot ${p.online ? 'on' : ''}" title="${p.online ? 'В сети' : 'Не в сети'}"></span>
        ${esc(p.name)} ${p.role === 'master' ? '👑' : ''}
        ${String(p.id) === String(session.player?.id) ? '<span class="online-me">(вы)</span>' : ''}
        ${isMaster && p.role !== 'master' ? `<button class="online-kick" title="Исключить из комнаты" onclick="kickPlayer(${Number(p.id)})">✕</button>` : ''}
      </div>`).join('') || '<div class="online-player">Нет игроков</div>';
  }

  async function loadPlayers(){
    if(!inRoom()) return;
    try{ renderPlayers((await API.request(`/api/rooms/${session.room.id}/players`)).players); }catch(e){}
  }

  window.kickPlayer = async function(id){
    if(!confirm('Исключить игрока из комнаты? Его персонажи останутся на карте.')) return;
    try{
      await API.request(`/api/rooms/${session.room.id}/players/${id}`, { method:'DELETE', headers:{ 'X-Player-Token':session.player.token || '' } });
    }catch(err){ msg(err.message, true); }
  };

  /* ---------- WebSocket ---------- */

  function connect(){
    if(!inRoom()) return;
    conn.stopped = false;
    window.dndApplyRoleUI?.();
    closeSocket();
    clearTimeout(conn.retryTimer);
    openSocket();
  }

  async function openSocket(){
    setStatus(conn.attempts ? 'reconnecting' : 'connecting');
    // Бесплатный Render усыпляет сервер — сначала будим его обычным запросом
    const slow = setTimeout(() => setStatus('waking'), 2500);
    await API.wake();
    clearTimeout(slow);
    if(conn.stopped || !inRoom() || conn.ws) return;

    const url = API.wsUrl(`/ws?roomId=${encodeURIComponent(session.room.id)}&playerId=${encodeURIComponent(session.player.id)}&token=${encodeURIComponent(session.player.token || '')}`);
    let ws;
    try{ ws = new WebSocket(url); }catch(err){ scheduleReconnect(); return; }
    conn.ws = ws;

    ws.onopen = () => {
      conn.attempts = 0;
      setStatus('online');
      window.DND_ONLINE?.handleConnected(ws, { room:session.room, player:session.player, campaign:session.campaign });
      window.dndApplyRoleUI?.();
    };
    ws.onmessage = e => {
      let m;
      try{ m = JSON.parse(e.data); }catch(err){ return; }
      if(m.type === 'welcome'){
        if(m.token){ session.player.token = m.token; }
        if(m.player){ session.player.name = m.player.name; session.player.role = m.player.role; }
        saveSession();
      }
      if(m.type === 'players_updated'){
        if(Array.isArray(m.players)) renderPlayers(m.players); else loadPlayers();
      }
      try{ window.DND_ONLINE?.handleMessage(m); }catch(err){ console.error('[D&D Online] message handling failed', m.type, err); }
    };
    ws.onclose = ev => {
      if(conn.ws !== ws) return;
      conn.ws = null;
      window.DND_ONLINE?.handleDisconnected();
      if(conn.stopped) return;
      if(ev.code === 4001 || ev.code === 4003 || ev.code === 4000){
        // Сессия больше не действительна (исключили из комнаты или её удалили)
        conn.stopped = true;
        clearSession();
        setStatus('offline');
        window.dndApplyRoleUI?.();
        document.getElementById('online-overlay').classList.remove('hidden');
        renderHome(ev.code === 4003 ? 'Мастер исключил вас из комнаты.' : 'Сессия устарела. Войдите в комнату заново.', true);
        return;
      }
      scheduleReconnect();
    };
    ws.onerror = () => { /* onclose сработает следом */ };
  }

  function scheduleReconnect(){
    if(conn.stopped || !inRoom()) return;
    conn.attempts++;
    const delay = Math.min(1000 * Math.pow(1.6, conn.attempts - 1), 10000);
    setStatus(conn.attempts > 3 ? 'lost' : 'reconnecting');
    clearTimeout(conn.retryTimer);
    conn.retryTimer = setTimeout(openSocket, delay);
  }

  function closeSocket(){
    const ws = conn.ws;
    conn.ws = null;
    if(ws){
      ws.onclose = ws.onmessage = ws.onerror = null;
      try{ ws.close(1000); }catch(e){}
      window.DND_ONLINE?.handleDisconnected();
    }
  }

  function retryNow(){
    if(!conn.stopped && inRoom() && !conn.ws){
      clearTimeout(conn.retryTimer);
      openSocket();
    }
  }
  window.addEventListener('online', retryNow);
  document.addEventListener('visibilitychange', () => { if(document.visibilityState === 'visible') retryNow(); });

  window.leaveRoom = async function(){
    if(!inRoom()) return;
    const isMaster = session.player.role === 'master';
    if(isMaster){
      // Мастер не удаляется из кампании: сессия запоминается, вернуться можно одной кнопкой
      try{ localStorage.setItem(PAUSED_KEY, JSON.stringify(session)); }catch(e){}
    } else {
      if(!confirm('Выйти из комнаты? Чтобы вернуться, войдите снова по коду с тем же именем.')) return;
      try{
        await API.request(`/api/rooms/${session.room.id}/players/${session.player.id}`, { method:'DELETE', headers:{ 'X-Player-Token':session.player.token || '' } });
      }catch(e){}
    }
    conn.stopped = true;
    clearTimeout(conn.retryTimer);
    closeSocket();
    clearSession();
    setStatus('offline');
    window.dndApplyRoleUI?.();
    renderHome();
  };

  window.resumePausedCampaign = function(){
    try{
      const s = JSON.parse(localStorage.getItem(PAUSED_KEY) || 'null');
      localStorage.removeItem(PAUSED_KEY);
      if(!s?.room?.id) return renderHome();
      useSession(s);
      renderRoom();
      connect();
    }catch(e){ renderHome(); }
  };

  /* ---------- автоматический вход ---------- */

  async function boot(){
    const match = location.hash.match(/join=([^&]+)/);
    if(match){
      history.replaceState(null, '', location.pathname + location.search);
      try{
        const r = await API.request('/api/session/resume', { method:'POST', timeout:70000, body:JSON.stringify({ token:decodeURIComponent(match[1]) }) });
        useSession(r);
      }catch(err){
        document.getElementById('online-overlay').classList.remove('hidden');
        renderHome(err.message, true);
        return;
      }
    }
    if(inRoom() || loadSession()){
      setStatus('connecting');
      connect();
    }
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
