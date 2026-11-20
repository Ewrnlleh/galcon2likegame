import type {
  Difficulty,
  GameRule,
  MapType,
  MatchConfig,
  NetGameSnapshot,
} from '../game/types';

export type {
  NetCaptureEvent,
  NetEliminationEvent,
  NetGameSnapshot,
  NetPlanetTuple,
  NetShipTuple,
} from '../game/types';

export const PEER_ID_PREFIX = 'gn2-room-';
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const MAX_ROOM_PLAYERS = 6;

export interface NetPlayerInfo {
  peerId: string;
  name: string;
  factionId: number;
  isHost: boolean;
  connected: boolean;
}

export interface NetLobbySettings {
  mapType: MapType;
  planetCount: number;
  rule: GameRule;
  botCount: number;
  botDifficulty: Difficulty;
  seed: number;
}

export interface NetChatMessage {
  sender: string;
  color: string;
  text: string;
  system?: boolean;
  ts: number;
}

export interface NetLobbyState {
  roomCode: string;
  status: 'lobby' | 'playing';
  players: NetPlayerInfo[];
  settings: NetLobbySettings;
}

export type NetClientCommand =
  | { type: 'cmd'; action: 'send'; fromIds: number[]; targetId: number; percent: number }
  | { type: 'cmd'; action: 'redirect'; shipIds: number[]; targetId: number }
  | { type: 'cmd'; action: 'rally'; planetIds: number[]; targetId: number | null };

export type NetClientMessage =
  | { type: 'hello'; name: string }
  | NetClientCommand
  | { type: 'chat'; text: string }
  | { type: 'update_name'; name: string };

export type NetHostMessage =
  | {
      type: 'welcome';
      yourFactionId: number;
      yourPeerId: string;
      lobby: NetLobbyState;
      chat: NetChatMessage[];
    }
  | { type: 'lobby_update'; lobby: NetLobbyState }
  | { type: 'chat_broadcast'; message: NetChatMessage }
  | { type: 'start_match'; config: MatchConfig; title: string }
  | { type: 'snapshot'; snapshot: NetGameSnapshot }
  | { type: 'return_lobby'; lobby: NetLobbyState }
  | { type: 'kicked'; reason: string }
  | { type: 'error'; message: string };

export type NetMessage = NetClientMessage | NetHostMessage;

export function generateRoomCode(length = 6): string {
  let code = '';
  for (let i = 0; i < length; i++) {
    const idx = Math.floor(Math.random() * ROOM_CODE_ALPHABET.length);
    code += ROOM_CODE_ALPHABET[idx];
  }
  return code;
}

export function extractRoomCodeFromInput(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Try URL or query parameter ?oda=XXXXXX
  const match = trimmed.match(/[?&]oda=([A-Za-z0-9]{6})/i);
  if (match) {
    return match[1].toUpperCase();
  }

  // Raw 6-char room code
  const cleaned = trimmed.toUpperCase();
  if (/^[A-Z0-9]{6}$/.test(cleaned)) {
    return cleaned;
  }

  return null;
}

export function buildInviteUrl(code: string): string {
  if (typeof window === 'undefined') {
    return `?oda=${code.toUpperCase()}`;
  }
  return `${window.location.origin}${window.location.pathname}?oda=${code.toUpperCase()}`;
}

export function sanitizeNickname(raw: string): string {
  const cleaned = raw.trim().replace(/\s+/g, ' ').slice(0, 16);
  return cleaned || 'Komutan';
}
