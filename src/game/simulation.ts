import { AIController } from './ai';
import {
  BASE_SHIP_SPEED,
  FACTION_PALETTE,
  LAUNCH_EMIT_INTERVAL,
  MAX_PARTICLES,
  NEUTRAL_ID,
  PLAYER_ID,
  POWER_SAMPLE_INTERVAL,
  RALLY_INTERVAL,
  RALLY_MIN_SHIPS,
  VISUAL_SHIP_SOFT_CAP,
  getRuleMultipliers,
} from './constants';
import { generateMap } from './maps';
import type {
  AIPersonality,
  FactionState,
  FactionSummary,
  MatchConfig,
  MatchStats,
  MatchStatus,
  NetCaptureEvent,
  NetEliminationEvent,
  NetGameSnapshot,
  Particle,
  PendingLaunch,
  Planet,
  Ship,
  Shockwave,
  SimulationEvents,
} from './types';

const PERSONALITY_ROTATION: AIPersonality[] = [
  'balanced',
  'aggressive',
  'expander',
  'opportunist',
];

export class GameSimulation {
  readonly config: MatchConfig;
  readonly localPlayerId: number;
  readonly planets: Planet[];
  readonly planetById = new Map<number, Planet>();
  readonly factions: FactionState[] = [];
  readonly factionById = new Map<number, FactionState>();

  ships: Ship[] = [];
  pendingLaunches: PendingLaunch[] = [];
  particles: Particle[] = [];
  shockwaves: Shockwave[] = [];

  elapsed = 0;
  paused = false;
  speedMultiplier: 1 | 1.5 | 2 = 1;
  status: MatchStatus = 'playing';
  spectating = false;

  stats: MatchStats;
  events: SimulationEvents;

  private ai: AIController;
  private nextShipId = 1;
  private nextPowerSampleTime = POWER_SAMPLE_INTERVAL;
  private spatialGrid = new Map<number, Ship[]>();
  private pendingNetCaptures: NetCaptureEvent[] = [];
  private pendingNetEliminations: NetEliminationEvent[] = [];
  private localDefeatedNotified = false;
  private matchEndNotified = false;

  constructor(config: MatchConfig, events: SimulationEvents = {}) {
    this.config = { ...config };
    this.localPlayerId = config.localPlayerId ?? PLAYER_ID;
    this.events = events;
    this.planets = generateMap(this.config);
    for (const p of this.planets) {
      this.planetById.set(p.id, p);
    }

    this.initFactions();
    this.ai = new AIController(this.config.difficulty);

    this.stats = {
      elapsed: 0,
      winnerId: null,
      planetsCaptured: 0,
      planetsLost: 0,
      shipsSent: 0,
      shipsLost: 0,
      shipsDestroyed: 0,
      peakShips: 0,
      powerHistory: [],
    };

    // Sample initial power distribution at t=0
    this.recordPowerSample();
  }

  private initFactions(): void {
    const neutralCfg = FACTION_PALETTE[NEUTRAL_ID];
    const neutralState: FactionState = {
      ...neutralCfg,
      isPlayer: false,
      eliminated: false,
    };
    this.factions.push(neutralState);
    this.factionById.set(NEUTRAL_ID, neutralState);

    if (this.config.customFactions && this.config.customFactions.length > 0) {
      for (let i = 0; i < this.config.customFactions.length; i++) {
        const spec = this.config.customFactions[i];
        const palette = FACTION_PALETTE[spec.id] ?? FACTION_PALETTE[PLAYER_ID];
        const personality = spec.isHuman
          ? 'balanced'
          : PERSONALITY_ROTATION[(i + (this.config.seed % 4)) % PERSONALITY_ROTATION.length];
        const state: FactionState = {
          ...palette,
          id: spec.id,
          name: spec.name,
          isPlayer: spec.isHuman,
          difficulty: spec.isHuman ? undefined : (spec.difficulty ?? this.config.difficulty),
          personality,
          eliminated: false,
        };
        this.factions.push(state);
        this.factionById.set(spec.id, state);
      }
      return;
    }

    const factionCount = Math.max(2, Math.min(6, this.config.opponents + 1));
    for (let i = 0; i < factionCount; i++) {
      const id = PLAYER_ID + i;
      const palette = FACTION_PALETTE[id];
      const isHumanPlayer = id === this.localPlayerId && this.config.mode !== 'attract';
      const personality =
        id === this.localPlayerId
          ? 'balanced'
          : PERSONALITY_ROTATION[(i + (this.config.seed % 4)) % PERSONALITY_ROTATION.length];
      const state: FactionState = {
        ...palette,
        name: isHumanPlayer ? 'Sen (Nova Filosu)' : palette.name,
        isPlayer: isHumanPlayer,
        difficulty: isHumanPlayer ? undefined : this.config.difficulty,
        personality,
        eliminated: false,
      };
      this.factions.push(state);
      this.factionById.set(id, state);
    }
  }

  getFactionColor(factionId: number): string {
    return this.factionById.get(factionId)?.color ?? '#7c8ba1';
  }

  getFactionCoreColor(factionId: number): string {
    return this.factionById.get(factionId)?.coreColor ?? '#c3d0e3';
  }

  getFactionSummary(factionId: number): FactionSummary {
    let planets = 0;
    let ships = 0;
    let production = 0;

    for (const p of this.planets) {
      if (p.ownerId === factionId) {
        planets++;
        ships += p.ships;
        if (factionId !== NEUTRAL_ID) {
          production += p.productionRate;
        }
      }
    }

    for (const s of this.ships) {
      if (s.ownerId === factionId) {
        ships += s.count;
      }
    }

    for (const l of this.pendingLaunches) {
      if (l.ownerId === factionId) {
        ships += l.remainingShips;
      }
    }

    const { prodMult } = getRuleMultipliers(this.config.rule);
    return {
      planets,
      ships,
      production: Number((production * prodMult).toFixed(1)),
    };
  }

  sendShips(
    fromPlanetIds: number[],
    targetPlanetId: number,
    ownerId: number,
    percent: number,
  ): number {
    if (this.status !== 'playing' && !this.spectating) return 0;
    const target = this.planetById.get(targetPlanetId);
    if (!target) return 0;

    const clampedPct = Math.max(0.05, Math.min(1, percent));
    const uniqueIds = new Set(fromPlanetIds);
    let totalSent = 0;

    for (const srcId of uniqueIds) {
      if (srcId === targetPlanetId) continue;
      const src = this.planetById.get(srcId);
      if (!src || src.ownerId !== ownerId || src.ships <= 0) continue;

      const count =
        clampedPct >= 0.999 ? src.ships : Math.floor(src.ships * clampedPct);
      if (count <= 0) continue;

      src.ships -= count;
      totalSent += count;

      this.pendingLaunches.push({
        ownerId,
        sourceId: src.id,
        targetId: target.id,
        remainingShips: count,
        emitTimer: 0,
        originX: src.x,
        originY: src.y,
        originRadius: src.radius,
      });
    }

    if (totalSent > 0) {
      if (ownerId === this.localPlayerId && this.config.mode !== 'attract') {
        this.stats.shipsSent += totalSent;
      }
      this.events.onLaunch?.(ownerId, totalSent);
    }

    return totalSent;
  }

  redirectShips(shipIds: number[], targetPlanetId: number, ownerId: number): number {
    if (this.status !== 'playing') return 0;
    const target = this.planetById.get(targetPlanetId);
    if (!target) return 0;

    const idSet = new Set(shipIds);
    let redirectedCount = 0;

    for (const ship of this.ships) {
      if (idSet.has(ship.id) && ship.ownerId === ownerId && ship.targetId !== targetPlanetId) {
        ship.targetId = targetPlanetId;
        redirectedCount += ship.count;
      }
    }

    if (redirectedCount > 0) {
      this.events.onLaunch?.(ownerId, redirectedCount);
    }
    return redirectedCount;
  }

  setRallyPoint(
    planetIds: number[],
    targetPlanetId: number | null,
    ownerId: number,
  ): void {
    const validTarget =
      targetPlanetId !== null ? this.planetById.get(targetPlanetId) ?? null : null;

    for (const id of planetIds) {
      const planet = this.planetById.get(id);
      if (!planet || planet.ownerId !== ownerId) continue;
      if (!validTarget || validTarget.id === planet.id) {
        planet.rallyTargetId = null;
      } else {
        planet.rallyTargetId = validTarget.id;
        planet.rallyCooldown = Math.min(planet.rallyCooldown, RALLY_INTERVAL * 0.5);
      }
    }
  }

  update(rawDt: number): void {
    if (this.paused) return;
    if (this.status === 'victory' || this.status === 'finished') return;
    if (this.status === 'defeat' && !this.spectating) return;

    const dt = rawDt * this.speedMultiplier;
    if (dt <= 0) return;

    this.elapsed += dt;
    this.stats.elapsed = this.elapsed;

    const { prodMult, speedMult } = getRuleMultipliers(this.config.rule);

    // 1. Planet production, rally points, and visual decay
    for (const p of this.planets) {
      if (p.hitFlash > 0) p.hitFlash = Math.max(0, p.hitFlash - dt * 2.8);
      if (p.capturePulse > 0) p.capturePulse = Math.max(0, p.capturePulse - dt * 1.4);

      if (p.ownerId !== NEUTRAL_ID) {
        p.prodProgress += p.productionRate * prodMult * dt;
        if (p.prodProgress >= 1 - 1e-9) {
          const produced = Math.floor(p.prodProgress + 1e-9);
          p.ships += produced;
          p.prodProgress = Math.max(0, p.prodProgress - produced);
        }

        if (p.rallyTargetId !== null) {
          p.rallyCooldown -= dt;
          if (p.rallyCooldown <= 0) {
            p.rallyCooldown = RALLY_INTERVAL;
            if (p.ships >= RALLY_MIN_SHIPS) {
              this.sendShips([p.id], p.rallyTargetId, p.ownerId, 0.5);
            }
          }
        }
      } else {
        p.prodProgress = 0;
        p.rallyTargetId = null;
      }
    }

    // 2. Emit pending launches
    this.processPendingLaunches(dt, speedMult);

    // 3. Update ships (flocking, obstacle avoidance, arrival combat)
    this.updateShips(dt, speedMult);

    // 4. Update visual particles & shockwaves
    this.updateEffects(dt);

    // 5. AI tick
    this.ai.update(this, dt);

    // 6. Track player peak ships & power history
    if (this.config.mode !== 'attract') {
      const playerSummary = this.getFactionSummary(this.localPlayerId);
      if (playerSummary.ships > this.stats.peakShips) {
        this.stats.peakShips = playerSummary.ships;
      }
    }

    while (this.elapsed >= this.nextPowerSampleTime) {
      this.recordPowerSample();
      this.nextPowerSampleTime += POWER_SAMPLE_INTERVAL;
    }

    // 7. Check eliminations and victory/defeat
    this.evaluateEliminationsAndEndState();
  }

  private processPendingLaunches(dt: number, speedMult: number): void {
    const speed = BASE_SHIP_SPEED * speedMult;
    const stillPending: PendingLaunch[] = [];

    for (const launch of this.pendingLaunches) {
      const target = this.planetById.get(launch.targetId);
      if (!target || launch.remainingShips <= 0) continue;

      launch.emitTimer -= dt;
      while (launch.emitTimer <= 0 && launch.remainingShips > 0) {
        launch.emitTimer += LAUNCH_EMIT_INTERVAL;

        // Emit ships in crisp arc waves so large fleets deploy smoothly
        const waveTotal = Math.min(
          launch.remainingShips,
          Math.max(2, Math.ceil(launch.remainingShips * 0.16)),
        );
        launch.remainingShips -= waveTotal;

        const baseAngle = Math.atan2(target.y - launch.originY, target.x - launch.originX);
        const visualLoad = this.ships.length;

        let spritesInWave = waveTotal;
        if (visualLoad >= VISUAL_SHIP_SOFT_CAP) {
          spritesInWave = 1;
        } else if (visualLoad >= VISUAL_SHIP_SOFT_CAP * 0.72) {
          spritesInWave = Math.min(waveTotal, Math.max(1, Math.ceil(waveTotal / 3)));
        }

        const baseCount = Math.floor(waveTotal / spritesInWave);
        const remainder = waveTotal % spritesInWave;

        for (let i = 0; i < spritesInWave; i++) {
          const shipCount = baseCount + (i < remainder ? 1 : 0);
          if (shipCount <= 0) continue;

          const spreadOffset =
            spritesInWave > 1
              ? ((i / (spritesInWave - 1)) - 0.5) * 1.15
              : ((this.nextShipId % 5) - 2) * 0.16;
          const spawnAngle = baseAngle + spreadOffset;
          const spawnDist = launch.originRadius + 6 + (i % 2) * 3;
          const sx = launch.originX + Math.cos(spawnAngle) * spawnDist;
          const sy = launch.originY + Math.sin(spawnAngle) * spawnDist;

          this.ships.push({
            id: this.nextShipId++,
            ownerId: launch.ownerId,
            sourceId: launch.sourceId,
            targetId: launch.targetId,
            x: sx,
            y: sy,
            vx: Math.cos(spawnAngle) * speed,
            vy: Math.sin(spawnAngle) * speed,
            count: shipCount,
            age: 0,
          });
        }
      }

      if (launch.remainingShips > 0) {
        stillPending.push(launch);
      }
    }

    this.pendingLaunches = stillPending;
  }

  private updateShips(dt: number, speedMult: number): void {
    const speed = BASE_SHIP_SPEED * speedMult;
    const cellSize = 42;
    this.spatialGrid.clear();

    for (const s of this.ships) {
      const cx = Math.floor(s.x / cellSize);
      const cy = Math.floor(s.y / cellSize);
      const key = cx * 1024 + cy;
      let cell = this.spatialGrid.get(key);
      if (!cell) {
        cell = [];
        this.spatialGrid.set(key, cell);
      }
      cell.push(s);
    }

    const survivingShips: Ship[] = [];

    for (const ship of this.ships) {
      const target = this.planetById.get(ship.targetId);
      if (!target) continue;

      const toTargetX = target.x - ship.x;
      const toTargetY = target.y - ship.y;
      const distToTarget = Math.hypot(toTargetX, toTargetY);

      if (distToTarget <= target.radius + 4) {
        this.resolveArrival(ship, target);
        continue;
      }

      // Desired target direction
      let steerX = toTargetX / distToTarget;
      let steerY = toTargetY / distToTarget;

      // Local separation from neighboring ships
      const cx = Math.floor(ship.x / cellSize);
      const cy = Math.floor(ship.y / cellSize);
      let sepX = 0;
      let sepY = 0;
      let sepHits = 0;

      for (let ox = -1; ox <= 1; ox++) {
        for (let oy = -1; oy <= 1; oy++) {
          const cell = this.spatialGrid.get((cx + ox) * 1024 + (cy + oy));
          if (!cell) continue;
          for (let i = 0; i < cell.length && sepHits < 6; i++) {
            const other = cell[i];
            if (other.id === ship.id) continue;
            const dx = ship.x - other.x;
            const dy = ship.y - other.y;
            const dSq = dx * dx + dy * dy;
            if (dSq > 0.01 && dSq < 196) {
              const d = Math.sqrt(dSq);
              const weight = (14 - d) / 14;
              sepX += (dx / d) * weight;
              sepY += (dy / d) * weight;
              sepHits++;
            }
          }
        }
      }

      steerX += sepX * 0.45;
      steerY += sepY * 0.45;

      // Smooth obstacle avoidance around intermediate planets
      for (const p of this.planets) {
        if (p.id === ship.targetId) continue;
        if (p.id === ship.sourceId && ship.age < 0.28) continue;

        const ox = ship.x - p.x;
        const oy = ship.y - p.y;
        const d = Math.hypot(ox, oy);
        const avoidRadius = p.radius + 26;
        if (d < avoidRadius && d > 0.01) {
          const nx = ox / d;
          const ny = oy / d;
          const strength = ((avoidRadius - d) / avoidRadius) * 2.2;

          // Tangential slide chosen cleanly by cross product relative to target vector
          const cross = steerX * ny - steerY * nx;
          const sign = cross >= 0 ? 1 : -1;
          const tx = -ny * sign;
          const ty = nx * sign;

          steerX += (nx * 1.1 + tx * 1.4) * strength;
          steerY += (ny * 1.1 + ty * 1.4) * strength;
        }
      }

      // Blend smoothly with current heading
      const curMag = Math.hypot(ship.vx, ship.vy) || 1;
      const curNx = ship.vx / curMag;
      const curNy = ship.vy / curMag;
      const steerMag = Math.hypot(steerX, steerY) || 1;
      const desiredNx = steerX / steerMag;
      const desiredNy = steerY / steerMag;

      const blend = Math.min(1, dt * 8.5);
      let finalX = curNx + (desiredNx - curNx) * blend;
      let finalY = curNy + (desiredNy - curNy) * blend;
      const finalMag = Math.hypot(finalX, finalY) || 1;
      finalX /= finalMag;
      finalY /= finalMag;

      ship.vx = finalX * speed;
      ship.vy = finalY * speed;
      ship.x += ship.vx * dt;
      ship.y += ship.vy * dt;
      ship.age += dt;

      // Keep outside non-target planet interiors
      for (const p of this.planets) {
        if (p.id === ship.targetId) continue;
        if (p.id === ship.sourceId && ship.age < 0.2) continue;
        const ox = ship.x - p.x;
        const oy = ship.y - p.y;
        const d = Math.hypot(ox, oy);
        const minR = p.radius + 3;
        if (d < minR && d > 0.001) {
          ship.x = p.x + (ox / d) * minR;
          ship.y = p.y + (oy / d) * minR;
        }
      }

      survivingShips.push(ship);
    }

    this.ships = survivingShips;
  }

  private resolveArrival(ship: Ship, target: Planet): void {
    const isPlayerMode = this.config.mode !== 'attract';

    if (target.ownerId === ship.ownerId) {
      target.ships += ship.count;
      target.hitFlash = Math.max(target.hitFlash, 0.16);
      this.events.onImpact?.(ship.ownerId, target.ownerId, true);
      return;
    }

    // Hostile combat
    if (target.ships >= ship.count) {
      const destroyed = ship.count;
      target.ships -= ship.count;
      target.hitFlash = Math.max(target.hitFlash, 0.38);

      if (isPlayerMode) {
        if (ship.ownerId === this.localPlayerId || target.ownerId === this.localPlayerId) {
          this.stats.shipsLost += destroyed;
          this.stats.shipsDestroyed += destroyed;
        }
      }

      this.spawnParticles(ship.x, ship.y, this.getFactionColor(ship.ownerId), 4, 70);
      this.events.onImpact?.(ship.ownerId, target.ownerId, false);
    } else {
      // Planet captured!
      const destroyed = target.ships;
      const remaining = ship.count - target.ships;
      const oldOwnerId = target.ownerId;

      target.ownerId = ship.ownerId;
      target.ships = remaining;
      target.prodProgress = 0;
      target.rallyTargetId = null;
      target.hitFlash = 0.65;
      target.capturePulse = 1.0;
      target.pulseColor = this.getFactionColor(ship.ownerId);

      if (isPlayerMode) {
        if (ship.ownerId === this.localPlayerId) {
          this.stats.planetsCaptured++;
          this.stats.shipsDestroyed += destroyed;
          this.stats.shipsLost += destroyed;
        }
        if (oldOwnerId === this.localPlayerId) {
          this.stats.planetsLost++;
          this.stats.shipsLost += destroyed;
          this.stats.shipsDestroyed += destroyed;
        }
      }

      if (this.config.mode === 'online') {
        this.pendingNetCaptures.push({
          planetId: target.id,
          newOwnerId: ship.ownerId,
          oldOwnerId,
        });
      }

      this.shockwaves.push({
        x: target.x,
        y: target.y,
        radius: target.radius,
        maxRadius: target.radius + 54,
        alpha: 0.9,
        color: target.pulseColor,
      });
      this.spawnParticles(target.x, target.y, target.pulseColor, 24, 155, target.radius * 0.7);
      this.events.onCapture?.(
        target.id,
        ship.ownerId,
        oldOwnerId,
        ship.ownerId === this.localPlayerId || oldOwnerId === this.localPlayerId,
      );
    }
  }

  private spawnParticles(
    x: number,
    y: number,
    color: string,
    count: number,
    maxSpeed: number,
    offsetRadius = 0,
  ): void {
    const room = MAX_PARTICLES - this.particles.length;
    const spawnCount = Math.min(count, Math.max(0, room));
    for (let i = 0; i < spawnCount; i++) {
      const angle = (i / Math.max(1, spawnCount)) * Math.PI * 2 + Math.random() * 0.7;
      const spd = 25 + Math.random() * maxSpeed;
      const life = 0.25 + Math.random() * 0.4;
      this.particles.push({
        x: x + Math.cos(angle) * offsetRadius,
        y: y + Math.sin(angle) * offsetRadius,
        vx: Math.cos(angle) * spd,
        vy: Math.sin(angle) * spd,
        life,
        maxLife: life,
        size: 1.8 + Math.random() * 2.2,
        color,
      });
    }
  }

  private updateEffects(dt: number): void {
    const nextParticles: Particle[] = [];
    for (const p of this.particles) {
      p.life -= dt;
      if (p.life > 0) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vx *= 0.94;
        p.vy *= 0.94;
        nextParticles.push(p);
      }
    }
    this.particles = nextParticles;

    const nextWaves: Shockwave[] = [];
    for (const w of this.shockwaves) {
      w.radius += (w.maxRadius - w.radius) * Math.min(1, dt * 6.5) + dt * 45;
      w.alpha -= dt * 1.65;
      if (w.alpha > 0.02) {
        nextWaves.push(w);
      }
    }
    this.shockwaves = nextWaves;
  }

  private recordPowerSample(): void {
    const shipsByFaction: Record<number, number> = {};
    for (const f of this.factions) {
      if (f.id === NEUTRAL_ID) continue;
      shipsByFaction[f.id] = this.getFactionSummary(f.id).ships;
    }
    this.stats.powerHistory.push({
      time: Number(this.elapsed.toFixed(1)),
      shipsByFaction,
    });
  }

  private evaluateEliminationsAndEndState(): void {
    const planetCounts = new Map<number, number>();
    const shipCounts = new Map<number, number>();

    for (const p of this.planets) {
      if (p.ownerId !== NEUTRAL_ID) {
        planetCounts.set(p.ownerId, (planetCounts.get(p.ownerId) ?? 0) + 1);
      }
    }
    for (const s of this.ships) {
      shipCounts.set(s.ownerId, (shipCounts.get(s.ownerId) ?? 0) + s.count);
    }
    for (const l of this.pendingLaunches) {
      shipCounts.set(l.ownerId, (shipCounts.get(l.ownerId) ?? 0) + l.remainingShips);
    }

    let aliveNonNeutral: FactionState[] = [];
    for (const f of this.factions) {
      if (f.id === NEUTRAL_ID) continue;
      const alive = (planetCounts.get(f.id) ?? 0) > 0 || (shipCounts.get(f.id) ?? 0) > 0;
      if (!alive && !f.eliminated) {
        f.eliminated = true;
        if (this.config.mode === 'online') {
          this.pendingNetEliminations.push({ factionId: f.id, factionName: f.name });
        }
        this.events.onElimination?.(f.id, f.name);
      }
      if (!f.eliminated) {
        aliveNonNeutral.push(f);
      }
    }

    if (this.config.mode === 'attract') {
      if (aliveNonNeutral.length <= 1 && this.status === 'playing') {
        this.status = 'finished';
        this.stats.winnerId = aliveNonNeutral[0]?.id ?? null;
        this.recordPowerSample();
        this.events.onMatchEnd?.('finished', this.stats.winnerId);
      }
      return;
    }

    if (this.config.mode === 'online') {
      const localFaction = this.factionById.get(this.localPlayerId);
      const localAlive = localFaction ? !localFaction.eliminated : false;

      if (!localAlive && aliveNonNeutral.length > 1 && !this.localDefeatedNotified) {
        this.localDefeatedNotified = true;
        this.spectating = true;
        this.events.onLocalEliminated?.();
      }

      if (aliveNonNeutral.length <= 1 && this.status === 'playing') {
        const winnerId = aliveNonNeutral[0]?.id ?? null;
        this.status = winnerId === this.localPlayerId ? 'victory' : 'defeat';
        this.stats.winnerId = winnerId;
        this.recordPowerSample();
        this.events.onMatchEnd?.(this.status, winnerId);
      }
      return;
    }

    const player = this.factionById.get(this.localPlayerId);
    const playerAlive = player ? !player.eliminated : false;
    const aliveAIs = aliveNonNeutral.filter((f) => f.id !== this.localPlayerId);

    if (!playerAlive && this.status === 'playing') {
      this.status = 'defeat';
      this.stats.winnerId = aliveAIs.length === 1 ? aliveAIs[0].id : null;
      this.recordPowerSample();
      this.events.onMatchEnd?.('defeat', this.stats.winnerId);
    } else if (playerAlive && aliveAIs.length === 0 && this.status === 'playing') {
      this.status = 'victory';
      this.stats.winnerId = this.localPlayerId;
      this.recordPowerSample();
      this.events.onMatchEnd?.('victory', this.localPlayerId);
    } else if (this.spectating && aliveNonNeutral.length <= 1) {
      this.status = 'finished';
      this.stats.winnerId = aliveNonNeutral[0]?.id ?? null;
      this.events.onMatchEnd?.('finished', this.stats.winnerId);
    }
  }

  convertFactionToBot(factionId: number): void {
    if (factionId === NEUTRAL_ID) return;
    const faction = this.factionById.get(factionId);
    if (!faction) return;
    faction.isPlayer = false;
    faction.difficulty = this.config.difficulty;
    if (!faction.name.endsWith(' (Bot)')) {
      faction.name = `${faction.name} (Bot)`;
    }
  }

  createSnapshot(): NetGameSnapshot {
    const captures = this.pendingNetCaptures;
    this.pendingNetCaptures = [];
    const eliminations = this.pendingNetEliminations;
    this.pendingNetEliminations = [];

    return {
      elapsed: Number(this.elapsed.toFixed(2)),
      status: this.status,
      winnerId: this.stats.winnerId,
      planets: this.planets.map((p) => [
        p.ownerId,
        p.ships,
        Math.round(p.prodProgress * 100) / 100,
        p.rallyTargetId,
      ]),
      ships: this.ships.map((s) => [
        s.id,
        s.ownerId,
        s.targetId,
        Math.round(s.x * 2) / 2,
        Math.round(s.y * 2) / 2,
        Math.round(s.vx),
        Math.round(s.vy),
        s.count,
      ]),
      eliminatedIds: this.factions.filter((f) => f.eliminated).map((f) => f.id),
      captures,
      eliminations,
      powerHistoryTail: this.stats.powerHistory[this.stats.powerHistory.length - 1],
    };
  }

  applySnapshot(snap: NetGameSnapshot): void {
    this.elapsed = snap.elapsed;
    this.stats.elapsed = snap.elapsed;

    for (let i = 0; i < snap.planets.length && i < this.planets.length; i++) {
      const p = this.planets[i];
      const [ownerId, ships, prodProgress, rallyTargetId] = snap.planets[i];
      if (ownerId !== p.ownerId || ships < p.ships) {
        p.hitFlash = Math.max(p.hitFlash, 0.24);
      }
      p.ownerId = ownerId;
      p.ships = ships;
      p.prodProgress = prodProgress;
      p.rallyTargetId = rallyTargetId;
    }

    this.ships = snap.ships.map(([id, ownerId, targetId, x, y, vx, vy, count]) => ({
      id,
      ownerId,
      sourceId: 0,
      targetId,
      x,
      y,
      vx,
      vy,
      count,
      age: 1,
    }));

    const localFaction = this.factionById.get(this.localPlayerId);
    const wasLocalElim = localFaction?.eliminated ?? false;
    const elimSet = new Set(snap.eliminatedIds);
    for (const f of this.factions) {
      if (f.id === NEUTRAL_ID) continue;
      f.eliminated = elimSet.has(f.id);
    }
    const nowLocalElim = localFaction?.eliminated ?? false;

    if (snap.powerHistoryTail) {
      const last = this.stats.powerHistory[this.stats.powerHistory.length - 1];
      if (!last || snap.powerHistoryTail.time > last.time) {
        this.stats.powerHistory.push(snap.powerHistoryTail);
      }
    }

    const localSummary = this.getFactionSummary(this.localPlayerId);
    if (localSummary.ships > this.stats.peakShips) {
      this.stats.peakShips = localSummary.ships;
    }

    for (const cap of snap.captures) {
      const target = this.planetById.get(cap.planetId);
      if (target) {
        target.capturePulse = 1.0;
        target.pulseColor = this.getFactionColor(cap.newOwnerId);
        this.shockwaves.push({
          x: target.x,
          y: target.y,
          radius: target.radius,
          maxRadius: target.radius + 54,
          alpha: 0.9,
          color: target.pulseColor,
        });
        this.spawnParticles(target.x, target.y, target.pulseColor, 24, 155, target.radius * 0.7);
      }
      if (cap.newOwnerId === this.localPlayerId) {
        this.stats.planetsCaptured++;
      }
      if (cap.oldOwnerId === this.localPlayerId) {
        this.stats.planetsLost++;
      }
      this.events.onCapture?.(
        cap.planetId,
        cap.newOwnerId,
        cap.oldOwnerId,
        cap.newOwnerId === this.localPlayerId || cap.oldOwnerId === this.localPlayerId,
      );
    }

    for (const elim of snap.eliminations) {
      this.events.onElimination?.(elim.factionId, elim.factionName);
    }

    if (!wasLocalElim && nowLocalElim && snap.status === 'playing' && !this.localDefeatedNotified) {
      this.localDefeatedNotified = true;
      this.spectating = true;
      this.events.onLocalEliminated?.();
    }

    if (snap.status !== 'playing' && !this.matchEndNotified) {
      this.matchEndNotified = true;
      this.status = snap.winnerId === this.localPlayerId ? 'victory' : 'defeat';
      this.stats.winnerId = snap.winnerId;
      this.events.onMatchEnd?.(this.status, snap.winnerId);
    }
  }

  stepClientVisuals(rawDt: number): void {
    const dt = Math.min(0.05, Math.max(0, rawDt));
    if (dt <= 0) return;

    const { prodMult } = getRuleMultipliers(this.config.rule);
    for (const p of this.planets) {
      if (p.hitFlash > 0) p.hitFlash = Math.max(0, p.hitFlash - dt * 2.8);
      if (p.capturePulse > 0) p.capturePulse = Math.max(0, p.capturePulse - dt * 1.4);
      if (p.ownerId !== NEUTRAL_ID) {
        p.prodProgress = Math.min(0.98, p.prodProgress + p.productionRate * prodMult * dt);
      }
    }

    for (const ship of this.ships) {
      ship.x += ship.vx * dt;
      ship.y += ship.vy * dt;
    }

    this.updateEffects(dt);
  }
}
