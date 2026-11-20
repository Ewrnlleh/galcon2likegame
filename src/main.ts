import './style.css';
import { SoundEngine } from './game/audio';
import { CAMPAIGN_SECTORS, recordSectorVictory } from './game/campaign';
import { MAP_TYPE_LABELS, PLAYER_ID } from './game/constants';
import { InputController } from './game/input';
import { GameRenderer } from './game/renderer';
import { GameSimulation } from './game/simulation';
import type { MapType, MatchConfig, MatchStatus } from './game/types';
import { PeerRoomManager, loadSavedNickname } from './net/peerManager';
import { extractRoomCodeFromInput } from './net/protocol';
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
  let lastSnapshotMs = 0;

  let sim: GameSimulation;
  let hud: HudController;
  let menus: MenuController;
  let input: InputController;

  const clearInviteQueryParam = (): void => {
    if (window.location.search.includes('oda=')) {
      window.history.replaceState({}, '', window.location.pathname);
    }
  };

  const buildSimulation = (config: MatchConfig): GameSimulation => {
    const localId = config.localPlayerId ?? PLAYER_ID;
    return new GameSimulation(config, {
      onLaunch: (ownerId, count) => {
        if (config.mode !== 'attract' && ownerId === localId) {
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
          audio.playCapture(newOwnerId === localId, oldOwnerId === localId);
          input.pruneInvalidSelections();
        }
      },
      onElimination: (_factionId, factionName) => {
        if (config.mode !== 'attract') {
          hud.showToast(`${factionName} elendi!`, '#ffbe0b', 3200);
        }
      },
      onLocalEliminated: () => {
        input.clearSelection();
        hud.setSpectating(true);
        hud.showToast(
          'Tüm gezegenlerin ve filoların imha edildi — İzleme moduna geçildi',
          '#ff3366',
          4800,
        );
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

        if (config.mode === 'online' && peerManager.role === 'host') {
          peerManager.broadcastSnapshot(sim.createSnapshot());
        }

        input.clearSelection();
        hud.setSpectating(false);

        if (config.mode === 'online') {
          if (status === 'victory') {
            audio.playVictory();
          } else {
            audio.playDefeat();
          }
          menus.showResults(sim, status, null, false, undefined, {
            isHost: peerManager.role === 'host',
          });
          return;
        }

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
    peerManager.leaveRoom();
    clearInviteQueryParam();
    activeConfig = createAttractConfig();
    sim = buildSimulation(activeConfig);
    hud.setOnlineMode(false);
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
    lastSnapshotMs = 0;
    input.clearSelection();
    menus.hide();
    hud.setOnlineMode(config.mode === 'online');
    hud.setVisible(true, currentTitle);
    hud.setPaused(false, false);
    hud.setSpeed(sim.speedMultiplier);
    hud.setSpectating(false);
    hud.setPercent(input.sendPercent);

    if (tip) {
      hud.showToast(tip, '#00e5ff', 5200);
    }
  };

  const peerManager = new PeerRoomManager({
    onLobbyChange: (lobby, chat) => {
      menus.showOnlineLobby(lobby, chat, peerManager.role === 'host', peerManager.localPeerId);
    },
    onMatchStart: (config, title) => {
      startMatch(config, title, 'Online maç başladı — iyi şanslar!');
    },
    onSnapshot: (snapshot) => {
      if (sim.config.mode === 'online' && peerManager.role === 'guest') {
        sim.applySnapshot(snapshot);
      }
    },
    onRemoteCommand: (factionId, cmd) => {
      if (sim.config.mode !== 'online' || peerManager.role !== 'host') return;
      if (cmd.action === 'send') {
        sim.sendShips(cmd.fromIds, cmd.targetId, factionId, cmd.percent);
      } else if (cmd.action === 'redirect') {
        sim.redirectShips(cmd.shipIds, cmd.targetId, factionId);
      } else if (cmd.action === 'rally') {
        sim.setRallyPoint(cmd.planetIds, cmd.targetId, factionId);
      }
    },
    onReturnToLobby: (lobby, chat) => {
      activeConfig = createAttractConfig();
      sim = buildSimulation(activeConfig);
      hud.setOnlineMode(false);
      hud.setVisible(false);
      input.clearSelection();
      menus.showOnlineLobby(lobby, chat, peerManager.role === 'host', peerManager.localPeerId);
    },
    onPlayerDisconnectedInGame: (factionId, playerName) => {
      if (sim.config.mode === 'online') {
        sim.convertFactionToBot(factionId);
        hud.showToast(`${playerName} ayrıldı — yapay zeka devraldı`, '#ffbe0b', 3800);
      }
    },
    onDisconnected: (reason) => {
      clearInviteQueryParam();
      activeConfig = createAttractConfig();
      sim = buildSimulation(activeConfig);
      hud.setOnlineMode(false);
      hud.setVisible(false);
      input.clearSelection();
      menus.showOnlineEntry('', '', reason);
    },
    onError: (message) => {
      if (menus.getScreen() === 'online_entry') {
        menus.showOnlineEntry('', '', message);
      } else {
        hud.showToast(message, '#ff3366', 3800);
      }
    },
  });

  const createOnlineRoomFlow = async (nickname: string): Promise<void> => {
    menus.showOnlineEntry('', 'Oda oluşturuluyor...');
    try {
      await peerManager.createRoom(nickname);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Oda oluşturulamadı.';
      menus.showOnlineEntry('', '', msg);
    }
  };

  const joinOnlineRoomFlow = async (code: string, nickname: string): Promise<void> => {
    menus.showOnlineEntry(code, `Odaya bağlanılıyor (${code})...`);
    try {
      await peerManager.joinRoom(code, nickname);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Odaya bağlanılamadı.';
      menus.showOnlineEntry(code, '', msg);
    }
  };

  const togglePause = (): void => {
    if (sim.config.mode === 'attract' || sim.status !== 'playing') return;
    if (sim.config.mode === 'online') {
      const nextOpen = !hud.isPauseOverlayVisible();
      hud.setPaused(false, nextOpen);
      return;
    }
    sim.paused = !sim.paused;
    hud.setPaused(sim.paused, sim.paused);
  };

  const cycleSpeed = (): void => {
    if (sim.config.mode === 'attract' || sim.config.mode === 'online') return;
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
        if (sim.config.mode !== 'online' && !sim.paused && sim.status === 'playing') {
          sim.paused = true;
          hud.setPaused(true, false);
        } else {
          hud.setPaused(false, false);
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
      if (
        sim.config.mode !== 'attract' &&
        sim.config.mode !== 'online' &&
        sim.status === 'playing'
      ) {
        sim.paused = false;
        hud.setPaused(false, false);
      }
    },
    onCreateOnlineRoom: (nick) => void createOnlineRoomFlow(nick),
    onJoinOnlineRoom: (code, nick) => void joinOnlineRoomFlow(code, nick),
    onUpdateLobbySettings: (partial) => peerManager.updateSettings(partial),
    onKickLobbyPlayer: (peerId) => peerManager.kickPlayer(peerId),
    onSendLobbyChat: (text) => peerManager.sendChat(text),
    onStartOnlineMatch: () => peerManager.startMatch(),
    onLeaveOnlineRoom: startAttractMode,
    onReturnToOnlineLobby: () => peerManager.returnAllToLobby(),
  });

  input = new InputController(canvas, renderer, audio, () => sim, {
    isMenuBlocking: () => menus.isBlockingGameplay() || sim.paused || hud.isPauseOverlayVisible(),
    onPercentChange: (pct) => hud.setPercent(pct),
    onTogglePause: togglePause,
    onCycleSpeed: cycleSpeed,
    onToggleMute: toggleMute,
    onEscapeAction: () => {
      if (menus.getScreen() === 'help') {
        menus.hide();
        if (
          sim.config.mode !== 'attract' &&
          sim.config.mode !== 'online' &&
          sim.status === 'playing'
        ) {
          sim.paused = false;
          hud.setPaused(false, false);
        }
      } else if (
        menus.getScreen() === 'campaign' ||
        menus.getScreen() === 'skirmish' ||
        menus.getScreen() === 'online_entry'
      ) {
        clearInviteQueryParam();
        menus.showMain();
      } else if (menus.getScreen() === 'online_lobby') {
        startAttractMode();
      } else if (!menus.isBlockingGameplay()) {
        togglePause();
      }
    },
    onToast: (msg) => hud.showToast(msg, '#00e5ff', 2200),
    onSendCommand: (fromIds, targetId, percent) => {
      if (sim.config.mode === 'online' && peerManager.role === 'guest') {
        let est = 0;
        for (const id of new Set(fromIds)) {
          const p = sim.planetById.get(id);
          if (p && p.ownerId === sim.localPlayerId && p.id !== targetId) {
            est += percent >= 0.999 ? p.ships : Math.floor(p.ships * percent);
          }
        }
        if (est > 0) {
          sim.stats.shipsSent += est;
          audio.playLaunch(est);
          peerManager.sendCommand({
            type: 'cmd',
            action: 'send',
            fromIds,
            targetId,
            percent,
          });
        }
      } else {
        sim.sendShips(fromIds, targetId, sim.localPlayerId, percent);
      }
    },
    onRedirectCommand: (shipIds, targetId) => {
      if (sim.config.mode === 'online' && peerManager.role === 'guest') {
        if (shipIds.length > 0) {
          audio.playLaunch(shipIds.length);
          peerManager.sendCommand({
            type: 'cmd',
            action: 'redirect',
            shipIds,
            targetId,
          });
        }
      } else {
        sim.redirectShips(shipIds, targetId, sim.localPlayerId);
      }
    },
    onRallyCommand: (planetIds, targetId) => {
      if (sim.config.mode === 'online' && peerManager.role === 'guest') {
        peerManager.sendCommand({
          type: 'cmd',
          action: 'rally',
          planetIds,
          targetId,
        });
      } else {
        sim.setRallyPoint(planetIds, targetId, sim.localPlayerId);
      }
    },
  });

  // Start immediately in Attract Mode behind main menu
  sim = buildSimulation(activeConfig);
  hud.setVisible(false);

  // Check ?oda=XXXXXX invite link on load
  const urlParams = new URLSearchParams(window.location.search);
  const inviteCode = extractRoomCodeFromInput(urlParams.get('oda') ?? '');
  if (inviteCode) {
    void joinOnlineRoomFlow(inviteCode, loadSavedNickname());
  }

  window.addEventListener('resize', () => renderer.resize());

  // Fixed-step game loop
  const FIXED_STEP = 1 / 60;
  let lastFrameMs = performance.now();
  let accumulator = 0;

  const frame = (nowMs: number) => {
    const rawDt = Math.min(0.05, Math.max(0, (nowMs - lastFrameMs) / 1000));
    lastFrameMs = nowMs;

    if (sim.config.mode === 'online' && peerManager.role === 'guest') {
      sim.stepClientVisuals(rawDt);
    } else {
      accumulator += rawDt;
      while (accumulator >= FIXED_STEP) {
        sim.update(FIXED_STEP);
        accumulator -= FIXED_STEP;
      }

      if (
        sim.config.mode === 'online' &&
        peerManager.role === 'host' &&
        sim.status === 'playing'
      ) {
        const snapshotInterval = sim.ships.length > 500 ? 67 : 50;
        if (nowMs - lastSnapshotMs >= snapshotInterval) {
          lastSnapshotMs = nowMs;
          peerManager.broadcastSnapshot(sim.createSnapshot());
        }
      }
    }

    input.pruneInvalidSelections();
    renderer.render(sim, input.getOverlayState(), nowMs / 1000);
    hud.update(sim, nowMs);

    requestAnimationFrame(frame);
  };

  requestAnimationFrame(frame);
}

bootstrap();
