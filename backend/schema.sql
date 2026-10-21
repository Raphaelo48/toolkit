-- D&D Toolkit — схема базы данных.
-- Сервер сам выполняет этот файл при запуске (src/db.js → ensureSchema),
-- поэтому вручную его запускать не обязательно. Все команды безопасны
-- для повторного запуска и не трогают существующие данные.

CREATE TABLE IF NOT EXISTS users (
  id         BIGSERIAL PRIMARY KEY,
  username   VARCHAR(80) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS campaigns (
  id             BIGSERIAL PRIMARY KEY,
  name           VARCHAR(120) NOT NULL,
  description    TEXT DEFAULT '',
  master_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS campaign_members (
  campaign_id BIGINT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        VARCHAR(20) NOT NULL DEFAULT 'player',
  joined_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (campaign_id, user_id)
);

CREATE TABLE IF NOT EXISTS rooms (
  id          BIGSERIAL PRIMARY KEY,
  campaign_id BIGINT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  room_code   VARCHAR(8) NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS room_state (
  room_id    BIGINT PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE,
  state      JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Новые поля (добавляются к уже существующей базе без потери данных)
ALTER TABLE campaign_members ADD COLUMN IF NOT EXISTS token TEXT;
ALTER TABLE room_state ADD COLUMN IF NOT EXISTS version     BIGINT NOT NULL DEFAULT 0;
ALTER TABLE room_state ADD COLUMN IF NOT EXISTS map_src     TEXT;
ALTER TABLE room_state ADD COLUMN IF NOT EXISTS draw_canvas TEXT;
ALTER TABLE room_state ADD COLUMN IF NOT EXISTS fog_canvas  TEXT;
ALTER TABLE room_state ADD COLUMN IF NOT EXISTS vision_walls TEXT;

CREATE INDEX IF NOT EXISTS idx_rooms_campaign_id ON rooms(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_members_user ON campaign_members(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_campaign_members_token ON campaign_members(token) WHERE token IS NOT NULL;
