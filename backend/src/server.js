```js
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import pg from 'pg';
import { WebSocketServer } from 'ws';
import http from 'http';
import crypto from 'crypto';

dotenv.config();

const { Pool } = pg;

const PORT = Number(process.env.PORT || 5000);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost')
    ? false
    : { rejectUnauthorized: false }
});

const app = express();

app.use(cors({
  origin: process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map(s => s.trim())
    : true,
  credentials: true
}));

app.use(express.json({ limit: '2mb' }));

const server = http.createServer(app);
const wss = new WebSocketServer({
  server,
  path: '/ws'
});

const sockets = new Map();

/* =========================================================
   HELPERS
========================================================= */

function generateRoomCode() {
  return crypto
    .randomBytes(4)
    .toString('hex')
    .toUpperCase()
    .slice(0, 6);
}

function broadcast(roomId, message) {
  const set = sockets.get(String(roomId));

  if (!set) return;

  const data = JSON.stringify(message);

  for (const ws of set) {
    if (ws.readyState === 1) {
      ws.send(data);
    }
  }
}

async function getRoomState(roomId) {
  const result = await pool.query(
    `
      SELECT state, updated_at
      FROM room_state
      WHERE room_id = $1
    `,
    [roomId]
  );

  if (!result.rowCount) {
    return {
      state: {},
      updated_at: null
    };
  }

  return result.rows[0];
}

async function saveRoomState(roomId, state) {
  await pool.query(
    `
      INSERT INTO room_state (
        room_id,
        state,
        updated_at
      )
      VALUES (
        $1,
        $2::jsonb,
        NOW()
      )
      ON CONFLICT (room_id)
      DO UPDATE SET
        state = EXCLUDED.state,
        updated_at = NOW()
    `,
    [
      roomId,
      JSON.stringify(state || {})
    ]
  );
}

/* =========================================================
   HEALTH
========================================================= */

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');

    res.json({
      success: true,
      database: 'connected'
    });
  } catch (error) {
    console.error('Health check error:', error);

    res.status(503).json({
      success: false,
      database: 'disconnected',
      error: error.message
    });
  }
});

/* =========================================================
   CAMPAIGNS
========================================================= */

/*
  Создание кампании.

  Используем:
  campaigns
  rooms
  campaign_members
*/

app.post('/api/campaigns', async (req, res) => {
  const {
    name,
    description = '',
    masterName
  } = req.body || {};

  if (!name || !masterName) {
    return res.status(400).json({
      error: 'Название кампании и имя мастера обязательны'
    });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    /*
      1. Создаём пользователя-мастера
    */

    const userResult = await client.query(
      `
        INSERT INTO users (username)
        VALUES ($1)
        RETURNING *
      `,
      [masterName]
    );

    const user = userResult.rows[0];

    /*
      2. Создаём кампанию
    */

    const campaignResult = await client.query(
      `
        INSERT INTO campaigns (
          name,
          description,
          master_user_id
        )
        VALUES ($1, $2, $3)
        RETURNING *
      `,
      [
        name,
        description,
        user.id
      ]
    );

    const campaign = campaignResult.rows[0];

    /*
      3. Добавляем мастера в campaign_members
    */

    await client.query(
      `
        INSERT INTO campaign_members (
          campaign_id,
          user_id,
          role
        )
        VALUES ($1, $2, 'master')
      `,
      [
        campaign.id,
        user.id
      ]
    );

    /*
      4. Генерируем уникальный код комнаты
    */

    let room = null;

    for (let i = 0; i < 10; i++) {
      const roomCode = generateRoomCode();

      try {
        const roomResult = await client.query(
          `
            INSERT INTO rooms (
              campaign_id,
              room_code
            )
            VALUES ($1, $2)
            RETURNING *
          `,
          [
            campaign.id,
            roomCode
          ]
        );

        room = roomResult.rows[0];
        break;

      } catch (error) {
        /*
          23505 = duplicate key
        */

        if (error.code !== '23505') {
          throw error;
        }
      }
    }

    if (!room) {
      throw new Error(
        'Не удалось создать уникальный код комнаты'
      );
    }

    /*
      5. Создаём начальное состояние комнаты
    */

    await client.query(
      `
        INSERT INTO room_state (
          room_id,
          state
        )
        VALUES ($1, '{}'::jsonb)
        ON CONFLICT (room_id)
        DO NOTHING
      `,
      [room.id]
    );

    await client.query('COMMIT');

    res.status(201).json({
      campaign,
      room: {
        id: room.id,
        code: room.room_code,
        campaign_id: room.campaign_id
      },
      player: {
        id: user.id,
        name: user.username,
        role: 'master'
      }
    });

  } catch (error) {
    await client.query('ROLLBACK');

    console.error('Create campaign error:', error);

    res.status(500).json({
      error: error.message || 'Не удалось создать кампанию'
    });

  } finally {
    client.release();
  }
});


/* =========================================================
   GET CAMPAIGNS
========================================================= */

app.get('/api/campaigns', async (_req, res) => {
  try {
    const result = await pool.query(
      `
        SELECT
          c.*,
          COUNT(cm.user_id)::int AS player_count
        FROM campaigns c
        LEFT JOIN campaign_members cm
          ON cm.campaign_id = c.id
        GROUP BY c.id
        ORDER BY c.created_at DESC
      `
    );

    res.json({
      campaigns: result.rows
    });

  } catch (error) {
    console.error('Get campaigns error:', error);

    res.status(500).json({
      error: 'Не удалось получить кампании'
    });
  }
});


/* =========================================================
   JOIN ROOM
========================================================= */

app.post('/api/rooms/join', async (req, res) => {
  const {
    code: rawCode,
    playerName
  } = req.body || {};

  const roomCode = String(rawCode || '')
    .trim()
    .toUpperCase();

  const name = String(playerName || '').trim();

  if (!roomCode || !name) {
    return res.status(400).json({
      error: 'Код комнаты и имя обязательны'
    });
  }

  try {
    /*
      1. Ищем комнату
    */

    const roomResult = await pool.query(
      `
        SELECT
          r.*,
          c.name AS campaign_name,
          c.description AS campaign_description
        FROM rooms r
        JOIN campaigns c
          ON c.id = r.campaign_id
        WHERE r.room_code = $1
      `,
      [roomCode]
    );

    if (!roomResult.rowCount) {
      return res.status(404).json({
        error: 'Комната не найдена'
      });
    }

    const room = roomResult.rows[0];

    /*
      2. Создаём пользователя
    */

    const userResult = await pool.query(
      `
        INSERT INTO users (username)
        VALUES ($1)
        RETURNING *
      `,
      [name]
    );

    const user = userResult.rows[0];

    /*
      3. Добавляем пользователя в кампанию
    */

    try {
      await pool.query(
        `
          INSERT INTO campaign_members (
            campaign_id,
            user_id,
            role
          )
          VALUES ($1, $2, 'player')
        `,
        [
          room.campaign_id,
          user.id
        ]
      );

    } catch (error) {
      if (error.code !== '23505') {
        throw error;
      }
    }

    /*
      4. Уведомляем остальных игроков
    */

    broadcast(room.id, {
      type: 'players_updated'
    });

    res.json({
      campaign: {
        id: room.campaign_id,
        name: room.campaign_name,
        description: room.campaign_description
      },

      room: {
        id: room.id,
        code: room.room_code,
        campaign_id: room.campaign_id
      },

      player: {
        id: user.id,
        name: user.username,
        role: 'player'
      }
    });

  } catch (error) {
    console.error('Join room error:', error);

    res.status(500).json({
      error: error.message || 'Не удалось подключиться к комнате'
    });
  }
});


/* =========================================================
   ROOM PLAYERS
========================================================= */

app.get('/api/rooms/:roomId/players', async (req, res) => {
  try {
    const result = await pool.query(
      `
        SELECT
          u.id,
          u.username AS name,
          cm.role,
          cm.joined_at
        FROM campaign_members cm
        JOIN users u
          ON u.id = cm.user_id
        JOIN rooms r
          ON r.campaign_id = cm.campaign_id
        WHERE r.id = $1
        ORDER BY cm.joined_at
      `,
      [req.params.roomId]
    );

    res.json({
      players: result.rows
    });

  } catch (error) {
    console.error('Get players error:', error);

    res.status(500).json({
      error: 'Не удалось получить список игроков'
    });
  }
});


/* =========================================================
   DELETE PLAYER
========================================================= */

app.delete(
  '/api/rooms/:roomId/players/:playerId',
  async (req, res) => {
    try {
      const roomResult = await pool.query(
        `
          SELECT campaign_id
          FROM rooms
          WHERE id = $1
        `,
        [req.params.roomId]
      );

      if (!roomResult.rowCount) {
        return res.status(404).json({
          error: 'Комната не найдена'
        });
      }

      const campaignId = roomResult.rows[0].campaign_id;

      await pool.query(
        `
          DELETE FROM campaign_members
          WHERE campaign_id = $1
            AND user_id = $2
        `,
        [
          campaignId,
          req.params.playerId
        ]
      );

      broadcast(req.params.roomId, {
        type: 'players_updated'
      });

      res.json({
        success: true
      });

    } catch (error) {
      console.error('Delete player error:', error);

      res.status(500).json({
        error: 'Не удалось удалить игрока'
      });
    }
  }
);


/* =========================================================
   ROOM STATE
========================================================= */

app.get(
  '/api/rooms/:roomId/state',
  async (req, res) => {
    try {
      const result = await getRoomState(
        req.params.roomId
      );

      res.json({
        state: result.state || {},
        updatedAt: result.updated_at
      });

    } catch (error) {
      console.error('Get room state error:', error);

      res.status(500).json({
        error: 'Не удалось получить состояние комнаты'
      });
    }
  }
);


app.put(
  '/api/rooms/:roomId/state',
  async (req, res) => {
    try {
      const roomId = req.params.roomId;
      const state = req.body?.state || {};

      await saveRoomState(
        roomId,
        state
      );

      broadcast(roomId, {
        type: 'state_snapshot',
        state,
        from: req.body?.from || null,
        updatedAt: new Date().toISOString()
      });

      res.json({
        success: true
      });

    } catch (error) {
      console.error('Save room state error:', error);

      res.status(500).json({
        error: 'Не удалось сохранить состояние комнаты'
      });
    }
  }
);


/* =========================================================
   WEBSOCKET
========================================================= */

wss.on('connection', async (ws, req) => {
  try {
    const url = new URL(
      req.url,
      'http://localhost'
    );

    const roomId =
      url.searchParams.get('roomId');

    const playerId =
      url.searchParams.get('playerId');

    if (!roomId || !playerId) {
      ws.close(
        1008,
        'roomId/playerId required'
      );
      return;
    }

    /*
      Добавляем сокет в комнату
    */

    if (!sockets.has(roomId)) {
      sockets.set(
        roomId,
        new Set()
      );
    }

    sockets
      .get(roomId)
      .add(ws);

    /*
      Сразу отправляем актуальное состояние
    */

    try {
      const current =
        await getRoomState(roomId);

      ws.send(
        JSON.stringify({
          type: 'state_snapshot',
          state: current.state || {},
          updatedAt: current.updated_at
        })
      );

    } catch (error) {
      console.error(
        'Initial state error:',
        error
      );
    }

    /*
      Сообщаем игрокам об изменении состава
    */

    broadcast(roomId, {
      type: 'players_updated'
    });


    /* =====================================================
       WS MESSAGES
    ===================================================== */

    ws.on('message', async raw => {
      try {
        const message =
          JSON.parse(raw.toString());


        /*
          PING
        */

        if (message.type === 'ping') {
          ws.send(
            JSON.stringify({
              type: 'pong'
            })
          );

          return;
        }


        /*
          GAME STATE
        */

        if (message.type === 'state_update') {
          const nextState =
            message.state || {};

          await saveRoomState(
            roomId,
            nextState
          );

          broadcast(roomId, {
            type: 'state_snapshot',
            state: nextState,
            from: playerId,
            updatedAt:
              new Date().toISOString()
          });

          return;
        }


        /*
          DICE
        */

        if (message.type === 'dice_roll') {
          broadcast(roomId, {
            type: 'dice_roll',
            roll: message.roll || {},
            from: playerId,
            playerName:
              message.playerName || 'Игрок'
          });

          return;
        }


        /*
          CANVAS
        */

        if (message.type === 'canvas_update') {
          broadcast(roomId, {
            type: 'canvas_update',
            canvas:
              message.canvas || null,
            canvasType:
              message.canvasType || 'draw',
            from: playerId
          });

          return;
        }


        /*
          GENERIC ROOM EVENT
        */

        if (message.type === 'room_event') {
          broadcast(roomId, {
            type: 'room_event',
            from: playerId,
            event: message.event
          });

          return;
        }

      } catch (error) {
        console.error(
          'WS message error:',
          error
        );
      }
    });


    /*
      DISCONNECT
    */

    ws.on('close', () => {
      const set =
        sockets.get(roomId);

      set?.delete(ws);

      if (set?.size === 0) {
        sockets.delete(roomId);
      }

      broadcast(roomId, {
        type: 'players_updated'
      });
    });

  } catch (error) {
    console.error(
      'WebSocket connection error:',
      error
    );

    ws.close(
      1011,
      'Internal server error'
    );
  }
});


/* =========================================================
   GLOBAL ERROR HANDLER
========================================================= */

app.use(
  (err, _req, res, _next) => {
    console.error(
      'Unhandled server error:',
      err
    );

    res.status(500).json({
      error:
        err.message ||
        'Внутренняя ошибка сервера'
    });
  }
);


/* =========================================================
   START
========================================================= */

server.listen(
  PORT,
  () => {
    console.log(
      `D&D Toolkit backend: http://localhost:${PORT}`
    );
  }
);
```
