# D&D Toolkit Backend

## Локальный запуск
1. Установить Node.js 20+.
2. Создать PostgreSQL базу `dnd_toolkit`.
3. Выполнить `schema.sql`.
4. Скопировать `.env.example` в `.env` и указать пароль PostgreSQL.
5. `npm install`
6. `npm run dev`

Проверка: GET `/api/health`.

API: создание кампании, вход по коду комнаты, список игроков, выход игрока. WebSocket `/ws` подготовлен для синхронизации карты, токенов, бросков и событий.
