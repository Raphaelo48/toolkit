// D&D Toolkit — online campaigns/rooms client
(function(){
  const API = window.DND_API;
  const state = { campaign:null, room:null, player:null, ws:null, poll:null };

  const view = () => document.getElementById('online-view');

  const esc = s => String(s??'').replace(
    /[&<>"']/g,
    c => ({
      '&':'&amp;',
      '<':'&lt;',
      '>':'&gt;',
      '"':'&quot;',
      "'":'&#039;'
    }[c])
  );

  function endpoint(){
    return API.baseUrl || `${location.protocol}//${location.hostname}:5000`;
  }

  function setBase(){
    API.configure(endpoint());
  }

  window.openOnlinePanel = function(){
    document.getElementById('online-overlay').classList.remove('hidden');
    renderHome();
  };

  window.closeOnlinePanel = function(){
    document.getElementById('online-overlay').classList.add('hidden');
    disconnect();
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
            <input
              name="name"
              placeholder="Название кампании"
              required
            >

            <textarea
              name="description"
              placeholder="Описание (необязательно)"
            ></textarea>

            <input
              name="masterName"
              placeholder="Имя мастера"
              required
            >

            <div class="online-actions">
              <button class="btn" type="submit">Создать</button>
            </div>
          </form>
        </div>

        <div class="online-card">
          <h3>Войти в комнату</h3>
          <p>Введи код, который дал мастер.</p>

          <form id="join-room" class="online-form">
            <input
              name="code"
              placeholder="Например X7K29P"
              maxlength="8"
              required
            >

            <input
              name="playerName"
              placeholder="Твоё имя"
              required
            >

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

  async function createCampaign(e){
    e.preventDefault();

    const f = new FormData(e.target);

    try{
      const r = await req('/api/campaigns',{
        method:'POST',
        body:JSON.stringify({
          name:f.get('name'),
          description:f.get('description'),
          masterName:f.get('masterName')
        })
      });

      state.campaign = r.campaign;
      state.room = r.room;
      state.player = r.player;

      enterRoom();

    }catch(err){
      msg(err.message,true);
    }
  }

  async function joinRoom(e){
    e.preventDefault();

    const f = new FormData(e.target);

    try{
      const r = await req('/api/rooms/join',{
        method:'POST',
        body:JSON.stringify({
          code:f.get('code').trim().toUpperCase(),
          playerName:f.get('playerName')
        })
      });

      state.campaign = r.campaign;
      state.room = r.room;
      state.player = r.player;

      enterRoom();

    }catch(err){
      msg(err.message,true);
    }
  }

  function msg(t,error=false){
    const el = document.getElementById('online-msg');

    if(el){
      el.innerHTML = `
        <div class="${error?'online-error':'online-ok'}">
          ${esc(t)}
        </div>
      `;
    }
  }

  function enterRoom(){
    view().innerHTML = `
      <div class="online-room">

        <div class="online-room-head">
          <div>
            <h3>${esc(state.campaign.name)}</h3>

            <div>
              Комната:
              <span class="online-code">
                ${esc(state.room.code)}
              </span>
            </div>

            <div id="ws-status">
              Подключение…
            </div>
          </div>

          <button
            class="btn"
            onclick="closeOnlinePanel()"
          >
            Закрыть
          </button>
        </div>

        <div>
          <h4>Игроки</h4>
          <div
            id="online-players"
            class="online-players"
          ></div>
        </div>

        <div class="online-actions">
          <button
            class="btn"
            onclick="copyRoomCode()"
          >
            Скопировать код
          </button>

          <button
            class="btn"
            onclick="leaveRoom()"
          >
            Выйти
          </button>
        </div>

      </div>
    `;

    connect();
    loadPlayers();
  }

  window.copyRoomCode = () =>
    navigator.clipboard?.writeText(state.room.code)
      .then(() => msg('Код скопирован'))
      .catch(() => msg(state.room.code));

  async function loadPlayers(){
    try{
      const r = await req(
        `/api/rooms/${state.room.id}/players`
      );

      document.getElementById('online-players').innerHTML =
        r.players
          .map(p => `
            <div class="online-player">
              ${esc(p.name)}
              ${p.role==='master'?'👑':''}
            </div>
          `)
          .join('') || 'Нет игроков';

    }catch(e){}
  }

  // =========================
  // WEBSOCKET
  // =========================

  function connect(){
    disconnect();
    setBase();

    const base = endpoint();

    const wsBase = base
      .replace(/^https:/, 'wss:')
      .replace(/^http:/, 'ws:');

    const wsUrl =
      `${wsBase}/ws` +
      `?roomId=${encodeURIComponent(state.room.id)}` +
      `&playerId=${encodeURIComponent(state.player.id)}`;

    console.log('[D&D Online] WebSocket:', wsUrl);

    try{
      state.ws = new WebSocket(wsUrl);

      state.ws.onopen = () => {
        const s = document.getElementById('ws-status');

        if(s){
          s.textContent = '🟢 Онлайн';
        }

        console.log('[D&D Online] WebSocket connected');

        window.DND_ONLINE?.handleConnected(
          state.ws,
          {
            room: state.room,
            player: state.player,
            campaign: state.campaign
          }
        );
      };

      state.ws.onclose = () => {
        const s = document.getElementById('ws-status');

        if(s){
          s.textContent = '⚪ Отключено';
        }

        console.log('[D&D Online] WebSocket disconnected');

        window.DND_ONLINE?.handleDisconnected();
      };

      state.ws.onerror = (error) => {
        console.error(
          '[D&D Online] WebSocket error:',
          error
        );

        const s = document.getElementById('ws-status');

        if(s){
          s.textContent = '🔴 Ошибка соединения';
        }
      };

      state.ws.onmessage = e => {
        try{
          const m = JSON.parse(e.data);

          console.log(
            '[D&D Online] WebSocket message:',
            m
          );

          if(m.type === 'players_updated'){
            loadPlayers();
          }

          window.DND_ONLINE?.handleMessage(m);

        }catch(error){
          console.error(
            '[D&D Online] WebSocket message error:',
            error
          );
        }
      };

    }catch(error){
      console.error(
        '[D&D Online] WebSocket connection failed:',
        error
      );

      const s = document.getElementById('ws-status');

      if(s){
        s.textContent = '🔴 Не удалось подключиться';
      }
    }
  }

  function disconnect(){
    if(state.ws){
      state.ws.close();
      state.ws = null;
    }

    if(state.poll){
      clearInterval(state.poll);
      state.poll = null;
    }
  }

  async function leaveRoom(){
    if(!state.player) return;

    try{
      await req(
        `/api/rooms/${state.room.id}/players/${state.player.id}`,
        {
          method:'DELETE'
        }
      );
    }catch(e){}

    state.campaign = null;
    state.room = null;
    state.player = null;

    disconnect();
    renderHome();
  }

  window.leaveRoom = leaveRoom;

})();
