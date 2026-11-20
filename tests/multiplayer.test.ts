import { describe, expect, it, vi } from 'vitest';
import { NEUTRAL_ID } from '../src/game/constants';
import { GameSimulation } from '../src/game/simulation';
import type { MatchConfig } from '../src/game/types';
import {
  ROOM_CODE_ALPHABET,
  extractRoomCodeFromInput,
  generateRoomCode,
} from '../src/net/protocol';

function makeOnlineConfig(overrides: Partial<MatchConfig> = {}): MatchConfig {
  return {
    mode: 'online',
    mapType: 'symmetric',
    planetCount: 16,
    opponents: 1,
    difficulty: 'normal',
    rule: 'standard',
    seed: 77777,
    localPlayerId: 1,
    customFactions: [
      { id: 1, name: 'Kurucu', isHuman: true },
      { id: 2, name: 'Misafir', isHuman: true },
    ],
    ...overrides,
  };
}

describe('Online Room Code & URL Parsing', () => {
  it('generates valid 6-char room codes from ROOM_CODE_ALPHABET', () => {
    for (let i = 0; i < 30; i++) {
      const code = generateRoomCode();
      expect(code).toHaveLength(6);
      for (const ch of code) {
        expect(ROOM_CODE_ALPHABET.includes(ch)).toBe(true);
      }
    }
  });

  it('extracts normalized room codes from raw codes and ?oda= invite URLs', () => {
    expect(extractRoomCodeFromInput('ab23cd')).toBe('AB23CD');
    expect(extractRoomCodeFromInput('  xy79mn  ')).toBe('XY79MN');
    expect(extractRoomCodeFromInput('https://galcon.vercel.app/?oda=k9p3qr')).toBe('K9P3QR');
    expect(extractRoomCodeFromInput('http://localhost:5173/?foo=1&oda=Z4M8W2&bar=2')).toBe(
      'Z4M8W2',
    );
    expect(extractRoomCodeFromInput('')).toBeNull();
    expect(extractRoomCodeFromInput('abc')).toBeNull();
    expect(extractRoomCodeFromInput('https://example.com/?room=AB12CD')).toBeNull();
  });
});

describe('Online Simulation & Host/Guest Snapshot Sync', () => {
  it('tracks customFactions and localPlayerId = 2 stats and victory', () => {
    const sim = new GameSimulation(makeOnlineConfig({ localPlayerId: 2 }));
    expect(sim.localPlayerId).toBe(2);

    const p1Home = sim.planets.find((p) => p.ownerId === 1)!;
    const p2Home = sim.planets.find((p) => p.ownerId === 2)!;

    p1Home.x = 400;
    p1Home.y = 360;
    p1Home.ships = 25;
    p1Home.productionRate = 0;

    p2Home.x = 500;
    p2Home.y = 360;
    p2Home.ships = 90;
    p2Home.productionRate = 0;

    const sent = sim.sendShips([p2Home.id], p1Home.id, 2, 1.0);
    expect(sent).toBe(90);
    expect(sim.stats.shipsSent).toBe(90);

    for (let i = 0; i < 200; i++) {
      sim.update(1 / 60);
      if (sim.status !== 'playing') break;
    }

    expect(sim.status).toBe('victory');
    expect(sim.stats.winnerId).toBe(2);
    expect(sim.stats.planetsCaptured).toBe(1);
    expect(sim.stats.shipsDestroyed).toBe(25);
  });

  it('syncs Host snapshot to Guest simulation including captures and match end', () => {
    const host = new GameSimulation(makeOnlineConfig({ localPlayerId: 1 }));
    const guestCaptureSpy = vi.fn();
    const guestEndSpy = vi.fn();

    const guest = new GameSimulation(makeOnlineConfig({ localPlayerId: 2 }), {
      onCapture: guestCaptureSpy,
      onMatchEnd: guestEndSpy,
    });

    const p1Host = host.planets.find((p) => p.ownerId === 1)!;
    const p2Host = host.planets.find((p) => p.ownerId === 2)!;
    p1Host.x = 200;
    p1Host.y = 360;
    p1Host.ships = 120;
    p2Host.x = 500;
    p2Host.y = 360;
    p2Host.ships = 20;

    // Keep planet positions aligned on guest (same seed already generated identical positions; align test override too)
    guest.planets[p1Host.id].x = 200;
    guest.planets[p1Host.id].y = 360;
    guest.planets[p2Host.id].x = 500;
    guest.planets[p2Host.id].y = 360;

    // Host dispatches faction 1 fleet toward faction 2 homeworld
    host.sendShips([p1Host.id], p2Host.id, 1, 1.0);
    for (let i = 0; i < 15; i++) {
      host.update(1 / 60);
    }

    // Mid-flight snapshot sync
    const midSnap = host.createSnapshot();
    expect(midSnap.ships.length).toBeGreaterThan(0);
    guest.applySnapshot(midSnap);
    expect(guest.ships.length).toBe(midSnap.ships.length);
    expect(guest.planets[p1Host.id].ships).toBe(p1Host.ships);

    // Run host until capture & victory for faction 1
    for (let i = 0; i < 200; i++) {
      host.update(1 / 60);
      if (host.status !== 'playing') break;
    }
    expect(host.status).toBe('victory');

    const finalSnap = host.createSnapshot();
    expect(finalSnap.captures.length).toBeGreaterThanOrEqual(1);
    guest.applySnapshot(finalSnap);

    // Guest (faction 2) should receive capture event, shockwave, and defeat status (winnerId = 1)
    expect(guestCaptureSpy).toHaveBeenCalled();
    expect(guest.shockwaves.length).toBeGreaterThan(0);
    expect(guest.status).toBe('defeat');
    expect(guest.stats.winnerId).toBe(1);
    expect(guestEndSpy).toHaveBeenCalledWith('defeat', 1);
  });

  it('converts disconnected human player to AI bot mid-match', () => {
    const sim = new GameSimulation(makeOnlineConfig({ localPlayerId: 1 }));
    const faction2 = sim.factionById.get(2)!;
    expect(faction2.isPlayer).toBe(true);

    sim.convertFactionToBot(2);
    expect(faction2.isPlayer).toBe(false);
    expect(faction2.name).toContain('(Bot)');

    const initialOwnedBy2 = sim.planets.filter((p) => p.ownerId === 2).length;
    for (let i = 0; i < 12 * 60; i++) {
      sim.update(1 / 60);
    }

    const totalOwnedBy2OrShips =
      sim.planets.filter((p) => p.ownerId === 2).length +
      sim.ships.filter((s) => s.ownerId === 2).length;
    const totalOwnedEver = sim.planets.filter((p) => p.ownerId !== NEUTRAL_ID).length;

    expect(totalOwnedBy2OrShips).toBeGreaterThan(initialOwnedBy2);
    expect(totalOwnedEver).toBeGreaterThan(2);
  });
});
