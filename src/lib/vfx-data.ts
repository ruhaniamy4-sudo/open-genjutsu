export type Category = 'Recast' | 'Camera' | 'Relight' | 'World';
export type EngineId =
  | 'kinetix-pro'
  | 'wan-26'
  | 'kling-30'
  | 'seedance-25'
  | 'veo-31'
  | 'nano-banana-pro'
  | 'gpt-image'
  | 'seedream-4'
  | 'flux-ultra';
export type MediaKind = 'video' | 'image';
export type Aspect = '16:9' | '9:16' | '2.39:1' | '1:1';
export type Duration = '5s' | '7s' | '8s';

export const ASPECTS: Aspect[] = ['16:9', '9:16', '2.39:1', '1:1'];
export const DURATIONS: Duration[] = ['5s', '7s', '8s'];
export const CATEGORIES: Category[] = ['Recast', 'Camera', 'Relight', 'World'];
export const ENGINE_IDS: EngineId[] = [
  'kinetix-pro',
  'wan-26',
  'kling-30',
  'seedance-25',
  'veo-31',
  'nano-banana-pro',
  'gpt-image',
  'seedream-4',
  'flux-ultra',
];

export interface VfxEffect {
  id: string;
  title: string;
  subtitle: string;
  category: Category;
  image: string;
  /** Natural image ratio (w / h), used to size masonry tiles without layout shift. */
  ratio: number;
  roughPrompt: string;
  camera: string;
  lighting: string;
  engine: EngineId;
  /** Shown as a Cinema Preset (tall card band + studio dock). */
  preset: boolean;
}

export interface EngineOption {
  id: EngineId;
  kind: MediaKind;
  name: string;
  credits: number;
  provider: string;
  blurb: string;
}

export interface BoostersConfig {
  fp16Vae: boolean;
  faceRefine: boolean;
  orionDctl: boolean;
}

export const DEFAULT_BOOSTERS: BoostersConfig = { fp16Vae: true, faceRefine: true, orionDctl: true };

export const BOOSTER_LABELS: Record<keyof BoostersConfig, { name: string; hint: string }> = {
  fp16Vae: { name: 'FP16 Video VAE', hint: 'No banding. Keeps skin pores and hair.' },
  faceRefine: { name: 'Macro Face Refine', hint: 'Follows the mouth, matches the photo.' },
  orionDctl: { name: 'Orion4D DCTL Grade', hint: 'Soft filmic tone map and 35mm grain.' },
};

export const VFX_EFFECTS: VfxEffect[] = [
  {
    id: 'character-swap',
    title: 'Character Recast',
    subtitle: 'Rainy Tokyo alley',
    category: 'Recast',
    image: '/images/character-swap.jpg',
    ratio: 637 / 853,
    roughPrompt: 'bristi te cyberpunk hero kore dao, tungsten rim light ar wet leather jacket',
    camera: '35mm anamorphic push-in',
    lighting: 'Amber tungsten rim + cyan rain bounce',
    engine: 'kinetix-pro',
    preset: true,
  },
  {
    id: 'bullet-time',
    title: 'Bullet Time 360',
    subtitle: 'Frozen droplets, orbital sweep',
    category: 'Camera',
    image: '/images/bullet-time.jpg',
    ratio: 637 / 853,
    roughPrompt: 'frozen rain droplets er moddhe slow motion 360 orbital camera sweep',
    camera: '360° high-speed orbital rig (1000fps)',
    lighting: 'Hard tungsten spotlights + volumetric haze',
    engine: 'kinetix-pro',
    preset: true,
  },
  {
    id: 'earth-zoom',
    title: 'Orbital Earth Zoom',
    subtitle: 'Golden-hour stratosphere plunge',
    category: 'Camera',
    image: '/images/earth-zoom.jpg',
    ratio: 637 / 853,
    roughPrompt: 'stratosphere theke golden hour clouds bhed kore coastal megacity te zoom plunge',
    camera: 'IMAX 70mm continuous stratospheric dive',
    lighting: 'Golden-hour volumetric crepuscular rays',
    engine: 'veo-31',
    preset: true,
  },
  {
    id: 'cinema-relight',
    title: 'Tungsten Relight',
    subtitle: 'Dual-tone studio key',
    category: 'Relight',
    image: '/images/cinema-relight.jpg',
    ratio: 637 / 853,
    roughPrompt: 'face er ek pashe warm golden tungsten key light ar onno pashe cool steel blue fill',
    camera: '85mm prime intimate profile close-up',
    lighting: 'Dual-tone 3200K / 6800K split',
    engine: 'kinetix-pro',
    preset: true,
  },
  {
    id: 'face-refine',
    title: 'Macro Face Refine',
    subtitle: 'Identity lock, micro detail',
    category: 'Recast',
    image: '/images/face-refine.jpg',
    ratio: 637 / 853,
    roughPrompt: 'close-up face sharpness lock, natural skin pores, eyelashes and studio catchlight',
    camera: '100mm macro anamorphic chiaroscuro',
    lighting: 'Soft key chiaroscuro + iris catchlight',
    engine: 'kinetix-pro',
    preset: true,
  },
  {
    id: 'world-morph',
    title: 'Metropolis Warp',
    subtitle: 'Locked foreground, skyline morph',
    category: 'World',
    image: '/images/world-morph.jpg',
    ratio: 637 / 853,
    roughPrompt: 'foreground man ekdom still thakbe, pichoner futuristic city bend hoye warp hobe',
    camera: '24mm wide Steadicam, locked foreground',
    lighting: 'Golden-cyan architectural light trails',
    engine: 'seedance-25',
    preset: true,
  },
  {
    id: 'neon-overpass',
    title: 'Neon Overpass',
    subtitle: 'S-Log3 plate to graded night',
    category: 'Relight',
    image: '/images/hero-cinema.jpg',
    ratio: 1280 / 714,
    roughPrompt: 'raw log footage ke rainy neon night grade koro, teal shadows ar warm signage',
    camera: '40mm anamorphic locked-off wide',
    lighting: 'Teal ambient night + warm practical signage',
    engine: 'kinetix-pro',
    preset: false,
  },
  {
    id: 'desert-drift',
    title: 'Desert Drift',
    subtitle: 'Sunset dust storm chase',
    category: 'World',
    image: '/images/desert-car.jpg',
    ratio: 1120 / 625,
    roughPrompt: 'sunset e desert e black supercar drift korbe, pichone heavy dust cloud',
    camera: 'Low tracking car-mount, 28mm, 1/50 shutter',
    lighting: 'Backlit golden sun through dust volume',
    engine: 'kling-30',
    preset: false,
  },
  {
    id: 'helipad-landing',
    title: 'Rooftop Landing',
    subtitle: 'Rain-soaked helipad at night',
    category: 'Camera',
    image: '/images/heli-landing.jpg',
    ratio: 1120 / 625,
    roughPrompt: 'rainy night e skyscraper rooftop helipad e helicopter land korbe, spray ar mist',
    camera: 'Drone descending orbit, 24mm',
    lighting: 'Cool city glow + helipad edge lights',
    engine: 'veo-31',
    preset: false,
  },
  {
    id: 'shibuya-ronin',
    title: 'Shibuya Ronin',
    subtitle: 'Lone samurai, neon crossing',
    category: 'Recast',
    image: '/images/shibuya-ronin.jpg',
    ratio: 536 / 960,
    roughPrompt: 'neon shibuya crossing e straw hat samurai daraye ache, bristi, katana',
    camera: '50mm slow dolly-in, low angle',
    lighting: 'Magenta-cyan neon wash + wet street reflections',
    engine: 'seedance-25',
    preset: false,
  },
  {
    id: 'underwater-rays',
    title: 'Abyss Light',
    subtitle: 'Diver under crepuscular rays',
    category: 'World',
    image: '/images/underwater-rays.jpg',
    ratio: 1,
    roughPrompt: 'gobhir pani te diver neme jacche, upor theke sunlight rays ar floating particles',
    camera: 'Slow descending underwater float, 18mm',
    lighting: 'Surface god-rays + teal depth falloff',
    engine: 'wan-26',
    preset: false,
  },
];

/** The raw S-Log3 plate that pairs with `neon-overpass` for the hero before/after. */
export const RAW_PLATE = '/images/hero-raw.jpg';

export const ENGINES: EngineOption[] = [
  { id: 'kinetix-pro', kind: 'video', name: 'Kinetix Pro', credits: 12, provider: 'KINETIX in-house', blurb: 'Our tuned cinema model. Half the credits.' },
  { id: 'wan-26', kind: 'video', name: 'WAN 2.6', credits: 18, provider: 'Partner model', blurb: 'Fast open model.' },
  { id: 'kling-30', kind: 'video', name: 'Kling 3.0', credits: 24, provider: 'Partner model', blurb: 'Strong motion physics.' },
  { id: 'seedance-25', kind: 'video', name: 'Seedance 2.5', credits: 28, provider: 'Partner model', blurb: 'Multi-shot storytelling.' },
  { id: 'veo-31', kind: 'video', name: 'Veo 3.1', credits: 36, provider: 'Partner model', blurb: 'Top realism with audio.' },
  { id: 'nano-banana-pro', kind: 'image', name: 'Nano Banana Pro', credits: 6, provider: 'Partner model', blurb: 'Best for edits and character consistency.' },
  { id: 'gpt-image', kind: 'image', name: 'GPT Image', credits: 8, provider: 'Partner model', blurb: 'Strong text, layouts and posters.' },
  { id: 'seedream-4', kind: 'image', name: 'Seedream 4', credits: 4, provider: 'Partner model', blurb: 'Fast photoreal stills.' },
  { id: 'flux-ultra', kind: 'image', name: 'FLUX Ultra', credits: 5, provider: 'Partner model', blurb: 'Crisp 4MP cinematic frames.' },
];

export function getEngine(id: string | null | undefined): EngineOption {
  return ENGINES.find((e) => e.id === id) ?? ENGINES[0];
}

export const VIDEO_ENGINES = ENGINES.filter((e) => e.kind === 'video');
export const IMAGE_ENGINES = ENGINES.filter((e) => e.kind === 'image');

export function getEffect(id: string | null | undefined): VfxEffect {
  return VFX_EFFECTS.find((e) => e.id === id) ?? VFX_EFFECTS[0];
}

export const PRESETS = VFX_EFFECTS.filter((e) => e.preset);

export const PLANS = [
  {
    id: 'free',
    name: 'Free',
    price: 0,
    credits: 30,
    blurb: 'Try the Director Agent and two Kinetix Pro shots.',
    perks: ['30 credits once', 'All 9 video and image engines', 'Director Agent in English or Banglish', 'Watermark-free previews'],
  },
  {
    id: 'creator',
    name: 'Creator',
    price: 19,
    credits: 300,
    blurb: 'For weekly shorts and client tests.',
    perks: ['300 credits every month', 'About 25 Kinetix Pro shots', 'Partner engines included', 'Commercial use'],
  },
  {
    id: 'pro',
    name: 'Pro Studio',
    price: 49,
    credits: 1000,
    blurb: 'Priority renders for agencies.',
    perks: ['1,000 credits every month', 'Priority render queue', 'Unlimited Film Playground projects', 'Email support'],
  },
] as const;

export type PlanId = (typeof PLANS)[number]['id'];
export type PaidPlanId = Exclude<PlanId, 'free'>;

/**
 * Distinctive Banglish words that must never reach a model prompt.
 * Short ambiguous tokens ("ar", "er", "te") are left out on purpose: they cause false positives in English.
 */
const BANGLISH_WORDS = [
  'kore', 'koro', 'korbe', 'dao', 'theke', 'ekdom', 'thakbe', 'hobe', 'hoye', 'pichone', 'pichoner', 'moddhe', 'bhed',
  'pashe', 'onno', 'bristi', 'ache', 'jacche', 'neme', 'gobhir', 'pani', 'upor', 'daraye', 'akash', 'akas',
];
const BANGLISH_RE = new RegExp(`\\b(${BANGLISH_WORDS.join('|')})\\b`, 'i');
const BANGLA_SCRIPT_RE = /[ঀ-৿]/;

/** True when text still contains Banglish words or Bangla script (a prompt "leak"). */
export function hasBanglishLeak(text: string): boolean {
  return BANGLISH_RE.test(text) || BANGLA_SCRIPT_RE.test(text);
}

export function compileLocalDirectorPrompt(
  rawIdea: string,
  effectId: string = 'character-swap',
  boosters: BoostersConfig = DEFAULT_BOOSTERS,
) {
  const lower = (rawIdea || '').toLowerCase();
  const fx = getEffect(effectId);
  const has = (re: RegExp) => re.test(lower);
  const hasRain = has(/bristi|rain|wet|monsoon|droplet/);
  const hasCyber = has(/cyberpunk|neon|tokyo|shibuya|futuristic|warp|metropolis/);
  const hasWarm = has(/tungsten|warm|golden|sunset|amber/);
  const hasBlue = has(/blue|moonlight|cool|cyan|night|teal/);
  const hasOrbit = has(/360|orbit|bullet|slow|frozen/);
  const hasDive = has(/zoom|dive|cloud|sky|akash|akas|earth|stratosphere/);
  const hasDesert = has(/desert|dust|sand|drift/);
  const hasWater = has(/underwater|pani|ocean|diver|sea\b/);

  const env = hasWater
    ? 'deep teal underwater void with drifting particulate and surface caustics'
    : hasDesert
      ? 'open desert dunes at sunset with a towering backlit dust cloud'
      : hasCyber
        ? 'rain-slicked midnight neon street with reflective asphalt and volumetric mist'
        : hasDive
          ? 'stratospheric golden-hour cloud deck plunging toward an illuminated coastal metropolis'
          : 'atmospheric 35mm cinema set with shallow depth of field and practical background lights';

  const light =
    hasWarm && hasBlue
      ? 'dual-tone 3200K warm tungsten key opposed by 6800K cool steel-blue fill'
      : hasWarm
        ? 'warm 3200K tungsten rim light sculpting skin and fabric highlights'
        : fx.lighting;

  const motion = hasOrbit
    ? 'high-speed 360-degree orbital camera sweep around suspended water droplets'
    : hasDive
      ? 'continuous gravity-accelerated IMAX 70mm plunge with natural motion blur'
      : hasRain
        ? 'controlled 35mm anamorphic push-in with real falling rain streaks and specular reflections'
        : fx.camera;

  const finish = boosters.orionDctl
    ? 'ARRI Alexa 65 color science, Orion4D H3 Soft DCTL tone mapping, subtle 35mm grain, detail contrast -0.20'
    : 'neutral theatrical Rec.709 grade';

  const identity = boosters.faceRefine
    ? 'Lock the primary character identity from Frame 0 and the reference portrait with zero facial drift; follow the mouth and match the photo.'
    : 'Keep the primary character consistent with Frame 0.';

  const prompt = `${identity} Scene: ${env}. Lighting: ${light}. Camera: ${motion}. Finish: ${finish}. Negative: no plastic skin, no banding, no identity morph, no warped hands, no watermark.`;

  return {
    prompt,
    camera: motion,
    lighting: light,
    params: {
      vae: boosters.fp16Vae ? 'minimax_h3_video_vae_fp16.safetensors' : 'standard',
      motionRefPx: 1376,
      faceRefine: boosters.faceRefine ? 'follow_mouth_match_photo' : 'disabled',
      colorGrade: boosters.orionDctl ? 'orion4d_h3_soft_dctl' : 'rec709',
    },
  };
}

export type CompiledPrompt = ReturnType<typeof compileLocalDirectorPrompt>;
