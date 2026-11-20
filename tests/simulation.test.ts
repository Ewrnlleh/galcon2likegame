import { describe, expect, it } from 'vitest';
import {
  HOMEWORLD_SHIPS_SUPERFLEET,
  MARGIN_X,
  MARGIN_Y,
  MIN_PLANET_GAP,
  NEUTRAL_ID,
  PLAYER_ID,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from '../src/game/constants';
import { generateMap } from '../src/game/maps';
import { GameSimulation } from '../src/game/simulation';
import type { MapType, MatchConfig } from '../src/game/types';

function makeConfig(overrides: Partial<MatchConfig> = {}): MatchConfig {
  return {
    mode: 'skirmish',
    mapType: 'classic',
    planetCount: 24,
    opponents: 2,
    difficulty: 'normal',
    rule: 'standard',
    seed: 12345,
    ...overrides,
  };
}

describe('Procedural Map Generators', () => {
  const mapTypes: MapType[] = ['classic', 'symmetric', 'spiral', 'ring', 'grid', 'clusters'];

  it.each(mapTypes)('generates valid non-overlapping in-bounds planets for %s', (mapType) => {
    for (const opponents of [1, 3, 5]) {
      const planets = generateMap(
        makeConfig({ mapType, opponents, planetCount: 28, seed: 4242 + opponents }),
      );

      expect(planets.length).toBeGreaterThanOrEqual(opponents + 5);

      // Check bounds and positive production rates
      for (const p of planets) {
        expect(p.x).toBeGreaterThanOrEqual(MARGIN_X + p.radius - 0.01);
        expect(p.x).toBeLessThanOrEqual(WORLD_WIDTH - MARGIN_X - p.radius + 0.01);
        expect(p.y).toBeGreaterThanOrEqual(MARGIN_Y + p.radius - 0.01);
        expect(p.y).toBeLessThanOrEqual(WORLD_HEIGHT - MARGIN_Y - p.radius + 0.01);
        expect(p.productionRate).toBeGreaterThan(0);
      }

      // Check no overlapping planets
      for (let i = 0; i < planets.length; i++) {
        for (let j = i + 1; j < planets.length; j++) {
          const a = planets[i];
          const b = planets[j];
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          expect(d).toBeGreaterThanOrEqual(a.radius + b.radius + MIN_PLANET_GAP - 0.5);
        }
      }

      // Check every active faction owns 1 homeworld
      for (let f = PLAYER_ID; f <= PLAYER_ID + opponents; f++) {
        const owned = planets.filter((p) => p.ownerId === f);
        expect(owned.length).toBe(1);
      }
    }
  });

  it('respects megacore and superfleet rules', () => {
    const megaPlanets = generateMap(makeConfig({ rule: 'megacore', opponents: 1 }));
    const mega = megaPlanets.find((p) => p.radius >= 45);
    expect(mega).toBeDefined();
    expect(mega?.productionRate).toBe(6.2);
    expect(mega?.ownerId).toBe(NEUTRAL_ID);

    const superPlanets = generateMap(makeConfig({ rule: 'superfleet', opponents: 1 }));
    const playerHome = superPlanets.find((p) => p.ownerId === PLAYER_ID);
    expect(playerHome?.ships).toBe(HOMEWORLD_SHIPS_SUPERFLEET);
  });
});

describe('Simulation Exact Ship Conservation & Combat', () => {
  it('conserves exact integer ship counts across launches, reinforcements, and captures', () => {
    const sim = new GameSimulation(
      makeConfig({ mode: 'skirmish', opponents: 1, planetCount: 12, difficulty: 'easy' }),
    );
    const playerPlanet = sim.planets.find((p) => p.ownerId === PLAYER_ID)!;
    const neutralPlanet = sim.planets.find((p) => p.ownerId === NEUTRAL_ID)!;
    const secondPlayerHostile = sim.planets.find((p) => p.ownerId === 2)!;

    // Set deterministic states close together for crisp testing
    playerPlanet.x = 300;
    playerPlanet.y = 360;
    playerPlanet.ships = 100;
    playerPlanet.productionRate = 0;

    neutralPlanet.x = 390;
    neutralPlanet.y = 360;
    neutralPlanet.ships = 30;
    neutralPlanet.productionRate = 0;
    neutralPlanet.rallyTargetId = null;

    // Keep AI passive (low ships so it cannot launch) for this conservation check
    secondPlayerHostile.ships = 1;
    secondPlayerHostile.productionRate = 0;

    // Launch 50% (50 ships)
    const sent = sim.sendShips([playerPlanet.id], neutralPlanet.id, PLAYER_ID, 0.5);
    expect(sent).toBe(50);
    expect(playerPlanet.ships).toBe(50);

    // Set rally point on neutralPlanet only to verify capture clears rallyTargetId
    neutralPlanet.rallyTargetId = playerPlanet.id;

    // Step simulation until all launched ships arrive
    for (let i = 0; i < 180; i++) {
      sim.update(1 / 60);
      if (sim.ships.length === 0 && sim.pendingLaunches.length === 0) break;
    }

    // 50 attacking vs 30 defending -> captured with exact 20 ships remaining!
    expect(neutralPlanet.ownerId).toBe(PLAYER_ID);
    expect(neutralPlanet.ships).toBe(20);
    expect(neutralPlanet.rallyTargetId).toBeNull();

    // Friendly reinforcement: send 100% (50) from playerPlanet to neutralPlanet
    const reinforced = sim.sendShips([playerPlanet.id], neutralPlanet.id, PLAYER_ID, 1.0);
    expect(reinforced).toBe(50);
    expect(playerPlanet.ships).toBe(0);

    for (let i = 0; i < 180; i++) {
      sim.update(1 / 60);
      if (sim.ships.length === 0 && sim.pendingLaunches.length === 0) break;
    }

    expect(neutralPlanet.ownerId).toBe(PLAYER_ID);
    expect(neutralPlanet.ships).toBe(70);
  });

  it('produces ships on owned planets proportional to productionRate while neutrals stay constant', () => {
    const sim = new GameSimulation(makeConfig({ opponents: 1, difficulty: 'easy' }));
    const playerPlanet = sim.planets.find((p) => p.ownerId === PLAYER_ID)!;
    const neutralPlanet = sim.planets.find((p) => p.ownerId === NEUTRAL_ID)!;

    playerPlanet.ships = 20;
    playerPlanet.prodProgress = 0;
    playerPlanet.productionRate = 2.5;
    const neutralStartShips = neutralPlanet.ships;

    // Run for exactly 4.0 seconds (240 frames of 1/60s) without AI interfering on neutralPlanet
    // Push AI ships to 0 except keeping 1 planet so AI doesn't attack neutralPlanet during test
    const aiPlanet = sim.planets.find((p) => p.ownerId === 2)!;
    aiPlanet.ships = 5;

    for (let i = 0; i < 240; i++) {
      sim.update(1 / 60);
    }

    expect(playerPlanet.ships).toBe(20 + Math.floor(2.5 * 4.0));
    expect(neutralPlanet.ships).toBe(neutralStartShips);
  });
});

describe('AI Activity & Victory/Defeat Invariants', () => {
  it('AI launches fleets and expands cleanly over 15 seconds without NaN', () => {
    const sim = new GameSimulation(
      makeConfig({ mode: 'attract', opponents: 3, planetCount: 24, difficulty: 'hard' }),
    );

    const initialTotalPlanetShips = sim.planets.reduce((acc, p) => acc + p.ships, 0);

    for (let i = 0; i < 15 * 60; i++) {
      sim.update(1 / 60);
    }

    const totalOwned = sim.planets.filter((p) => p.ownerId !== NEUTRAL_ID).length;
    expect(totalOwned).toBeGreaterThan(4);

    for (const p of sim.planets) {
      expect(Number.isFinite(p.ships)).toBe(true);
      expect(Number.isInteger(p.ships)).toBe(true);
    }
    for (const s of sim.ships) {
      expect(Number.isFinite(s.x)).toBe(true);
      expect(Number.isFinite(s.y)).toBe(true);
      expect(s.count).toBeGreaterThanOrEqual(1);
    }
    expect(sim.stats.powerHistory.length).toBeGreaterThanOrEqual(7);
    expect(initialTotalPlanetShips).toBeGreaterThan(0);
  });

  it('keeps player alive while last fleet is in flight and triggers victory when all AIs are eliminated', () => {
    const sim = new GameSimulation(makeConfig({ opponents: 1, planetCount: 10, difficulty: 'easy' }));
    const playerHome = sim.planets.find((p) => p.ownerId === PLAYER_ID)!;
    const aiHome = sim.planets.find((p) => p.ownerId === 2)!;

    // Position close to each other
    playerHome.x = 320;
    playerHome.y = 360;
    playerHome.ships = 120;
    aiHome.x = 460;
    aiHome.y = 360;
    aiHome.ships = 20;

    // Player sends 100% of fleet toward AI homeworld, then loses their own homeworld to neutral
    const sent = sim.sendShips([playerHome.id], aiHome.id, PLAYER_ID, 1.0);
    expect(sent).toBe(120);
    playerHome.ownerId = NEUTRAL_ID;
    playerHome.ships = 15;

    // Tick 10 frames: player owns 0 planets, yet fleet is in flight -> NOT defeated!
    for (let i = 0; i < 10; i++) {
      sim.update(1 / 60);
    }
    expect(sim.status).toBe('playing');
    expect(sim.factionById.get(PLAYER_ID)?.eliminated).toBe(false);

    // Continue ticking until fleet reaches and captures AI's last planet
    for (let i = 0; i < 240; i++) {
      sim.update(1 / 60);
      if (sim.status !== 'playing') break;
    }

    expect(sim.status).toBe('victory');
    expect(sim.stats.winnerId).toBe(PLAYER_ID);
  });
});
