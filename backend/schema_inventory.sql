-- ============================================================
-- INVENTORY — хранение инвентаря токенов, привязанного к комнате
-- Выполнить в Supabase SQL Editor
-- ============================================================

-- Таблица инвентаря: одна строка = один предмет в инвентаре конкретного токена в конкретной комнате
CREATE TABLE IF NOT EXISTS token_inventory (
  id          BIGSERIAL PRIMARY KEY,
  room_id     BIGINT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  token_id    BIGINT NOT NULL,                        -- id токена (из state.tokens[].id)
  item_id     VARCHAR(80) NOT NULL,                   -- id предмета из LOOT_ITEMS
  item_name   VARCHAR(120) NOT NULL,
  item_icon   VARCHAR(20) NOT NULL DEFAULT '❓',
  item_rarity VARCHAR(20) NOT NULL DEFAULT 'common',
  item_desc   TEXT NOT NULL DEFAULT '',
  qty         INT NOT NULL DEFAULT 1 CHECK (qty > 0),
  added_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Один тип предмета в одном токене в одной комнате — одна строка
  UNIQUE (room_id, token_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_token_inventory_room_id ON token_inventory(room_id);
CREATE INDEX IF NOT EXISTS idx_token_inventory_token_id ON token_inventory(room_id, token_id);

-- ============================================================
-- API-функции (опционально — если используешь Supabase RPC)
-- ============================================================

-- Получить инвентарь всех токенов в комнате (возвращает JSON-объект { tokenId: [...items] })
CREATE OR REPLACE FUNCTION get_room_inventory(p_room_id BIGINT)
RETURNS JSONB
LANGUAGE plpgsql AS $$
DECLARE
  result JSONB := '{}';
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT
      token_id,
      jsonb_agg(
        jsonb_build_object(
          'id',     item_id,
          'name',   item_name,
          'icon',   item_icon,
          'rarity', item_rarity,
          'desc',   item_desc,
          'qty',    qty
        ) ORDER BY added_at
      ) AS items
    FROM token_inventory
    WHERE room_id = p_room_id
    GROUP BY token_id
  LOOP
    result := result || jsonb_build_object(rec.token_id::TEXT, rec.items);
  END LOOP;
  RETURN result;
END;
$$;

-- Добавить/обновить предмет в инвентаре токена
CREATE OR REPLACE FUNCTION upsert_inventory_item(
  p_room_id    BIGINT,
  p_token_id   BIGINT,
  p_item_id    VARCHAR,
  p_item_name  VARCHAR,
  p_item_icon  VARCHAR,
  p_item_rarity VARCHAR,
  p_item_desc  TEXT,
  p_qty_delta  INT   -- положительное = добавить, отрицательное = убрать
)
RETURNS VOID
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO token_inventory (room_id, token_id, item_id, item_name, item_icon, item_rarity, item_desc, qty)
  VALUES (p_room_id, p_token_id, p_item_id, p_item_name, p_item_icon, p_item_rarity, p_item_desc, GREATEST(1, p_qty_delta))
  ON CONFLICT (room_id, token_id, item_id) DO UPDATE
    SET qty = GREATEST(0, token_inventory.qty + p_qty_delta),
        item_name = EXCLUDED.item_name,
        item_icon = EXCLUDED.item_icon;

  -- Удалить строку если qty упало до 0
  DELETE FROM token_inventory
  WHERE room_id = p_room_id AND token_id = p_token_id AND item_id = p_item_id AND qty <= 0;
END;
$$;

-- Очистить инвентарь всей комнаты (например при сбросе сессии)
CREATE OR REPLACE FUNCTION clear_room_inventory(p_room_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM token_inventory WHERE room_id = p_room_id;
END;
$$;
