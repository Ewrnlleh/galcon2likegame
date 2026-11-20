import {
  CAMPAIGN_SECTORS,
  isSectorUnlocked,
  loadCampaignProgress,
  saveCampaignProgress,
} from '../game/campaign';
import {
  DIFFICULTY_LABELS,
  MAP_TYPE_LABELS,
  NEUTRAL_ID,
  PLAYER_ID,
  RULE_LABELS,
} from '../game/constants';
import { generateMiniMapPreview } from '../game/maps';
import { renderMiniMapPreview } from '../game/renderer';
import type { GameSimulation } from '../game/simulation';
import type {
  Difficulty,
  GameRule,
  MapType,
  MatchConfig,
  MatchStatus,
} from '../game/types';
import { formatTime, svgIcon } from './icons';

export type MenuScreen = 'none' | 'main' | 'campaign' | 'skirmish' | 'help' | 'results';

export interface MenuCallbacks {
  onStartMatch: (config: MatchConfig, title: string, tip?: string) => void;
  onReturnToMain: () => void;
  onRestartMatch: () => void;
  onSpectateMatch: () => void;
  onCloseHelp: () => void;
}

export class MenuController {
  private root: HTMLElement;
  private callbacks: MenuCallbacks;

  private activeScreen: MenuScreen = 'main';
  private helpReturnTo: MenuScreen = 'main';

  private skirmishConfig: MatchConfig = {
    mode: 'skirmish',
    mapType: 'classic',
    planetCount: 26,
    opponents: 1,
    difficulty: 'normal',
    rule: 'standard',
    seed: Math.floor(Math.random() * 900000) + 10000,
  };

  constructor(root: HTMLElement, callbacks: MenuCallbacks) {
    this.root = root;
    this.callbacks = callbacks;
    this.showMain();
  }

  getScreen(): MenuScreen {
    return this.activeScreen;
  }

  isBlockingGameplay(): boolean {
    return this.activeScreen !== 'none';
  }

  hide(): void {
    this.activeScreen = 'none';
    this.root.innerHTML = '';
  }

  showMain(): void {
    this.activeScreen = 'main';
    this.root.innerHTML = `
      <div class="menu-backdrop main-menu-backdrop">
        <div class="main-menu-panel glass-card">
          <div class="brand-emblem">
            <span class="brand-badge">GALAKTİK FİLO STRATEJİSİ</span>
            <h1 class="brand-title">GALCON <span class="neon-cyan">NOVA</span></h1>
            <p class="brand-subtitle">Gezegenleri ele geçir, devasa filolar üret ve galaksiyi fethet.</p>
          </div>

          <div class="main-actions">
            <button class="btn btn-primary btn-lg" id="btn-quick-play">
              ${svgIcon('rocket', 20)}
              <span>Hızlı Savaş (1v1)</span>
            </button>
            <button class="btn btn-cyan btn-lg" id="btn-campaign">
              ${svgIcon('trophy', 20)}
              <span>Galaktik Sefer (10 Sektör)</span>
            </button>
            <button class="btn btn-ghost btn-lg" id="btn-skirmish">
              ${svgIcon('sliders', 20)}
              <span>Özel Skirmish</span>
            </button>
            <button class="btn btn-ghost" id="btn-how-to-play">
              ${svgIcon('help', 18)}
              <span>Nasıl Oynanır?</span>
            </button>
          </div>

          <div class="menu-footer-hint">
            <span>Arka planda canlı yapay zeka savaşı oynanıyor</span>
          </div>
        </div>
      </div>
    `;

    this.root.querySelector('#btn-quick-play')!.addEventListener('click', () => {
      const cfg: MatchConfig = {
        mode: 'skirmish',
        mapType: 'classic',
        planetCount: 24,
        opponents: 1,
        difficulty: 'normal',
        rule: 'standard',
        seed: Math.floor(Math.random() * 900000) + 10000,
      };
      this.callbacks.onStartMatch(cfg, 'Hızlı Savaş (1v1)');
    });

    this.root.querySelector('#btn-campaign')!.addEventListener('click', () => this.showCampaign());
    this.root.querySelector('#btn-skirmish')!.addEventListener('click', () => this.showSkirmish());
    this.root
      .querySelector('#btn-how-to-play')!
      .addEventListener('click', () => this.showHelp('main'));
  }

  showCampaign(): void {
    this.activeScreen = 'campaign';
    const progress = loadCampaignProgress();

    const cardsHtml = CAMPAIGN_SECTORS.map((sec) => {
      const unlocked = isSectorUnlocked(sec.id, progress);
      const secProg = progress.sectors[sec.id];
      const stars = secProg?.stars ?? 0;
      const diff = DIFFICULTY_LABELS[sec.difficulty];
      const mapInfo = MAP_TYPE_LABELS[sec.mapType];
      const starsHtml = [1, 2, 3]
        .map((n) => (n <= stars ? svgIcon('starFilled', 15) : svgIcon('starEmpty', 15)))
        .join('');

      return `
        <article class="sector-card ${unlocked ? 'unlocked' : 'locked'} ${secProg?.completed ? 'completed' : ''}" data-sector="${sec.id}">
          <div class="sector-top">
            <span class="sector-num">SEKTÖR ${sec.id}</span>
            <span class="diff-pill" style="color:${diff.color};border-color:${diff.color}44">${diff.name}</span>
          </div>
          <h3>${sec.name}</h3>
          <div class="sector-sub">${sec.subtitle} • ${sec.opponents + 1} Güç • ${mapInfo.name}</div>
          <p class="sector-desc">${sec.description}</p>
          <div class="sector-bottom">
            <div class="stars-row">${starsHtml}</div>
            ${
              unlocked
                ? `<button class="btn btn-sm btn-cyan sector-play-btn" data-sector="${sec.id}">${svgIcon('play', 14)} Başlat</button>`
                : `<span class="locked-label">${svgIcon('lock', 14)} Kilitli</span>`
            }
          </div>
          ${
            secProg?.bestTime != null
              ? `<div class="sector-best">En İyi: ${formatTime(secProg.bestTime)}</div>`
              : ''
          }
        </article>
      `;
    }).join('');

    this.root.innerHTML = `
      <div class="menu-backdrop">
        <div class="modal-panel glass-card wide-panel">
          <div class="modal-header">
            <div>
              <h2>GALAKTİK SEFER</h2>
              <p class="muted-text">10 stratejik sektörü fethederek galaksi imparatorluğunu kur.</p>
            </div>
            <div class="modal-header-actions">
              <button class="btn btn-sm btn-ghost" id="btn-toggle-unlock-all">
                ${svgIcon(progress.unlockAll ? 'unlock' : 'lock', 15)}
                <span>${progress.unlockAll ? 'Kilitlemeyi Açık Tut: Açık' : 'Tümünü Aç'}</span>
              </button>
              <button class="btn btn-sm btn-ghost" id="btn-camp-back">Ana Menü</button>
            </div>
          </div>

          <div class="campaign-grid">
            ${cardsHtml}
          </div>
        </div>
      </div>
    `;

    this.root.querySelector('#btn-camp-back')!.addEventListener('click', () => this.showMain());
    this.root.querySelector('#btn-toggle-unlock-all')!.addEventListener('click', () => {
      const next = loadCampaignProgress();
      next.unlockAll = !next.unlockAll;
      saveCampaignProgress(next);
      this.showCampaign();
    });

    for (const btn of this.root.querySelectorAll<HTMLButtonElement>('.sector-play-btn')) {
      btn.addEventListener('click', () => {
        const id = Number(btn.dataset.sector);
        const sec = CAMPAIGN_SECTORS.find((s) => s.id === id);
        if (!sec) return;
        const cfg: MatchConfig = {
          mode: 'campaign',
          sectorId: sec.id,
          mapType: sec.mapType,
          planetCount: sec.planetCount,
          opponents: sec.opponents,
          difficulty: sec.difficulty,
          rule: sec.rule,
          seed: sec.seed,
          asymmetricStart: sec.asymmetricStart,
        };
        this.callbacks.onStartMatch(cfg, `Sektör ${sec.id}: ${sec.name}`, sec.tip);
      });
    }
  }

  showSkirmish(): void {
    this.activeScreen = 'skirmish';

    const mapBtns = (Object.keys(MAP_TYPE_LABELS) as MapType[])
      .map(
        (key) => `
        <button class="choice-pill ${this.skirmishConfig.mapType === key ? 'active' : ''}" data-map="${key}">
          ${MAP_TYPE_LABELS[key].name}
        </button>
      `,
      )
      .join('');

    const oppBtns = [1, 2, 3, 4, 5]
      .map(
        (n) => `
        <button class="choice-pill ${this.skirmishConfig.opponents === n ? 'active' : ''}" data-opp="${n}">
          1v${n} (${n + 1} Güç)
        </button>
      `,
      )
      .join('');

    const diffBtns = (Object.keys(DIFFICULTY_LABELS) as Difficulty[])
      .map(
        (d) => `
        <button class="choice-pill ${this.skirmishConfig.difficulty === d ? 'active' : ''}" data-diff="${d}">
          ${DIFFICULTY_LABELS[d].name}
        </button>
      `,
      )
      .join('');

    const sizeOptions = [
      { label: 'Küçük (16)', count: 16 },
      { label: 'Orta (26)', count: 26 },
      { label: 'Büyük (38)', count: 38 },
      { label: 'Dev (50)', count: 50 },
    ]
      .map(
        (s) => `
        <button class="choice-pill ${this.skirmishConfig.planetCount === s.count ? 'active' : ''}" data-size="${s.count}">
          ${s.label}
        </button>
      `,
      )
      .join('');

    const ruleBtns = (Object.keys(RULE_LABELS) as GameRule[])
      .map(
        (r) => `
        <button class="choice-pill ${this.skirmishConfig.rule === r ? 'active' : ''}" data-rule="${r}" title="${RULE_LABELS[r].desc}">
          ${RULE_LABELS[r].name}
        </button>
      `,
      )
      .join('');

    this.root.innerHTML = `
      <div class="menu-backdrop">
        <div class="modal-panel glass-card wide-panel">
          <div class="modal-header">
            <div>
              <h2>ÖZEL SKİRMİSH</h2>
              <p class="muted-text">Galaksi düzenini, yapay zeka sayısını ve savaş kurallarını özelleştir.</p>
            </div>
            <button class="btn btn-sm btn-ghost" id="btn-skirmish-back">Ana Menü</button>
          </div>

          <div class="skirmish-layout">
            <div class="skirmish-controls">
              <div class="cfg-group">
                <label>Harita Türü</label>
                <div class="choice-row">${mapBtns}</div>
                <span class="cfg-subdesc" id="sk-map-desc">${MAP_TYPE_LABELS[this.skirmishConfig.mapType].desc}</span>
              </div>

              <div class="cfg-group">
                <label>Rakip Sayısı</label>
                <div class="choice-row">${oppBtns}</div>
              </div>

              <div class="cfg-group">
                <label>Yapay Zeka Zorluğu</label>
                <div class="choice-row">${diffBtns}</div>
              </div>

              <div class="cfg-group">
                <label>Galaksi Boyutu</label>
                <div class="choice-row">${sizeOptions}</div>
              </div>

              <div class="cfg-group">
                <label>Oyun Kuralı</label>
                <div class="choice-row">${ruleBtns}</div>
                <span class="cfg-subdesc" id="sk-rule-desc">${RULE_LABELS[this.skirmishConfig.rule].desc}</span>
              </div>
            </div>

            <div class="skirmish-preview-col">
              <div class="preview-box">
                <div class="preview-top">
                  <span>CANLI HARİTA ÖNİZLEMESİ</span>
                  <button class="btn btn-sm btn-ghost" id="btn-new-seed">
                    ${svgIcon('shuffle', 14)} Yeni Tohum
                  </button>
                </div>
                <canvas id="skirmish-minimap" width="420" height="236"></canvas>
                <div class="preview-meta">Tohum: #${this.skirmishConfig.seed}</div>
              </div>

              <button class="btn btn-primary btn-lg start-skirmish-btn" id="btn-start-skirmish">
                ${svgIcon('rocket', 20)} Savaşı Başlat
              </button>
            </div>
          </div>
        </div>
      </div>
    `;

    const refreshPreview = () => {
      const canvas = this.root.querySelector<HTMLCanvasElement>('#skirmish-minimap');
      if (!canvas) return;
      const previewPlanets = generateMiniMapPreview(
        this.skirmishConfig.mapType,
        this.skirmishConfig.opponents,
        this.skirmishConfig.planetCount,
        this.skirmishConfig.seed,
        this.skirmishConfig.rule,
      );
      renderMiniMapPreview(canvas, previewPlanets);
      const meta = this.root.querySelector('.preview-meta');
      if (meta) meta.textContent = `Tohum: #${this.skirmishConfig.seed} • ${previewPlanets.length} Gezegen`;
    };

    refreshPreview();

    this.root.querySelector('#btn-skirmish-back')!.addEventListener('click', () => this.showMain());
    this.root.querySelector('#btn-new-seed')!.addEventListener('click', () => {
      this.skirmishConfig.seed = Math.floor(Math.random() * 900000) + 10000;
      refreshPreview();
    });

    const bindGroup = (selector: string, attr: string, onPick: (val: string) => void) => {
      const buttons = this.root.querySelectorAll<HTMLButtonElement>(selector);
      for (const btn of buttons) {
        btn.addEventListener('click', () => {
          for (const b of buttons) b.classList.remove('active');
          btn.classList.add('active');
          onPick(btn.getAttribute(attr)!);
          refreshPreview();
        });
      }
    };

    bindGroup('[data-map]', 'data-map', (val) => {
      this.skirmishConfig.mapType = val as MapType;
      const desc = this.root.querySelector('#sk-map-desc');
      if (desc) desc.textContent = MAP_TYPE_LABELS[this.skirmishConfig.mapType].desc;
    });
    bindGroup('[data-opp]', 'data-opp', (val) => {
      this.skirmishConfig.opponents = Number(val);
    });
    bindGroup('[data-diff]', 'data-diff', (val) => {
      this.skirmishConfig.difficulty = val as Difficulty;
    });
    bindGroup('[data-size]', 'data-size', (val) => {
      this.skirmishConfig.planetCount = Number(val);
    });
    bindGroup('[data-rule]', 'data-rule', (val) => {
      this.skirmishConfig.rule = val as GameRule;
      const desc = this.root.querySelector('#sk-rule-desc');
      if (desc) desc.textContent = RULE_LABELS[this.skirmishConfig.rule].desc;
    });

    this.root.querySelector('#btn-start-skirmish')!.addEventListener('click', () => {
      const cfg = { ...this.skirmishConfig };
      const title = `Skirmish 1v${cfg.opponents} • ${MAP_TYPE_LABELS[cfg.mapType].name}`;
      this.callbacks.onStartMatch(cfg, title);
    });
  }

  showHelp(returnTo: MenuScreen): void {
    this.helpReturnTo = returnTo;
    this.activeScreen = 'help';

    this.root.innerHTML = `
      <div class="menu-backdrop">
        <div class="modal-panel glass-card help-panel">
          <div class="modal-header">
            <div>
              <h2>NASIL OYNANIR?</h2>
              <p class="muted-text">Galcon Nova filo yönetimi ve hızlı fetih rehberi</p>
            </div>
            <button class="hud-icon-btn" id="btn-help-close">${svgIcon('x', 18)}</button>
          </div>

          <div class="help-grid">
            <div class="help-section">
              <h3>Kontroller</h3>
              <ul class="help-list">
                <li><strong>Sürükle ve Bırak:</strong> Kendi gezegeninden hedef gezegene sürükleyerek filo gönder.</li>
                <li><strong>Kutu Seçimi:</strong> Boşlukta basılı tutup sürükleyerek birden fazla gezegeni seç.</li>
                <li><strong>Çift Tıklama / A Tuşu:</strong> Tüm gezegenlerini tek seferde seç.</li>
                <li><strong>Fare Tekerleği / 1-4 / Q-E:</strong> Gönderilecek filo yüzdesini (%10 – %100) ayarla.</li>
                <li><strong>Sağ Tık:</strong> Seçili filoları hedefe (kendi gezegenin dahil) anında gönder.</li>
                <li><strong>Shift + Sağ Tık:</strong> Seçili gezegenlerden hedefe otomatik <em>Ralli Noktası</em> kur (<strong>R</strong> ile temizle).</li>
                <li><strong>Havada Yönlendirme:</strong> Boşlukta kutu çizerek uçan filolarını yakala ve yeni hedefe tıkla!</li>
              </ul>
            </div>

            <div class="help-section">
              <h3>Temel Kurallar</h3>
              <ul class="help-list">
                <li><strong>Gezegen Boyutu:</strong> Büyük gezegenler saniyede daha fazla gemi üretir.</li>
                <li><strong>Tarafsız Gezegenler:</strong> Gri gezegenler ele geçirilene kadar gemi üretmez; doğru zamanda fethet!</li>
                <li><strong>Tam Sayı Çatışma:</strong> Her gemi 1 savunucuyu imha eder; kalan gemilerle gezegeni ele geçirirsin.</li>
                <li><strong>Kısayollar:</strong> <code>Boşluk</code> Duraklat • <code>F</code> Hız (1x/1.5x/2x) • <code>M</code> Ses.</li>
              </ul>
            </div>
          </div>

          <div class="help-footer">
            <button class="btn btn-cyan" id="btn-help-ok">Anladım</button>
          </div>
        </div>
      </div>
    `;

    const close = () => {
      if (this.helpReturnTo === 'main') {
        this.showMain();
      } else {
        this.hide();
        this.callbacks.onCloseHelp();
      }
    };

    this.root.querySelector('#btn-help-close')!.addEventListener('click', close);
    this.root.querySelector('#btn-help-ok')!.addEventListener('click', close);
  }

  showResults(
    sim: GameSimulation,
    status: MatchStatus,
    earnedStars: number | null,
    hasNextSector: boolean,
    onNextSector?: () => void,
  ): void {
    this.activeScreen = 'results';
    const isVictory = status === 'victory';

    const starsBlock =
      sim.config.mode === 'campaign' && isVictory && earnedStars !== null
        ? `
          <div class="results-stars">
            ${[1, 2, 3]
              .map((n) =>
                n <= earnedStars ? svgIcon('starFilled', 30) : svgIcon('starEmpty', 30),
              )
              .join('')}
          </div>
        `
        : '';

    const canSpectate =
      !isVictory &&
      sim.factions.filter((f) => f.id !== NEUTRAL_ID && f.id !== PLAYER_ID && !f.eliminated)
        .length > 1;

    this.root.innerHTML = `
      <div class="menu-backdrop">
        <div class="modal-panel glass-card results-panel">
          <div class="results-hero ${isVictory ? 'win' : 'loss'}">
            <span class="results-tag">${sim.config.mode === 'campaign' ? `SEKTÖR ${sim.config.sectorId}` : 'SKİRMİSH SONUCU'}</span>
            <h2>${isVictory ? 'GALAKTİK ZAFER!' : 'FİLO İMHA EDİLDİ'}</h2>
            ${starsBlock}
          </div>

          <div class="results-stats-grid">
            <div class="stat-box">
              <span>Süre</span>
              <strong>${formatTime(sim.stats.elapsed)}</strong>
            </div>
            <div class="stat-box">
              <span>Fethedilen Gezegen</span>
              <strong>${sim.stats.planetsCaptured}</strong>
            </div>
            <div class="stat-box">
              <span>Gönderilen Gemi</span>
              <strong>${sim.stats.shipsSent}</strong>
            </div>
            <div class="stat-box">
              <span>İmha Edilen</span>
              <strong>${sim.stats.shipsDestroyed}</strong>
            </div>
            <div class="stat-box">
              <span>Zirve Filo</span>
              <strong>${sim.stats.peakShips}</strong>
            </div>
          </div>

          <div class="power-chart-card">
            <div class="power-chart-header">
              <span>GÜÇ GRAFİĞİ (ZAMANA GÖRE TOPLAM GEMİ)</span>
              <div class="chart-legend">
                ${sim.factions
                  .filter((f) => f.id !== NEUTRAL_ID)
                  .map(
                    (f) =>
                      `<span class="legend-chip"><i style="background:${f.color}"></i>${f.name}</span>`,
                  )
                  .join('')}
              </div>
            </div>
            ${buildPowerChartSvg(sim)}
          </div>

          <div class="results-actions">
            ${
              isVictory && hasNextSector
                ? `<button class="btn btn-primary" id="res-next-sector">${svgIcon('play', 16)} Sonraki Sektör</button>`
                : ''
            }
            <button class="btn btn-cyan" id="res-replay">${svgIcon('rotateCcw', 16)} Tekrar Oyna</button>
            ${
              canSpectate
                ? `<button class="btn btn-ghost" id="res-spectate">İzlemeye Devam Et</button>`
                : ''
            }
            <button class="btn btn-ghost" id="res-main">${svgIcon('home', 16)} Ana Menü</button>
          </div>
        </div>
      </div>
    `;

    this.root.querySelector('#res-replay')!.addEventListener('click', () => {
      this.callbacks.onRestartMatch();
    });
    this.root.querySelector('#res-main')!.addEventListener('click', () => {
      this.callbacks.onReturnToMain();
    });

    const spectateBtn = this.root.querySelector('#res-spectate');
    if (spectateBtn) {
      spectateBtn.addEventListener('click', () => {
        this.hide();
        this.callbacks.onSpectateMatch();
      });
    }

    const nextBtn = this.root.querySelector('#res-next-sector');
    if (nextBtn && onNextSector) {
      nextBtn.addEventListener('click', onNextSector);
    }
  }
}

function buildPowerChartSvg(sim: GameSimulation): string {
  const samples = sim.stats.powerHistory;
  const w = 640;
  const h = 165;
  const padL = 40;
  const padR = 14;
  const padT = 12;
  const padB = 24;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;

  const maxTime = Math.max(1, samples[samples.length - 1]?.time ?? 1);
  let maxShips = 50;
  for (const s of samples) {
    for (const val of Object.values(s.shipsByFaction)) {
      if (val > maxShips) maxShips = val;
    }
  }
  maxShips = Math.ceil(maxShips * 1.1);

  const gridLines = [0, 0.25, 0.5, 0.75, 1]
    .map((frac) => {
      const y = padT + plotH * (1 - frac);
      const val = Math.round(maxShips * frac);
      return `
        <line x1="${padL}" y1="${y.toFixed(1)}" x2="${w - padR}" y2="${y.toFixed(1)}" stroke="rgba(148,163,184,0.14)" stroke-width="1"/>
        <text x="${padL - 6}" y="${(y + 3).toFixed(1)}" text-anchor="end" fill="#7c8ba1" font-size="10" font-family="Inter, sans-serif">${val}</text>
      `;
    })
    .join('');

  const timeTicks = [0, 0.5, 1]
    .map((frac) => {
      const x = padL + plotW * frac;
      const t = Math.round(maxTime * frac);
      return `<text x="${x.toFixed(1)}" y="${h - 6}" text-anchor="middle" fill="#7c8ba1" font-size="10" font-family="Inter, sans-serif">${formatTime(t)}</text>`;
    })
    .join('');

  const polylines = sim.factions
    .filter((f) => f.id !== NEUTRAL_ID)
    .map((f) => {
      if (samples.length < 2) return '';
      const pts = samples
        .map((s) => {
          const x = padL + (s.time / maxTime) * plotW;
          const y = padT + plotH * (1 - (s.shipsByFaction[f.id] ?? 0) / maxShips);
          return `${x.toFixed(1)},${y.toFixed(1)}`;
        })
        .join(' ');
      return `<polyline fill="none" stroke="${f.color}" stroke-width="${f.id === PLAYER_ID ? 2.6 : 1.9}" stroke-linejoin="round" stroke-linecap="round" points="${pts}"/>`;
    })
    .join('');

  return `
    <svg viewBox="0 0 ${w} ${h}" class="power-chart-svg" preserveAspectRatio="none">
      ${gridLines}
      ${timeTicks}
      ${polylines}
    </svg>
  `;
}
