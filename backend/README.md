# D&D Toolkit Backend

Node.js + Express + WebSocket (`ws`) + PostgreSQL.

## Локальный запуск
1. Установить Node.js 20+ и PostgreSQL, создать базу `dnd_toolkit`.
2. Скопировать `.env.example` в `.env` и указать `DATABASE_URL`.
3. `npm install`
4. `npm run dev`

Таблицы создаются и обновляются автоматически при запуске (`schema.sql`), существующие данные не трогаются.
Проверка: `GET /api/health`.

Чтобы фронтенд ходил в локальный сервер, в консоли браузера:
`localStorage.setItem('dnd_backend_url', 'http://localhost:5000')` (убрать: `localStorage.removeItem('dnd_backend_url')`).

## Render
- Root Directory: `backend`, Build: `npm install`, Start: `npm start`.
- Переменные: `DATABASE_URL` (Internal Database URL базы на Render), при желании `CORS_ORIGIN=https://dnd-toolkit-frontend.onrender.com`.
- Бесплатный тариф засыпает после 15 минут простоя; фронтенд сам будит сервер и переподключается.

## Supabase как база данных
- В `DATABASE_URL` на Render указывайте строку **Session pooler** (Supabase → Connect → Session pooler,
  хост вида `aws-0-…pooler.supabase.com`, порт `5432`). Прямой адрес `db.<проект>.supabase.co` работает
  только по IPv6, а Render его не поддерживает.
- Пароль в строке — пароль базы из Supabase (не anon/service key).
- Сервер включает RLS на своих таблицах: через REST API Supabase их прочитать нельзя, сам сервер работает как обычно.
- Бесплатный проект Supabase ставится на паузу после недели без активности — тогда его нужно возобновить в панели Supabase.
- Таблица `token_inventory` (`schema_inventory.sql`) больше не используется: инвентарь хранится в состоянии комнаты.

## Как устроена синхронизация
- Состояние комнаты живёт в памяти сервера, каждое изменение получает номер версии; изменения одной комнаты обрабатываются по очереди.
- В базу состояние пишется не чаще раза в секунду и обязательно при остановке/перезапуске сервера.
- Мастер меняет всё поле боя, игрок — только своих персонажей, их токены и инвентарь. Если мастер отправил изменения, не видя свежих изменений игрока, сервер сохраняет изменения обоих.
- Картинка карты, рисунки и туман хранятся и передаются отдельно, только когда меняются.
- Доступ к комнате подтверждается секретным токеном участника (выдаётся при входе, хранится в браузере).

## API
- `POST /api/campaigns` — создать кампанию (`name`, `description`, `masterName`).
- `POST /api/rooms/join` — войти по коду (`code`, `playerName`); то же имя = тот же игрок.
- `POST /api/session/resume` — вернуться по токену (`token`).
- `GET /api/rooms/:roomId/players` — игроки и кто в сети.
- `DELETE /api/rooms/:roomId/players/:playerId` — выйти/исключить (заголовок `X-Player-Token`).
- WebSocket `/ws?roomId=&playerId=&token=`.
