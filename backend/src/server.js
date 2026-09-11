import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import pg from 'pg';
import { WebSocketServer } from 'ws';
import http from 'http';
import crypto from 'crypto';
dotenv.config();
const {Pool}=pg;
const PORT=Number(process.env.PORT||5000);
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_URL?.includes('localhost')?false:{rejectUnauthorized:false}});
const app=express(); app.use(cors({origin:process.env.CORS_ORIGIN?.split(',').map(s=>s.trim())||true,credentials:true})); app.use(express.json({limit:'2mb'}));
const server=http.createServer(app); const wss=new WebSocketServer({server,path:'/ws'}); const sockets=new Map();
function code(){return crypto.randomBytes(4).toString('hex').toUpperCase().slice(0,6)}
function broadcast(roomId,message){const set=sockets.get(String(roomId)); if(!set)return; const data=JSON.stringify(message); for(const ws of set) if(ws.readyState===1)ws.send(data)}
app.get('/api/health',async(_req,res)=>{try{await pool.query('SELECT 1');res.json({success:true,database:'connected'})}catch(e){res.status(503).json({success:false,database:'disconnected',error:e.message})}});
app.post('/api/campaigns',async(req,res)=>{const {name,description='',masterName}=req.body||{}; if(!name||!masterName)return res.status(400).json({error:'Название кампании и имя мастера обязательны'}); const c=await pool.query('INSERT INTO campaigns(name,description) VALUES($1,$2) RETURNING *',[name,description]); let roomCode; for(let i=0;i<10;i++){const x=code(); try{const r=await pool.query('INSERT INTO rooms(campaign_id,code) VALUES($1,$2) RETURNING *',[c.rows[0].id,x]);roomCode=r.rows[0];break}catch(e){if(e.code!=='23505')throw e}} if(!roomCode)return res.status(500).json({error:'Не удалось создать код комнаты'}); const p=await pool.query("INSERT INTO room_players(room_id,name,role) VALUES($1,$2,'master') RETURNING id,name,role",[roomCode.id,masterName]); res.status(201).json({campaign:c.rows[0],room:roomCode,player:p.rows[0]})});
app.get('/api/campaigns',async(_req,res)=>{const r=await pool.query('SELECT c.*,count(rp.id)::int AS player_count FROM campaigns c LEFT JOIN rooms r ON r.campaign_id=c.id LEFT JOIN room_players rp ON rp.room_id=r.id GROUP BY c.id ORDER BY c.created_at DESC');res.json({campaigns:r.rows})});
app.post('/api/rooms/join',async(req,res)=>{const {code:rawCode,playerName}=req.body||{};const code=String(rawCode||'').trim().toUpperCase(); if(!code||!playerName)return res.status(400).json({error:'Код комнаты и имя обязательны'}); const r=await pool.query('SELECT r.*,c.name AS campaign_name,c.description FROM rooms r JOIN campaigns c ON c.id=r.campaign_id WHERE r.code=$1 AND r.status=\'active\'',[code]); if(!r.rowCount)return res.status(404).json({error:'Комната не найдена'}); try{const p=await pool.query("INSERT INTO room_players(room_id,name,role) VALUES($1,$2,'player') RETURNING id,name,role",[r.rows[0].id,playerName]); const room=r.rows[0]; broadcast(room.id,{type:'players_updated'}); res.json({campaign:{id:room.campaign_id,name:room.campaign_name,description:room.description},room:{id:room.id,code:room.code,status:room.status},player:p.rows[0]})}catch(e){if(e.code==='23505')return res.status(409).json({error:'Игрок с таким именем уже находится в комнате'});throw e}});

async function getRoomState(roomId){
  const r=await pool.query('SELECT state,updated_at FROM room_state WHERE room_id=$1',[roomId]);
  return r.rowCount ? r.rows[0] : {state:{},updated_at:null};
}
async function saveRoomState(roomId,state){
  await pool.query(
    `INSERT INTO room_state(room_id,state,updated_at) VALUES($1,$2::jsonb,NOW())
     ON CONFLICT(room_id) DO UPDATE SET state=EXCLUDED.state,updated_at=NOW()`,
    [roomId, JSON.stringify(state || {})]
  );
}

app.get('/api/rooms/:roomId/state',async(req,res)=>{
  try{
    const r=await getRoomState(req.params.roomId);
    res.json({state:r.state||{},updatedAt:r.updated_at});
  }catch(e){res.status(500).json({error:'Не удалось получить состояние комнаты'});}
});

app.put('/api/rooms/:roomId/state',async(req,res)=>{
  try{
    const roomId=req.params.roomId;
    await saveRoomState(roomId,req.body?.state||{});
    broadcast(roomId,{type:'state_updated',state:req.body?.state||{},from:req.body?.from||null});
    res.json({success:true});
  }catch(e){console.error(e);res.status(500).json({error:'Не удалось сохранить состояние комнаты'});}
});

app.get('/api/rooms/:roomId/players',async(req,res)=>{const r=await pool.query('SELECT id,name,role,joined_at,last_seen_at FROM room_players WHERE room_id=$1 ORDER BY joined_at',[req.params.roomId]);res.json({players:r.rows})});
app.delete('/api/rooms/:roomId/players/:playerId',async(req,res)=>{await pool.query('DELETE FROM room_players WHERE id=$1 AND room_id=$2',[req.params.playerId,req.params.roomId]);broadcast(req.params.roomId,{type:'players_updated'});res.json({success:true})});
wss.on('connection',async(ws,req)=>{
  const u=new URL(req.url,'http://localhost');
  const roomId=u.searchParams.get('roomId'),playerId=u.searchParams.get('playerId');
  if(!roomId||!playerId)return ws.close(1008,'roomId/playerId required');

  if(!sockets.has(roomId))sockets.set(roomId,new Set());
  sockets.get(roomId).add(ws);

  await pool.query(
    'UPDATE room_players SET last_seen_at=NOW() WHERE id=$1 AND room_id=$2',
    [playerId,roomId]
  );

  // Immediately give the newly connected client the latest game state.
  try{
    const current=await getRoomState(roomId);
    ws.send(JSON.stringify({type:'state_snapshot',state:current.state||{},updatedAt:current.updated_at}));
  }catch(e){console.error(e);}

  broadcast(roomId,{type:'players_updated'});

  ws.on('message',async raw=>{
    try{
      const m=JSON.parse(raw.toString());

      if(m.type==='ping'){
        ws.send(JSON.stringify({type:'pong'}));
        return;
      }

      if(m.type==='state_update'){
        const nextState=m.state||{};
        await saveRoomState(roomId,nextState);
        broadcast(roomId,{
          type:'state_snapshot',
          state:nextState,
          from:playerId,
          updatedAt:new Date().toISOString()
        });
        return;
      }

      if(m.type==='dice_roll'){
        // Dice results are generated by the sender and then broadcast unchanged,
        // so every participant sees exactly the same result.
        broadcast(roomId,{
          type:'dice_roll',
          roll:m.roll||{},
          from:playerId,
          playerName:m.playerName||'Игрок'
        });
        return;
      }

      if(m.type==='canvas_update'){
        // Canvas images are sent explicitly after a drawing/fog operation,
        // not on every mouse movement.
        broadcast(roomId,{
          type:'canvas_update',
          canvas:m.canvas||null,
          canvasType:m.canvasType||'draw',
          from:playerId
        });
        return;
      }

      if(m.type==='room_event'){
        broadcast(roomId,{type:'room_event',from:playerId,event:m.event});
      }
    }catch(e){
      console.error('WS message error:',e);
    }
  });

  ws.on('close',()=>{
    const set=sockets.get(roomId);
    set?.delete(ws);
    if(set?.size===0)sockets.delete(roomId);
    broadcast(roomId,{type:'players_updated'});
  });
});

app.use((err,_req,res,_next)=>{console.error(err);res.status(500).json({error:'Внутренняя ошибка сервера'})});
server.listen(PORT,()=>console.log(`D&D Toolkit backend: http://localhost:${PORT}`));
