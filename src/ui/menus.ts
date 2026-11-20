import {
  CAMPAIGN_SECTORS,
  isSectorUnlocked,
  loadCampaignProgress,
  saveCampaignProgress,
} from '../game/campaign';
import {
  DIFFICULTY_LABELS,
  FACTION_PALETTE,
  MAP_TYPE_LABELS,
  NEUTRAL_ID,
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
import { loadSavedNickname, saveNickname } from '../net/peerManager';
import {
  MAX_ROOM_PLAYERS,
  buildInviteUrl,
  extractRoomCodeFromInput,
  type NetChatMessage,
  type NetLobbySettings,
  type NetLobbyState,
} from '../net/protocol';
import { formatTime, svgIcon } from './icons';

export type MenuScreen =
  | 'none'
  | 'main'
  | 'campaign'
  | 'skirmish'
  | 'help'
  | 'results'
  | 'online_entry'
  | 'online_lobby';

export interface MenuCallbacks {
  onStartMatch: (config: MatchConfig, title: string, tip?: string) => void;
  onReturnToMain: () => void;
  onRestartMatch: () => void;
  onSpectateMatch: () => void;
  onCloseHelp: () => void;
  onCreateOnlineRoom: (nickname: string) => void;
  onJoinOnlineRoom: (code: string, nickname: string) => void;
  onUpdateLobbySettings: (partial: Partial<NetLobbySettings>) => void;
  onKickLobbyPlayer: (peerId: string) => void;
  onSendLobbyChat: (text: string) => void;
  onStartOnlineMatch: () => void;
  onLeaveOnlineRoom: () => void;
  onReturnToOnlineLobby: () => void;
}

export class MenuController {
  private root: HTMLElement;
  private callbacks: MenuCallbacks;

  private activeScreen: MenuScreen = 'main';
  private helpReturnTo: MenuScreen = 'main';
  private chatDraft = '';

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
            <button class="btn btn-online btn-lg" id="btn-online-mp">
              ${svgIcon('globe', 20)}
              <span>Online Çok Oyunculu</span>
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

    this.root
      .querySelector('#btn-online-mp')!
      .addEventListener('click', () => this.showOnlineEntry());
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

  showOnlineEntry(prefillCode = '', statusMsg = '', errorMsg = ''): void {
    this.activeScreen = 'online_entry';
    const savedName = loadSavedNickname();
    const busy = Boolean(statusMsg);

    this.root.innerHTML = `
      <div class="menu-backdrop">
        <div class="modal-panel glass-card online-entry-panel">
          <div class="modal-header">
            <div>
              <h2>ONLİNE ÇOK OYUNCULU</h2>
              <p class="muted-text">Özel oda aç, davet linkini paylaş ve arkadaşlarınla uzaktan kapış.</p>
            </div>
            <button class="btn btn-sm btn-ghost" id="btn-online-back" ${busy ? 'disabled' : ''}>Ana Menü</button>
          </div>

          <div class="online-nick-bar">
            <label for="online-nick-input">TAKMA ADIN</label>
            <input
              type="text"
              id="online-nick-input"
              maxlength="16"
              value="${escapeHtml(savedName)}"
              placeholder="Komutan"
              ${busy ? 'disabled' : ''}
            />
          </div>

          ${
            errorMsg
              ? `<div class="online-alert error">${escapeHtml(errorMsg)}</div>`
              : ''
          }
          ${
            statusMsg
              ? `<div class="online-alert info"><span class="spinner-dot"></span> ${escapeHtml(statusMsg)}</div>`
              : ''
          }

          <div class="online-entry-grid">
            <div class="online-entry-card">
              <h3>${svgIcon('users', 18)} Oda Kur</h3>
              <p class="muted-text">2–6 kişilik özel bir galaksi odası oluştur, harita ve kuralları seç, arkadaşlarına link gönder.</p>
              <button class="btn btn-primary btn-lg" id="btn-create-room" ${busy ? 'disabled' : ''}>
                ${svgIcon('globe', 18)} Yeni Oda Oluştur
              </button>
            </div>

            <div class="online-entry-card">
              <h3>${svgIcon('rocket', 18)} Odaya Katıl</h3>
              <p class="muted-text">Sana gönderilen 6 haneli oda kodunu veya davet linkini aşağıya yapıştır.</p>
              <input
                type="text"
                id="online-code-input"
                value="${escapeHtml(prefillCode)}"
                placeholder="Örn: AB12CD veya https://.../?oda=AB12CD"
                ${busy ? 'disabled' : ''}
              />
              <button class="btn btn-cyan btn-lg" id="btn-join-room" ${busy ? 'disabled' : ''}>
                ${svgIcon('play', 18)} Odaya Katıl
              </button>
            </div>
          </div>
        </div>
      </div>
    `;

    const nickInput = this.root.querySelector<HTMLInputElement>('#online-nick-input')!;
    const codeInput = this.root.querySelector<HTMLInputElement>('#online-code-input')!;

    this.root.querySelector('#btn-online-back')!.addEventListener('click', () => {
      this.callbacks.onLeaveOnlineRoom();
      this.showMain();
    });

    this.root.querySelector('#btn-create-room')!.addEventListener('click', () => {
      const nick = saveNickname(nickInput.value);
      this.callbacks.onCreateOnlineRoom(nick);
    });

    const triggerJoin = () => {
      const code = extractRoomCodeFromInput(codeInput.value);
      if (!code) {
        this.showOnlineEntry(
          codeInput.value,
          '',
          'Geçerli bir 6 haneli oda kodu veya ?oda= davet linki gir.',
        );
        return;
      }
      const nick = saveNickname(nickInput.value);
      this.callbacks.onJoinOnlineRoom(code, nick);
    };

    this.root.querySelector('#btn-join-room')!.addEventListener('click', triggerJoin);
    codeInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') triggerJoin();
    });
  }

  showOnlineLobby(
    lobby: NetLobbyState,
    chat: NetChatMessage[],
    isHost: boolean,
    localPeerId: string,
  ): void {
    const wasChatFocused = document.activeElement?.id === 'lobby-chat-input';
    this.activeScreen = 'online_lobby';

    const { settings, players } = lobby;
    const maxBots = Math.max(0, MAX_ROOM_PLAYERS - players.length);
    const totalFactions = Math.min(MAX_ROOM_PLAYERS, players.length + settings.botCount);
    const canStart = totalFactions >= 2;

    const playerRows = players
      .map((p) => {
        const pal = FACTION_PALETTE[p.factionId] ?? FACTION_PALETTE[1];
        const isSelf = p.peerId === localPeerId;
        const kickBtn =
          isHost && !p.isHost
            ? `<button class="btn btn-sm btn-danger kick-btn" data-kick="${escapeHtml(p.peerId)}">Çıkar</button>`
            : '';
        return `
          <div class="lobby-player-row">
            <div class="player-id-info">
              <span class="faction-dot" style="background:${pal.color};box-shadow:0 0 10px ${pal.color}"></span>
              <span class="player-name">${escapeHtml(p.name)}</span>
              ${p.isHost ? '<span class="role-tag host">Kurucu</span>' : ''}
              ${isSelf ? '<span class="role-tag self">Sen</span>' : ''}
            </div>
            ${kickBtn}
          </div>
        `;
      })
      .join('');

    const botRows = Array.from({ length: settings.botCount }, (_, i) => {
      const fid = players.length + 1 + i;
      const pal = FACTION_PALETTE[fid] ?? FACTION_PALETTE[2];
      return `
        <div class="lobby-player-row bot-row">
          <div class="player-id-info">
            <span class="faction-dot" style="background:${pal.color}"></span>
            <span class="player-name">${escapeHtml(pal.name)}</span>
            <span class="role-tag bot">Bot • ${DIFFICULTY_LABELS[settings.botDifficulty].name}</span>
          </div>
        </div>
      `;
    }).join('');

    const chatHtml = chat
      .map((m) =>
        m.system
          ? `<div class="chat-msg sys">${escapeHtml(m.text)}</div>`
          : `<div class="chat-msg"><strong style="color:${m.color}">${escapeHtml(m.sender)}:</strong> ${escapeHtml(m.text)}</div>`,
      )
      .join('');

    const mapBtns = (Object.keys(MAP_TYPE_LABELS) as MapType[])
      .map(
        (key) => `
        <button class="choice-pill ${settings.mapType === key ? 'active' : ''}" data-omap="${key}">${MAP_TYPE_LABELS[key].name}</button>
      `,
      )
      .join('');

    const sizeBtns = [
      { label: 'Küçük (16)', count: 16 },
      { label: 'Orta (26)', count: 26 },
      { label: 'Büyük (38)', count: 38 },
      { label: 'Dev (50)', count: 50 },
    ]
      .map(
        (s) => `
        <button class="choice-pill ${settings.planetCount === s.count ? 'active' : ''}" data-osize="${s.count}">${s.label}</button>
      `,
      )
      .join('');

    const ruleBtns = (Object.keys(RULE_LABELS) as GameRule[])
      .map(
        (r) => `
        <button class="choice-pill ${settings.rule === r ? 'active' : ''}" data-orule="${r}">${RULE_LABELS[r].name}</button>
      `,
      )
      .join('');

    const botCountBtns = [0, 1, 2, 3, 4]
      .filter((n) => n <= maxBots)
      .map(
        (n) => `
        <button class="choice-pill ${settings.botCount === n ? 'active' : ''}" data-obots="${n}">${n === 0 ? 'Bot Yok' : `${n} Bot`}</button>
      `,
      )
      .join('');

    const botDiffBtns = (Object.keys(DIFFICULTY_LABELS) as Difficulty[])
      .map(
        (d) => `
        <button class="choice-pill ${settings.botDifficulty === d ? 'active' : ''}" data-odiff="${d}">${DIFFICULTY_LABELS[d].name}</button>
      `,
      )
      .join('');

    const settingsPanel = isHost
      ? `
        <div class="cfg-group">
          <label>Harita Türü</label>
          <div class="choice-row">${mapBtns}</div>
        </div>
        <div class="cfg-group">
          <label>Galaksi Boyutu</label>
          <div class="choice-row">${sizeBtns}</div>
        </div>
        <div class="cfg-group">
          <label>Oyun Kuralı</label>
          <div class="choice-row">${ruleBtns}</div>
        </div>
        <div class="cfg-group">
          <label>Yapay Zeka Botlar (Toplam Güç: ${totalFactions}/6)</label>
          <div class="choice-row">${botCountBtns}</div>
        </div>
        ${
          settings.botCount > 0
            ? `<div class="cfg-group"><label>Bot Zorluğu</label><div class="choice-row">${botDiffBtns}</div></div>`
            : ''
        }
      `
      : `
        <div class="guest-settings-summary">
          <div class="summary-chip"><span>Harita</span><strong>${MAP_TYPE_LABELS[settings.mapType].name}</strong></div>
          <div class="summary-chip"><span>Boyut</span><strong>${settings.planetCount} Gezegen</strong></div>
          <div class="summary-chip"><span>Kural</span><strong>${RULE_LABELS[settings.rule].name}</strong></div>
          <div class="summary-chip"><span>Botlar</span><strong>${settings.botCount > 0 ? `${settings.botCount} (${DIFFICULTY_LABELS[settings.botDifficulty].name})` : 'Yok'}</strong></div>
        </div>
      `;

    this.root.innerHTML = `
      <div class="menu-backdrop">
        <div class="modal-panel glass-card wide-panel lobby-panel">
          <div class="modal-header lobby-header">
            <div class="lobby-room-title">
              <span class="room-code-badge">ODA: ${escapeHtml(lobby.roomCode)}</span>
              <button class="btn btn-sm btn-cyan" id="btn-copy-invite">
                ${svgIcon('copy', 15)} <span>Davet Linkini Kopyala</span>
              </button>
            </div>
            <button class="btn btn-sm btn-danger" id="btn-leave-lobby">Odadan Ayrıl</button>
          </div>

          <div class="lobby-layout">
            <div class="lobby-left">
              <div class="lobby-section">
                <div class="lobby-section-title">OYUNCULAR (${totalFactions}/${MAX_ROOM_PLAYERS})</div>
                <div class="lobby-players-list">
                  ${playerRows}
                  ${botRows}
                </div>
              </div>

              <div class="lobby-chat-box">
                <div class="lobby-section-title">ODA SOHBETİ</div>
                <div class="lobby-chat-messages" id="lobby-chat-messages">${chatHtml}</div>
                <div class="lobby-chat-input-row">
                  <input type="text" id="lobby-chat-input" maxlength="140" placeholder="Mesaj yaz..." value="${escapeHtml(this.chatDraft)}" />
                  <button class="btn btn-sm btn-cyan" id="btn-send-chat" title="Gönder">${svgIcon('send', 15)}</button>
                </div>
              </div>
            </div>

            <div class="lobby-right">
              ${settingsPanel}

              <div class="preview-box">
                <div class="preview-top">
                  <span>CANLI HARİTA ÖNİZLEMESİ</span>
                  ${
                    isHost
                      ? `<button class="btn btn-sm btn-ghost" id="btn-lobby-new-seed">${svgIcon('shuffle', 14)} Yeni Tohum</button>`
                      : `<span class="muted-seed">Tohum #${settings.seed}</span>`
                  }
                </div>
                <canvas id="online-minimap" width="420" height="236"></canvas>
              </div>

              ${
                isHost
                  ? `
                    <button class="btn btn-primary btn-lg start-skirmish-btn" id="btn-start-online" ${canStart ? '' : 'disabled'}>
                      ${svgIcon('rocket', 20)} Savaşı Başlat
                    </button>
                    ${
                      !canStart
                        ? `<p class="lobby-hint-warn">Başlatmak için bir arkadaş davet et veya yapay zeka bot ekle.</p>`
                        : ''
                    }
                  `
                  : `<div class="guest-waiting-pill">Oda kurucusunun maçı başlatması bekleniyor...</div>`
              }
            </div>
          </div>
        </div>
      </div>
    `;

    const miniCanvas = this.root.querySelector<HTMLCanvasElement>('#online-minimap');
    if (miniCanvas) {
      const previewPlanets = generateMiniMapPreview(
        settings.mapType,
        Math.max(1, totalFactions - 1),
        settings.planetCount,
        settings.seed,
        settings.rule,
      );
      renderMiniMapPreview(miniCanvas, previewPlanets);
    }

    const chatBox = this.root.querySelector<HTMLElement>('#lobby-chat-messages');
    if (chatBox) chatBox.scrollTop = chatBox.scrollHeight;

    const chatInput = this.root.querySelector<HTMLInputElement>('#lobby-chat-input');
    if (chatInput) {
      if (wasChatFocused) {
        chatInput.focus();
        chatInput.setSelectionRange(chatInput.value.length, chatInput.value.length);
      }
      chatInput.addEventListener('input', () => {
        this.chatDraft = chatInput.value;
      });
      const submitChat = () => {
        const text = chatInput.value.trim();
        if (!text) return;
        this.chatDraft = '';
        chatInput.value = '';
        this.callbacks.onSendLobbyChat(text);
      };
      chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') submitChat();
      });
      this.root.querySelector('#btn-send-chat')?.addEventListener('click', submitChat);
    }

    const copyBtn = this.root.querySelector<HTMLButtonElement>('#btn-copy-invite')!;
    copyBtn.addEventListener('click', () => {
      const url = buildInviteUrl(lobby.roomCode);
      const markCopied = () => {
        copyBtn.innerHTML = `${svgIcon('check', 15)} <span>Kopyalandı ✓</span>`;
        setTimeout(() => {
          if (copyBtn.isConnected) {
            copyBtn.innerHTML = `${svgIcon('copy', 15)} <span>Davet Linkini Kopyala</span>`;
          }
        }, 2000);
      };
      if (navigator.clipboard?.writeText) {
        void navigator.clipboard.writeText(url).then(markCopied).catch(() => {
          window.prompt('Davet linkini kopyala:', url);
        });
      } else {
        window.prompt('Davet linkini kopyala:', url);
      }
    });

    this.root.querySelector('#btn-leave-lobby')!.addEventListener('click', () => {
      this.chatDraft = '';
      this.callbacks.onLeaveOnlineRoom();
    });

    if (isHost) {
      for (const btn of this.root.querySelectorAll<HTMLButtonElement>('.kick-btn')) {
        btn.addEventListener('click', () => {
          const pid = btn.dataset.kick;
          if (pid) this.callbacks.onKickLobbyPlayer(pid);
        });
      }

      const bindSetting = (selector: string, attr: string, handler: (val: string) => void) => {
        for (const btn of this.root.querySelectorAll<HTMLButtonElement>(selector)) {
          btn.addEventListener('click', () => handler(btn.getAttribute(attr)!));
        }
      };

      bindSetting('[data-omap]', 'data-omap', (val) =>
        this.callbacks.onUpdateLobbySettings({ mapType: val as MapType }),
      );
      bindSetting('[data-osize]', 'data-osize', (val) =>
        this.callbacks.onUpdateLobbySettings({ planetCount: Number(val) }),
      );
      bindSetting('[data-orule]', 'data-orule', (val) =>
        this.callbacks.onUpdateLobbySettings({ rule: val as GameRule }),
      );
      bindSetting('[data-obots]', 'data-obots', (val) =>
        this.callbacks.onUpdateLobbySettings({ botCount: Number(val) }),
      );
      bindSetting('[data-odiff]', 'data-odiff', (val) =>
        this.callbacks.onUpdateLobbySettings({ botDifficulty: val as Difficulty }),
      );

      this.root.querySelector('#btn-lobby-new-seed')?.addEventListener('click', () => {
        this.callbacks.onUpdateLobbySettings({
          seed: Math.floor(Math.random() * 900000) + 10000,
        });
      });

      this.root.querySelector('#btn-start-online')?.addEventListener('click', () => {
        this.callbacks.onStartOnlineMatch();
      });
    }
  }

  showResults(
    sim: GameSimulation,
    status: MatchStatus,
    earnedStars: number | null,
    hasNextSector: boolean,
    onNextSector?: () => void,
    onlineCtx?: { isHost: boolean },
  ): void {
    this.activeScreen = 'results';
    const isVictory = status === 'victory';
    const isOnline = sim.config.mode === 'online';

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
      sim.factions.filter(
        (f) => f.id !== NEUTRAL_ID && f.id !== sim.localPlayerId && !f.eliminated,
      ).length > 1;

    const tagText =
      sim.config.mode === 'campaign'
        ? `SEKTÖR ${sim.config.sectorId}`
        : isOnline
          ? 'ONLİNE MAÇ SONUCU'
          : 'SKİRMİSH SONUCU';

    const actionsHtml = isOnline
      ? `
        ${
          onlineCtx?.isHost
            ? `<button class="btn btn-primary" id="res-online-lobby">${svgIcon('users', 16)} Lobiye Dön</button>`
            : `<span class="guest-lobby-wait">Oda kurucusu lobiye döndüğünde yeni maç başlayacaktır.</span>`
        }
        <button class="btn btn-ghost" id="res-main">${svgIcon('home', 16)} Odadan Çık</button>
      `
      : `
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
      `;

    this.root.innerHTML = `
      <div class="menu-backdrop">
        <div class="modal-panel glass-card results-panel">
          <div class="results-hero ${isVictory ? 'win' : 'loss'}">
            <span class="results-tag">${tagText}</span>
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
                      `<span class="legend-chip"><i style="background:${f.color}"></i>${escapeHtml(f.name)}</span>`,
                  )
                  .join('')}
              </div>
            </div>
            ${buildPowerChartSvg(sim)}
          </div>

          <div class="results-actions">
            ${actionsHtml}
          </div>
        </div>
      </div>
    `;

    this.root.querySelector('#res-replay')?.addEventListener('click', () => {
      this.callbacks.onRestartMatch();
    });
    this.root.querySelector('#res-online-lobby')?.addEventListener('click', () => {
      this.callbacks.onReturnToOnlineLobby();
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

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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
      return `<polyline fill="none" stroke="${f.color}" stroke-width="${f.id === sim.localPlayerId ? 2.6 : 1.9}" stroke-linejoin="round" stroke-linecap="round" points="${pts}"/>`;
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
