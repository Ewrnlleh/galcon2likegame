import Peer, { type DataConnection, type PeerOptions } from 'peerjs';
import { FACTION_PALETTE, MAP_TYPE_LABELS, PLAYER_ID } from '../game/constants';
import type { CustomFactionSpec, MatchConfig, NetGameSnapshot } from '../game/types';
import {
  MAX_ROOM_PLAYERS,
  PEER_ID_PREFIX,
  generateRoomCode,
  sanitizeNickname,
  type NetChatMessage,
  type NetClientCommand,
  type NetClientMessage,
  type NetHostMessage,
  type NetLobbySettings,
  type NetLobbyState,
  type NetPlayerInfo,
} from './protocol';

const NICKNAME_STORAGE_KEY = 'galcon_nova_nickname_v1';

export type PeerRole = 'none' | 'host' | 'guest';

export interface PeerRoomCallbacks {
  onLobbyChange: (lobby: NetLobbyState, chat: NetChatMessage[]) => void;
  onMatchStart: (
    config: MatchConfig,
    title: string,
    isHost: boolean,
    localFactionId: number,
  ) => void;
  onSnapshot: (snapshot: NetGameSnapshot) => void;
  onRemoteCommand: (factionId: number, cmd: NetClientCommand) => void;
  onReturnToLobby: (lobby: NetLobbyState, chat: NetChatMessage[]) => void;
  onPlayerDisconnectedInGame: (factionId: number, playerName: string) => void;
  onDisconnected: (reason: string) => void;
  onError: (message: string) => void;
}

function buildPeerOptions(): PeerOptions {
  const opts: PeerOptions = {
    config: {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:global.stun.twilio.com:3478' },
      ],
    },
  };

  const customHost = import.meta.env.VITE_PEER_HOST as string | undefined;
  const customPort = import.meta.env.VITE_PEER_PORT as string | undefined;
  const customPath = import.meta.env.VITE_PEER_PATH as string | undefined;
  if (customHost) {
    opts.host = customHost;
    if (customPort) opts.port = Number(customPort);
    if (customPath) opts.path = customPath;
    opts.secure = window.location.protocol === 'https:';
  }

  return opts;
}

export function loadSavedNickname(): string {
  try {
    return sanitizeNickname(localStorage.getItem(NICKNAME_STORAGE_KEY) ?? '');
  } catch {
    return 'Komutan';
  }
}

export function saveNickname(name: string): string {
  const clean = sanitizeNickname(name);
  try {
    localStorage.setItem(NICKNAME_STORAGE_KEY, clean);
  } catch {
    // Ignore storage errors
  }
  return clean;
}

export class PeerRoomManager {
  role: PeerRole = 'none';
  roomCode = '';
  localPeerId = '';
  localFactionId = PLAYER_ID;
  lobbyState: NetLobbyState | null = null;
  chatHistory: NetChatMessage[] = [];

  private callbacks: PeerRoomCallbacks;
  private peer: Peer | null = null;
  private hostConn: DataConnection | null = null;
  private guestConns = new Map<string, DataConnection>();
  private intentionalLeave = false;

  constructor(callbacks: PeerRoomCallbacks) {
    this.callbacks = callbacks;
  }

  async createRoom(nickname: string): Promise<string> {
    this.leaveRoom();
    this.intentionalLeave = false;
    const cleanName = saveNickname(nickname);

    let lastErr: Error | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const code = generateRoomCode();
      try {
        await this.openHostPeer(code, cleanName);
        return code;
      } catch (err) {
        lastErr = err instanceof Error ? err : new Error(String(err));
        this.destroyPeerOnly();
      }
    }

    this.role = 'none';
    throw lastErr ?? new Error('Oda oluşturulamadı');
  }

  private openHostPeer(code: string, hostName: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const peerId = `${PEER_ID_PREFIX}${code}`;
      const peer = new Peer(peerId, buildPeerOptions());
      this.peer = peer;

      let settled = false;
      const timer = window.setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error('Sinyal sunucusuna bağlanılamadı.'));
        }
      }, 12000);

      peer.on('open', (id) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);

        this.role = 'host';
        this.roomCode = code;
        this.localPeerId = id;
        this.localFactionId = PLAYER_ID;
        this.chatHistory = [];

        this.lobbyState = {
          roomCode: code,
          status: 'lobby',
          players: [
            {
              peerId: id,
              name: hostName,
              factionId: PLAYER_ID,
              isHost: true,
              connected: true,
            },
          ],
          settings: {
            mapType: 'classic',
            planetCount: 26,
            rule: 'standard',
            botCount: 0,
            botDifficulty: 'normal',
            seed: Math.floor(Math.random() * 900000) + 10000,
          },
        };

        this.pushSystemChat(`${hostName} odayı oluşturdu.`);
        this.bindHostEvents(peer);
        this.callbacks.onLobbyChange(this.lobbyState, this.chatHistory);
        resolve(code);
      });

      peer.on('error', (err) => {
        const msg =
          err.type === 'unavailable-id'
            ? 'Oda kodu çakıştı, yeniden deneniyor...'
            : `Bağlantı hatası: ${err.message || err.type}`;
        if (!settled) {
          settled = true;
          window.clearTimeout(timer);
          reject(new Error(msg));
        } else if (!this.intentionalLeave) {
          this.callbacks.onError(msg);
        }
      });
    });
  }

  private bindHostEvents(peer: Peer): void {
    peer.on('connection', (conn) => {
      conn.on('open', () => {
        // Wait for hello
      });

      conn.on('data', (raw) => {
        const msg = raw as NetClientMessage;
        if (!msg || typeof msg !== 'object') return;
        this.handleHostMessage(conn, msg);
      });

      conn.on('close', () => {
        this.handleGuestDrop(conn.peer);
      });

      conn.on('error', () => {
        this.handleGuestDrop(conn.peer);
      });
    });
  }

  private handleHostMessage(conn: DataConnection, msg: NetClientMessage): void {
    if (!this.lobbyState) return;

    if (msg.type === 'hello') {
      if (this.lobbyState.status !== 'lobby') {
        this.sendToConn(conn, { type: 'error', message: 'Maç zaten başladı.' });
        conn.close();
        return;
      }

      if (this.lobbyState.players.length >= MAX_ROOM_PLAYERS) {
        this.sendToConn(conn, {
          type: 'error',
          message: `Oda dolu (maksimum ${MAX_ROOM_PLAYERS} oyuncu).`,
        });
        conn.close();
        return;
      }

      const existing = this.lobbyState.players.find((p) => p.peerId === conn.peer);
      const cleanName = sanitizeNickname(msg.name);

      if (!existing) {
        const factionId = PLAYER_ID + this.lobbyState.players.length;
        const player: NetPlayerInfo = {
          peerId: conn.peer,
          name: cleanName,
          factionId,
          isHost: false,
          connected: true,
        };
        this.lobbyState.players.push(player);
        this.guestConns.set(conn.peer, conn);
        this.clampBotCount();

        this.sendToConn(conn, {
          type: 'welcome',
          yourFactionId: factionId,
          yourPeerId: conn.peer,
          lobby: this.lobbyState,
          chat: this.chatHistory,
        });

        this.pushSystemChat(`${cleanName} odaya katıldı.`);
        this.broadcastHostLobby();
      }
      return;
    }

    const sender = this.lobbyState.players.find((p) => p.peerId === conn.peer);
    if (!sender) return;

    if (msg.type === 'cmd') {
      if (this.lobbyState.status === 'playing') {
        this.callbacks.onRemoteCommand(sender.factionId, msg);
      }
      return;
    }

    if (msg.type === 'chat') {
      const text = msg.text.trim().slice(0, 140);
      if (!text) return;
      const color = FACTION_PALETTE[sender.factionId]?.color ?? '#00e5ff';
      const entry: NetChatMessage = {
        sender: sender.name,
        color,
        text,
        ts: Date.now(),
      };
      this.appendChat(entry);
      this.broadcastToAllGuests({ type: 'chat_broadcast', message: entry });
      this.callbacks.onLobbyChange(this.lobbyState, this.chatHistory);
      return;
    }

    if (msg.type === 'update_name') {
      sender.name = sanitizeNickname(msg.name);
      this.broadcastHostLobby();
    }
  }

  private handleGuestDrop(peerId: string): void {
    if (!this.lobbyState || this.role !== 'host') return;
    this.guestConns.delete(peerId);

    const idx = this.lobbyState.players.findIndex((p) => p.peerId === peerId);
    if (idx === -1) return;

    const dropped = this.lobbyState.players[idx];
    if (this.lobbyState.status === 'lobby') {
      this.lobbyState.players.splice(idx, 1);
      // Re-index lobby faction IDs cleanly so slots remain contiguous
      this.lobbyState.players.forEach((p, i) => {
        p.factionId = PLAYER_ID + i;
      });
      this.pushSystemChat(`${dropped.name} odadan ayrıldı.`);
      this.broadcastHostLobby();
    } else if (dropped.connected) {
      dropped.connected = false;
      this.pushSystemChat(`${dropped.name} bağlantısı koptu — yapay zeka devraldı.`);
      this.callbacks.onPlayerDisconnectedInGame(dropped.factionId, dropped.name);
    }
  }

  joinRoom(code: string, nickname: string): Promise<void> {
    this.leaveRoom();
    this.intentionalLeave = false;
    const cleanName = saveNickname(nickname);
    const normalizedCode = code.trim().toUpperCase();

    return new Promise((resolve, reject) => {
      const peer = new Peer(buildPeerOptions());
      this.peer = peer;
      this.role = 'guest';
      this.roomCode = normalizedCode;

      let settled = false;
      const timeoutId = window.setTimeout(() => {
        if (!settled) {
          settled = true;
          this.leaveRoom();
          reject(
            new Error(
              'Odaya bağlanılamadı. Oda kodu hatalı olabilir veya oda kurucusu çevrimdışı.',
            ),
          );
        }
      }, 12000);

      const failJoin = (message: string) => {
        if (!settled) {
          settled = true;
          window.clearTimeout(timeoutId);
          this.leaveRoom();
          reject(new Error(message));
        } else if (!this.intentionalLeave) {
          this.leaveRoom();
          this.callbacks.onDisconnected(message);
        }
      };

      peer.on('open', (myId) => {
        this.localPeerId = myId;
        const conn = peer.connect(`${PEER_ID_PREFIX}${normalizedCode}`, {
          reliable: true,
          serialization: 'json',
        });
        this.hostConn = conn;

        conn.on('open', () => {
          this.sendToConn(conn, { type: 'hello', name: cleanName });
        });

        conn.on('data', (raw) => {
          const msg = raw as NetHostMessage;
          if (!msg || typeof msg !== 'object') return;

          if (msg.type === 'welcome') {
            if (!settled) {
              settled = true;
              window.clearTimeout(timeoutId);
              this.localFactionId = msg.yourFactionId;
              this.localPeerId = msg.yourPeerId;
              this.lobbyState = msg.lobby;
              this.chatHistory = msg.chat ?? [];
              this.callbacks.onLobbyChange(this.lobbyState, this.chatHistory);
              resolve();
            }
            return;
          }

          if (msg.type === 'error') {
            failJoin(msg.message);
            return;
          }

          this.handleGuestMessage(msg);
        });

        conn.on('close', () => {
          if (!this.intentionalLeave) {
            failJoin('Oda kurucusuyla bağlantı kesildi.');
          }
        });

        conn.on('error', () => {
          if (!this.intentionalLeave) {
            failJoin('Oda bağlantısında hata oluştu.');
          }
        });
      });

      peer.on('error', (err) => {
        if (err.type === 'peer-unavailable') {
          failJoin('Bu koda sahip aktif bir oda bulunamadı.');
        } else {
          failJoin(`Bağlantı hatası: ${err.message || err.type}`);
        }
      });
    });
  }

  private handleGuestMessage(msg: NetHostMessage): void {
    switch (msg.type) {
      case 'lobby_update': {
        this.lobbyState = msg.lobby;
        const self = msg.lobby.players.find((p) => p.peerId === this.localPeerId);
        if (self) {
          this.localFactionId = self.factionId;
        }
        this.callbacks.onLobbyChange(this.lobbyState, this.chatHistory);
        break;
      }

      case 'chat_broadcast': {
        this.appendChat(msg.message);
        if (this.lobbyState) {
          this.callbacks.onLobbyChange(this.lobbyState, this.chatHistory);
        }
        break;
      }

      case 'start_match': {
        if (this.lobbyState) {
          this.lobbyState.status = 'playing';
        }
        const cfg: MatchConfig = {
          ...msg.config,
          localPlayerId: this.localFactionId,
        };
        this.callbacks.onMatchStart(cfg, msg.title, false, this.localFactionId);
        break;
      }

      case 'snapshot': {
        this.callbacks.onSnapshot(msg.snapshot);
        break;
      }

      case 'return_lobby': {
        this.lobbyState = msg.lobby;
        const self = msg.lobby.players.find((p) => p.peerId === this.localPeerId);
        if (self) {
          this.localFactionId = self.factionId;
        }
        this.callbacks.onReturnToLobby(this.lobbyState, this.chatHistory);
        break;
      }

      case 'kicked': {
        const reason = msg.reason;
        this.leaveRoom();
        this.callbacks.onDisconnected(reason);
        break;
      }
    }
  }

  updateSettings(partial: Partial<NetLobbySettings>): void {
    if (this.role !== 'host' || !this.lobbyState || this.lobbyState.status !== 'lobby') return;
    this.lobbyState.settings = {
      ...this.lobbyState.settings,
      ...partial,
    };
    this.clampBotCount();
    this.broadcastHostLobby();
  }

  kickPlayer(peerId: string): void {
    if (this.role !== 'host' || !this.lobbyState || this.lobbyState.status !== 'lobby') return;
    const conn = this.guestConns.get(peerId);
    if (conn) {
      this.sendToConn(conn, {
        type: 'kicked',
        reason: 'Oda kurucusu tarafından odadan çıkarıldın.',
      });
      setTimeout(() => conn.close(), 60);
      this.guestConns.delete(peerId);
    }

    const idx = this.lobbyState.players.findIndex((p) => p.peerId === peerId);
    if (idx !== -1) {
      const removed = this.lobbyState.players.splice(idx, 1)[0];
      this.lobbyState.players.forEach((p, i) => {
        p.factionId = PLAYER_ID + i;
      });
      this.pushSystemChat(`${removed.name} odadan çıkarıldı.`);
      this.broadcastHostLobby();
    }
  }

  startMatch(): void {
    if (this.role !== 'host' || !this.lobbyState) return;
    const { settings, players } = this.lobbyState;
    const totalFactions = Math.min(MAX_ROOM_PLAYERS, players.length + settings.botCount);
    if (totalFactions < 2) {
      this.callbacks.onError('Maçı başlatmak için en az 2 oyuncu (veya 1 bot) gerekir.');
      return;
    }

    // Remove any lingering disconnected slots from previous match
    this.lobbyState.players = players.filter((p) => p.connected);
    this.lobbyState.players.forEach((p, i) => {
      p.factionId = PLAYER_ID + i;
    });
    this.clampBotCount();

    const customFactions: CustomFactionSpec[] = [];
    for (const p of this.lobbyState.players) {
      customFactions.push({
        id: p.factionId,
        name: p.name,
        isHuman: true,
      });
    }

    const activeBots = Math.min(
      this.lobbyState.settings.botCount,
      MAX_ROOM_PLAYERS - customFactions.length,
    );
    for (let b = 0; b < activeBots; b++) {
      const id = PLAYER_ID + customFactions.length;
      const palette = FACTION_PALETTE[id];
      customFactions.push({
        id,
        name: `${palette?.name ?? `Bot ${b + 1}`} (Bot)`,
        isHuman: false,
        difficulty: settings.botDifficulty,
      });
    }

    const config: MatchConfig = {
      mode: 'online',
      mapType: settings.mapType,
      planetCount: settings.planetCount,
      opponents: customFactions.length - 1,
      difficulty: settings.botDifficulty,
      rule: settings.rule,
      seed: settings.seed,
      localPlayerId: this.localFactionId,
      customFactions,
    };

    const title = `Online Oda #${this.roomCode} • ${MAP_TYPE_LABELS[settings.mapType].name}`;
    this.lobbyState.status = 'playing';

    this.broadcastToAllGuests({
      type: 'start_match',
      config: { ...config, localPlayerId: undefined },
      title,
    });

    this.callbacks.onMatchStart(config, title, true, this.localFactionId);
  }

  returnAllToLobby(): void {
    if (this.role !== 'host' || !this.lobbyState) return;
    this.lobbyState.status = 'lobby';
    this.lobbyState.players = this.lobbyState.players.filter((p) => p.connected);
    this.lobbyState.players.forEach((p, i) => {
      p.factionId = PLAYER_ID + i;
    });
    this.lobbyState.settings.seed = Math.floor(Math.random() * 900000) + 10000;
    this.clampBotCount();

    this.broadcastToAllGuests({ type: 'return_lobby', lobby: this.lobbyState });
    this.callbacks.onReturnToLobby(this.lobbyState, this.chatHistory);
  }

  broadcastSnapshot(snapshot: NetGameSnapshot): void {
    if (this.role !== 'host') return;
    this.broadcastToAllGuests({ type: 'snapshot', snapshot });
  }

  sendCommand(cmd: NetClientCommand): void {
    if (this.role !== 'guest' || !this.hostConn || !this.hostConn.open) return;
    this.sendToConn(this.hostConn, cmd);
  }

  sendChat(text: string): void {
    const clean = text.trim().slice(0, 140);
    if (!clean || !this.lobbyState) return;

    if (this.role === 'host') {
      const hostPlayer = this.lobbyState.players.find((p) => p.isHost);
      const entry: NetChatMessage = {
        sender: hostPlayer?.name ?? 'Kurucu',
        color: FACTION_PALETTE[this.localFactionId]?.color ?? '#00e5ff',
        text: clean,
        ts: Date.now(),
      };
      this.appendChat(entry);
      this.broadcastToAllGuests({ type: 'chat_broadcast', message: entry });
      this.callbacks.onLobbyChange(this.lobbyState, this.chatHistory);
    } else if (this.role === 'guest' && this.hostConn?.open) {
      this.sendToConn(this.hostConn, { type: 'chat', text: clean });
    }
  }

  leaveRoom(): void {
    this.intentionalLeave = true;
    for (const conn of this.guestConns.values()) {
      try {
        conn.close();
      } catch {
        // Ignore
      }
    }
    this.guestConns.clear();
    if (this.hostConn) {
      try {
        this.hostConn.close();
      } catch {
        // Ignore
      }
      this.hostConn = null;
    }
    this.destroyPeerOnly();
    this.role = 'none';
    this.roomCode = '';
    this.localPeerId = '';
    this.localFactionId = PLAYER_ID;
    this.lobbyState = null;
    this.chatHistory = [];
  }

  private destroyPeerOnly(): void {
    if (this.peer) {
      try {
        this.peer.destroy();
      } catch {
        // Ignore
      }
      this.peer = null;
    }
  }

  private clampBotCount(): void {
    if (!this.lobbyState) return;
    const maxBots = Math.max(0, MAX_ROOM_PLAYERS - this.lobbyState.players.length);
    this.lobbyState.settings.botCount = Math.max(
      0,
      Math.min(maxBots, this.lobbyState.settings.botCount),
    );
  }

  private pushSystemChat(text: string): void {
    const msg: NetChatMessage = {
      sender: 'Sistem',
      color: '#94a3b8',
      text,
      system: true,
      ts: Date.now(),
    };
    this.appendChat(msg);
    if (this.role === 'host') {
      this.broadcastToAllGuests({ type: 'chat_broadcast', message: msg });
    }
  }

  private appendChat(msg: NetChatMessage): void {
    this.chatHistory.push(msg);
    if (this.chatHistory.length > 40) {
      this.chatHistory.shift();
    }
  }

  private broadcastHostLobby(): void {
    if (!this.lobbyState) return;
    this.broadcastToAllGuests({ type: 'lobby_update', lobby: this.lobbyState });
    this.callbacks.onLobbyChange(this.lobbyState, this.chatHistory);
  }

  private broadcastToAllGuests(msg: NetHostMessage): void {
    for (const conn of this.guestConns.values()) {
      this.sendToConn(conn, msg);
    }
  }

  private sendToConn(conn: DataConnection, msg: NetClientMessage | NetHostMessage): void {
    try {
      if (conn.open) {
        conn.send(msg);
      }
    } catch {
      // Ignore closed channel error
    }
  }
}
