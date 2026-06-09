// server.js — Backend WebSocket para "Opostos Perfeitos"
// Rode com: node server.js
const { WebSocketServer } = require("ws");
const http = require("http");
 
// Railway/Render injetam PORT automaticamente; fallback para 4000 local
const PORT = process.env.PORT || 4000;
 
// Servidor HTTP base (necessário para Railway/Render detectarem o serviço ativo)
const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Opostos Perfeitos — WebSocket Server OK");
});
 
const wss = new WebSocketServer({ server });
 
// rooms: { [roomId]: { players, deck, flipped, matched, currentPlayerIndex, difficulty, maxPlayers, gameStarted, gameOver } }
const rooms = {};
// clientRoom: Map<ws, { roomId, playerId }>
const clientRoom = new Map();
 
function broadcast(roomId, type, payload) {
  const room = rooms[roomId];
  if (!room) return;
  const msg = JSON.stringify({ type, payload });
  wss.clients.forEach((client) => {
    const info = clientRoom.get(client);
    if (info && info.roomId === roomId && client.readyState === 1) {
      client.send(msg);
    }
  });
}
 
function sendTo(ws, type, payload) {
  if (ws.readyState === 1) ws.send(JSON.stringify({ type, payload }));
}
 
function checkGameOver(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  if (room.matched.length === room.deck.length) {
    room.gameOver = true;
    broadcast(roomId, "ROOM_STATE", room);
  }
}
 
// [CHANGE 3] Encerra partida se restar menos de 2 jogadores durante o jogo
function checkPlayersRemaining(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  if (room.gameStarted && !room.gameOver && room.players.length < 2) {
    room.gameOver = true;
    broadcast(roomId, "ROOM_STATE", room);
  }
}
 
wss.on("connection", (ws) => {
  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const { type, payload } = msg;
 
    if (type === "GET_ROOM") {
      const room = rooms[payload.roomId] || null;
      if (payload.playerId && payload.roomId) {
        clientRoom.set(ws, { roomId: payload.roomId, playerId: payload.playerId });
      }
      sendTo(ws, "ROOM_STATE", room);
    }
 
    else if (type === "JOIN_ROOM") {
      const { roomId, player, isHost, difficulty, maxPlayers } = payload;
      if (!rooms[roomId]) {
        rooms[roomId] = {
          id: roomId,
          players: [],
          deck: [],
          flipped: [],
          matched: [],
          currentPlayerIndex: 0,
          difficulty: difficulty || "médio",
          maxPlayers: maxPlayers || 4,
          gameStarted: false,
          gameOver: false,
        };
      }
      const room = rooms[roomId];
 
      // [CHANGE 2] Bloqueia entrada de novos jogadores após o jogo iniciar
      if (room.gameStarted) {
        sendTo(ws, "ERROR", "O jogo já começou. Aguarde a próxima partida.");
        return;
      }
 
      if (!room.players.find((p) => p.id === player.id)) {
        if (room.players.length >= room.maxPlayers) {
          sendTo(ws, "ERROR", "Sala cheia!");
          return;
        }
        room.players.push({ ...player, score: 0, isHost: isHost && room.players.length === 0 });
      }
      clientRoom.set(ws, { roomId, playerId: player.id });
      broadcast(roomId, "ROOM_STATE", room);
    }
 
    else if (type === "UPDATE_SETTINGS") {
      const room = rooms[payload.roomId];
      if (!room) return;
      if (payload.difficulty) room.difficulty = payload.difficulty;
      if (payload.maxPlayers) room.maxPlayers = payload.maxPlayers;
      broadcast(payload.roomId, "ROOM_STATE", room);
    }
 
    else if (type === "START_GAME") {
      const room = rooms[payload.roomId];
      if (!room) return;
      room.deck = payload.deck;
      room.flipped = [];
      room.matched = [];
      room.currentPlayerIndex = 0;
      room.gameStarted = true;
      room.gameOver = false;
      room.players = room.players.map((p) => ({ ...p, score: 0 }));
      broadcast(payload.roomId, "ROOM_STATE", room);
    }
 
    else if (type === "FLIP_CARD") {
      const { roomId, cardId, playerId } = payload;
      const room = rooms[roomId];
      if (!room) return;
      if (room.flipped.includes(cardId) || room.matched.includes(cardId)) return;
      if (room.players[room.currentPlayerIndex]?.id !== playerId) return;
      if (room.flipped.length >= 2) return;
 
      room.flipped = [...room.flipped, cardId];
 
      if (room.flipped.length === 2) {
        const [a, b] = room.flipped.map((id) => room.deck.find((c) => c.id === id));
        broadcast(roomId, "ROOM_STATE", { ...room });
 
        setTimeout(() => {
          if (a && b && a.groupId === b.groupId && a.side !== b.side) {
            room.matched = [...room.matched, a.id, b.id];
            room.players[room.currentPlayerIndex].score += 1;
            room.flipped = [];
          } else {
            room.flipped = [];
            room.currentPlayerIndex = (room.currentPlayerIndex + 1) % room.players.length;
          }
          broadcast(roomId, "ROOM_STATE", { ...room });
          checkGameOver(roomId);
        }, 900);
      } else {
        broadcast(roomId, "ROOM_STATE", { ...room });
      }
    }
 
    else if (type === "RESTART_GAME") {
      const room = rooms[payload.roomId];
      if (!room) return;
      room.deck = payload.deck;
      room.flipped = [];
      room.matched = [];
      room.currentPlayerIndex = 0;
      room.gameStarted = true;
      room.gameOver = false;
      room.players = room.players.map((p) => ({ ...p, score: 0 }));
      broadcast(payload.roomId, "ROOM_STATE", room);
    }
 
    // Reseta a sala para o estado de lobby (antes do jogo começar)
    // Disparado quando jogadores voltam para o lobby após "Jogar Novamente"
    else if (type === "RESET_ROOM") {
      const room = rooms[payload.roomId];
      if (!room) return;
      room.deck = [];
      room.flipped = [];
      room.matched = [];
      room.currentPlayerIndex = 0;
      room.gameStarted = false;
      room.gameOver = false;
      room.players = room.players.map((p) => ({ ...p, score: 0 }));
      broadcast(payload.roomId, "ROOM_STATE", room);
    }
 
    // [CHANGE 3] PING — cliente envia a cada 5s para sinalizar que está vivo.
    // O servidor faz broadcast de PONG com o playerId para que os demais
    // clientes atualizem o timestamp desse jogador no lastPongRef.
    else if (type === "PING") {
      const { roomId, playerId } = payload;
      if (!roomId || !playerId) return;
      broadcast(roomId, "PONG", { playerId });
    }
 
    // [CHANGE 3] REMOVE_PLAYER — disparado por qualquer cliente que detecte
    // um jogador sem responder ao PONG por mais de 12s.
    // O servidor remove o jogador, reajusta o índice de turno e encerra
    // a partida se restar menos de 2 jogadores.
    else if (type === "REMOVE_PLAYER") {
      const { roomId, playerId } = payload;
      const room = rooms[roomId];
      if (!room) return;
 
      const idx = room.players.findIndex((p) => p.id === playerId);
      if (idx === -1) return; // já foi removido por outro cliente
 
      // Remove o jogador da lista
      room.players.splice(idx, 1);
 
      // Sala ficou vazia: destrói
      if (room.players.length === 0) {
        delete rooms[roomId];
        return;
      }
 
      // Reajusta índice do turno para não ultrapassar o array
      if (room.currentPlayerIndex >= room.players.length) {
        room.currentPlayerIndex = 0;
      }
 
      broadcast(roomId, "ROOM_STATE", { ...room });
 
      // Verifica se a partida deve encerrar por falta de jogadores
      checkPlayersRemaining(roomId);
    }
  });
 
  ws.on("close", () => {
    const info = clientRoom.get(ws);
    if (info) {
      const { roomId, playerId } = info;
      const room = rooms[roomId];
      if (room && !room.gameStarted) {
        // Fora do jogo: remove imediatamente do lobby
        room.players = room.players.filter((p) => p.id !== playerId);
        if (room.players.length === 0) {
          delete rooms[roomId];
        } else {
          broadcast(roomId, "ROOM_STATE", room);
        }
      }
      // Durante o jogo a remoção é feita via REMOVE_PLAYER (heartbeat),
      // que garante que o jogo continue sem travar esperando o próximo turno.
      clientRoom.delete(ws);
    }
  });
});
 
server.listen(PORT, () => {
  console.log(`✅ Servidor HTTP+WebSocket rodando na porta ${PORT}`);
});
