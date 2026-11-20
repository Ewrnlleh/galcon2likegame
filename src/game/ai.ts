import { BASE_SHIP_SPEED, NEUTRAL_ID, getRuleMultipliers } from './constants';
import type { GameSimulation } from './simulation';
import type { AIPersonality, Difficulty, Planet } from './types';

interface ThinkConfig {
  interval: number;
  minReserve: number;
  considerIncoming: boolean;
  supportFrontline: boolean;
  vultureStrike: boolean;
  multiPlanetSync: boolean;
}

const DIFFICULTY_CFG: Record<Difficulty, ThinkConfig> = {
  easy: {
    interval: 1.8,
    minReserve: 14,
    considerIncoming: false,
    supportFrontline: false,
    vultureStrike: false,
    multiPlanetSync: false,
  },
  normal: {
    interval: 1.0,
    minReserve: 10,
    considerIncoming: true,
    supportFrontline: false,
    vultureStrike: false,
    multiPlanetSync: true,
  },
  hard: {
    interval: 0.55,
    minReserve: 7,
    considerIncoming: true,
    supportFrontline: true,
    vultureStrike: true,
    multiPlanetSync: true,
  },
  expert: {
    interval: 0.35,
    minReserve: 5,
    considerIncoming: true,
    supportFrontline: true,
    vultureStrike: true,
    multiPlanetSync: true,
  },
};

export class AIController {
  private timers = new Map<number, number>();
  private cfg: ThinkConfig;

  constructor(difficulty: Difficulty) {
    this.cfg = DIFFICULTY_CFG[difficulty];
  }

  reset(): void {
    this.timers.clear();
  }

  update(sim: GameSimulation, dt: number): void {
    for (const faction of sim.factions) {
      if (faction.id === NEUTRAL_ID || faction.isPlayer || faction.eliminated) {
        continue;
      }

      const prev = this.timers.get(faction.id);
      if (prev === undefined) {
        // Stagger initial think slightly per faction
        this.timers.set(faction.id, 0.25 + (faction.id % 5) * 0.14);
        continue;
      }

      const next = prev - dt;
      if (next <= 0) {
        const jitter = 0.88 + ((Math.sin(sim.elapsed * 13.7 + faction.id * 4.3) + 1) * 0.5) * 0.24;
        this.timers.set(faction.id, this.cfg.interval * jitter);
        this.thinkForFaction(sim, faction.id, faction.personality ?? 'balanced');
      } else {
        this.timers.set(faction.id, next);
      }
    }
  }

  private thinkForFaction(
    sim: GameSimulation,
    factionId: number,
    personality: AIPersonality,
  ): void {
    const owned = sim.planets.filter((p) => p.ownerId === factionId);
    if (owned.length === 0) return;

    const { prodMult, speedMult } = getRuleMultipliers(sim.config.rule);
    const shipSpeed = BASE_SHIP_SPEED * speedMult;

    // Precompute incoming friendly & hostile ships per planet
    const incomingFriendly = new Map<number, number>();
    const incomingHostile = new Map<number, number>();
    const incomingByFaction = new Map<number, Map<number, number>>();

    for (const ship of sim.ships) {
      if (ship.ownerId === factionId) {
        incomingFriendly.set(ship.targetId, (incomingFriendly.get(ship.targetId) ?? 0) + ship.count);
      } else {
        incomingHostile.set(ship.targetId, (incomingHostile.get(ship.targetId) ?? 0) + ship.count);
      }
      let byPlanet = incomingByFaction.get(ship.targetId);
      if (!byPlanet) {
        byPlanet = new Map<number, number>();
        incomingByFaction.set(ship.targetId, byPlanet);
      }
      byPlanet.set(ship.ownerId, (byPlanet.get(ship.ownerId) ?? 0) + ship.count);
    }

    for (const launch of sim.pendingLaunches) {
      if (launch.ownerId === factionId) {
        incomingFriendly.set(
          launch.targetId,
          (incomingFriendly.get(launch.targetId) ?? 0) + launch.remainingShips,
        );
      } else {
        incomingHostile.set(
          launch.targetId,
          (incomingHostile.get(launch.targetId) ?? 0) + launch.remainingShips,
        );
      }
    }

    const reservedSourceIds = new Set<number>();

    // 1. Defense: rescue threatened owned planets (Hard+)
    if (this.cfg.supportFrontline) {
      for (const threatened of owned) {
        const hostileIn = incomingHostile.get(threatened.id) ?? 0;
        const friendlyIn = incomingFriendly.get(threatened.id) ?? 0;
        const netDefense = threatened.ships + friendlyIn - hostileIn;
        if (hostileIn > 0 && netDefense < 4) {
          const deficit = Math.abs(netDefense) + 10;
          const helpers = owned
            .filter(
              (p) =>
                p.id !== threatened.id &&
                !reservedSourceIds.has(p.id) &&
                (incomingHostile.get(p.id) ?? 0) === 0 &&
                p.ships >= 22,
            )
            .sort((a, b) => dist(a, threatened) - dist(b, threatened));

          let sentTotal = 0;
          for (const helper of helpers) {
            const pct = helper.ships * 0.55 >= deficit ? 0.55 : 0.75;
            const sent = sim.sendShips([helper.id], threatened.id, factionId, pct);
            if (sent > 0) {
              reservedSourceIds.add(helper.id);
              sentTotal += sent;
            }
            if (sentTotal >= deficit) break;
          }
        }
      }
    }

    // 2. Offense / Expansion
    const targets = sim.planets.filter((p) => p.ownerId !== factionId);
    if (targets.length === 0) return;

    // Identify leading opponent for Expert focus
    let leaderId: number | null = null;
    let leaderShips = -1;
    for (const f of sim.factions) {
      if (f.id === NEUTRAL_ID || f.id === factionId || f.eliminated) continue;
      const summary = sim.getFactionSummary(f.id);
      if (summary.ships > leaderShips) {
        leaderShips = summary.ships;
        leaderId = f.id;
      }
    }

    const readySources = owned.filter(
      (p) =>
        !reservedSourceIds.has(p.id) &&
        p.ships > this.cfg.minReserve + 8 &&
        (incomingHostile.get(p.id) ?? 0) < p.ships * 0.6,
    );

    if (readySources.length === 0) return;

    // Score targets for the strongest cluster of ready sources
    type CandidateAttack = {
      target: Planet;
      sources: Planet[];
      score: number;
      neededShips: number;
      availableShips: number;
    };

    const candidates: CandidateAttack[] = [];

    for (const target of targets) {
      const friendlyOnWay = incomingFriendly.get(target.id) ?? 0;
      const hostileOnWay = this.cfg.considerIncoming ? incomingHostile.get(target.id) ?? 0 : 0;

      // Skip if we already sent overwhelmingly enough ships
      if (this.cfg.considerIncoming && friendlyOnWay > target.ships + 18) {
        continue;
      }

      // Sort our ready sources by proximity to this target
      const sortedSources = [...readySources].sort((a, b) => dist(a, target) - dist(b, target));
      const nearest = sortedSources[0];
      const flightTime = dist(nearest, target) / shipSpeed;

      let effectiveDefense = target.ships;
      if (target.ownerId !== NEUTRAL_ID) {
        // Enemy produces while fleet is in flight (Hard+)
        if (this.cfg.supportFrontline) {
          effectiveDefense += target.productionRate * prodMult * flightTime;
        }
      }

      // Vulturing: if neutral/enemy planet is getting hit by another AI/player
      let vultureBonus = 1.0;
      if (this.cfg.vultureStrike && hostileOnWay > 0 && target.ownerId !== factionId) {
        if (hostileOnWay >= target.ships * 0.7) {
          // Planet will be weakened or freshly flipped with tiny garrison!
          effectiveDefense = Math.max(4, Math.abs(target.ships - hostileOnWay) + 6);
          vultureBonus = 1.65;
        }
      }

      const needed = Math.max(4, Math.ceil(effectiveDefense - friendlyOnWay + 6));

      // Try single source or multi-source coordination
      const chosenSources: Planet[] = [];
      let accumAvailable = 0;
      const maxSources = this.cfg.multiPlanetSync ? 3 : 1;

      for (let i = 0; i < Math.min(maxSources, sortedSources.length); i++) {
        const src = sortedSources[i];
        if (i > 0 && dist(src, target) > dist(nearest, target) * 1.9 + 140) break;
        const sendable = Math.floor((src.ships - this.cfg.minReserve) * 0.85);
        if (sendable <= 2) continue;
        chosenSources.push(src);
        accumAvailable += sendable;
        if (accumAvailable >= needed * 1.15) break;
      }

      if (chosenSources.length === 0 || accumAvailable < needed) continue;

      const avgDist =
        chosenSources.reduce((sum, s) => sum + dist(s, target), 0) / chosenSources.length;

      let personalityMult = 1.0;
      if (personality === 'aggressive') {
        personalityMult = target.ownerId === NEUTRAL_ID ? 0.82 : 1.35;
      } else if (personality === 'expander') {
        personalityMult = target.ownerId === NEUTRAL_ID ? 1.35 : 0.85;
      } else if (personality === 'opportunist') {
        personalityMult = target.ships < 25 ? 1.3 : 0.95;
      }

      if (target.ownerId === leaderId && sim.factions.length > 3) {
        personalityMult *= 1.18;
      }

      const distanceFactor = 1 + avgDist / 260;
      const costFactor = needed + 10;
      const score =
        ((target.productionRate * 18 + 6) * personalityMult * vultureBonus) /
        (costFactor * distanceFactor);

      candidates.push({
        target,
        sources: chosenSources,
        score,
        neededShips: needed,
        availableShips: accumAvailable,
      });
    }

    candidates.sort((a, b) => b.score - a.score);

    let launchesMade = 0;
    const maxLaunchesPerTick = this.cfg.multiPlanetSync ? 2 : 1;

    for (const cand of candidates) {
      if (launchesMade >= maxLaunchesPerTick) break;
      const usable = cand.sources.filter((s) => !reservedSourceIds.has(s.id));
      if (usable.length === 0) continue;

      const ratio = Math.min(0.85, Math.max(0.45, (cand.neededShips + 4) / cand.availableShips));
      const ids = usable.map((s) => s.id);
      const sent = sim.sendShips(ids, cand.target.id, factionId, ratio);
      if (sent > 0) {
        for (const id of ids) reservedSourceIds.add(id);
        launchesMade++;
      }
    }

    // 3. Rear-line feeding (Hard+): interior rich planets reinforce frontline planets
    if (this.cfg.supportFrontline && owned.length >= 3) {
      const enemies = sim.planets.filter((p) => p.ownerId !== factionId && p.ownerId !== NEUTRAL_ID);
      if (enemies.length > 0) {
        let frontline: Planet | null = null;
        let bestFrontDist = Infinity;
        for (const p of owned) {
          let minEnemyDist = Infinity;
          for (const e of enemies) {
            const d = dist(p, e);
            if (d < minEnemyDist) minEnemyDist = d;
          }
          if (minEnemyDist < bestFrontDist) {
            bestFrontDist = minEnemyDist;
            frontline = p;
          }
        }

        if (frontline) {
          for (const p of owned) {
            if (p.id === frontline.id || reservedSourceIds.has(p.id)) continue;
            if (p.ships > 42 && (incomingHostile.get(p.id) ?? 0) === 0) {
              // Ensure it's significantly further from enemies than frontline
              let minEnemyDist = Infinity;
              for (const e of enemies) {
                const d = dist(p, e);
                if (d < minEnemyDist) minEnemyDist = d;
              }
              if (minEnemyDist > bestFrontDist + 170) {
                const sent = sim.sendShips([p.id], frontline.id, factionId, 0.5);
                if (sent > 0) {
                  reservedSourceIds.add(p.id);
                  break;
                }
              }
            }
          }
        }
      }
    }
  }
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
