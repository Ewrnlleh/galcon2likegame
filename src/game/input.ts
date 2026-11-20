import { PLAYER_ID } from './constants';
import type { SoundEngine } from './audio';
import type { GameRenderer, InteractionOverlay } from './renderer';
import type { GameSimulation } from './simulation';
import type { Planet } from './types';

export interface InputCallbacks {
  isMenuBlocking: () => boolean;
  onPercentChange: (percent: number) => void;
  onTogglePause: () => void;
  onCycleSpeed: () => void;
  onToggleMute: () => void;
  onEscapeAction: () => void;
  onToast?: (message: string) => void;
}

export class InputController {
  private canvas: HTMLCanvasElement;
  private renderer: GameRenderer;
  private audio: SoundEngine;
  private simGetter: () => GameSimulation;
  private callbacks: InputCallbacks;

  selectedPlanetIds = new Set<number>();
  selectedShipIds = new Set<number>();
  hoveredPlanetId: number | null = null;
  sendPercent = 0.5;

  private dragState: 'none' | 'planetDrag' | 'marquee' = 'none';
  private dragActivated = false;
  private dragSourcePlanetId: number | null = null;
  private dragStartScreen = { x: 0, y: 0 };
  private dragStartWorld = { x: 0, y: 0 };
  private pointerWorld = { x: 0, y: 0 };
  private activePointerId: number | null = null;

  private lastClickTime = 0;
  private lastClickPlanetId: number | null = null;

  constructor(
    canvas: HTMLCanvasElement,
    renderer: GameRenderer,
    audio: SoundEngine,
    simGetter: () => GameSimulation,
    callbacks: InputCallbacks,
  ) {
    this.canvas = canvas;
    this.renderer = renderer;
    this.audio = audio;
    this.simGetter = simGetter;
    this.callbacks = callbacks;

    this.bindEvents();
  }

  getOverlayState(): InteractionOverlay {
    const sim = this.simGetter();
    return {
      selectedPlanetIds: this.selectedPlanetIds,
      selectedShipIds: this.selectedShipIds,
      hoveredPlanetId: this.hoveredPlanetId,
      sendPercent: this.sendPercent,
      dragState: this.dragState,
      dragActivated: this.dragActivated,
      dragSourcePlanetId: this.dragSourcePlanetId,
      dragStartWorld: this.dragStartWorld,
      pointerWorld: this.pointerWorld,
      showInteractiveGuides:
        sim.config.mode !== 'attract' && sim.status === 'playing' && !this.callbacks.isMenuBlocking(),
    };
  }

  clearSelection(): void {
    this.selectedPlanetIds.clear();
    this.selectedShipIds.clear();
    this.dragState = 'none';
    this.dragActivated = false;
    this.dragSourcePlanetId = null;
  }

  pruneInvalidSelections(): void {
    const sim = this.simGetter();
    for (const id of [...this.selectedPlanetIds]) {
      const p = sim.planetById.get(id);
      if (!p || p.ownerId !== PLAYER_ID) {
        this.selectedPlanetIds.delete(id);
      }
    }
    if (this.selectedShipIds.size > 0) {
      const liveIds = new Set(sim.ships.map((s) => s.id));
      for (const id of [...this.selectedShipIds]) {
        if (!liveIds.has(id)) {
          this.selectedShipIds.delete(id);
        }
      }
    }
  }

  setSendPercent(pct: number): void {
    const clamped = Math.round(Math.max(0.1, Math.min(1.0, pct)) * 10) / 10;
    const fineClamped =
      Math.abs(pct - 0.25) < 0.01
        ? 0.25
        : Math.abs(pct - 0.75) < 0.01
          ? 0.75
          : clamped;
    this.sendPercent = fineClamped;
    this.callbacks.onPercentChange(this.sendPercent);
  }

  selectAllPlayerPlanets(): void {
    const sim = this.simGetter();
    if (sim.config.mode === 'attract' || sim.status !== 'playing') return;
    this.selectedShipIds.clear();
    this.selectedPlanetIds.clear();
    for (const p of sim.planets) {
      if (p.ownerId === PLAYER_ID) {
        this.selectedPlanetIds.add(p.id);
      }
    }
    if (this.selectedPlanetIds.size > 0) {
      this.audio.playSelect();
    }
  }

  private bindEvents(): void {
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerCancel);
    this.canvas.addEventListener('contextmenu', this.onContextMenu);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    window.addEventListener('keydown', this.onKeyDown);
  }

  destroy(): void {
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerCancel);
    this.canvas.removeEventListener('contextmenu', this.onContextMenu);
    this.canvas.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('keydown', this.onKeyDown);
  }

  private hitTestPlanet(wx: number, wy: number): Planet | null {
    const sim = this.simGetter();
    let best: Planet | null = null;
    let bestDist = Infinity;
    for (const p of sim.planets) {
      const d = Math.hypot(wx - p.x, wy - p.y);
      if (d <= p.radius + 7 && d < bestDist) {
        best = p;
        bestDist = d;
      }
    }
    return best;
  }

  private onContextMenu = (e: MouseEvent): void => {
    e.preventDefault();
  };

  private onPointerDown = (e: PointerEvent): void => {
    this.audio.unlock();
    const sim = this.simGetter();
    if (this.callbacks.isMenuBlocking() || sim.config.mode === 'attract' || sim.status !== 'playing') {
      return;
    }

    const world = this.renderer.screenToWorld(e.clientX, e.clientY);
    this.pointerWorld = world;
    const hit = this.hitTestPlanet(world.x, world.y);
    this.hoveredPlanetId = hit ? hit.id : null;

    // Right click: attack / reinforce / rally point
    if (e.button === 2) {
      e.preventDefault();
      if (!hit) return;

      if (e.shiftKey) {
        if (this.selectedPlanetIds.size > 0) {
          sim.setRallyPoint([...this.selectedPlanetIds], hit.id, PLAYER_ID);
          this.audio.playSelect();
          const clearing =
            this.selectedPlanetIds.size === 1 && this.selectedPlanetIds.has(hit.id);
          this.callbacks.onToast?.(
            clearing ? 'Ralli noktası temizlendi' : 'Ralli noktası ayarlandı',
          );
        }
        return;
      }

      if (this.selectedPlanetIds.size > 0) {
        sim.sendShips([...this.selectedPlanetIds], hit.id, PLAYER_ID, this.sendPercent);
      }
      if (this.selectedShipIds.size > 0) {
        sim.redirectShips([...this.selectedShipIds], hit.id, PLAYER_ID);
      }
      return;
    }

    if (e.button !== 0) return;

    this.activePointerId = e.pointerId;
    this.dragStartScreen = { x: e.clientX, y: e.clientY };
    this.dragStartWorld = { x: world.x, y: world.y };
    this.dragActivated = false;

    if (hit && hit.ownerId === PLAYER_ID) {
      this.dragState = 'planetDrag';
      this.dragSourcePlanetId = hit.id;
    } else {
      this.dragState = 'marquee';
      this.dragSourcePlanetId = null;
    }
  };

  private onPointerMove = (e: PointerEvent): void => {
    const sim = this.simGetter();
    if (this.callbacks.isMenuBlocking() || sim.config.mode === 'attract') {
      this.hoveredPlanetId = null;
      return;
    }

    const world = this.renderer.screenToWorld(e.clientX, e.clientY);
    this.pointerWorld = world;
    const hit = this.hitTestPlanet(world.x, world.y);
    this.hoveredPlanetId = hit ? hit.id : null;

    if (this.dragState === 'none' || e.pointerId !== this.activePointerId) return;

    const screenDist = Math.hypot(
      e.clientX - this.dragStartScreen.x,
      e.clientY - this.dragStartScreen.y,
    );
    if (screenDist > 8) {
      this.dragActivated = true;
    }

    if (this.dragState === 'marquee' && this.dragActivated && !e.shiftKey) {
      const minX = Math.min(this.dragStartWorld.x, world.x);
      const maxX = Math.max(this.dragStartWorld.x, world.x);
      const minY = Math.min(this.dragStartWorld.y, world.y);
      const maxY = Math.max(this.dragStartWorld.y, world.y);

      const caughtPlanets: number[] = [];
      for (const p of sim.planets) {
        if (
          p.ownerId === PLAYER_ID &&
          p.x >= minX - p.radius * 0.4 &&
          p.x <= maxX + p.radius * 0.4 &&
          p.y >= minY - p.radius * 0.4 &&
          p.y <= maxY + p.radius * 0.4
        ) {
          caughtPlanets.push(p.id);
        }
      }

      if (caughtPlanets.length > 0) {
        this.selectedShipIds.clear();
        this.selectedPlanetIds = new Set(caughtPlanets);
      }
    }
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (e.button !== 0 || e.pointerId !== this.activePointerId) return;

    const sim = this.simGetter();
    const world = this.renderer.screenToWorld(e.clientX, e.clientY);
    this.pointerWorld = world;
    const hit = this.hitTestPlanet(world.x, world.y);

    if (this.dragState === 'planetDrag' && this.dragSourcePlanetId !== null) {
      if (this.dragActivated) {
        if (hit && hit.id !== this.dragSourcePlanetId) {
          const sources =
            this.selectedPlanetIds.has(this.dragSourcePlanetId) &&
            this.selectedPlanetIds.size > 0
              ? [...this.selectedPlanetIds]
              : [this.dragSourcePlanetId];
          sim.sendShips(sources, hit.id, PLAYER_ID, this.sendPercent);
        }
      } else {
        // Click on owned planet
        const now = performance.now();
        const isDouble =
          now - this.lastClickTime < 320 && this.lastClickPlanetId === this.dragSourcePlanetId;
        this.lastClickTime = now;
        this.lastClickPlanetId = this.dragSourcePlanetId;

        if (isDouble) {
          this.selectAllPlayerPlanets();
        } else if (e.shiftKey) {
          this.selectedShipIds.clear();
          if (this.selectedPlanetIds.has(this.dragSourcePlanetId)) {
            this.selectedPlanetIds.delete(this.dragSourcePlanetId);
          } else {
            this.selectedPlanetIds.add(this.dragSourcePlanetId);
          }
          this.audio.playSelect();
        } else {
          this.selectedShipIds.clear();
          this.selectedPlanetIds.clear();
          this.selectedPlanetIds.add(this.dragSourcePlanetId);
          this.audio.playSelect();
        }
      }
    } else if (this.dragState === 'marquee') {
      if (this.dragActivated) {
        const minX = Math.min(this.dragStartWorld.x, world.x);
        const maxX = Math.max(this.dragStartWorld.x, world.x);
        const minY = Math.min(this.dragStartWorld.y, world.y);
        const maxY = Math.max(this.dragStartWorld.y, world.y);

        const caughtPlanets: number[] = [];
        for (const p of sim.planets) {
          if (
            p.ownerId === PLAYER_ID &&
            p.x >= minX - p.radius * 0.4 &&
            p.x <= maxX + p.radius * 0.4 &&
            p.y >= minY - p.radius * 0.4 &&
            p.y <= maxY + p.radius * 0.4
          ) {
            caughtPlanets.push(p.id);
          }
        }

        if (caughtPlanets.length > 0) {
          this.selectedShipIds.clear();
          if (!e.shiftKey) this.selectedPlanetIds.clear();
          for (const id of caughtPlanets) this.selectedPlanetIds.add(id);
          this.audio.playSelect();
        } else {
          // Check in-flight player ships for mid-flight redirect!
          const caughtShips: number[] = [];
          for (const s of sim.ships) {
            if (
              s.ownerId === PLAYER_ID &&
              s.x >= minX &&
              s.x <= maxX &&
              s.y >= minY &&
              s.y <= maxY
            ) {
              caughtShips.push(s.id);
            }
          }
          if (caughtShips.length > 0) {
            this.selectedPlanetIds.clear();
            this.selectedShipIds = new Set(caughtShips);
            this.audio.playSelect();
            this.callbacks.onToast?.(`${caughtShips.length} uçan filo seçildi — hedef gezegene tıkla`);
          } else if (!e.shiftKey) {
            this.selectedPlanetIds.clear();
            this.selectedShipIds.clear();
          }
        }
      } else {
        // Simple click on non-owned planet or empty space
        if (hit && hit.ownerId !== PLAYER_ID && (this.selectedPlanetIds.size > 0 || this.selectedShipIds.size > 0)) {
          if (this.selectedPlanetIds.size > 0) {
            sim.sendShips([...this.selectedPlanetIds], hit.id, PLAYER_ID, this.sendPercent);
          }
          if (this.selectedShipIds.size > 0) {
            sim.redirectShips([...this.selectedShipIds], hit.id, PLAYER_ID);
          }
        } else if (!hit && !e.shiftKey) {
          this.selectedPlanetIds.clear();
          this.selectedShipIds.clear();
        }
      }
    }

    this.dragState = 'none';
    this.dragActivated = false;
    this.dragSourcePlanetId = null;
    this.activePointerId = null;
  };

  private onPointerCancel = (): void => {
    this.dragState = 'none';
    this.dragActivated = false;
    this.dragSourcePlanetId = null;
    this.activePointerId = null;
  };

  private onWheel = (e: WheelEvent): void => {
    const sim = this.simGetter();
    if (this.callbacks.isMenuBlocking() || sim.config.mode === 'attract') return;
    e.preventDefault();
    const step = e.deltaY < 0 ? 0.1 : -0.1;
    // Snap cleanly to 10% increments on wheel
    const base = Math.round(this.sendPercent * 10) / 10;
    const next = Math.max(0.1, Math.min(1.0, Math.round((base + step) * 10) / 10));
    this.sendPercent = next;
    this.callbacks.onPercentChange(this.sendPercent);
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      if (this.callbacks.isMenuBlocking()) {
        this.callbacks.onEscapeAction();
        return;
      }
      if (this.selectedPlanetIds.size > 0 || this.selectedShipIds.size > 0) {
        this.clearSelection();
      } else {
        this.callbacks.onEscapeAction();
      }
      return;
    }

    if (this.callbacks.isMenuBlocking()) return;
    const sim = this.simGetter();
    if (sim.config.mode === 'attract') return;

    switch (e.key) {
      case '1':
        this.sendPercent = 0.25;
        this.callbacks.onPercentChange(0.25);
        break;
      case '2':
        this.sendPercent = 0.5;
        this.callbacks.onPercentChange(0.5);
        break;
      case '3':
        this.sendPercent = 0.75;
        this.callbacks.onPercentChange(0.75);
        break;
      case '4':
        this.sendPercent = 1.0;
        this.callbacks.onPercentChange(1.0);
        break;
      case 'q':
      case 'Q': {
        const base = Math.round(this.sendPercent * 10) / 10;
        this.sendPercent = Math.max(0.1, Math.round((base - 0.1) * 10) / 10);
        this.callbacks.onPercentChange(this.sendPercent);
        break;
      }
      case 'e':
      case 'E': {
        const base = Math.round(this.sendPercent * 10) / 10;
        this.sendPercent = Math.min(1.0, Math.round((base + 0.1) * 10) / 10);
        this.callbacks.onPercentChange(this.sendPercent);
        break;
      }
      case 'a':
      case 'A':
        this.selectAllPlayerPlanets();
        break;
      case 'r':
      case 'R': {
        const ids =
          this.selectedPlanetIds.size > 0
            ? [...this.selectedPlanetIds]
            : sim.planets.filter((p) => p.ownerId === PLAYER_ID).map((p) => p.id);
        sim.setRallyPoint(ids, null, PLAYER_ID);
        this.callbacks.onToast?.('Ralli noktaları temizlendi');
        break;
      }
      case ' ':
      case 'p':
      case 'P':
        e.preventDefault();
        this.callbacks.onTogglePause();
        break;
      case 'f':
      case 'F':
        this.callbacks.onCycleSpeed();
        break;
      case 'm':
      case 'M':
        this.callbacks.onToggleMute();
        break;
    }
  };
}
