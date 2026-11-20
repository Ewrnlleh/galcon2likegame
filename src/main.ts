import './style.css';
import { SoundEngine } from './game/audio';
import { CAMPAIGN_SECTORS, recordSectorVictory } from './game/campaign';
import { MAP_TYPE_LABELS, PLAYER_ID } from './game/constants';
import { InputController } from './game/input';
import { GameRenderer } from './game/renderer';
import { GameSimulation } from './game/simulation';
import type { MapType, MatchConfig, MatchStatus } from './game/types';
import { HudController } from './ui/hud';
import { MenuController } from './ui/menus';

const ATTRACT_MAPS: MapType[] = ['classic', 'spiral', 'ring', 'clusters', 'symmetric'];

function createAttractConfig(): MatchConfig {
  const mapType = ATTRACT_MAPS[Math.floor(Math.random() * ATTRACT_MAPS.length)];
  return {
    mode: 'attract',
    mapType,
    planetCount: 28,
    opponents: 3,
    difficulty: 'hard',
    rule: 'turbo',
    seed: Math.floor(Math.random() * 900000) + 10000,
  };
}

function bootstrap(): void {
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement | null;
  const hudRoot = document.getElementById('hud-root');
  const menuRoot = document.getElementById('menu-root');
  if (!canvas || !hudRoot || !menuRoot) {
    throw new Error('Required DOM containers missing');
  }

  const audio = new SoundEngine();
  const renderer = new GameRenderer(canvas);

  let currentTitle = 'Hızlı Savaş';
  let activeConfig: MatchConfig = createAttractConfig();
  let attractRestartTimer: number | null = null;

  let sim: GameSimulation;
  let hud: HudController;
  let menus: MenuController;
  let input: InputController;

  const buildSimulation = (config: MatchConfig): GameSimulation => {
    return new GameSimulation(config, {
      onLaunch: (ownerId, count) => {
        if (config.mode !== 'attract' && ownerId === PLAYER_ID) {
          audio.playLaunch(count);
        }
      },
      onImpact: () => {
        if (config.mode !== 'attract') {
          audio.playImpact();
        }
      },
      onCapture: (_planetId, newOwnerId, oldOwnerId) => {
        if (config.mode !== 'attract') {
          audio.playCapture(newOwnerId === PLAYER_ID, oldOwnerId === PLAYER_ID);
          input.pruneInvalidSelections();
        }
      },
      onElimination: (_factionId, factionName) => {
        if (config.mode !== 'attract') {
          hud.showToast(`${factionName} elendi!`, '#ffbe0b', 3200);
        }
      },
      onMatchEnd: (status: MatchStatus) => {
        if (config.mode === 'attract') {
          if (attractRestartTimer !== null) window.clearTimeout(attractRestartTimer);
          attractRestartTimer = window.setTimeout(() => {
            if (sim.config.mode === 'attract') {
              activeConfig = createAttractConfig();
              sim = buildSimulation(activeConfig);
            }
          }, 2200);
          return;
        }

        input.clearSelection();

        if (status === 'victory') {
          audio.playVictory();
          let earnedStars: number | null = null;
          let hasNextSector = false;
          let onNext: (() => void) | undefined;

          if (config.mode === 'campaign' && config.sectorId !== undefined) {
            const sec = CAMPAIGN_SECTORS.find((s) => s.id === config.sectorId);
            if (sec) {
              const res = recordSectorVictory(sec, sim.stats.elapsed);
              earnedStars = res.earnedStars;
              const nextSec = CAMPAIGN_SECTORS.find((s) => s.id === sec.id + 1);
              if (nextSec) {
                hasNextSector = true;
                onNext = () => {
                  startMatch(
                    {
                      mode: 'campaign',
                      sectorId: nextSec.id,
                      mapType: nextSec.mapType,
                      planetCount: nextSec.planetCount,
                      opponents: nextSec.opponents,
                      difficulty: nextSec.difficulty,
                      rule: nextSec.rule,
                      seed: nextSec.seed,
                      asymmetricStart: nextSec.asymmetricStart,
                    },
                    `Sektör ${nextSec.id}: ${nextSec.name}`,
                    nextSec.tip,
                  );
                };
              }
            }
          }

          menus.showResults(sim, status, earnedStars, hasNextSector, onNext);
        } else if (status === 'defeat') {
          audio.playDefeat();
          menus.showResults(sim, status, null, false);
        }
      },
    });
  };

  const startAttractMode = (): void => {
    if (attractRestartTimer !== null) {
      window.clearTimeout(attractRestartTimer);
      attractRestartTimer = null;
    }
    activeConfig = createAttractConfig();
    sim = buildSimulation(activeConfig);
    hud.setVisible(false);
    input.clearSelection();
    menus.showMain();
  };

  const startMatch = (config: MatchConfig, title: string, tip?: string): void => {
    if (attractRestartTimer !== null) {
      window.clearTimeout(attractRestartTimer);
      attractRestartTimer = null;
    }
    audio.unlock();
    activeConfig = { ...config };
    currentTitle = title || `${MAP_TYPE_LABELS[config.mapType].name}`;
    sim = buildSimulation(activeConfig);
    input.clearSelection();
    menus.hide();
    hud.setVisible(true, currentTitle);
    hud.setPaused(false, false);
    hud.setSpeed(sim.speedMultiplier);
    hud.setSpectating(false);
    hud.setPercent(input.sendPercent);

    if (tip) {
      hud.showToast(tip, '#00e5ff', 5200);
    }
  };

  const togglePause = (): void => {
    if (sim.config.mode === 'attract' || sim.status !== 'playing') return;
    sim.paused = !sim.paused;
    hud.setPaused(sim.paused, sim.paused);
  };

  const cycleSpeed = (): void => {
    if (sim.config.mode === 'attract') return;
    sim.speedMultiplier = sim.speedMultiplier === 1 ? 1.5 : sim.speedMultiplier === 1.5 ? 2 : 1;
    hud.setSpeed(sim.speedMultiplier);
    hud.showToast(`Oyun hızı: ${sim.speedMultiplier}x`, '#00e5ff', 1800);
  };

  const toggleMute = (): void => {
    const muted = audio.toggleMute();
    hud.setMuted(muted);
  };

  hud = new HudController(
    hudRoot,
    {
      onTogglePause: togglePause,
      onCycleSpeed: cycleSpeed,
      onToggleMute: toggleMute,
      onOpenHelp: () => {
        if (!sim.paused && sim.status === 'playing') {
          sim.paused = true;
          hud.setPaused(true, false);
        }
        menus.showHelp('none');
      },
      onExitToMenu: startAttractMode,
      onRestart: () => startMatch(activeConfig, currentTitle),
      onSelectPercent: (pct) => input.setSendPercent(pct),
      onSelectAll: () => input.selectAllPlayerPlanets(),
    },
    audio.isMuted(),
  );

  menus = new MenuController(menuRoot, {
    onStartMatch: startMatch,
    onReturnToMain: startAttractMode,
    onRestartMatch: () => startMatch(activeConfig, currentTitle),
    onSpectateMatch: () => {
      sim.spectating = true;
      hud.setSpectating(true);
    },
    onCloseHelp: () => {
      if (sim.config.mode !== 'attract' && sim.status === 'playing') {
        sim.paused = false;
        hud.setPaused(false, false);
      }
    },
  });

  input = new InputController(canvas, renderer, audio, () => sim, {
    isMenuBlocking: () => menus.isBlockingGameplay() || sim.paused,
    onPercentChange: (pct) => hud.setPercent(pct),
    onTogglePause: togglePause,
    onCycleSpeed: cycleSpeed,
    onToggleMute: toggleMute,
    onEscapeAction: () => {
      if (menus.getScreen() === 'help') {
        menus.hide();
        if (sim.config.mode !== 'attract' && sim.status === 'playing') {
          sim.paused = false;
          hud.setPaused(false, false);
        }
      } else if (menus.getScreen() === 'campaign' || menus.getScreen() === 'skirmish') {
        menus.showMain();
      } else if (!menus.isBlockingGameplay()) {
        togglePause();
      }
    },
    onToast: (msg) => hud.showToast(msg, '#00e5ff', 2200),
  });

  // Start immediately in Attract Mode behind main menu
  sim = buildSimulation(activeConfig);
  hud.setVisible(false);

  window.addEventListener('resize', () => renderer.resize());

  // Fixed-step game loop
  const FIXED_STEP = 1 / 60;
  let lastFrameMs = performance.now();
  let accumulator = 0;

  const frame = (nowMs: number) => {
    const rawDt = Math.min(0.05, Math.max(0, (nowMs - lastFrameMs) / 1000));
    lastFrameMs = nowMs;

    accumulator += rawDt;
    while (accumulator >= FIXED_STEP) {
      sim.update(FIXED_STEP);
      accumulator -= FIXED_STEP;
    }

    input.pruneInvalidSelections();
    renderer.render(sim, input.getOverlayState(), nowMs / 1000);
    hud.update(sim, nowMs);

    requestAnimationFrame(frame);
  };

  requestAnimationFrame(frame);
}

bootstrap();
