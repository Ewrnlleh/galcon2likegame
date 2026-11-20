import { NEUTRAL_ID, PLAYER_ID } from '../game/constants';
import type { GameSimulation } from '../game/simulation';
import { formatTime, svgIcon } from './icons';

export interface HudCallbacks {
  onTogglePause: () => void;
  onCycleSpeed: () => void;
  onToggleMute: () => void;
  onOpenHelp: () => void;
  onExitToMenu: () => void;
  onRestart: () => void;
  onSelectPercent: (pct: number) => void;
  onSelectAll: () => void;
}

export class HudController {
  private root: HTMLElement;
  private callbacks: HudCallbacks;

  private matchLabel = 'Hızlı Savaş';
  private visible = false;
  private muted = false;
  private lastHudUpdate = 0;

  private topBarEl!: HTMLElement;
  private bottomDockEl!: HTMLElement;
  private toastContainerEl!: HTMLElement;
  private pauseOverlayEl!: HTMLElement;

  private titleEl!: HTMLElement;
  private pauseBtnEl!: HTMLButtonElement;
  private speedBtnEl!: HTMLButtonElement;
  private muteBtnEl!: HTMLButtonElement;
  private powerBarEl!: HTMLElement;
  private powerLegendEl!: HTMLElement;
  private timerEl!: HTMLElement;
  private playerPlanetsEl!: HTMLElement;
  private playerShipsEl!: HTMLElement;
  private playerProdEl!: HTMLElement;
  private percentReadoutEl!: HTMLElement;
  private percentSliderEl!: HTMLInputElement;
  private presetBtns: HTMLButtonElement[] = [];
  private spectateBannerEl!: HTMLElement;

  constructor(root: HTMLElement, callbacks: HudCallbacks, muted: boolean) {
    this.root = root;
    this.callbacks = callbacks;
    this.muted = muted;
    this.buildDom();
  }

  private buildDom(): void {
    this.root.innerHTML = `
      <div class="hud-layer hidden" id="hud-container">
        <header class="hud-top">
          <div class="hud-top-left">
            <span class="hud-badge" id="hud-match-title">Hızlı Savaş</span>
            <div class="hud-btn-group">
              <button class="hud-icon-btn" id="hud-pause-btn" title="Duraklat (Boşluk)">${svgIcon('pause', 16)}</button>
              <button class="hud-icon-btn hud-speed-btn" id="hud-speed-btn" title="Oyun Hızı (F)">1x</button>
              <button class="hud-icon-btn" id="hud-mute-btn" title="Ses (M)">${svgIcon(this.muted ? 'volumeOff' : 'volumeOn', 16)}</button>
              <button class="hud-icon-btn" id="hud-help-btn" title="Nasıl Oynanır?">${svgIcon('help', 16)}</button>
              <button class="hud-icon-btn" id="hud-exit-btn" title="Ana Menü">${svgIcon('home', 16)}</button>
            </div>
          </div>

          <div class="hud-power-wrap">
            <div class="hud-power-bar" id="hud-power-bar"></div>
            <div class="hud-power-legend" id="hud-power-legend"></div>
          </div>

          <div class="hud-top-right">
            <div class="hud-stat-pill">
              <span class="pill-label">Süre</span>
              <span class="pill-val" id="hud-timer">00:00</span>
            </div>
            <div class="hud-stat-pill cyan">
              <span class="pill-label">Gezegen</span>
              <span class="pill-val" id="hud-planets">0</span>
            </div>
            <div class="hud-stat-pill cyan">
              <span class="pill-label">Gemi</span>
              <span class="pill-val" id="hud-ships">0</span>
            </div>
            <div class="hud-stat-pill cyan">
              <span class="pill-label">Üretim</span>
              <span class="pill-val" id="hud-prod">+0.0/sn</span>
            </div>
          </div>
        </header>

        <div class="spectate-banner hidden" id="spectate-banner">
          <span>İzleme Modu — Yapay zekaların kapışmasını izliyorsun</span>
          <button class="btn btn-sm btn-ghost" id="spectate-exit-btn">Ana Menüye Dön</button>
        </div>

        <div class="toast-container" id="hud-toasts"></div>

        <footer class="hud-bottom" id="hud-bottom">
          <div class="dock-presets">
            <button class="pct-btn" data-pct="0.25">25%</button>
            <button class="pct-btn active" data-pct="0.5">50%</button>
            <button class="pct-btn" data-pct="0.75">75%</button>
            <button class="pct-btn" data-pct="1">100%</button>
          </div>
          <div class="dock-slider-wrap">
            <input type="range" id="hud-pct-slider" min="10" max="100" step="5" value="50" aria-label="Gönderilecek filo yüzdesi" />
            <span class="pct-readout" id="hud-pct-readout">%50</span>
          </div>
          <button class="btn btn-sm btn-cyan" id="hud-select-all">Tümünü Seç (A)</button>
          <span class="dock-hint">Sürükle: Saldır • Çift Tık: Tümü • Sağ Tık: Takviye • Shift+Sağ Tık: Ralli</span>
        </footer>

        <div class="pause-overlay hidden" id="pause-overlay">
          <div class="glass-card pause-card">
            <h2>OYUN DURAKLATILDI</h2>
            <p class="muted-text">Filo emirleri beklemede.</p>
            <div class="pause-actions">
              <button class="btn btn-cyan" id="pause-resume-btn">${svgIcon('play', 16)} Devam Et</button>
              <button class="btn btn-ghost" id="pause-restart-btn">${svgIcon('rotateCcw', 16)} Yeniden Başlat</button>
              <button class="btn btn-ghost" id="pause-help-btn">${svgIcon('help', 16)} Nasıl Oynanır?</button>
              <button class="btn btn-danger" id="pause-menu-btn">${svgIcon('home', 16)} Ana Menü</button>
            </div>
          </div>
        </div>
      </div>
    `;

    this.topBarEl = this.root.querySelector('#hud-container')!;
    this.bottomDockEl = this.root.querySelector('#hud-bottom')!;
    this.toastContainerEl = this.root.querySelector('#hud-toasts')!;
    this.pauseOverlayEl = this.root.querySelector('#pause-overlay')!;
    this.spectateBannerEl = this.root.querySelector('#spectate-banner')!;

    this.titleEl = this.root.querySelector('#hud-match-title')!;
    this.pauseBtnEl = this.root.querySelector('#hud-pause-btn')!;
    this.speedBtnEl = this.root.querySelector('#hud-speed-btn')!;
    this.muteBtnEl = this.root.querySelector('#hud-mute-btn')!;
    this.powerBarEl = this.root.querySelector('#hud-power-bar')!;
    this.powerLegendEl = this.root.querySelector('#hud-power-legend')!;
    this.timerEl = this.root.querySelector('#hud-timer')!;
    this.playerPlanetsEl = this.root.querySelector('#hud-planets')!;
    this.playerShipsEl = this.root.querySelector('#hud-ships')!;
    this.playerProdEl = this.root.querySelector('#hud-prod')!;
    this.percentReadoutEl = this.root.querySelector('#hud-pct-readout')!;
    this.percentSliderEl = this.root.querySelector('#hud-pct-slider')!;
    this.presetBtns = [...this.root.querySelectorAll<HTMLButtonElement>('.pct-btn')];

    this.pauseBtnEl.addEventListener('click', () => this.callbacks.onTogglePause());
    this.speedBtnEl.addEventListener('click', () => this.callbacks.onCycleSpeed());
    this.muteBtnEl.addEventListener('click', () => this.callbacks.onToggleMute());
    this.root.querySelector('#hud-help-btn')!.addEventListener('click', () => this.callbacks.onOpenHelp());
    this.root.querySelector('#hud-exit-btn')!.addEventListener('click', () => this.callbacks.onExitToMenu());
    this.root.querySelector('#spectate-exit-btn')!.addEventListener('click', () => this.callbacks.onExitToMenu());

    this.root.querySelector('#hud-select-all')!.addEventListener('click', () => this.callbacks.onSelectAll());
    this.percentSliderEl.addEventListener('input', () => {
      const val = Number(this.percentSliderEl.value) / 100;
      this.callbacks.onSelectPercent(val);
    });
    for (const btn of this.presetBtns) {
      btn.addEventListener('click', () => {
        const val = Number(btn.dataset.pct);
        this.callbacks.onSelectPercent(val);
      });
    }

    this.root.querySelector('#pause-resume-btn')!.addEventListener('click', () => this.callbacks.onTogglePause());
    this.root.querySelector('#pause-restart-btn')!.addEventListener('click', () => this.callbacks.onRestart());
    this.root.querySelector('#pause-help-btn')!.addEventListener('click', () => this.callbacks.onOpenHelp());
    this.root.querySelector('#pause-menu-btn')!.addEventListener('click', () => this.callbacks.onExitToMenu());
  }

  setVisible(visible: boolean, matchTitle?: string): void {
    this.visible = visible;
    this.topBarEl.classList.toggle('hidden', !visible);
    if (matchTitle) {
      this.matchLabel = matchTitle;
      this.titleEl.textContent = this.matchLabel;
    }
    if (!visible) {
      this.pauseOverlayEl.classList.add('hidden');
      this.spectateBannerEl.classList.add('hidden');
      this.toastContainerEl.innerHTML = '';
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.muteBtnEl.innerHTML = svgIcon(muted ? 'volumeOff' : 'volumeOn', 16);
  }

  setPercent(pct: number): void {
    const whole = Math.round(pct * 100);
    this.percentReadoutEl.textContent = `%${whole}`;
    this.percentSliderEl.value = String(whole);
    for (const btn of this.presetBtns) {
      const val = Number(btn.dataset.pct);
      btn.classList.toggle('active', Math.abs(val - pct) < 0.02);
    }
  }

  setPaused(paused: boolean, showOverlay: boolean): void {
    this.pauseBtnEl.innerHTML = svgIcon(paused ? 'play' : 'pause', 16);
    this.pauseOverlayEl.classList.toggle('hidden', !(paused && showOverlay && this.visible));
  }

  setSpeed(speed: 1 | 1.5 | 2): void {
    this.speedBtnEl.textContent = `${speed}x`;
  }

  setSpectating(spectating: boolean): void {
    this.spectateBannerEl.classList.toggle('hidden', !spectating);
    this.bottomDockEl.classList.toggle('hidden', spectating);
  }

  showToast(message: string, accentColor = '#00e5ff', durationMs = 3600): void {
    if (!this.visible) return;
    const toast = document.createElement('div');
    toast.className = 'hud-toast';
    toast.style.borderLeftColor = accentColor;
    toast.textContent = message;
    this.toastContainerEl.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add('show'));
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, durationMs);
  }

  update(sim: GameSimulation, nowMs: number): void {
    if (!this.visible) return;
    if (nowMs - this.lastHudUpdate < 110) return;
    this.lastHudUpdate = nowMs;

    this.timerEl.textContent = formatTime(sim.elapsed);

    const playerSummary = sim.getFactionSummary(PLAYER_ID);
    this.playerPlanetsEl.textContent = String(playerSummary.planets);
    this.playerShipsEl.textContent = String(playerSummary.ships);
    this.playerProdEl.textContent = `+${playerSummary.production.toFixed(1)}/sn`;

    // Build live galactic dominance power bar
    let totalPower = 0;
    const factionPowers: Array<{ id: number; name: string; color: string; ships: number }> = [];
    for (const f of sim.factions) {
      if (f.id === NEUTRAL_ID) continue;
      const sum = sim.getFactionSummary(f.id);
      if (sum.ships > 0 || !f.eliminated) {
        factionPowers.push({ id: f.id, name: f.name, color: f.color, ships: sum.ships });
        totalPower += sum.ships;
      }
    }

    const denom = Math.max(1, totalPower);
    this.powerBarEl.innerHTML = factionPowers
      .map((fp) => {
        const pct = (fp.ships / denom) * 100;
        return `<div class="power-seg" style="width:${pct.toFixed(2)}%;background:${fp.color};" title="${fp.name}: ${fp.ships}"></div>`;
      })
      .join('');

    this.powerLegendEl.innerHTML = factionPowers
      .map((fp) => {
        const shortName = fp.id === PLAYER_ID ? 'Sen' : fp.name.split(' ')[0];
        return `<span class="legend-chip"><i style="background:${fp.color}"></i>${shortName} <b>${fp.ships}</b></span>`;
      })
      .join('');
  }
}
