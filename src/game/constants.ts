import type { Difficulty, FactionConfig, GameRule, MapType } from './types';

export const WORLD_WIDTH = 1280;
export const WORLD_HEIGHT = 720;

export const MARGIN_X = 76;
export const MARGIN_Y = 86;

export const NEUTRAL_ID = 0;
export const PLAYER_ID = 1;

export const BASE_SHIP_SPEED = 122;
export const MIN_PLANET_RADIUS = 18;
export const MAX_PLANET_RADIUS = 44;

export const PRODUCTION_MIN = 0.85;
export const PRODUCTION_MAX = 4.2;

export const VISUAL_SHIP_SOFT_CAP = 850;
export const MAX_PARTICLES = 400;
export const MIN_PLANET_GAP = 22;

export const HOMEWORLD_RADIUS = 36;
export const HOMEWORLD_SHIPS_STANDARD = 100;
export const HOMEWORLD_SHIPS_SUPERFLEET = 150;

export const RALLY_INTERVAL = 2.4;
export const RALLY_MIN_SHIPS = 18;
export const LAUNCH_EMIT_INTERVAL = 0.035;
export const POWER_SAMPLE_INTERVAL = 2.0;

export const FACTION_PALETTE: Record<number, Omit<FactionConfig, 'isPlayer' | 'difficulty' | 'personality'>> = {
  0: {
    id: 0,
    name: 'Tarafsız',
    color: '#7c8ba1',
    coreColor: '#c3d0e3',
    glowColor: 'rgba(124, 139, 161, 0.35)',
  },
  1: {
    id: 1,
    name: 'Nova Filosu',
    color: '#00e5ff',
    coreColor: '#b8f7ff',
    glowColor: 'rgba(0, 229, 255, 0.6)',
  },
  2: {
    id: 2,
    name: 'Kızıl İmparatorluk',
    color: '#ff3366',
    coreColor: '#ffc2d1',
    glowColor: 'rgba(255, 51, 102, 0.6)',
  },
  3: {
    id: 3,
    name: 'Altın Armada',
    color: '#ffbe0b',
    coreColor: '#fff0b3',
    glowColor: 'rgba(255, 190, 11, 0.6)',
  },
  4: {
    id: 4,
    name: 'Zümrüt Sürü',
    color: '#22ff88',
    coreColor: '#c4ffe0',
    glowColor: 'rgba(34, 255, 136, 0.6)',
  },
  5: {
    id: 5,
    name: 'Mor Nebula',
    color: '#c04dff',
    coreColor: '#ecd1ff',
    glowColor: 'rgba(192, 77, 255, 0.6)',
  },
  6: {
    id: 6,
    name: 'Turuncu Nova',
    color: '#ff6b2b',
    coreColor: '#ffd2bd',
    glowColor: 'rgba(255, 107, 43, 0.6)',
  },
};

export const MAP_TYPE_LABELS: Record<MapType, { name: string; desc: string }> = {
  classic: { name: 'Klasik Uzay', desc: 'Dengeli dağılmış organik yıldız kümesi' },
  symmetric: { name: 'Simetrik Arena', desc: 'Tam dönel simetrili eşit mücadele' },
  spiral: { name: 'Sarmal Galaksi', desc: 'Merkez çekirdekten uzanan spiral kollar' },
  ring: { name: 'Yörünge Halkası', desc: 'İç ve dış halkalar, zengin merkez üssü' },
  grid: { name: 'Yıldız Ağı', desc: 'Düzenli altıgen ızgara taktik hattı' },
  clusters: { name: 'Takımyıldızlar', desc: 'Boğaz noktalarıyla bağlı ayrı kümeler' },
};

export const DIFFICULTY_LABELS: Record<Difficulty, { name: string; color: string }> = {
  easy: { name: 'Kolay', color: '#22ff88' },
  normal: { name: 'Orta', color: '#00e5ff' },
  hard: { name: 'Zor', color: '#ffbe0b' },
  expert: { name: 'Uzman', color: '#ff3366' },
};

export const RULE_LABELS: Record<GameRule, { name: string; desc: string }> = {
  standard: { name: 'Klasik', desc: 'Standart üretim ve gemi hızı' },
  turbo: { name: 'Turbo', desc: '1.6x üretim ve 1.45x gemi hızı' },
  megacore: { name: 'Büyük Çekirdek', desc: 'Merkezde devasa üretim gezegeni' },
  superfleet: { name: 'Süper Filo', desc: '150 başlangıç gemisiyle hızlı başlangıç' },
};

export function getRuleMultipliers(rule: GameRule): { prodMult: number; speedMult: number } {
  if (rule === 'turbo') {
    return { prodMult: 1.6, speedMult: 1.45 };
  }
  return { prodMult: 1.0, speedMult: 1.0 };
}
