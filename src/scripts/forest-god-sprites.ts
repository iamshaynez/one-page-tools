import { ANIMAL_RULES } from './forest-god-content';
import type { Animal, Plant } from './forest-god-core';

export interface SpriteEnvironment {
  time: number;
  daylight: number;
  seasonIndex: number;
  weather: 'clear' | 'rain' | 'storm';
  reducedMotion: boolean;
}

/**
 * Everything is drawn in little, integer local cells. Four cells make one world
 * unit, so the same silhouettes remain useful from a distant z=3 to a close
 * z=8. Rectangles are aligned by their two edges rather than by their centres.
 */
interface Pen {
  g: CanvasRenderingContext2D;
  x: number;
  y: number;
  s: number;
  flip: boolean;
  color: string;
}

interface Palette {
  dark: string;
  mid: string;
  light: string;
}

const C = {
  ink: '#29273c',
  violet: '#3b304b',
  violetLight: '#625069',
  shade: '#4a3c54',
  warm: '#f3d39b',
  cream: '#eee0bd',
  snow: '#d9ded2',
  snowShade: '#9faeaa',
  bark: '#665044',
  barkLight: '#a47750',
  dead: '#62545a',
  deadLight: '#8a7165',
  berry: '#a9415c',
  berryLight: '#e07978',
  gold: '#e9b95f',
  water: '#76aeb2',
  eye: '#211f31',
  rose: '#d98b9d',
} as const;

const BROAD_LEAVES: readonly Palette[] = [
  { dark: '#354d43', mid: '#66865a', light: '#b0c477' },
  { dark: '#304a40', mid: '#52764e', light: '#91aa65' },
  { dark: '#533e43', mid: '#a36245', light: '#e0ad58' },
  { dark: '#3b3545', mid: '#65575a', light: '#a38b75' },
];
const NIGHT_LEAVES: Palette = { dark: '#292d3d', mid: '#3e4b4b', light: '#637064' };
const WITHERED_LEAVES: Palette = { dark: '#453b45', mid: '#75634f', light: '#aa8a60' };
const WITHERED_PINE: Palette = { dark: '#393841', mid: '#59564c', light: '#8a7d61' };
const WINTER_FERN: Palette = { dark: '#49434a', mid: '#74664f', light: '#a18b62' };
const PINE_LEAVES: readonly Palette[] = [
  { dark: '#293e3b', mid: '#426553', light: '#7e9b69' },
  { dark: '#263c38', mid: '#365a4b', light: '#65875e' },
  { dark: '#303c3b', mid: '#465c4d', light: '#7c8760' },
  { dark: '#303942', mid: '#455754', light: '#77877a' },
];
const GRASS_COLORS = [
  ['#3d5545', '#77945b', '#b4bd78'],
  ['#354e40', '#688650', '#a2b46b'],
  ['#514b40', '#8b8050', '#c2a665'],
  ['#49454a', '#81775f', '#b4a77f'],
] as const;
const FLOWER_COLORS = ['#e9afc0', '#e8c76f', '#a9addd', '#eee0c2'] as const;
const WIND = [0, 1, 0, -1] as const;
const GAIT = [0, 1, 0, -1] as const;
const TREE_DECAY = 12;
const NIGHT_GRASS = ['#303842', '#4b5b4d', '#75816a'] as const;
const WITHERED_GRASS = ['#494047', '#79674f', '#a88a60'] as const;
const GRASS_BLADES = [
  [-4, 4, -1], [-2, 7, 0], [0, 8, 1], [2, 6, 0], [4, 4, 1],
] as const;
const BERRY_POINTS = [
  [-6, -13], [-2, -16], [3, -13], [6, -10], [-4, -9], [1, -11], [0, -17],
] as const;
const PINE_TIERS = [
  [-40, 3], [-35, 8], [-29, 14], [-22, 21], [-14, 28], [-7, 32],
] as const;
const FERN_FRONDS = [
  [-1, -4, 5], [-1, -7, 7], [0, -10, 5],
] as const;
const DEAD_PINE_BRANCHES = [0.18, 0.34, 0.51, 0.68] as const;

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));
const mod4 = (n: number): number => ((Math.floor(n) % 4) + 4) % 4;

function at(g: CanvasRenderingContext2D, x: number, y: number, z: number, scale = 1, flip = false): Pen {
  return {
    g,
    x: Math.round(x),
    y: Math.round(y),
    s: Math.max(0.01, z) * 0.25 * scale,
    flip,
    color: '',
  };
}

function px(p: Pen, color: string, x: number, y: number, w = 1, h = 1): void {
  if (w <= 0 || h <= 0) return;
  const localX = p.flip ? -x - w : x;
  const x0 = Math.round(p.x + localX * p.s);
  const x1 = Math.round(p.x + (localX + w) * p.s);
  const y0 = Math.round(p.y + y * p.s);
  const y1 = Math.round(p.y + (y + h) * p.s);
  if (p.color !== color) {
    p.g.fillStyle = color;
    p.color = color;
  }
  // Tiny details still get one physical pixel at unusually small zoom levels.
  p.g.fillRect(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0));
}

function growthScale(plant: Plant): number {
  return 0.2 + Math.sqrt(clamp01(plant.growth)) * 0.8;
}

function growthStage(plant: Plant): number {
  if (plant.growth < 0.2) return 0;
  if (plant.growth < 0.5) return 1;
  if (plant.growth < 0.82) return 2;
  return 3;
}

function seasonOf(env: SpriteEnvironment): number {
  return mod4(env.seasonIndex);
}

function windFor(plant: Plant, env: SpriteEnvironment): number {
  if (env.reducedMotion) return 0;
  const frame = Math.floor(env.time * 8) + plant.id * 3 + plant.variant;
  const strength = env.weather === 'storm' ? 2 : 1;
  return WIND[mod4(frame)] * strength;
}

function broadPalette(env: SpriteEnvironment, health = 1): Palette {
  if (health < 0.3) return WITHERED_LEAVES;
  if (env.daylight < 0.14) return NIGHT_LEAVES;
  return BROAD_LEAVES[seasonOf(env)];
}

function pinePalette(env: SpriteEnvironment, health = 1): Palette {
  if (health < 0.3) return WITHERED_PINE;
  if (env.daylight < 0.14) return NIGHT_LEAVES;
  return PINE_LEAVES[seasonOf(env)];
}

function plantTop(plant: Plant): number {
  switch (plant.species) {
    case 'grass': return 8;
    case 'flower': return 11;
    case 'berry': return 18;
    case 'oak': return plant.variant === 7 ? 44 : 36;
    case 'pine': return 40;
    case 'fern': return 12;
    case 'mushroom': return 9;
  }
}

function decayFor(plant: Plant): number {
  const duration = plant.species === 'oak' || plant.species === 'pine' ? TREE_DECAY : plant.species === 'berry' ? 4 : 1.5;
  return clamp01(Math.max(0, plant.deadFor) / duration);
}

export function plantPixelHeight(plant: Plant, z: number): number {
  let cells = plantTop(plant);
  if (!plant.alive) {
    const decay = decayFor(plant);
    const loss = plant.species === 'oak' || plant.species === 'pine' ? 0.7 : plant.species === 'mushroom' ? 0.82 : 0.66;
    cells *= 1 - decay * loss;
  }
  return Math.max(1, Math.round(cells * Math.max(0, z) * 0.25 * growthScale(plant)));
}

function drawGrass(p: Pen, plant: Plant, stage: number, wind: number, env: SpriteEnvironment): void {
  const season = seasonOf(env);
  const colors = env.daylight < 0.14
    ? NIGHT_GRASS
    : plant.health < 0.3 ? WITHERED_GRASS : GRASS_COLORS[season];
  px(p, colors[0], -5, -1, 10, 1);
  const count = stage === 0 ? 3 : 5;
  for (let i = 0; i < count; i++) {
    const blade = GRASS_BLADES[i];
    const bx = blade[0];
    const h = blade[1] - (stage === 0 && i > 1 ? 1 : 0);
    const lean = blade[2] + wind;
    px(p, colors[0], bx, -Math.max(2, h - 2), 1, Math.max(2, h - 2));
    px(p, colors[1], bx + Math.sign(lean), -h, 1, 3);
    if (h > 5) px(p, colors[2], bx + lean, -h, 1, 2);
  }
  if (season === 3 && stage > 1) {
    px(p, C.snowShade, -5, -1, 4, 1);
    px(p, C.snow, 1, -1, 4, 1);
  }
}

function flowerHead(p: Pen, x: number, y: number, color: string, open: boolean, pollinated: boolean): void {
  if (!open) {
    px(p, C.shade, x, y, 2, 2);
    px(p, C.deadLight, x, y, 1, 1);
    return;
  }
  px(p, color, x - 1, y + 1, 4, 2);
  px(p, color, x, y, 2, 4);
  px(p, pollinated ? C.gold : C.warm, x, y + 1, 2, 2);
  if (pollinated) px(p, C.cream, x + 1, y + 1, 1, 1);
}

function drawFlower(p: Pen, plant: Plant, stage: number, wind: number, env: SpriteEnvironment): void {
  const season = seasonOf(env);
  const leaf = broadPalette(env, plant.health);
  const color = FLOWER_COLORS[mod4(plant.variant + plant.id)];
  const open = season < 2 || (season === 2 && plant.health > 0.55);
  const top = -9 + wind;
  px(p, leaf.dark, -1, -1, 3, 1);
  px(p, leaf.dark, 0, -8, 1, 8);
  px(p, leaf.mid, wind, -9, 1, 4);
  px(p, leaf.mid, -2, -4, 2, 1);
  px(p, leaf.light, -3, -5, 2, 1);
  px(p, leaf.mid, 1, -6, 2, 1);
  flowerHead(p, wind - 1, top - 2, color, open && stage > 0, plant.pollinated);
  if (stage >= 2) {
    px(p, leaf.dark, -4, -5, 1, 5);
    px(p, leaf.mid, -4 + wind, -7, 1, 3);
    flowerHead(p, -5 + wind, -8, color, open, false);
  }
  if (stage >= 3 && plant.fruit > 0.35 && season !== 3) {
    px(p, leaf.dark, 3, -4, 1, 4);
    flowerHead(p, 2 + wind, -6, FLOWER_COLORS[mod4(plant.variant + 1)], open, false);
  }
  if (season === 3) px(p, C.snow, -2, -1, 4, 1);
}

function drawBerry(p: Pen, plant: Plant, stage: number, wind: number, env: SpriteEnvironment): void {
  const season = seasonOf(env);
  const leaf = broadPalette(env, plant.health);
  const bare = season === 3 || plant.health < 0.25;
  px(p, C.violet, -6, -2, 12, 2);
  px(p, C.bark, -1, -13, 2, 13);
  px(p, C.bark, -6, -10, 2, 9);
  px(p, C.bark, 4, -11, 2, 10);
  px(p, C.barkLight, 0, -12, 1, 9);
  px(p, C.bark, -6, -12, 5, 2);
  px(p, C.bark, 1, -14, 5, 2);
  if (stage > 0) {
    px(p, C.bark, -8, -8, 3, 2);
    px(p, C.bark, 5, -8, 3, 2);
  }
  if (!bare) {
    const w = wind;
    px(p, leaf.dark, -8 + w, -16, 16, 9);
    px(p, leaf.dark, -6 + w, -18, 12, 12);
    px(p, leaf.mid, -7 + w, -16, 6, 7);
    px(p, leaf.mid, 1 + w, -17, 6, 7);
    px(p, leaf.mid, -3 + w, -18, 6, 5);
    px(p, leaf.light, -5 + w, -17, 4, 2);
    px(p, leaf.light, 3 + w, -15, 3, 2);
    if (stage < 2) {
      // Young canes carry an open centre instead of a mature, solid canopy.
      px(p, C.violet, -2 + w, -12, 4, 4);
      px(p, C.bark, -1, -13, 2, 7);
    }
  } else {
    px(p, C.dead, -8 + wind, -15, 2, 6);
    px(p, C.dead, 6 + wind, -16, 2, 7);
    px(p, C.deadLight, -8 + wind, -16, 5, 1);
    px(p, C.deadLight, 3 + wind, -17, 5, 1);
    if (season === 3) {
      px(p, C.snow, -8 + wind, -17, 5, 1);
      px(p, C.snowShade, 3 + wind, -18, 5, 1);
    }
  }
  if (plant.fruit > 0.08 && plant.growth > 0.48 && season !== 3 && plant.alive) {
    const berries = BERRY_POINTS;
    const count = Math.min(berries.length, 1 + Math.floor(plant.fruit * 7));
    for (let i = 0; i < count; i++) {
      const b = berries[i];
      px(p, C.berry, b[0] + wind, b[1], 2, 2);
      px(p, C.berryLight, b[0] + wind, b[1], 1, 1);
    }
  } else if (season === 0 && stage >= 2 && !bare) {
    px(p, C.cream, -5 + wind, -16, 2, 1);
    px(p, C.rose, 3 + wind, -14, 2, 2);
  }
}

function oakBranches(p: Pen, ancient: boolean, top: number, wind: number, snowy: boolean): void {
  const dark = ancient ? '#403346' : C.violet;
  const mid = ancient ? '#725345' : C.bark;
  const light = ancient ? '#b28b58' : C.barkLight;
  const trunkW = ancient ? 7 : 5;
  const trunkX = ancient ? -3 : -2;
  // A dead snag's trunk follows its descending broken top, never a ghost of
  // the original full-height trunk.
  const trunkTop = Math.max(top, ancient ? -32 : -25);
  px(p, dark, trunkX - 1, trunkTop, trunkW + 2, -trunkTop);
  px(p, mid, trunkX, trunkTop, trunkW, -trunkTop);
  px(p, light, trunkX + trunkW - 2, trunkTop + 2, 1, -trunkTop - 4);
  px(p, dark, ancient ? -10 : -6, -2, ancient ? 20 : 12, 2);
  px(p, mid, ancient ? -8 : -5, -3, ancient ? 7 : 5, 2);
  px(p, mid, ancient ? 3 : 2, -4, ancient ? 7 : 5, 3);
  if (top >= -16) return;
  // Stair-stepped limbs are deliberately built from blocks, not smoothed lines.
  const shift = Math.sign(wind);
  px(p, dark, -9 + shift, top + 12, 9, 3);
  px(p, dark, -12 + shift, top + 9, 4, 5);
  px(p, mid, -11 + shift, top + 8, 6, 2);
  px(p, dark, 1 + shift, top + 10, ancient ? 13 : 10, 3);
  px(p, mid, 5 + shift, top + 7, 3, 6);
  px(p, dark, (ancient ? 12 : 8) + shift, top + 5, 3, 6);
  px(p, mid, -2 + shift, top + 3, 3, Math.max(3, -top - 6));
  px(p, light, -1 + shift, top + 2, 1, Math.max(2, -top - 8));
  if (ancient) {
    px(p, dark, -16 + shift, top + 13, 7, 3);
    px(p, mid, -17 + shift, top + 9, 3, 6);
    px(p, dark, 13 + shift, top + 15, 7, 3);
    px(p, mid, 16 + shift, top + 10, 3, 6);
  }
  if (snowy) {
    px(p, C.snowShade, -12 + shift, top + 8, 7, 1);
    px(p, C.snow, 4 + shift, top + 6, ancient ? 12 : 7, 1);
  }
}

function drawOak(p: Pen, plant: Plant, stage: number, wind: number, env: SpriteEnvironment): void {
  const ancient = plant.variant === 7;
  const top = ancient ? -44 : -36;
  const season = seasonOf(env);
  const bare = season === 3 || plant.health < 0.24;
  oakBranches(p, ancient, top, wind, bare && season === 3);
  if (ancient) {
    px(p, C.ink, -1, -15, 3, 6);
    px(p, C.violetLight, 2, -15, 1, 5);
    px(p, C.barkLight, -2, -17, 1, 6);
  } else if (stage >= 2) {
    px(p, C.ink, 0, -11, 2, 3);
  }
  if (bare) return;
  const leaf = broadPalette(env, plant.health);
  const w = wind;
  if (ancient) {
    px(p, leaf.dark, -20 + w, -39, 40, 15);
    px(p, leaf.dark, -15 + w, -43, 28, 18);
    px(p, leaf.dark, -23 + w, -34, 46, 8);
    px(p, leaf.mid, -19 + w, -38, 13, 11);
    px(p, leaf.mid, -5 + w, -42, 16, 14);
    px(p, leaf.mid, 10 + w, -37, 11, 9);
    px(p, leaf.mid, -13 + w, -32, 25, 5);
    px(p, leaf.light, -12 + w, -42, 9, 3);
    px(p, leaf.light, 2 + w, -39, 8, 3);
    px(p, leaf.light, -20 + w, -33, 7, 2);
    px(p, C.gold, -15 + w, -37, 2, 2);
    px(p, C.warm, 6 + w, -43, 2, 2);
    px(p, C.gold, 16 + w, -32, 2, 2);
    px(p, C.gold, -4 + w, -29, 2, 2);
    if (season === 0) px(p, '#b7cf8a', -22 + w, -31, 3, 2);
  } else {
    px(p, leaf.dark, -14 + w, -32, 28, 12);
    px(p, leaf.dark, -10 + w, -36, 20, 16);
    px(p, leaf.dark, -16 + w, -28, 32, 6);
    px(p, leaf.mid, -12 + w, -31, 10, 9);
    px(p, leaf.mid, -3 + w, -35, 12, 12);
    px(p, leaf.mid, 7 + w, -30, 7, 7);
    px(p, leaf.light, -7 + w, -35, 7, 3);
    px(p, leaf.light, 4 + w, -32, 5, 2);
    if (stage < 2) px(p, C.violet, -3 + w, -25, 5, 3);
  }
  if (season === 2 && plant.fruit > 0.25) {
    px(p, C.gold, -9 + w, -24, 2, 2);
    px(p, C.bark, 8 + w, -25, 2, 3);
  }
}

function drawPine(p: Pen, plant: Plant, stage: number, wind: number, env: SpriteEnvironment): void {
  const leaf = pinePalette(env, plant.health);
  const winter = seasonOf(env) === 3;
  px(p, C.violet, -3, -2, 6, 2);
  px(p, C.bark, -1, -32, 3, 32);
  px(p, C.barkLight, 1, -29, 1, 26);
  const tiers = PINE_TIERS;
  const first = 0;
  for (let i = first; i < tiers.length; i++) {
    const tier = tiers[i];
    const y = tier[0];
    const half = tier[1] >> 1;
    const sway = Math.round(wind * (1 - i / tiers.length));
    px(p, leaf.dark, -half + sway, y, half * 2, 6);
    px(p, leaf.mid, -half + 2 + sway, y, Math.max(2, half * 2 - 4), 4);
    px(p, leaf.light, -half + 2 + sway, y, Math.max(2, half), 1);
    if (winter && i > 0) {
      px(p, C.snowShade, -half + sway, y + 4, half, 1);
      px(p, C.snow, -half + 2 + sway, y, Math.max(2, half), 1);
    }
  }
  px(p, leaf.light, wind, -40, 1, 3);
  if (stage >= 3 && plant.fruit > 0.45 && !winter) {
    px(p, C.barkLight, -5 + wind, -20, 2, 3);
    px(p, C.bark, 6 + wind, -13, 2, 3);
  }
}

function drawFern(p: Pen, plant: Plant, stage: number, wind: number, env: SpriteEnvironment): void {
  const season = seasonOf(env);
  const leaf = season === 3 ? WINTER_FERN : broadPalette(env, plant.health);
  px(p, leaf.dark, -5, -1, 10, 1);
  px(p, leaf.mid, 0, -10, 1, 10);
  const fronds = FERN_FRONDS;
  const count = stage === 0 ? 1 : stage === 1 ? 2 : 3;
  for (let i = 0; i < count; i++) {
    const f = fronds[i];
    const y = f[1];
    const len = f[2];
    const w = i === 2 ? wind : Math.sign(wind);
    px(p, leaf.dark, -len + w, y, len + 1, 1);
    px(p, leaf.dark, 0 + w, y - 1, len + 1, 1);
    px(p, leaf.mid, -len + w, y - 1, len, 1);
    px(p, leaf.mid, 1 + w, y - 2, len, 1);
    for (let n = 2; n <= len; n += 2) {
      px(p, leaf.light, -n + w, y - 2, 2, 1);
      px(p, leaf.mid, n + w, y, 2, 1);
    }
  }
  if (stage >= 2) {
    px(p, leaf.light, wind, -12, 2, 2);
    px(p, leaf.mid, 1 + wind, -11, 2, 1);
  }
  if (season === 3) px(p, C.snowShade, -5, -1, 8, 1);
}

function drawMushroom(p: Pen, plant: Plant, stage: number, wind: number, env: SpriteEnvironment): void {
  const variant = mod4(plant.variant + plant.id);
  const cap = variant === 0 ? '#b96855' : variant === 1 ? '#c38c55' : variant === 2 ? '#8b6578' : '#b97761';
  const capLight = variant === 2 ? '#c49aad' : '#e4ae79';
  const sway = Math.sign(wind);
  px(p, C.violet, -4, -1, 8, 1);
  px(p, C.cream, -1 + sway, -6, 3, 6);
  px(p, C.warm, 1 + sway, -5, 1, 4);
  px(p, C.violet, -5 + sway, -7, 10, 3);
  px(p, cap, -4 + sway, -8, 8, 4);
  px(p, cap, -2 + sway, -9, 5, 1);
  px(p, capLight, -3 + sway, -8, 5, 1);
  if (stage > 0) {
    px(p, C.cream, -2 + sway, -7, 1, 1);
    px(p, C.cream, 2 + sway, -6, 1, 1);
  }
  if (stage >= 3) {
    px(p, C.violet, 4, -3, 4, 2);
    px(p, cap, 4, -4, 4, 2);
    px(p, C.cream, 5, -3, 2, 3);
  }
  if (seasonOf(env) === 3) px(p, C.snow, -3 + sway, -9, 5, 1);
  else if (env.weather !== 'clear') px(p, C.water, 3 + sway, -8, 1, 1);
}

function drawDeadOak(p: Pen, plant: Plant, decay: number): void {
  const ancient = plant.variant === 7;
  const nominal = ancient ? 44 : 36;
  const top = -Math.max(7, Math.round(nominal * (1 - decay * 0.7)));
  oakBranches(p, ancient, top, 0, false);
  px(p, C.ink, ancient ? -1 : 0, Math.max(top + 3, -12), ancient ? 3 : 2, 4);
  // Broken, pale end grain makes a snag distinct from a dormant winter tree.
  px(p, C.deadLight, ancient ? -3 : -2, top, ancient ? 4 : 3, 1);
  px(p, C.violet, ancient ? 2 : 1, top + 1, 2, 2);
  if (decay > 0.45) {
    px(p, C.dead, ancient ? 5 : 3, -2, ancient ? 10 : 7, 2);
    px(p, C.deadLight, ancient ? 12 : 8, -3, 3, 1);
    px(p, C.violetLight, -5, -1, 3, 1);
  }
}

function drawDeadPine(p: Pen, decay: number): void {
  const top = -Math.max(7, Math.round(40 * (1 - decay * 0.7)));
  px(p, C.violet, -2, top, 4, -top);
  px(p, C.dead, -1, top, 2, -top);
  px(p, C.deadLight, -1, top, 2, 1);
  const branches = DEAD_PINE_BRANCHES;
  for (let i = 0; i < branches.length; i++) {
    if (decay > 0.65 + i * 0.07) continue;
    const y = Math.round(top * branches[i]);
    const length = 4 + i * 2;
    px(p, C.dead, -length, y - 2, length, 2);
    px(p, C.dead, 1, y - 4, length - 1, 2);
    px(p, C.deadLight, -length, y - 3, Math.max(2, length - 2), 1);
  }
  if (decay > 0.55) px(p, C.dead, 2, -1, 9, 1);
}

function drawDeadSmall(p: Pen, plant: Plant, decay: number): void {
  const top = -Math.max(2, Math.round(plantTop(plant) * (1 - decay * 0.66)));
  switch (plant.species) {
    case 'grass':
      px(p, C.violet, -5, -1, 10, 1);
      px(p, C.dead, -3, top, 1, -top);
      px(p, C.deadLight, 0, top + 1, 1, -top - 1);
      px(p, C.dead, 3, top + 2, 1, -top - 2);
      px(p, C.dead, -4, top + 1, 2, 1);
      break;
    case 'flower': {
      const sideTop = Math.max(top + 2, -4);
      px(p, C.dead, 0, top, 1, -top);
      px(p, C.deadLight, -2, Math.min(-1, top + 3), 2, 1);
      px(p, C.shade, -1, top - 1, 3, 2);
      px(p, C.dead, -4, sideTop, 1, -sideTop);
      break;
    }
    case 'berry':
      px(p, C.violet, -6, -1, 12, 1);
      px(p, C.dead, -1, top, 2, -top);
      px(p, C.dead, -7, top + 4, 7, 2);
      px(p, C.deadLight, 1, top + 2, 7, 1);
      px(p, C.dead, 6, top + 2, 1, -top - 4);
      if (decay > 0.55) px(p, C.dead, 3, -1, 8, 1);
      break;
    case 'fern':
      px(p, C.dead, 0, top, 1, -top);
      px(p, C.deadLight, -6, Math.min(-1, top + 3), 7, 1);
      px(p, C.dead, 1, Math.min(-1, top + 1), 7, 1);
      px(p, C.violet, -5, -1, 10, 1);
      break;
    case 'mushroom':
      px(p, C.violet, -5, -2, 10, 2);
      px(p, C.dead, -4, -3, 8, 2);
      if (decay < 0.6) px(p, C.deadLight, -2, -4, 5, 1);
      px(p, C.shade, 1, -1, 5, 1);
      break;
    case 'oak':
    case 'pine':
      break;
  }
}

export function drawPlant(
  ctx: CanvasRenderingContext2D,
  plant: Plant,
  x: number,
  y: number,
  z: number,
  env: SpriteEnvironment,
): void {
  ctx.save();
  try {
    ctx.imageSmoothingEnabled = false;
    const p = at(ctx, x, y, z, growthScale(plant), (plant.variant & 1) === 1);
    const stage = growthStage(plant);
    const wind = windFor(plant, env);
    if (!plant.alive) {
      const decay = decayFor(plant);
      if (plant.species === 'oak') drawDeadOak(p, plant, decay);
      else if (plant.species === 'pine') drawDeadPine(p, decay);
      else drawDeadSmall(p, plant, decay);
      return;
    }
    switch (plant.species) {
      case 'grass': drawGrass(p, plant, stage, wind, env); break;
      case 'flower': drawFlower(p, plant, stage, wind, env); break;
      case 'berry': drawBerry(p, plant, stage, wind, env); break;
      case 'oak': drawOak(p, plant, stage, wind, env); break;
      case 'pine': drawPine(p, plant, stage, wind, env); break;
      case 'fern': drawFern(p, plant, stage, wind, env); break;
      case 'mushroom': drawMushroom(p, plant, stage, wind, env); break;
    }
  } finally {
    ctx.restore();
  }
}

interface Pose {
  behavior: Animal['behavior'];
  frame: number;
  gait: number;
  bob: number;
  moving: boolean;
  resting: boolean;
  drinking: boolean;
  feeding: boolean;
  hunting: boolean;
  fleeing: boolean;
  courting: boolean;
  following: boolean;
  juvenile: boolean;
  adult: boolean;
}

function poseFor(animal: Animal, env: SpriteEnvironment): Pose {
  const frame = env.reducedMotion ? 0 : mod4(Math.floor(env.time * 8) + animal.id);
  const moving = Math.abs(animal.vx) + Math.abs(animal.vy) > 0.08 && animal.behavior !== 'rest';
  const resting = animal.behavior === 'rest' && !moving;
  const hunting = animal.behavior === 'hunt';
  const fleeing = animal.behavior === 'flee';
  const courting = animal.behavior === 'court';
  const bob = env.reducedMotion ? 0 : courting ? (frame < 2 ? -1 : 0) : moving ? (frame === 1 || frame === 2 ? -1 : 0) : 0;
  const maturity = clamp01(animal.age / ANIMAL_RULES[animal.species].matureAt);
  return {
    behavior: animal.behavior,
    frame,
    gait: moving ? GAIT[frame] * (fleeing || hunting ? 2 : 1) : 0,
    bob,
    moving,
    resting,
    drinking: animal.behavior === 'drink',
    feeding: animal.behavior === 'seekFood' && animal.action > 0 && !moving,
    hunting,
    fleeing,
    courting,
    following: animal.behavior === 'follow',
    juvenile: maturity < 1,
    adult: maturity >= 1,
  };
}

function animalScale(animal: Animal): number {
  const maturity = clamp01(animal.age / ANIMAL_RULES[animal.species].matureAt);
  return 0.6 + 0.4 * Math.sqrt(maturity);
}

function eye(p: Pen, x: number, y: number, closed: boolean, night = false): void {
  if (closed) px(p, C.violet, x, y + 1, 2, 1);
  else {
    px(p, C.eye, x, y, 1, 1);
    if (night) px(p, C.gold, x, y, 1, 1);
  }
}

function drinkRipple(p: Pen, x: number): void {
  px(p, C.water, x, 0, 4, 1);
  px(p, C.cream, x + 1, -1, 2, 1);
}

function courtMark(p: Pen, top: number): void {
  const y = top - 4;
  px(p, C.rose, -1, y, 1, 1);
  px(p, C.rose, 1, y, 1, 1);
  px(p, C.rose, -2, y + 1, 4, 1);
  px(p, C.warm, -1, y + 2, 2, 1);
  px(p, C.rose, 0, y + 3, 1, 1);
}

function drawRabbit(p: Pen, animal: Animal, pose: Pose): void {
  const pale = (animal.variant & 1) === 0;
  const dark = pale ? '#65566a' : '#4e5260';
  const fur = pale ? '#c7b89f' : '#92969a';
  const light = pale ? '#ead8b7' : '#c8c8ba';
  const rest = pose.resting;
  const low = pose.drinking || pose.feeding;
  const body = (rest ? -4 : pose.fleeing ? -4 : -5) + pose.bob;
  if (!rest) {
    px(p, dark, -3 - pose.gait, -2, 2, 2);
    px(p, dark, 2 + pose.gait, -2, 2, 2);
    if (pose.fleeing) {
      px(p, dark, -6, -1, 4, 1);
      px(p, dark, 3, -1, 4, 1);
    }
  } else {
    px(p, dark, -3, -1, 6, 1);
  }
  px(p, dark, -5, body - 1, 3, 3);
  px(p, light, -5, body - 1, 2, 2);
  px(p, dark, -4, body, 8, rest ? 3 : 3);
  px(p, fur, -3, body - 1, 6, 3);
  px(p, light, -2, body - 1, 4, 1);
  const hx = low ? 4 : 2;
  const hy = low ? -2 : rest ? body - 2 : body - 3;
  px(p, dark, hx, hy, 4, 3);
  px(p, fur, hx, hy - 1, 3, 3);
  px(p, light, hx + 2, hy + 1, 3, 2);
  px(p, C.rose, hx + 4, hy + 1, 1, 1);
  if (rest || low) {
    px(p, dark, hx - 3, hy - 1, 4, 1);
    px(p, fur, hx - 2, hy - 2, 4, 1);
  } else if (pose.fleeing) {
    px(p, dark, hx - 4, hy - 2, 5, 2);
    px(p, light, hx - 3, hy - 2, 3, 1);
  } else {
    const earLift = pose.following ? -1 : 0;
    px(p, dark, hx, hy - 5 + earLift, 2, 5 - earLift);
    px(p, fur, hx + 2, hy - 6, 2, 6);
    px(p, C.rose, hx + 2, hy - 5, 1, 3);
    px(p, light, hx, hy - 5 + earLift, 1, 2);
  }
  eye(p, hx + 2, hy, rest, false);
  if (pose.drinking) drinkRipple(p, 7);
  if (pose.courting) courtMark(p, -13);
}

function antlers(p: Pen, hx: number, hy: number, lowered: boolean): void {
  const color = C.warm;
  if (lowered) {
    px(p, C.bark, hx + 1, hy - 3, 1, 3);
    px(p, color, hx, hy - 4, 1, 2);
    px(p, C.bark, hx + 3, hy - 2, 1, 2);
    return;
  }
  px(p, C.bark, hx, hy - 5, 1, 5);
  px(p, C.bark, hx + 3, hy - 6, 1, 6);
  px(p, color, hx - 2, hy - 5, 3, 1);
  px(p, color, hx + 3, hy - 6, 3, 1);
  px(p, C.bark, hx - 2, hy - 7, 1, 3);
  px(p, C.bark, hx + 5, hy - 8, 1, 3);
  px(p, color, hx + 1, hy - 7, 1, 2);
}

function drawDeer(p: Pen, animal: Animal, pose: Pose): void {
  const dark = (animal.variant & 1) === 0 ? '#574454' : '#4b4651';
  const fur = (animal.variant & 1) === 0 ? '#ad784f' : '#987052';
  const light = '#d6a46b';
  const low = pose.drinking || pose.feeding;
  const body = (pose.resting ? -5 : -8) + pose.bob + (pose.fleeing ? 1 : 0);
  if (!pose.resting) {
    px(p, dark, -5 - pose.gait, body + 3, 2, -body - 3);
    px(p, dark, 2 + pose.gait, body + 3, 2, -body - 3);
    px(p, fur, -3 + pose.gait, body + 3, 1, -body - 4);
    px(p, fur, 4 - pose.gait, body + 3, 1, -body - 4);
    if (pose.fleeing) {
      px(p, dark, -8, -1, 5, 1);
      px(p, dark, 3, -1, 5, 1);
    }
  } else {
    px(p, dark, -5, -2, 10, 2);
    px(p, light, 1, -1, 5, 1);
  }
  px(p, dark, -7, body, 12, 4);
  px(p, fur, -6, body - 1, 10, 4);
  px(p, light, -4, body - 1, 7, 1);
  px(p, C.cream, -8, body, 2, 2);
  px(p, dark, -8, body + 1, 1, 3);
  // Fawn-like spots remain visible on adults as the species' field mark.
  px(p, C.cream, -3, body, 1, 1);
  px(p, C.warm, 0, body + 1, 1, 1);
  if (!pose.juvenile) px(p, C.cream, 2, body, 1, 1);
  let hx = 5;
  let hy = body - 6;
  if (low) {
    px(p, dark, 3, body - 1, 4, 7);
    px(p, fur, 4, body, 3, 6);
    hx = 6;
    hy = -3;
  } else if (pose.resting) {
    px(p, dark, 2, body - 4, 4, 5);
    px(p, fur, 3, body - 5, 3, 5);
    hy = body - 6;
  } else {
    const lift = pose.following || pose.courting ? -1 : 0;
    px(p, dark, 2, body - 7 + lift, 4, 8 - lift);
    px(p, fur, 3, body - 8 + lift, 3, 8 - lift);
    px(p, light, 5, body - 7 + lift, 1, 5);
    hy += lift;
  }
  px(p, dark, hx - 1, hy, 5, 3);
  px(p, fur, hx, hy - 1, 4, 3);
  px(p, C.cream, hx + 3, hy + 1, 3, 2);
  px(p, C.eye, hx + 5, hy + 1, 1, 1);
  px(p, fur, hx - 1, hy - 2, 2, 2);
  px(p, dark, hx + 2, hy - 2, 2, 2);
  eye(p, hx + 2, hy, pose.resting);
  if (animal.sex === 1 && pose.adult) antlers(p, hx, hy - 1, low);
  if (pose.drinking) drinkRipple(p, 9);
  if (pose.courting) courtMark(p, animal.sex === 1 && pose.adult ? -24 : -18);
}

function drawFox(p: Pen, animal: Animal, pose: Pose): void {
  const dark = '#51394a';
  const fur = (animal.variant & 1) === 0 ? '#c27145' : '#ad5d43';
  const light = '#e8a265';
  const low = pose.drinking || pose.feeding;
  const body = (pose.resting ? -4 : pose.hunting ? -4 : -6) + pose.bob;
  if (pose.resting) {
    px(p, dark, -7, -3, 12, 3);
    px(p, fur, -6, -4, 9, 3);
    px(p, C.cream, 1, -2, 5, 2);
  } else {
    px(p, dark, -4 - pose.gait, body + 2, 2, -body - 2);
    px(p, dark, 2 + pose.gait, body + 2, 2, -body - 2);
    px(p, fur, -2 + pose.gait, body + 2, 1, -body - 3);
    px(p, fur, 4 - pose.gait, body + 2, 1, -body - 3);
    px(p, dark, -6, body, 11, 3);
    px(p, fur, -5, body - 1, 9, 3);
    px(p, light, -3, body - 1, 6, 1);
    const tailY = pose.fleeing || pose.hunting ? body : body + 1;
    px(p, dark, -10, tailY, 6, 4);
    px(p, fur, -9, tailY - 1, 5, 4);
    px(p, C.cream, -11, tailY, 3, 3);
  }
  const hx = low ? 6 : pose.hunting ? 5 : 3;
  const hy = low ? -2 : body - 3;
  px(p, dark, hx - 1, hy, 5, 4);
  px(p, fur, hx, hy - 1, 4, 4);
  px(p, fur, hx, hy - 3, 2, 3);
  px(p, dark, hx + 2, hy - 3, 2, 3);
  px(p, C.cream, hx + 2, hy + 1, 4, 2);
  px(p, C.eye, hx + 5, hy + 1, 1, 1);
  eye(p, hx + 2, hy, pose.resting, true);
  if (pose.following) px(p, light, hx - 1, hy - 3, 1, 2);
  if (pose.drinking) drinkRipple(p, 9);
  if (pose.courting) courtMark(p, -13);
}

function drawWolf(p: Pen, animal: Animal, pose: Pose): void {
  const dark = (animal.variant & 1) === 0 ? '#3f3c4d' : '#48404a';
  const fur = (animal.variant & 1) === 0 ? '#7c8384' : '#887c72';
  const light = (animal.variant & 1) === 0 ? '#b5b9ae' : '#c0ae91';
  const low = pose.drinking || pose.feeding;
  const body = (pose.resting ? -5 : pose.hunting ? -5 : -8) + pose.bob;
  if (!pose.resting) {
    px(p, dark, -5 - pose.gait, body + 3, 2, -body - 3);
    px(p, dark, 2 + pose.gait, body + 3, 2, -body - 3);
    px(p, fur, -2 + pose.gait, body + 3, 1, -body - 4);
    px(p, fur, 4 - pose.gait, body + 3, 1, -body - 4);
    if (pose.fleeing) {
      px(p, dark, -8, -1, 5, 1);
      px(p, dark, 3, -1, 5, 1);
    }
  } else {
    px(p, dark, -5, -2, 10, 2);
    px(p, light, 0, -1, 5, 1);
  }
  px(p, dark, -7, body, 13, 4);
  px(p, fur, -6, body - 1, 11, 4);
  px(p, light, -3, body - 1, 7, 1);
  px(p, light, 2, body + 2, 4, 2);
  const tailY = pose.hunting || pose.fleeing ? body + 1 : body + 2;
  px(p, dark, -11, tailY, 5, 3);
  px(p, fur, -10, tailY - (pose.following ? 2 : 0), 5, 3);
  const hx = low ? 6 : pose.hunting ? 5 : 4;
  const hy = low ? -3 : body - 4;
  px(p, dark, hx - 2, hy, 6, 5);
  px(p, fur, hx - 1, hy - 1, 5, 5);
  px(p, fur, hx - 1, hy - 3, 2, 3);
  px(p, dark, hx + 2, hy - 3, 2, 3);
  px(p, light, hx + 2, hy + 2, 4, 2);
  px(p, C.eye, hx + 5, hy + 2, 1, 1);
  eye(p, hx + 2, hy, pose.resting, true);
  if (pose.hunting) px(p, C.cream, hx + 4, hy + 2, 1, 1);
  if (pose.drinking) drinkRipple(p, 10);
  if (pose.courting) courtMark(p, -17);
}

function drawBee(p: Pen, animal: Animal, pose: Pose): void {
  const lift = pose.resting || pose.drinking ? 0 : 3 + (pose.frame === 1 || pose.frame === 2 ? 1 : 0);
  const body = -3 - lift + pose.bob;
  const wingY = body - 3;
  const wing = pose.resting ? '#8f8790' : pose.frame % 2 === 0 ? '#d7d9c9' : '#aaa9bd';
  if (!pose.resting) {
    px(p, C.violetLight, -3, wingY, 4, 2);
    px(p, wing, -2, wingY - 1, 4, 2);
    px(p, C.violetLight, 1, wingY + (pose.frame % 2), 4, 2);
    px(p, wing, 2, wingY + (pose.frame % 2), 3, 1);
  } else {
    px(p, wing, -2, body - 1, 5, 1);
  }
  px(p, C.ink, -4, body, 8, 3);
  px(p, C.gold, -3, body - 1, 6, 3);
  px(p, C.ink, -1, body - 1, 1, 3);
  px(p, C.ink, 2, body - 1, 1, 3);
  px(p, C.warm, -3, body - 1, 2, 1);
  px(p, C.bark, 3, body, 2, 2);
  eye(p, 4, body, pose.resting);
  px(p, C.violet, -5, body + 1, 1, 1);
  if (!pose.resting) {
    px(p, C.violet, -2, body + 2, 1, 2);
    px(p, C.violet, 2, body + 2, 1, 2);
  }
  if (pose.hunting || pose.feeding || pose.drinking) px(p, C.rose, 5, body + 1, 3, 1);
  if (pose.courting) {
    px(p, C.gold, -5, body - 4, 2, 2);
    px(p, C.warm, 5, body - 5, 1, 1);
  }
}

function drawFrog(p: Pen, animal: Animal, pose: Pose, env: SpriteEnvironment): void {
  const teal = (animal.variant & 1) === 1;
  const dark = teal ? '#34494d' : '#3d4b43';
  const skin = teal ? '#5e9481' : '#71975d';
  const light = teal ? '#9fbea0' : '#b4c681';
  const hop = pose.moving && !env.reducedMotion && (pose.frame === 1 || pose.frame === 2) ? -2 : 0;
  const body = (pose.resting ? -3 : -4) + hop + pose.bob;
  const stretched = hop < 0 || pose.fleeing;
  px(p, dark, stretched ? -8 : -6, stretched ? -1 : -2, stretched ? 6 : 4, 2);
  px(p, skin, -5, body + 1, 4, 3);
  px(p, dark, 3, -2, stretched ? 5 : 3, 2);
  px(p, dark, -5, body, 10, 4);
  px(p, skin, -4, body - 1, 8, 4);
  px(p, light, -2, body - 1, 5, 1);
  const hx = pose.drinking ? 4 : 2;
  const hy = pose.drinking ? -2 : body - 3;
  px(p, dark, hx - 2, hy, 6, 4);
  px(p, skin, hx - 1, hy - 1, 5, 4);
  px(p, skin, hx, hy - 2, 2, 2);
  px(p, skin, hx + 3, hy - 2, 2, 2);
  if (!pose.resting) {
    px(p, C.cream, hx, hy - 2, 1, 1);
    px(p, C.cream, hx + 3, hy - 2, 1, 1);
  }
  eye(p, hx + 1, hy - 2, pose.resting);
  eye(p, hx + 4, hy - 2, pose.resting);
  if (pose.courting || pose.drinking) {
    px(p, C.warm, hx + 2, hy + 2, 3, pose.courting && pose.frame < 2 ? 3 : 2);
  }
  if (pose.hunting) {
    px(p, C.rose, hx + 5, hy + 1, 5, 1);
    px(p, C.warm, hx + 9, hy, 2, 2);
  }
  if (env.weather !== 'clear' && !pose.resting) px(p, C.water, -3, body - 2, 1, 1);
  if (pose.courting) courtMark(p, -11 + hop);
}

function drawDeadAnimal(p: Pen, animal: Animal): void {
  const decay = clamp01(Math.max(0, animal.deadFor) / 2.2);
  const dark = decay > 0.55 ? C.violet : '#514451';
  const mid = decay > 0.55 ? C.shade : C.deadLight;
  const flat = decay > 0.72;
  switch (animal.species) {
    case 'rabbit':
      px(p, dark, -5, flat ? -2 : -3, 9, flat ? 2 : 3);
      px(p, mid, 2, -3, 4, 2);
      px(p, dark, 4, -1, 5, 1);
      px(p, mid, -6, -2, 2, 2);
      break;
    case 'deer':
      px(p, dark, -7, flat ? -2 : -4, 12, flat ? 2 : 4);
      px(p, mid, 3, -3, 6, 2);
      px(p, dark, -6, -1, 14, 1);
      if (animal.sex === 1 && !flat) {
        px(p, C.deadLight, 4, -6, 1, 3);
        px(p, C.deadLight, 3, -6, 4, 1);
      }
      if (!flat) px(p, C.warm, -3, -4, 1, 1);
      break;
    case 'fox':
      px(p, dark, -6, flat ? -2 : -3, 12, flat ? 2 : 3);
      px(p, mid, -11, -2, 6, 2);
      px(p, C.deadLight, -12, -2, 2, 2);
      px(p, dark, 5, -2, 4, 1);
      break;
    case 'wolf':
      px(p, dark, -7, flat ? -2 : -4, 13, flat ? 2 : 4);
      px(p, mid, 3, -4, 6, 3);
      px(p, dark, -11, -2, 5, 2);
      px(p, C.deadLight, 7, -2, 4, 1);
      break;
    case 'bee':
      px(p, dark, -4, -2, 8, 2);
      px(p, mid, -2, -2, 1, 2);
      px(p, mid, 2, -2, 1, 2);
      if (!flat) px(p, C.violetLight, -3, -4, 6, 2);
      break;
    case 'frog':
      px(p, dark, -5, flat ? -2 : -3, 10, flat ? 2 : 3);
      px(p, mid, 1, -3, 5, 2);
      px(p, dark, -8, -1, 5, 1);
      px(p, dark, 5, -1, 5, 1);
      break;
  }
  if (decay > 0.82) px(p, C.violet, -2, 0, 5, 1);
}

export function drawAnimal(
  ctx: CanvasRenderingContext2D,
  animal: Animal,
  x: number,
  y: number,
  z: number,
  env: SpriteEnvironment,
): void {
  ctx.save();
  try {
    ctx.imageSmoothingEnabled = false;
    const p = at(ctx, x, y, z, animalScale(animal), animal.vx < 0);
    if (!animal.alive) {
      drawDeadAnimal(p, animal);
      return;
    }
    const pose = poseFor(animal, env);
    switch (animal.species) {
      case 'rabbit': drawRabbit(p, animal, pose); break;
      case 'deer': drawDeer(p, animal, pose); break;
      case 'fox': drawFox(p, animal, pose); break;
      case 'wolf': drawWolf(p, animal, pose); break;
      case 'bee': drawBee(p, animal, pose); break;
      case 'frog': drawFrog(p, animal, pose, env); break;
    }
  } finally {
    ctx.restore();
  }
}
