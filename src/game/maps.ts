import {
  HOMEWORLD_RADIUS,
  HOMEWORLD_SHIPS_STANDARD,
  HOMEWORLD_SHIPS_SUPERFLEET,
  MARGIN_X,
  MARGIN_Y,
  MAX_PLANET_RADIUS,
  MIN_PLANET_GAP,
  MIN_PLANET_RADIUS,
  NEUTRAL_ID,
  PLAYER_ID,
  PRODUCTION_MAX,
  PRODUCTION_MIN,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from './constants';
import type { GameRule, MapType, MatchConfig, Planet, PlanetCrater } from './types';

export function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function calcProductionRate(radius: number): number {
  const t = Math.max(
    0,
    Math.min(1, (radius - MIN_PLANET_RADIUS) / (MAX_PLANET_RADIUS - MIN_PLANET_RADIUS)),
  );
  return Number((PRODUCTION_MIN + t * (PRODUCTION_MAX - PRODUCTION_MIN)).toFixed(2));
}

function generateCraters(rng: () => number): PlanetCrater[] {
  const count = 2 + Math.floor(rng() * 3);
  const craters: PlanetCrater[] = [];
  for (let i = 0; i < count; i++) {
    craters.push({
      angle: rng() * Math.PI * 2,
      dist: 0.22 + rng() * 0.44,
      r: 0.1 + rng() * 0.12,
    });
  }
  return craters;
}

function createPlanet(
  id: number,
  x: number,
  y: number,
  radius: number,
  ownerId: number,
  ships: number,
  rng: () => number,
  overrideProd?: number,
): Planet {
  return {
    id,
    x,
    y,
    radius,
    ownerId,
    ships: Math.round(ships),
    prodProgress: 0,
    productionRate: overrideProd ?? calcProductionRate(radius),
    rallyTargetId: null,
    rallyCooldown: 0,
    hitFlash: 0,
    capturePulse: 0,
    pulseColor: '',
    craters: generateCraters(rng),
  };
}

function isInsideBounds(x: number, y: number, radius: number): boolean {
  return (
    x >= MARGIN_X + radius &&
    x <= WORLD_WIDTH - MARGIN_X - radius &&
    y >= MARGIN_Y + radius &&
    y <= WORLD_HEIGHT - MARGIN_Y - radius
  );
}

function clampToBounds(x: number, y: number, radius: number): { x: number; y: number } {
  return {
    x: Math.max(MARGIN_X + radius, Math.min(WORLD_WIDTH - MARGIN_X - radius, x)),
    y: Math.max(MARGIN_Y + radius, Math.min(WORLD_HEIGHT - MARGIN_Y - radius, y)),
  };
}

function canPlace(
  planets: Planet[],
  x: number,
  y: number,
  radius: number,
  gap: number = MIN_PLANET_GAP,
): boolean {
  if (!isInsideBounds(x, y, radius)) return false;
  for (const p of planets) {
    const dx = p.x - x;
    const dy = p.y - y;
    const minDist = p.radius + radius + gap;
    if (dx * dx + dy * dy < minDist * minDist) {
      return false;
    }
  }
  return true;
}

function addRandomNeutralPlanets(
  planets: Planet[],
  targetTotal: number,
  rng: () => number,
  minShipMult = 1,
): void {
  let attempts = 0;
  const maxAttempts = 2500;
  while (planets.length < targetTotal && attempts < maxAttempts) {
    attempts++;
    const radius =
      MIN_PLANET_RADIUS + Math.floor(rng() * (MAX_PLANET_RADIUS - MIN_PLANET_RADIUS + 1));
    const x = MARGIN_X + radius + rng() * (WORLD_WIDTH - 2 * (MARGIN_X + radius));
    const y = MARGIN_Y + radius + rng() * (WORLD_HEIGHT - 2 * (MARGIN_Y + radius));
    if (canPlace(planets, x, y, radius)) {
      const ships = Math.max(6, Math.round((radius * 0.62 + rng() * 16) * minShipMult));
      planets.push(createPlanet(planets.length, x, y, radius, NEUTRAL_ID, ships, rng));
    }
  }
}

function placeHomeworldsEllipse(
  planets: Planet[],
  factionCount: number,
  startShips: number,
  rng: () => number,
  rx = 430,
  ry = 205,
  angleOffset = 0,
  asymmetricStart = false,
): void {
  const cx = WORLD_WIDTH / 2;
  const cy = WORLD_HEIGHT / 2;

  for (let i = 0; i < factionCount; i++) {
    const ownerId = PLAYER_ID + i;
    const angle = angleOffset + (i * Math.PI * 2) / factionCount;
    const rawX = cx + Math.cos(angle) * rx;
    const rawY = cy + Math.sin(angle) * ry;
    const isAsymPlayer = asymmetricStart && ownerId === PLAYER_ID;
    const radius = isAsymPlayer ? 33 : HOMEWORLD_RADIUS;
    const ships = isAsymPlayer ? 85 : startShips;
    const clamped = clampToBounds(rawX, rawY, radius);

    if (canPlace(planets, clamped.x, clamped.y, radius)) {
      planets.push(createPlanet(planets.length, clamped.x, clamped.y, radius, ownerId, ships, rng));
    } else {
      // Spiral search nearby if exact slot blocked
      for (let d = 16; d < 260; d += 16) {
        let placed = false;
        for (let a = 0; a < 12; a++) {
          const theta = (a * Math.PI * 2) / 12;
          const pos = clampToBounds(
            clamped.x + Math.cos(theta) * d,
            clamped.y + Math.sin(theta) * d,
            radius,
          );
          if (canPlace(planets, pos.x, pos.y, radius)) {
            planets.push(createPlanet(planets.length, pos.x, pos.y, radius, ownerId, ships, rng));
            placed = true;
            break;
          }
        }
        if (placed) break;
      }
    }
  }

  // Sector 8 asymmetric siege: player gets a second core planet nearby
  if (asymmetricStart) {
    const playerMain = planets.find((p) => p.ownerId === PLAYER_ID);
    if (playerMain) {
      const baseAngle = Math.atan2(WORLD_HEIGHT / 2 - playerMain.y, WORLD_WIDTH / 2 - playerMain.x);
      for (let step = 0; step < 16; step++) {
        const a = baseAngle + (step % 2 === 0 ? 1 : -1) * Math.floor(step / 2) * 0.35;
        const dist = 108;
        const pos = clampToBounds(
          playerMain.x + Math.cos(a) * dist,
          playerMain.y + Math.sin(a) * dist,
          33,
        );
        if (canPlace(planets, pos.x, pos.y, 33)) {
          planets.push(createPlanet(planets.length, pos.x, pos.y, 33, PLAYER_ID, 85, rng));
          break;
        }
      }
    }
  }
}

export function generateMap(config: MatchConfig): Planet[] {
  const rng = mulberry32(config.seed);
  const planets: Planet[] = [];
  const factionCount = Math.max(2, Math.min(6, config.opponents + 1));
  const totalPlanets = Math.max(factionCount + 4, config.planetCount);
  const startShips =
    config.rule === 'superfleet' ? HOMEWORLD_SHIPS_SUPERFLEET : HOMEWORLD_SHIPS_STANDARD;
  const cx = WORLD_WIDTH / 2;
  const cy = WORLD_HEIGHT / 2;

  if (config.rule === 'megacore') {
    planets.push(createPlanet(planets.length, cx, cy, 46, NEUTRAL_ID, 65, rng, 6.2));
  }

  switch (config.mapType) {
    case 'classic': {
      const baseAngle = rng() * Math.PI * 2;
      placeHomeworldsEllipse(
        planets,
        factionCount,
        startShips,
        rng,
        420,
        200,
        baseAngle,
        config.asymmetricStart,
      );
      addRandomNeutralPlanets(planets, totalPlanets, rng);
      break;
    }

    case 'symmetric': {
      const baseAngle = rng() * Math.PI * 2;
      placeHomeworldsEllipse(
        planets,
        factionCount,
        startShips,
        rng,
        435,
        205,
        baseAngle,
        config.asymmetricStart,
      );

      // Optional single center planet if not already megacore
      if (config.rule !== 'megacore' && totalPlanets % factionCount !== 0) {
        const centerRadius = 38;
        if (canPlace(planets, cx, cy, centerRadius)) {
          planets.push(createPlanet(planets.length, cx, cy, centerRadius, NEUTRAL_ID, 42, rng));
        }
      }

      let attempts = 0;
      while (planets.length + factionCount <= totalPlanets && attempts < 900) {
        attempts++;
        const radius =
          MIN_PLANET_RADIUS + Math.floor(rng() * (MAX_PLANET_RADIUS - MIN_PLANET_RADIUS + 1));
        const radial = 0.22 + rng() * 0.72;
        const theta = rng() * ((Math.PI * 2) / factionCount);
        const ships = Math.round(radius * 0.65 + rng() * 14);

        const candidates: Array<{ x: number; y: number }> = [];
        let validGroup = true;
        for (let i = 0; i < factionCount; i++) {
          const a = baseAngle + theta + (i * Math.PI * 2) / factionCount;
          const x = cx + Math.cos(a) * 485 * radial;
          const y = cy + Math.sin(a) * 230 * radial;
          if (!canPlace(planets, x, y, radius)) {
            validGroup = false;
            break;
          }
          // Check against other candidates in same symmetric group
          for (const c of candidates) {
            const dx = c.x - x;
            const dy = c.y - y;
            const minD = radius * 2 + MIN_PLANET_GAP;
            if (dx * dx + dy * dy < minD * minD) {
              validGroup = false;
              break;
            }
          }
          if (!validGroup) break;
          candidates.push({ x, y });
        }

        if (validGroup) {
          for (const c of candidates) {
            planets.push(createPlanet(planets.length, c.x, c.y, radius, NEUTRAL_ID, ships, rng));
          }
        }
      }

      addRandomNeutralPlanets(planets, totalPlanets, rng);
      break;
    }

    case 'spiral': {
      if (config.rule !== 'megacore') {
        planets.push(createPlanet(planets.length, cx, cy, 40, NEUTRAL_ID, 45, rng));
      }
      const arms = Math.max(2, factionCount);
      const baseAngle = rng() * Math.PI * 2;
      const twist = 2.2;

      // Place homeworlds near outer arm tips
      for (let i = 0; i < factionCount; i++) {
        const ownerId = PLAYER_ID + i;
        const isAsymPlayer = Boolean(config.asymmetricStart) && ownerId === PLAYER_ID;
        const radius = isAsymPlayer ? 33 : HOMEWORLD_RADIUS;
        const ships = isAsymPlayer ? 85 : startShips;
        const angle = baseAngle + (i * Math.PI * 2) / arms + twist * 0.82;
        const pos = clampToBounds(cx + Math.cos(angle) * 435, cy + Math.sin(angle) * 210, radius);
        if (canPlace(planets, pos.x, pos.y, radius)) {
          planets.push(createPlanet(planets.length, pos.x, pos.y, radius, ownerId, ships, rng));
        }
      }

      if (config.asymmetricStart) {
        const playerMain = planets.find((p) => p.ownerId === PLAYER_ID);
        if (playerMain) {
          const pos = clampToBounds(playerMain.x * 0.8 + cx * 0.2, playerMain.y * 0.8 + cy * 0.2, 33);
          if (canPlace(planets, pos.x, pos.y, 33)) {
            planets.push(createPlanet(planets.length, pos.x, pos.y, 33, PLAYER_ID, 85, rng));
          }
        }
      }

      // Distribute arm planets
      const remaining = totalPlanets - planets.length;
      const perArm = Math.ceil(remaining / arms);
      for (let arm = 0; arm < arms; arm++) {
        for (let step = 0; step < perArm && planets.length < totalPlanets; step++) {
          const t = (step + 1) / (perArm + 1);
          const angle =
            baseAngle + (arm * Math.PI * 2) / arms + twist * t + (rng() - 0.5) * 0.25;
          const rx = 115 + t * 380;
          const ry = 75 + t * 155;
          const radius = Math.round(MAX_PLANET_RADIUS - 4 - t * 14 + (rng() - 0.5) * 6);
          const clampedRadius = Math.max(MIN_PLANET_RADIUS, Math.min(MAX_PLANET_RADIUS, radius));
          const pos = clampToBounds(
            cx + Math.cos(angle) * rx + (rng() - 0.5) * 24,
            cy + Math.sin(angle) * ry + (rng() - 0.5) * 24,
            clampedRadius,
          );
          if (canPlace(planets, pos.x, pos.y, clampedRadius)) {
            const ships = Math.round(clampedRadius * 0.55 + (1 - t) * 14 + rng() * 10);
            planets.push(
              createPlanet(planets.length, pos.x, pos.y, clampedRadius, NEUTRAL_ID, ships, rng),
            );
          }
        }
      }

      addRandomNeutralPlanets(planets, totalPlanets, rng);
      break;
    }

    case 'ring': {
      if (config.rule !== 'megacore') {
        planets.push(createPlanet(planets.length, cx, cy, 42, NEUTRAL_ID, 50, rng));
      }
      const baseAngle = rng() * Math.PI * 2;
      placeHomeworldsEllipse(
        planets,
        factionCount,
        startShips,
        rng,
        430,
        205,
        baseAngle,
        config.asymmetricStart,
      );

      const remaining = Math.max(4, totalPlanets - planets.length);
      const innerCount = Math.max(4, Math.floor(remaining * 0.4));
      const outerCount = remaining - innerCount;

      for (let i = 0; i < innerCount && planets.length < totalPlanets; i++) {
        const a = baseAngle + (i * Math.PI * 2) / innerCount + 0.15;
        const r = Math.round(25 + rng() * 11);
        const pos = clampToBounds(cx + Math.cos(a) * 195, cy + Math.sin(a) * 115, r);
        if (canPlace(planets, pos.x, pos.y, r)) {
          planets.push(
            createPlanet(planets.length, pos.x, pos.y, r, NEUTRAL_ID, Math.round(r * 0.72 + rng() * 10), rng),
          );
        }
      }

      for (let i = 0; i < outerCount && planets.length < totalPlanets; i++) {
        const a = baseAngle + ((i + 0.5) * Math.PI * 2) / Math.max(1, outerCount);
        const r = Math.round(20 + rng() * 14);
        const pos = clampToBounds(cx + Math.cos(a) * 425, cy + Math.sin(a) * 202, r);
        if (canPlace(planets, pos.x, pos.y, r)) {
          planets.push(
            createPlanet(planets.length, pos.x, pos.y, r, NEUTRAL_ID, Math.round(r * 0.55 + rng() * 12), rng),
          );
        }
      }

      addRandomNeutralPlanets(planets, totalPlanets, rng);
      break;
    }

    case 'grid': {
      const aspect = (WORLD_WIDTH - 2 * MARGIN_X) / (WORLD_HEIGHT - 2 * MARGIN_Y);
      const cols = Math.max(4, Math.min(9, Math.round(Math.sqrt(totalPlanets * aspect))));
      const rows = Math.max(3, Math.min(6, Math.ceil(totalPlanets / cols)));
      const usableW = WORLD_WIDTH - 2 * MARGIN_X - 96;
      const usableH = WORLD_HEIGHT - 2 * MARGIN_Y - 90;
      const stepX = cols > 1 ? usableW / (cols - 1) : 0;
      const stepY = rows > 1 ? usableH / (rows - 1) : 0;

      const nodes: Array<{ x: number; y: number; distFromEdge: number }> = [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const stagger = r % 2 === 1 ? stepX * 0.25 : -stepX * 0.25;
          const x = MARGIN_X + 48 + c * stepX + (cols > 4 ? stagger * 0.5 : 0);
          const y = MARGIN_Y + 45 + r * stepY;
          const edgeDist = Math.min(c, cols - 1 - c, r, rows - 1 - r);
          nodes.push({ x, y, distFromEdge: edgeDist });
        }
      }

      // Place homeworlds on maximally spaced perimeter positions
      placeHomeworldsEllipse(
        planets,
        factionCount,
        startShips,
        rng,
        435,
        202,
        Math.PI / 6,
        config.asymmetricStart,
      );

      // Shuffle nodes deterministically while slightly preferring center nodes
      const shuffled = [...nodes].sort(() => rng() - 0.5);
      for (const n of shuffled) {
        if (planets.length >= totalPlanets) break;
        const radius =
          MIN_PLANET_RADIUS + Math.floor(rng() * (MAX_PLANET_RADIUS - MIN_PLANET_RADIUS - 2));
        const jx = n.x + (rng() - 0.5) * 18;
        const jy = n.y + (rng() - 0.5) * 18;
        const pos = clampToBounds(jx, jy, radius);
        if (canPlace(planets, pos.x, pos.y, radius)) {
          const ships = Math.round(radius * 0.6 + n.distFromEdge * 5 + rng() * 10);
          planets.push(createPlanet(planets.length, pos.x, pos.y, radius, NEUTRAL_ID, ships, rng));
        }
      }

      addRandomNeutralPlanets(planets, totalPlanets, rng);
      break;
    }

    case 'clusters': {
      const baseAngle = rng() * Math.PI * 2;
      placeHomeworldsEllipse(
        planets,
        factionCount,
        startShips,
        rng,
        430,
        200,
        baseAngle,
        config.asymmetricStart,
      );

      // Central choke-point cluster
      if (config.rule !== 'megacore') {
        planets.push(createPlanet(planets.length, cx, cy, 41, NEUTRAL_ID, 48, rng));
      }
      for (let i = 0; i < 3 && planets.length < totalPlanets; i++) {
        const a = baseAngle + (i * Math.PI * 2) / 3;
        const r = Math.round(27 + rng() * 8);
        const pos = clampToBounds(cx + Math.cos(a) * 115, cy + Math.sin(a) * 85, r);
        if (canPlace(planets, pos.x, pos.y, r)) {
          planets.push(createPlanet(planets.length, pos.x, pos.y, r, NEUTRAL_ID, 28 + rng() * 12, rng));
        }
      }

      // Satellite neutral planets near each faction homeworld
      for (let f = 0; f < factionCount; f++) {
        const home = planets.find((p) => p.ownerId === PLAYER_ID + f);
        if (!home) continue;
        let placedNear = 0;
        let tries = 0;
        while (placedNear < 3 && tries < 60 && planets.length < totalPlanets) {
          tries++;
          const a = rng() * Math.PI * 2;
          const dist = 92 + rng() * 68;
          const r = Math.round(20 + rng() * 11);
          const pos = clampToBounds(home.x + Math.cos(a) * dist, home.y + Math.sin(a) * dist, r);
          if (canPlace(planets, pos.x, pos.y, r)) {
            planets.push(
              createPlanet(planets.length, pos.x, pos.y, r, NEUTRAL_ID, Math.round(10 + rng() * 12), rng),
            );
            placedNear++;
          }
        }
      }

      addRandomNeutralPlanets(planets, totalPlanets, rng);
      break;
    }
  }

  return planets;
}

export function generateMiniMapPreview(
  mapType: MapType,
  opponents: number,
  planetCount: number,
  seed: number,
  rule: GameRule = 'standard',
): Planet[] {
  return generateMap({
    mode: 'skirmish',
    mapType,
    opponents,
    planetCount,
    difficulty: 'normal',
    rule,
    seed,
  });
}
