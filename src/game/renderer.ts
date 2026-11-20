import { FACTION_PALETTE, NEUTRAL_ID, WORLD_HEIGHT, WORLD_WIDTH } from './constants';
import type { GameSimulation } from './simulation';
import type { Planet, ViewportTransform } from './types';

export interface InteractionOverlay {
  selectedPlanetIds: ReadonlySet<number>;
  selectedShipIds: ReadonlySet<number>;
  hoveredPlanetId: number | null;
  sendPercent: number;
  dragState: 'none' | 'planetDrag' | 'marquee';
  dragActivated: boolean;
  dragSourcePlanetId: number | null;
  dragStartWorld: { x: number; y: number };
  pointerWorld: { x: number; y: number };
  showInteractiveGuides: boolean;
}

interface TwinkleStar {
  xFrac: number;
  yFrac: number;
  size: number;
  phase: number;
  speed: number;
  tint: string;
}

export class GameRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private bgCanvas: HTMLCanvasElement;
  private bgCtx: CanvasRenderingContext2D;
  private dpr = 1;
  private twinkleStars: TwinkleStar[] = [];

  viewport: ViewportTransform = {
    offsetX: 0,
    offsetY: 0,
    scale: 1,
    cssWidth: WORLD_WIDTH,
    cssHeight: WORLD_HEIGHT,
  };

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('2D canvas context unavailable');
    this.ctx = ctx;

    this.bgCanvas = document.createElement('canvas');
    const bgCtx = this.bgCanvas.getContext('2d', { alpha: false });
    if (!bgCtx) throw new Error('Offscreen 2D context unavailable');
    this.bgCtx = bgCtx;

    this.initTwinkleStars();
    this.resize();
  }

  private initTwinkleStars(): void {
    const tints = ['#ffffff', '#9be7ff', '#d8b4fe', '#fde68a'];
    for (let i = 0; i < 36; i++) {
      this.twinkleStars.push({
        xFrac: ((i * 73 + 19) % 997) / 997,
        yFrac: ((i * 137 + 43) % 991) / 991,
        size: 1 + (i % 3) * 0.55,
        phase: i * 0.9,
        speed: 1.3 + (i % 5) * 0.45,
        tint: tints[i % tints.length],
      });
    }
  }

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const cssWidth = Math.max(320, rect.width || window.innerWidth);
    const cssHeight = Math.max(240, rect.height || window.innerHeight);
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);

    this.canvas.width = Math.round(cssWidth * this.dpr);
    this.canvas.height = Math.round(cssHeight * this.dpr);

    const scale = Math.min(cssWidth / WORLD_WIDTH, cssHeight / WORLD_HEIGHT);
    const offsetX = (cssWidth - WORLD_WIDTH * scale) * 0.5;
    const offsetY = (cssHeight - WORLD_HEIGHT * scale) * 0.5;

    this.viewport = { offsetX, offsetY, scale, cssWidth, cssHeight };
    this.rebuildBackgroundCache();
  }

  private rebuildBackgroundCache(): void {
    const { cssWidth, cssHeight } = this.viewport;
    this.bgCanvas.width = Math.round(cssWidth * this.dpr);
    this.bgCanvas.height = Math.round(cssHeight * this.dpr);

    const g = this.bgCtx;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    // Deep space cosmic gradient
    const bgGrad = g.createRadialGradient(
      cssWidth * 0.5,
      cssHeight * 0.45,
      20,
      cssWidth * 0.5,
      cssHeight * 0.5,
      Math.max(cssWidth, cssHeight) * 0.8,
    );
    bgGrad.addColorStop(0, '#0a142d');
    bgGrad.addColorStop(0.55, '#050a18');
    bgGrad.addColorStop(1, '#02040a');
    g.fillStyle = bgGrad;
    g.fillRect(0, 0, cssWidth, cssHeight);

    // Nebula glow clouds
    const nebulae = [
      { x: 0.22, y: 0.3, r: 0.36, color: 'rgba(0, 180, 255, 0.08)' },
      { x: 0.78, y: 0.65, r: 0.4, color: 'rgba(192, 52, 235, 0.07)' },
      { x: 0.54, y: 0.2, r: 0.3, color: 'rgba(255, 51, 102, 0.045)' },
    ];
    for (const neb of nebulae) {
      const cx = cssWidth * neb.x;
      const cy = cssHeight * neb.y;
      const rad = Math.max(cssWidth, cssHeight) * neb.r;
      const ng = g.createRadialGradient(cx, cy, 0, cx, cy, rad);
      ng.addColorStop(0, neb.color);
      ng.addColorStop(1, 'rgba(0, 0, 0, 0)');
      g.fillStyle = ng;
      g.fillRect(0, 0, cssWidth, cssHeight);
    }

    // Subtle world grid in arena space
    g.save();
    g.translate(this.viewport.offsetX, this.viewport.offsetY);
    g.scale(this.viewport.scale, this.viewport.scale);
    g.strokeStyle = 'rgba(0, 229, 255, 0.028)';
    g.lineWidth = 1;
    const step = 80;
    g.beginPath();
    for (let x = step; x < WORLD_WIDTH; x += step) {
      g.moveTo(x, 0);
      g.lineTo(x, WORLD_HEIGHT);
    }
    for (let y = step; y < WORLD_HEIGHT; y += step) {
      g.moveTo(0, y);
      g.lineTo(WORLD_WIDTH, y);
    }
    g.stroke();
    g.restore();

    // 220 crisp static stars
    for (let i = 0; i < 220; i++) {
      const sx = (((i * 193 + 53) % 1999) / 1999) * cssWidth;
      const sy = (((i * 311 + 89) % 1993) / 1993) * cssHeight;
      const r = 0.5 + (i % 4) * 0.38;
      const alpha = 0.18 + (i % 7) * 0.08;
      g.fillStyle = `rgba(220, 236, 255, ${alpha.toFixed(2)})`;
      g.beginPath();
      g.arc(sx, sy, r, 0, Math.PI * 2);
      g.fill();
    }
  }

  screenToWorld(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    return {
      x: (sx - this.viewport.offsetX) / this.viewport.scale,
      y: (sy - this.viewport.offsetY) / this.viewport.scale,
    };
  }

  render(sim: GameSimulation, overlay: InteractionOverlay, timeSec: number): void {
    const ctx = this.ctx;
    const { cssWidth, cssHeight, offsetX, offsetY, scale } = this.viewport;

    // Layer 1: Cached cosmic background + twinkling stars
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.bgCanvas, 0, 0);

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    for (const st of this.twinkleStars) {
      const alpha = 0.25 + 0.55 * (0.5 + 0.5 * Math.sin(timeSec * st.speed + st.phase));
      ctx.globalAlpha = alpha;
      ctx.fillStyle = st.tint;
      ctx.beginPath();
      ctx.arc(st.xFrac * cssWidth, st.yFrac * cssHeight, st.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Enter World Coordinate Space
    ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);

    // Layer 2: Rally route lines
    this.drawRallyLines(ctx, sim, overlay.showInteractiveGuides, timeSec);

    // Layer 3: Tactical targeting preview lines
    let targetingBadge: { x: number; y: number; total: number } | null = null;
    if (overlay.showInteractiveGuides) {
      targetingBadge = this.drawTargetingPreview(ctx, sim, overlay, timeSec);
    }

    // Layer 4: Capture shockwaves
    for (const wave of sim.shockwaves) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, wave.alpha);
      ctx.strokeStyle = wave.color;
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.arc(wave.x, wave.y, wave.radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Layer 5: Planets
    for (const p of sim.planets) {
      this.drawPlanet(ctx, sim, p, overlay, timeSec);
    }

    // Layer 6: Ships
    this.drawShips(ctx, sim, overlay);

    // Targeting count badge rendered above planets & ships
    if (targetingBadge) {
      this.drawTargetingBadge(
        ctx,
        targetingBadge.x,
        targetingBadge.y,
        targetingBadge.total,
        sim.getFactionColor(sim.localPlayerId),
        sim.getFactionCoreColor(sim.localPlayerId),
      );
    }

    // Layer 7: Particles (additive glow)
    if (sim.particles.length > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const pt of sim.particles) {
        const alpha = Math.max(0, pt.life / pt.maxLife);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = pt.color;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, pt.size * (0.6 + alpha * 0.5), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // Layer 8: Marquee selection box
    if (overlay.showInteractiveGuides && overlay.dragState === 'marquee' && overlay.dragActivated) {
      const x = Math.min(overlay.dragStartWorld.x, overlay.pointerWorld.x);
      const y = Math.min(overlay.dragStartWorld.y, overlay.pointerWorld.y);
      const w = Math.abs(overlay.pointerWorld.x - overlay.dragStartWorld.x);
      const h = Math.abs(overlay.pointerWorld.y - overlay.dragStartWorld.y);
      const localColor = sim.getFactionColor(sim.localPlayerId);

      ctx.save();
      ctx.fillStyle = withAlpha(localColor, 0.12);
      ctx.strokeStyle = withAlpha(localColor, 0.85);
      ctx.lineWidth = 1.5;
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x, y, w, h);
      ctx.restore();
    }

    ctx.restore();
  }

  private drawRallyLines(
    ctx: CanvasRenderingContext2D,
    sim: GameSimulation,
    showPlayerRallies: boolean,
    timeSec: number,
  ): void {
    if (!showPlayerRallies) return;
    const localId = sim.localPlayerId;
    const localColor = sim.getFactionColor(localId);

    ctx.save();
    ctx.lineDashOffset = -timeSec * 36;
    ctx.setLineDash([6, 8]);
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = withAlpha(localColor, 0.44);

    for (const p of sim.planets) {
      if (p.ownerId !== localId || p.rallyTargetId === null) continue;
      const target = sim.planetById.get(p.rallyTargetId);
      if (!target) continue;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(target.x, target.y);
      ctx.stroke();

      // Small arrow marker near target rim
      const angle = Math.atan2(target.y - p.y, target.x - p.x);
      const ax = target.x - Math.cos(angle) * (target.radius + 10);
      const ay = target.y - Math.sin(angle) * (target.radius + 10);
      ctx.fillStyle = withAlpha(localColor, 0.82);
      ctx.beginPath();
      ctx.arc(ax, ay, 3.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawTargetingPreview(
    ctx: CanvasRenderingContext2D,
    sim: GameSimulation,
    overlay: InteractionOverlay,
    timeSec: number,
  ): { x: number; y: number; total: number } | null {
    const localId = sim.localPlayerId;
    const localColor = sim.getFactionColor(localId);

    let sources: Planet[] = [];
    if (overlay.dragState === 'planetDrag' && overlay.dragActivated && overlay.dragSourcePlanetId !== null) {
      if (
        overlay.selectedPlanetIds.has(overlay.dragSourcePlanetId) &&
        overlay.selectedPlanetIds.size > 0
      ) {
        sources = sim.planets.filter((p) => overlay.selectedPlanetIds.has(p.id) && p.ownerId === localId);
      } else {
        const src = sim.planetById.get(overlay.dragSourcePlanetId);
        if (src && src.ownerId === localId) sources = [src];
      }
    } else if (overlay.hoveredPlanetId !== null && overlay.selectedPlanetIds.size > 0) {
      sources = sim.planets.filter(
        (p) => overlay.selectedPlanetIds.has(p.id) && p.ownerId === localId && p.id !== overlay.hoveredPlanetId,
      );
    }

    if (sources.length === 0) return null;

    const hoveredTarget =
      overlay.hoveredPlanetId !== null ? sim.planetById.get(overlay.hoveredPlanetId) ?? null : null;
    const destX = hoveredTarget ? hoveredTarget.x : overlay.pointerWorld.x;
    const destY = hoveredTarget ? hoveredTarget.y : overlay.pointerWorld.y;

    let estimatedTotal = 0;
    ctx.save();
    ctx.setLineDash([8, 6]);
    ctx.lineDashOffset = -timeSec * 52;
    ctx.lineWidth = 2;

    for (const src of sources) {
      if (hoveredTarget && hoveredTarget.id === src.id) continue;
      const sendCount =
        overlay.sendPercent >= 0.999 ? src.ships : Math.floor(src.ships * overlay.sendPercent);
      estimatedTotal += sendCount;

      ctx.strokeStyle = withAlpha(localColor, hoveredTarget ? 0.75 : 0.44);
      ctx.beginPath();
      ctx.moveTo(src.x, src.y);
      ctx.lineTo(destX, destY);
      ctx.stroke();
    }

    ctx.restore();

    if (estimatedTotal <= 0) return null;
    const offset = hoveredTarget ? hoveredTarget.radius + 10 : 16;
    return {
      x: destX + offset,
      y: destY - offset * 0.65,
      total: estimatedTotal,
    };
  }

  private drawTargetingBadge(
    ctx: CanvasRenderingContext2D,
    bx: number,
    by: number,
    estimatedTotal: number,
    borderColor: string,
    textColor: string,
  ): void {
    const label = `~${estimatedTotal}`;
    ctx.save();
    ctx.font = '700 12px Orbitron, Inter, sans-serif';
    const w = ctx.measureText(label).width + 14;
    ctx.fillStyle = 'rgba(5, 12, 28, 0.92)';
    ctx.strokeStyle = withAlpha(borderColor, 0.88);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.roundRect(bx, by - 11, w, 22, 6);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = textColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, bx + w / 2, by);
    ctx.restore();
  }

  private drawPlanet(
    ctx: CanvasRenderingContext2D,
    sim: GameSimulation,
    p: Planet,
    overlay: InteractionOverlay,
    timeSec: number,
  ): void {
    const color = sim.getFactionColor(p.ownerId);
    const coreColor = sim.getFactionCoreColor(p.ownerId);
    const isSelected = overlay.showInteractiveGuides && overlay.selectedPlanetIds.has(p.id);
    const isHovered = overlay.showInteractiveGuides && overlay.hoveredPlanetId === p.id;

    // Outer neon aura
    const auraRadius = p.radius * (1.75 + p.capturePulse * 0.5);
    const aura = ctx.createRadialGradient(p.x, p.y, p.radius * 0.45, p.x, p.y, auraRadius);
    aura.addColorStop(0, withAlpha(color, p.ownerId === NEUTRAL_ID ? 0.16 : 0.34 + p.hitFlash * 0.3));
    aura.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = aura;
    ctx.beginPath();
    ctx.arc(p.x, p.y, auraRadius, 0, Math.PI * 2);
    ctx.fill();

    // Planet sphere gradient
    const sphereGrad = ctx.createRadialGradient(
      p.x - p.radius * 0.32,
      p.y - p.radius * 0.32,
      p.radius * 0.1,
      p.x,
      p.y,
      p.radius,
    );
    sphereGrad.addColorStop(0, coreColor);
    sphereGrad.addColorStop(0.38, color);
    sphereGrad.addColorStop(1, '#091122');

    ctx.fillStyle = sphereGrad;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
    ctx.fill();

    // Surface craters for depth
    ctx.save();
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.radius - 1, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = 'rgba(2, 6, 16, 0.25)';
    for (const c of p.craters) {
      const cx = p.x + Math.cos(c.angle) * (p.radius * c.dist);
      const cy = p.y + Math.sin(c.angle) * (p.radius * c.dist);
      ctx.beginPath();
      ctx.arc(cx, cy, p.radius * c.r, 0, Math.PI * 2);
      ctx.fill();
    }
    if (p.hitFlash > 0) {
      ctx.fillStyle = `rgba(255, 255, 255, ${Math.min(0.55, p.hitFlash * 0.6)})`;
      ctx.fillRect(p.x - p.radius, p.y - p.radius, p.radius * 2, p.radius * 2);
    }
    ctx.restore();

    // Crisp planet rim
    ctx.strokeStyle = withAlpha(coreColor, p.ownerId === NEUTRAL_ID ? 0.55 : 0.9);
    ctx.lineWidth = p.ownerId === NEUTRAL_ID ? 1.3 : 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
    ctx.stroke();

    // Production progress ring around owned planets
    if (p.ownerId !== NEUTRAL_ID && p.prodProgress > 0.01) {
      ctx.save();
      ctx.strokeStyle = coreColor;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      const start = -Math.PI / 2;
      ctx.arc(p.x, p.y, p.radius + 4, start, start + Math.PI * 2 * p.prodProgress);
      ctx.stroke();
      ctx.restore();
    }

    // Selected planet rotating dashed ring
    if (isSelected) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(timeSec * 1.4);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2.2;
      ctx.setLineDash([7, 5]);
      ctx.beginPath();
      ctx.arc(0, 0, p.radius + 8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Hovered reticle
    if (isHovered) {
      const pulse = 1 + 0.08 * Math.sin(timeSec * 8);
      ctx.save();
      ctx.strokeStyle = p.ownerId === sim.localPlayerId ? sim.getFactionColor(sim.localPlayerId) : '#ffffff';
      ctx.lineWidth = 1.8;
      ctx.globalAlpha = 0.82;
      ctx.beginPath();
      ctx.arc(p.x, p.y, (p.radius + 11) * pulse, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Centered integer ship count
    const fontSize = Math.max(12, Math.min(18, Math.round(p.radius * 0.46)));
    ctx.font = `800 ${fontSize}px Orbitron, Inter, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const text = String(p.ships);
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = 'rgba(3, 7, 18, 0.88)';
    ctx.strokeText(text, p.x, p.y + 0.5);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, p.x, p.y + 0.5);
  }

  private drawShips(
    ctx: CanvasRenderingContext2D,
    sim: GameSimulation,
    overlay: InteractionOverlay,
  ): void {
    for (const ship of sim.ships) {
      const color = sim.getFactionColor(ship.ownerId);
      const coreColor = sim.getFactionCoreColor(ship.ownerId);
      const mag = Math.hypot(ship.vx, ship.vy) || 1;
      const dx = ship.vx / mag;
      const dy = ship.vy / mag;
      const px = -dy;
      const py = dx;

      const heavy = ship.count > 1;
      const len = heavy ? 8.2 : 5.8;
      const wing = heavy ? 4.4 : 3.2;

      // Plasma tail (zero-GC line behind ship)
      ctx.strokeStyle = withAlpha(color, 0.42);
      ctx.lineWidth = heavy ? 2.4 : 1.5;
      ctx.beginPath();
      ctx.moveTo(ship.x - dx * 2, ship.y - dy * 2);
      ctx.lineTo(ship.x - dx * (heavy ? 16 : 11), ship.y - dy * (heavy ? 16 : 11));
      ctx.stroke();

      // Arrowhead chevron
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(ship.x + dx * len, ship.y + dy * len);
      ctx.lineTo(ship.x - dx * (len * 0.65) + px * wing, ship.y - dy * (len * 0.65) + py * wing);
      ctx.lineTo(ship.x - dx * (len * 0.3), ship.y - dy * (len * 0.3));
      ctx.lineTo(ship.x - dx * (len * 0.65) - px * wing, ship.y - dy * (len * 0.65) - py * wing);
      ctx.closePath();
      ctx.fill();

      if (heavy) {
        ctx.fillStyle = coreColor;
        ctx.beginPath();
        ctx.arc(ship.x, ship.y, 1.8, 0, Math.PI * 2);
        ctx.fill();
      }

      if (overlay.showInteractiveGuides && overlay.selectedShipIds.has(ship.id)) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        ctx.arc(ship.x, ship.y, 8, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }
}

function withAlpha(hex: string, alpha: number): string {
  if (!hex.startsWith('#') || (hex.length !== 7 && hex.length !== 4)) {
    return hex;
  }
  let r: number;
  let g: number;
  let b: number;
  if (hex.length === 4) {
    r = parseInt(hex[1] + hex[1], 16);
    g = parseInt(hex[2] + hex[2], 16);
    b = parseInt(hex[3] + hex[3], 16);
  } else {
    r = parseInt(hex.slice(1, 3), 16);
    g = parseInt(hex.slice(3, 5), 16);
    b = parseInt(hex.slice(5, 7), 16);
  }
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha)).toFixed(2)})`;
}

export function renderMiniMapPreview(canvas: HTMLCanvasElement, planets: Planet[]): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const bg = ctx.createRadialGradient(w * 0.5, h * 0.5, 10, w * 0.5, h * 0.5, w * 0.7);
  bg.addColorStop(0, '#0c1836');
  bg.addColorStop(1, '#040814');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  // Subtle border grid
  ctx.strokeStyle = 'rgba(0, 229, 255, 0.08)';
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, w - 1, h - 1);

  const scale = Math.min(w / WORLD_WIDTH, h / WORLD_HEIGHT);
  const ox = (w - WORLD_WIDTH * scale) * 0.5;
  const oy = (h - WORLD_HEIGHT * scale) * 0.5;

  for (const p of planets) {
    const pal = FACTION_PALETTE[p.ownerId] ?? FACTION_PALETTE[0];
    const px = ox + p.x * scale;
    const py = oy + p.y * scale;
    const pr = Math.max(2.5, p.radius * scale);

    if (p.ownerId !== 0) {
      const glow = ctx.createRadialGradient(px, py, 0, px, py, pr * 2.4);
      glow.addColorStop(0, withAlpha(pal.color, 0.45));
      glow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(px, py, pr * 2.4, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = pal.color;
    ctx.beginPath();
    ctx.arc(px, py, pr, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = pal.coreColor;
    ctx.lineWidth = p.ownerId !== 0 ? 1.4 : 0.7;
    ctx.stroke();
  }
}
