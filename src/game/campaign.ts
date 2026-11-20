import type { CampaignProgress, CampaignSector, SectorProgress } from './types';

const STORAGE_KEY = 'galcon_nova_campaign_v1';

export const CAMPAIGN_SECTORS: CampaignSector[] = [
  {
    id: 1,
    name: 'İlk Temas',
    subtitle: 'Sınır Karakolu',
    description: 'Keşif öncülerin Kızıl İmparatorluk devriyesiyle karşılaştı. Yakın gezegenleri hızla ele geçir.',
    tip: 'İpucu: Büyük gezegenler daha hızlı gemi üretir. Tarafsız gezegenler saldırılmadıkça üretmez.',
    mapType: 'classic',
    opponents: 1,
    difficulty: 'easy',
    planetCount: 16,
    rule: 'standard',
    seed: 10101,
    starTimes: [65, 105, 9999],
  },
  {
    id: 2,
    name: 'İkiz Yörüngeler',
    subtitle: 'Simetrik Düello',
    description: 'Eşit koşullara sahip ayna arenada saf hız ve zamanlama üstünlüğünü kanıtla.',
    tip: 'İpucu: Fare tekerleği veya 1-4 tuşlarıyla göndereceğin filo yüzdesini anlık ayarla.',
    mapType: 'symmetric',
    opponents: 1,
    difficulty: 'easy',
    planetCount: 19,
    rule: 'standard',
    seed: 20202,
    starTimes: [70, 115, 9999],
  },
  {
    id: 3,
    name: 'Kızıl Sarmal',
    subtitle: 'Galaktik Kollar',
    description: 'İki rakip galaksi kollarından merkeze doğru yayılıyor. Merkez çekirdeği kaptırma.',
    tip: 'İpucu: Shift + Sağ Tık ile arka gezegenlerinden cepheye otomatik Ralli Noktası kurabilirsin.',
    mapType: 'spiral',
    opponents: 2,
    difficulty: 'normal',
    planetCount: 24,
    rule: 'standard',
    seed: 30303,
    starTimes: [85, 135, 9999],
  },
  {
    id: 4,
    name: 'Altın Halka',
    subtitle: 'Yörünge Kuşatması',
    description: 'İç halkadaki zengin dünyalar için üç yönlü çarpışma. Düşmanların birbirini yıpratmasını bekle.',
    tip: 'İpucu: İki rakip çarpışırken zayıflayan gezegene zamanlı saldırı yap.',
    mapType: 'ring',
    opponents: 2,
    difficulty: 'normal',
    planetCount: 26,
    rule: 'standard',
    seed: 40404,
    starTimes: [90, 145, 9999],
  },
  {
    id: 5,
    name: 'Yıldız Ağı',
    subtitle: 'Taktik Izgara',
    description: 'Düzenli yıldız matrisinde her bağlantı noktası kritik. Hızlı üretim kuralları devrede.',
    tip: 'İpucu: Turbo kuralında hem gemiler hem üretim çok hızlıdır; savunmayı ihmal etme!',
    mapType: 'grid',
    opponents: 2,
    difficulty: 'normal',
    planetCount: 28,
    rule: 'turbo',
    seed: 50505,
    starTimes: [75, 120, 9999],
  },
  {
    id: 6,
    name: 'Dörtlü Kıskaç',
    subtitle: 'Kümeler Savaşı',
    description: 'Dört ayrı yıldız kümesi dar boğazlarla bağlanıyor. Kendi kümeni hızla birleştir.',
    tip: 'İpucu: Boşlukta kutu çizerek uçuş halindeki filolarını seçip havada yönlendirebilirsin.',
    mapType: 'clusters',
    opponents: 3,
    difficulty: 'hard',
    planetCount: 30,
    rule: 'standard',
    seed: 60606,
    starTimes: [105, 160, 9999],
  },
  {
    id: 7,
    name: 'Çekirdek Yarışı',
    subtitle: 'Büyük Çekirdek',
    description: 'Merkezdeki devasa gezegen saniyede 6.2 gemi üretiyor. Orayı alan galaksiye hükmeder.',
    tip: 'İpucu: Büyük Çekirdeğe ilk saldıran gemilerini tüketir; ikinci dalga için hazır ol.',
    mapType: 'ring',
    opponents: 3,
    difficulty: 'hard',
    planetCount: 29,
    rule: 'megacore',
    seed: 70707,
    starTimes: [100, 155, 9999],
  },
  {
    id: 8,
    name: 'Asimetrik Kuşatma',
    subtitle: 'Çifte Üs Avantajı',
    description: 'Güçlü bir çift merkezle başlıyorsun ama üç acımasız düşman seni kuşatıyor.',
    tip: 'İpucu: Çifte tıklayarak tüm gezegenlerini seçebilir ve koordine saldırı başlatabilirsin.',
    mapType: 'symmetric',
    opponents: 3,
    difficulty: 'hard',
    planetCount: 32,
    rule: 'superfleet',
    seed: 80808,
    asymmetricStart: true,
    starTimes: [110, 170, 9999],
  },
  {
    id: 9,
    name: 'Kaotik Nebula',
    subtitle: 'Beşli FFA',
    description: 'Beş düşman filosu aynı anda savaşta. Uzman komutanlar savunmasız sınırları anında cezalandırır.',
    tip: 'İpucu: Erken oyunda tek bir rakibe odaklanmak yerine yüksek verimli kümeleri topla.',
    mapType: 'spiral',
    opponents: 4,
    difficulty: 'expert',
    planetCount: 38,
    rule: 'standard',
    seed: 90909,
    starTimes: [125, 190, 9999],
  },
  {
    id: 10,
    name: 'Nova İmparatorluğu',
    subtitle: 'Son Hesaplaşma',
    description: 'Altı galaktik gücün dev Turbo çatışması. Galaksinin mutlak hakimi olmak için son sınav.',
    tip: 'İpucu: Arka gezegenlerden cepheye sürekli ralli hattı kurarak ön hattı besle.',
    mapType: 'clusters',
    opponents: 5,
    difficulty: 'expert',
    planetCount: 44,
    rule: 'turbo',
    seed: 101010,
    starTimes: [120, 185, 9999],
  },
];

export function loadCampaignProgress(): CampaignProgress {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { sectors: {}, unlockAll: false };
    }
    const parsed = JSON.parse(raw) as Partial<CampaignProgress>;
    return {
      sectors: parsed.sectors ?? {},
      unlockAll: Boolean(parsed.unlockAll),
    };
  } catch {
    return { sectors: {}, unlockAll: false };
  }
}

export function saveCampaignProgress(progress: CampaignProgress): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  } catch {
    // Ignore storage quota / private mode issues
  }
}

export function isSectorUnlocked(sectorId: number, progress: CampaignProgress): boolean {
  if (progress.unlockAll || sectorId === 1) return true;
  return Boolean(progress.sectors[sectorId - 1]?.completed);
}

export function calculateSectorStars(sector: CampaignSector, elapsedSeconds: number): number {
  if (elapsedSeconds <= sector.starTimes[0]) return 3;
  if (elapsedSeconds <= sector.starTimes[1]) return 2;
  return 1;
}

export function recordSectorVictory(
  sector: CampaignSector,
  elapsedSeconds: number,
): { progress: CampaignProgress; earnedStars: number } {
  const progress = loadCampaignProgress();
  const earnedStars = calculateSectorStars(sector, elapsedSeconds);
  const prev: SectorProgress | undefined = progress.sectors[sector.id];
  const bestStars = Math.max(prev?.stars ?? 0, earnedStars);
  const bestTime =
    prev?.bestTime != null ? Math.min(prev.bestTime, elapsedSeconds) : elapsedSeconds;

  progress.sectors[sector.id] = {
    completed: true,
    stars: bestStars,
    bestTime,
  };
  saveCampaignProgress(progress);
  return { progress, earnedStars };
}
