export type MapType = 'classic' | 'symmetric' | 'spiral' | 'ring' | 'grid' | 'clusters';
export type Difficulty = 'easy' | 'normal' | 'hard' | 'expert';
export type GameRule = 'standard' | 'turbo' | 'megacore' | 'superfleet';
export type AIPersonality = 'balanced' | 'aggressive' | 'expander' | 'opportunist';
export type MatchMode = 'skirmish' | 'campaign' | 'attract';
export type MatchStatus = 'playing' | 'victory' | 'defeat' | 'finished';

export interface FactionConfig {
  id: number;
  name: string;
  isPlayer: boolean;
  color: string;
  coreColor: string;
  glowColor: string;
  difficulty?: Difficulty;
  personality?: AIPersonality;
}

export interface FactionState extends FactionConfig {
  eliminated: boolean;
}

export interface PlanetCrater {
  angle: number;
  dist: number;
  r: number;
}

export interface Planet {
  id: number;
  x: number;
  y: number;
  radius: number;
  ownerId: number;
  ships: number;
  prodProgress: number;
  productionRate: number;
  rallyTargetId: number | null;
  rallyCooldown: number;
  hitFlash: number;
  capturePulse: number;
  pulseColor: string;
  craters: PlanetCrater[];
}

export interface Ship {
  id: number;
  ownerId: number;
  sourceId: number;
  targetId: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  count: number;
  age: number;
}

export interface PendingLaunch {
  ownerId: number;
  sourceId: number;
  targetId: number;
  remainingShips: number;
  emitTimer: number;
  originX: number;
  originY: number;
  originRadius: number;
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
}

export interface Shockwave {
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  alpha: number;
  color: string;
}

export interface MatchConfig {
  mode: MatchMode;
  sectorId?: number;
  mapType: MapType;
  planetCount: number;
  opponents: number;
  difficulty: Difficulty;
  rule: GameRule;
  seed: number;
  asymmetricStart?: boolean;
}

export interface PowerSample {
  time: number;
  shipsByFaction: Record<number, number>;
}

export interface MatchStats {
  elapsed: number;
  winnerId: number | null;
  planetsCaptured: number;
  planetsLost: number;
  shipsSent: number;
  shipsLost: number;
  shipsDestroyed: number;
  peakShips: number;
  powerHistory: PowerSample[];
}

export interface ViewportTransform {
  offsetX: number;
  offsetY: number;
  scale: number;
  cssWidth: number;
  cssHeight: number;
}

export interface FactionSummary {
  planets: number;
  ships: number;
  production: number;
}

export interface SimulationEvents {
  onLaunch?: (ownerId: number, shipCount: number) => void;
  onImpact?: (ownerId: number, targetOwnerId: number, isFriendly: boolean) => void;
  onCapture?: (
    planetId: number,
    newOwnerId: number,
    oldOwnerId: number,
    isPlayerInvolved: boolean,
  ) => void;
  onElimination?: (factionId: number, factionName: string) => void;
  onMatchEnd?: (status: MatchStatus, winnerId: number | null) => void;
}

export interface CampaignSector {
  id: number;
  name: string;
  subtitle: string;
  description: string;
  tip: string;
  mapType: MapType;
  opponents: number;
  difficulty: Difficulty;
  planetCount: number;
  rule: GameRule;
  seed: number;
  asymmetricStart?: boolean;
  starTimes: [number, number, number]; // [3 stars <=, 2 stars <=, 1 star (any win)]
}

export interface SectorProgress {
  completed: boolean;
  stars: number;
  bestTime: number | null;
}

export interface CampaignProgress {
  sectors: Record<number, SectorProgress>;
  unlockAll: boolean;
}
