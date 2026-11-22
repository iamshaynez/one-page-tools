import { ANIMAL_RULES, PLANT_RULES, WORLD_H, WORLD_W, clamp } from './forest-god-content';
import type { Power } from './forest-god-content';
import { BIOME, environmentAt, findEntity, hash2, isLand, isWater, stepWorld, tileAt } from './forest-god-core';
import type { ActionResult, Animal, ForestEvent, Plant, World } from './forest-god-core';
import { drawAnimal, drawMemorial, drawPlant, drawStructure, plantPixelHeight } from './forest-god-sprites';
import type { SpriteEnvironment } from './forest-god-sprites';
import { createWeatherVisual, interpolatePosition, lerp, updateWeatherVisual } from './forest-god-motion';

interface SceneOptions {
  onTick?(world: World): void;
  onSelect?(id: number | null): void;
  onPower?(x: number, y: number): ActionResult;
  onMessage?(message: string, ok?: boolean): void;
  onEvent?(event: ForestEvent): void;
  onFollow?(id: number | null): void;
  onError?(error: unknown): void;
}

interface MotionSample { fromX: number; fromY: number; toX: number; toY: number }
interface Reaction { kind: 'startle' | 'bless' | 'bond'; until: number }

interface Effect {
  kind: 'bless' | 'lightning' | 'seed' | 'bond';
  x: number;
  y: number;
  life: number;
  maxLife: number;
}

const TERRAIN_PX = 6;
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const GROUND = [
  ['#779064', '#6f895d', '#9c9a72', '#72a5a4', '#89877a'],
  ['#7f925d', '#738654', '#a99b6b', '#69a3a3', '#8b8574'],
  ['#998555', '#7d7650', '#ae9166', '#668f99', '#8a7b70'],
  ['#a7afa0', '#8f9e91', '#b5b5a3', '#637f91', '#8e9290'],
];
const VOID_DAY = '#dedfd2';
const VOID_NIGHT = '#171b27';

function mixColor(a: string, b: string, t: number): string {
  const pa = [1, 3, 5].map(i => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map(i => parseInt(b.slice(i, i + 2), 16));
  return `rgb(${pa.map((v, i) => Math.round(lerp(v, pb[i], clamp(t)))).join(',')})`;
}

export function createForestScene(canvas: HTMLCanvasElement, initialWorld: World, options: SceneOptions = {}) {
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('这片森林需要 Canvas 2D 支持。');
  const ctx: CanvasRenderingContext2D = context;
  let world = initialWorld;
  let width = 1, height = 1;
  let camera = { x: WORLD_W / 2, y: WORLD_H / 2, zoom: 1 };
  let cameraGoal = { ...camera };
  let followId: number | null = null;
  let shake = 0, shakeX = 0, shakeY = 0;
  const weatherVisual = createWeatherVisual();
  const motionSamples = new Map<number, MotionSample>();
  const reactions = new Map<number, Reaction>();
  let terrainSnow = 0;
  let terrainDirty = true;
  let fit = 4;
  let power: Power = 'inspect';
  let speed = 1;
  let paused = false;
  let disposed = false;
  let raf = 0;
  let watchdog = 0;
  let lastRawDt = 0;
  let frames = 0;
  let usedFallback = false;
  let fallbackStreak = 0;
  let motionWorker: Worker | null = null;
  let motionWorkerUrl = '';
  let lastTime = 0;
  let accumulator = 0;
  let lastHud = 0;
  let lastTerrainAt = -10;
  let terrainSeason = -1;
  let selectedId: number | null = null;
  let hover: { x: number; y: number } | null = null;
  let visualTime = 0;
  let flash = 0;
  let lastEventId = world.events[0]?.id ?? 0;
  let previousFires = 0;
  let effects: Effect[] = [];
  let userMovedCamera = false;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const terrainCanvas = document.createElement('canvas');
  terrainCanvas.width = WORLD_W * TERRAIN_PX;
  terrainCanvas.height = WORLD_H * TERRAIN_PX;
  const terrainCtx = terrainCanvas.getContext('2d')!;
  terrainCtx.imageSmoothingEnabled = false;
  const pointers = new Map<number, { x: number; y: number }>();
  let drag: { id: number; x: number; y: number; startX: number; startY: number; moved: boolean } | null = null;
  let pinch: { distance: number; zoom: number } | null = null;

  const scale = () => fit * camera.zoom;
  const sx = (x: number) => Math.round((x - camera.x) * scale() + width / 2 + shakeX);
  const sy = (y: number) => Math.round((y - camera.y) * scale() + height / 2 + shakeY);
  const spriteEnv = (): SpriteEnvironment => {
    const env = environmentAt(world.time);
    return {
      time: visualTime, daylight: env.daylight, seasonIndex: env.seasonIndex, weather: world.weather.kind, reducedMotion,
      paused, rainIntensity: weatherVisual.rain, snowCover: weatherVisual.snow, windStrength: 0.7 + weatherVisual.gust * 1.8,
    };
  };

  function renderPosition(entity: Plant | Animal): { x: number; y: number } {
    const sample = motionSamples.get(entity.id);
    if (!sample || paused) return entity;
    return interpolatePosition({ x: sample.fromX, y: sample.fromY }, { x: sample.toX, y: sample.toY }, accumulator);
  }

  function resize(): void {
    const rect = canvas.getBoundingClientRect();
    const pixelSize = rect.width >= 900 ? 2 : 1;
    width = Math.max(1, Math.floor(rect.width / pixelSize));
    height = Math.max(1, Math.floor(rect.height / pixelSize));
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    ctx.imageSmoothingEnabled = false;
    fit = Math.min(width / (WORLD_W + 20), height / (WORLD_H + 20));
    if (!userMovedCamera) {
      camera.zoom = rect.width < 760 ? 1.5 : 1;
      cameraGoal = { ...camera };
    }
  }

  function terrainColor(biome: number, x: number, y: number, wet: number, season: number): string {
    if (biome === BIOME.WATER) {
      const water = ['#5e989b', '#609a98', '#5c8e96', '#607e91'][season];
      return hash2(world.seed + 99, x, y) > 0.62 ? '#77aaab' : water;
    }
    const baseIndex = biome === BIOME.FOREST ? 1 : biome === BIOME.BANK ? 2 : biome === BIOME.ROCK ? 4 : 0;
    const base = GROUND[season][baseIndex];
    const ground = wet > 0.68 && biome !== BIOME.BANK && biome !== BIOME.ROCK ? season === 3 ? '#929f91' : '#5f7d5c' : base;
    const snowed = mixColor(ground, '#d7ded4', weatherVisual.snow * 0.84);
    const trail = clamp(world.terrain.trail[y * WORLD_W + x] / 170);
    return mixColor(snowed, '#b7a37b', trail * 0.76);
  }

  function rebuildTerrain(): void {
    const env = environmentAt(world.time);
    terrainCtx.clearRect(0, 0, terrainCanvas.width, terrainCanvas.height);
    for (let y = 0; y < WORLD_H; y++) for (let x = 0; x < WORLD_W; x++) {
      const i = y * WORLD_W + x;
      const biome = world.terrain.biome[i];
      if (biome === BIOME.VOID) continue;
      const wet = world.terrain.moisture[i];
      const px = x * TERRAIN_PX, py = y * TERRAIN_PX;
      terrainCtx.fillStyle = terrainColor(biome, x, y, wet, env.seasonIndex);
      terrainCtx.fillRect(px, py, TERRAIN_PX, TERRAIN_PX);
      const h = hash2(world.seed, x, y);
      const lightEdge = x === 0 || world.terrain.biome[i - 1] === BIOME.VOID || y === 0 || world.terrain.biome[i - WORLD_W] === BIOME.VOID;
      if (lightEdge) {
        terrainCtx.fillStyle = env.seasonIndex === 3 ? '#d4d7c6' : '#c1bd8b';
        terrainCtx.fillRect(px, py, TERRAIN_PX, 1);
      }
      const darkEdge = x === WORLD_W - 1 || world.terrain.biome[i + 1] === BIOME.VOID || y === WORLD_H - 1 || world.terrain.biome[i + WORLD_W] === BIOME.VOID;
      if (darkEdge) {
        terrainCtx.fillStyle = '#49475a';
        terrainCtx.fillRect(px, py + TERRAIN_PX - 2, TERRAIN_PX, 2);
      }
      if (biome === BIOME.WATER) {
        if (h > 0.42) {
          terrainCtx.fillStyle = '#91b8b2';
          terrainCtx.fillRect(px + Math.floor(h * 3), py + 2, 2, 1);
        }
      } else if (biome !== BIOME.ROCK) {
        const bayer = BAYER[(x & 3) + (y & 3) * 4];
        if (bayer / 16 < wet * 0.42) {
          terrainCtx.fillStyle = env.seasonIndex === 3 ? '#7f928a' : '#4f7058';
          terrainCtx.fillRect(px + (bayer & 3), py + (bayer >> 2), 1, 1);
        }
        if (h > 0.76) {
          terrainCtx.fillStyle = env.seasonIndex === 2 ? '#d0a360' : env.seasonIndex === 3 ? '#d5d8c8' : '#a9ad76';
          terrainCtx.fillRect(px + 1 + Math.floor(h * 3), py + 1 + Math.floor(h * 2), 1, 1);
        }
        if (h < 0.1) {
          terrainCtx.fillStyle = '#4b6653';
          terrainCtx.fillRect(px + 2, py + 4, 1, 2);
          terrainCtx.fillRect(px + 3, py + 3, 1, 1);
        }
      } else {
        terrainCtx.fillStyle = '#a5a18f';
        terrainCtx.fillRect(px + 1, py + 1, 2, 1);
        terrainCtx.fillStyle = '#5c5b64';
        terrainCtx.fillRect(px + 3, py + 3, 2, 2);
      }
    }
    lastTerrainAt = world.time;
    terrainSeason = env.seasonIndex;
    terrainSnow = weatherVisual.snow;
    terrainDirty = false;
  }

  function drawBackground(): void {
    const env = environmentAt(world.time);
    const nightAmount = clamp((0.42 - env.daylight) / 0.42);
    ctx.fillStyle = mixColor(VOID_DAY, VOID_NIGHT, nightAmount);
    ctx.fillRect(0, 0, width, height);
    const twilight = clamp(1 - Math.abs(env.daylight - 0.28) * 4) * (1 - nightAmount * 0.45);
    if (twilight > 0.02) {
      ctx.fillStyle = '#d9a77d'; ctx.globalAlpha = twilight * 0.16; ctx.fillRect(0, 0, width, height); ctx.globalAlpha = 1;
    }
    if (nightAmount > 0.48) {
      ctx.fillStyle = '#9aa7b4';
      for (let i = 0; i < 70; i++) {
        const x = Math.floor(hash2(world.seed + 2000, i, 1) * width);
        const y = Math.floor(hash2(world.seed + 2000, i, 2) * height);
        const blink = Math.floor(visualTime * 2 + i) % 7 === 0;
        ctx.globalAlpha = blink ? 0.9 : 0.45;
        ctx.fillRect(x, y, 1, 1);
      }
      ctx.globalAlpha = 1;
    }
    const angle = (env.day - 0.25) * Math.PI * 2;
    const cx = width * 0.5 - Math.cos(angle) * width * 0.38;
    const cy = height * 0.58 - Math.sin(angle) * height * 0.52;
    ctx.fillStyle = env.daylight > 0.05 ? '#f1ce80' : '#d7d8c8';
    const size = env.daylight > 0.05 ? 8 : 6;
    ctx.fillRect(Math.round(cx - size / 2), Math.round(cy - size / 2), size, size);
    ctx.fillStyle = env.daylight > 0.05 ? '#f7dfa4' : '#eef0df';
    ctx.fillRect(Math.round(cx - size / 2), Math.round(cy - size / 2), size - 2, 2);
    if (world.rainbow > 0 && env.daylight > 0.15) {
      const colors = ['#c77a78', '#d6b878', '#8ead8b', '#819db2'];
      ctx.globalAlpha = world.rainbow * 0.48;
      for (let band = 0; band < colors.length; band++) {
        ctx.fillStyle = colors[band];
        const radius = 56 + band * 2;
        for (let n = 0; n <= 40; n++) {
          const a = Math.PI + n / 40 * Math.PI;
          ctx.fillRect(Math.round(width * 0.78 + Math.cos(a) * radius), Math.round(height * 0.22 + Math.sin(a) * radius * 0.55), 2, 2);
        }
      }
      ctx.globalAlpha = 1;
    }
    if (weatherVisual.aurora > 0.01 && nightAmount > 0.3) {
      const colors = ['#79c4a5', '#809fc4', '#a28bb8'];
      for (let band = 0; band < 3; band++) {
        ctx.fillStyle = colors[band]; ctx.globalAlpha = weatherVisual.aurora * nightAmount * (0.22 - band * 0.04);
        for (let x = -8; x < width + 8; x += 4) {
          const y = height * (0.1 + band * 0.035) + Math.sin(x * 0.035 + visualTime * 0.32 + band) * 10;
          ctx.fillRect(x, Math.round(y), 5, 3 + band);
        }
      }
      ctx.globalAlpha = 1;
    }
  }

  function drawWater(): void {
    const frame = Math.floor(visualTime * (reducedMotion ? 1 : 5));
    const z = scale();
    const minX = Math.max(0, Math.floor(camera.x - width / z / 2) - 2), maxX = Math.min(WORLD_W - 1, Math.ceil(camera.x + width / z / 2) + 2);
    const minY = Math.max(0, Math.floor(camera.y - height / z / 2) - 2), maxY = Math.min(WORLD_H - 1, Math.ceil(camera.y + height / z / 2) + 2);
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const index = y * WORLD_W + x;
      const biome = world.terrain.biome[index];
      const flooded = biome !== BIOME.WATER && world.terrain.water[index] > 0.28;
      if (biome !== BIOME.WATER && !flooded) {
        if (biome === BIOME.BANK && weatherVisual.rain > 0.25 && world.terrain.moisture[y * WORLD_W + x] > 0.65) {
          const nearRiver = [world.terrain.biome[y * WORLD_W + x - 1], world.terrain.biome[y * WORLD_W + x + 1], world.terrain.biome[(y - 1) * WORLD_W + x], world.terrain.biome[(y + 1) * WORLD_W + x]].includes(BIOME.WATER);
          if (nearRiver) {
            ctx.fillStyle = '#79a7a4'; ctx.globalAlpha = weatherVisual.rain * 0.42;
            ctx.fillRect(sx(x), sy(y + 0.55), Math.max(2, Math.round(z)), Math.max(1, Math.round(z * 0.35)));
          }
        }
        ctx.globalAlpha = 1;
        continue;
      }
      if (flooded || world.terrain.water[index] > 0.8) {
        ctx.fillStyle = flooded ? '#6e9e9c' : '#517f89';
        ctx.globalAlpha = flooded ? clamp(world.terrain.water[index] * 0.72) : 0.28;
        ctx.fillRect(sx(x), sy(y), Math.max(2, Math.ceil(z)), Math.max(2, Math.ceil(z)));
      }
      const h = hash2(world.seed + 811, x, y);
      if ((frame + Math.floor(h * 10)) % 5 > 1) { ctx.globalAlpha = 1; continue; }
      const px = sx(x + h), py = sy(y + 0.25 + h * 0.5);
      ctx.fillStyle = '#b4d0c1';
      ctx.globalAlpha = 0.55;
      ctx.fillRect(px, py, Math.max(1, Math.floor(z * 0.5)), 1);
      if (h > 0.72) {
        ctx.fillStyle = '#3e777f';
        ctx.fillRect(px + 2, py + 2, Math.max(1, Math.floor(z * 0.4)), 1);
      }
    }
    ctx.globalAlpha = 1;
    // 鱼影：纯环境生物，不消耗可交互动物配额。
    ctx.fillStyle = '#385f6c';
    ctx.globalAlpha = 0.45;
    for (let n = 0; n < 9; n++) {
      const wx = (n * 17 + visualTime * (0.3 + n * 0.01)) % WORLD_W;
      const riverY = 40 + Math.sin(wx * 0.085 + world.seed * 0.001) * 6 + Math.sin(wx * 0.027) * 4;
      const wy = riverY + Math.sin(visualTime + n) * 0.7;
      if (tileAt(world, wx, wy) >= 0 && isWater(world, wx, wy)) {
        const px = sx(wx), py = sy(wy);
        ctx.fillRect(px, py, Math.max(2, Math.floor(z * 0.55)), 1);
        ctx.fillRect(px - 1, py - 1, 1, 3);
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawStructures(): void {
    for (const structure of world.structures) {
      const x = sx(structure.x), y = sy(structure.y);
      if (x < -30 || y < -30 || x > width + 30 || y > height + 30) continue;
      drawStructure(ctx, structure, x, y, scale(), spriteEnv());
    }
  }

  function drawCloudShadows(): void {
    if (reducedMotion) return;
    ctx.fillStyle = '#34354c';
    ctx.globalAlpha = 0.025 + weatherVisual.cloud * 0.14;
    for (let n = 0; n < 5; n++) {
      const wx = ((visualTime * (0.5 + n * 0.06 + weatherVisual.gust * 0.9) + n * 31) % 160) - 20;
      const wy = 12 + n * 15;
      const x = sx(wx), y = sy(wy), z = scale();
      ctx.fillRect(x, y, Math.round(z * 15), Math.round(z * 4));
      ctx.fillRect(x + Math.round(z * 4), y - Math.round(z * 3), Math.round(z * 8), Math.round(z * 3));
    }
    ctx.globalAlpha = 1;
  }

  function drawShadow(x: number, y: number, radius: number, long = 0): void {
    ctx.fillStyle = '#373247';
    ctx.globalAlpha = 0.18 + (1 - environmentAt(world.time).daylight) * 0.08;
    const rows = Math.max(1, Math.round(radius * 0.45));
    for (let row = -rows; row <= rows; row++) {
      const half = Math.round(radius * (1 - Math.abs(row) / (rows + 1)));
      ctx.fillRect(Math.round(x + long - half), Math.round(y + row), half * 2, 1);
    }
    ctx.globalAlpha = 1;
  }

  function drawEntitySymbol(entity: Plant | Animal, x: number, y: number): void {
    if (!('behavior' in entity) || !entity.alive || scale() < 3) return;
    const behavior = entity.behavior;
    if (behavior === 'wander' || behavior === 'follow') return;
    const px = Math.round(x), py = Math.round(y - 9);
    if (behavior === 'rest' || behavior === 'shelter') {
      ctx.fillStyle = '#e6dfc4';
      ctx.fillRect(px + 5, py - 4, 3, 1); ctx.fillRect(px + 7, py - 3, 1, 1); ctx.fillRect(px + 5, py - 2, 3, 1);
    } else if (behavior === 'flee' || behavior === 'hunt' || behavior === 'alert') {
      ctx.fillStyle = behavior === 'hunt' ? '#d98778' : '#f2d395';
      ctx.fillRect(px, py - 5, 1, 4); ctx.fillRect(px, py, 1, 1);
    } else if (behavior === 'play') {
      ctx.fillStyle = '#d7e6a2';
      ctx.fillRect(px - 2, py - 3, 1, 1); ctx.fillRect(px + 2, py - 5, 1, 1); ctx.fillRect(px + 4, py - 2, 1, 1);
    } else if (behavior === 'dig' || behavior === 'fell' || behavior === 'build') {
      ctx.fillStyle = '#dec181';
      ctx.fillRect(px - 2, py - 4, 4, 2); ctx.fillRect(px + 1, py - 2, 1, 3);
      ctx.fillRect(px - 3, py, 1, 1);
    } else if (behavior === 'court') {
      ctx.fillStyle = '#e9a0a8';
      ctx.fillRect(px - 1, py - 4, 1, 2); ctx.fillRect(px + 1, py - 4, 1, 2); ctx.fillRect(px, py - 3, 1, 2);
    }
  }

  function drawEntities(): void {
    const env = spriteEnv();
    const z = scale();
    const entities: (Plant | Animal)[] = [...world.plants, ...world.animals];
    entities.sort((a, b) => a.y - b.y || a.id - b.id);
    for (const memorial of world.memorials) {
      const x = sx(memorial.x), y = sy(memorial.y);
      if (x >= -20 && x <= width + 20 && y >= -20 && y <= height + 20) drawMemorial(ctx, memorial, x, y, z, env);
    }
    // 所有地面阴影先画，避免后出现的生命踩进前者的阴影。
    for (const entity of entities) {
      if (!entity.alive && entity.deadFor > 1) continue;
      const position = renderPosition(entity);
      const x = sx(position.x), y = sy(position.y);
      if (x < -60 || y < -80 || x > width + 60 || y > height + 50) continue;
      if ('growth' in entity && (entity.species === 'oak' || entity.species === 'pine')) {
        const heightPx = plantPixelHeight(entity, z);
        drawShadow(x, y + 2, Math.max(2, heightPx * 0.28), Math.round(heightPx * 0.34));
      } else if ('behavior' in entity && entity.species !== 'bee') drawShadow(x, y + 1, Math.max(1, z * 0.45));
    }
    for (const animal of world.animals) {
      const relevant = ['hunt', 'flee', 'seekFood', 'court', 'alert', 'fell', 'build', 'dig'].includes(animal.behavior);
      if ((!animal.bond && animal.id !== selectedId) || !relevant || (animal.targetId === null && animal.structureId === null)) continue;
      const target = animal.targetId !== null ? findEntity(world, animal.targetId) : world.structures.find(s => s.id === animal.structureId);
      if (!target) continue;
      const from = renderPosition(animal), to = 'kind' in target ? target : renderPosition(target);
      ctx.fillStyle = animal.behavior === 'hunt' ? '#d77b70' : animal.behavior === 'court' ? '#e5a3ad' : '#e4ce88';
      ctx.globalAlpha = 0.55;
      for (let n = 1; n < 12; n += 2) {
        const t = n / 12;
        ctx.fillRect(Math.round(lerp(sx(from.x), sx(to.x), t)), Math.round(lerp(sy(from.y), sy(to.y), t)), 1, 1);
      }
    }
    ctx.globalAlpha = 1;
    for (const entity of entities) {
      const position = renderPosition(entity);
      const x = sx(position.x), y = sy(position.y);
      if (x < -70 || y < -100 || x > width + 70 || y > height + 50) continue;
      if (entity.id === selectedId) drawRune(position.x, position.y, 'behavior' in entity ? 1.4 : 'growth' in entity && (entity.species === 'oak' || entity.species === 'pine') ? 3 : 1.2, '#f2d386');
      if ('growth' in entity) drawPlant(ctx, entity, x, y, z, env);
      else {
        const reaction = reactions.get(entity.id);
        drawAnimal(ctx, entity, x, y, z, env, reaction && reaction.until > visualTime ? reaction.kind : null);
        drawEntitySymbol(entity, x, y - z);
      }
    }
  }

  function drawFire(): void {
    const frame = Math.floor(visualTime * (reducedMotion ? 2 : 9));
    const z = scale();
    let count = 0;
    for (let y = 0; y < WORLD_H; y++) for (let x = 0; x < WORLD_W; x++) {
      const fire = world.terrain.fire[y * WORLD_W + x];
      if (fire < 0.05) continue;
      count++;
      const px = sx(x + 0.5), py = sy(y + 0.8);
      if (px < -20 || py < -20 || px > width + 20 || py > height + 20) continue;
      const h = Math.max(2, Math.round(z * (0.45 + fire * 0.5)));
      ctx.globalAlpha = clamp(fire + 0.2);
      ctx.fillStyle = '#8f3f45'; ctx.fillRect(px - Math.round(z * 0.4), py - 2, Math.round(z * 0.8), 3);
      ctx.fillStyle = '#e1714f'; ctx.fillRect(px - 1, py - h, 3, h);
      ctx.fillStyle = '#f4c66f'; ctx.fillRect(px + ((frame + x) % 3) - 1, py - h + 1, 2, Math.max(1, h - 2));
      if ((x + y + frame) % 4 === 0) {
        ctx.fillStyle = '#595362'; ctx.globalAlpha = 0.28;
        ctx.fillRect(px + (frame % 5), py - h - 4 - (frame % 8), 3, 3);
      }
    }
    ctx.globalAlpha = 1;
    if (count > previousFires && previousFires > 0) flash = Math.max(flash, 0.16);
    previousFires = count;
  }

  function drawAmbient(): void {
    const env = environmentAt(world.time);
    const z = scale();
    const night = 1 - env.daylight;
    if (night > 0.35) {
      for (let n = 0; n < (reducedMotion ? 24 : 72); n++) {
        const wx = 6 + hash2(world.seed + 333, n, 1) * 108 + Math.sin(visualTime * 0.7 + n) * 0.8;
        const wy = 5 + hash2(world.seed + 333, n, 2) * 70 + Math.cos(visualTime * 0.5 + n) * 0.6;
        if (tileAt(world, wx, wy) < 0 || world.terrain.biome[tileAt(world, wx, wy)] === BIOME.VOID) continue;
        const pulse = Math.sin(visualTime * 3 + n * 2) > 0.05;
        ctx.globalAlpha = night * (pulse ? 0.85 : 0.22);
        ctx.fillStyle = pulse ? '#f0d977' : '#a8bd75';
        const x = sx(wx), y = sy(wy);
        ctx.fillRect(x, y, pulse ? 2 : 1, pulse ? 2 : 1);
      }
      ctx.globalAlpha = 1;
    } else if (!reducedMotion) {
      ctx.fillStyle = '#efe0a8';
      ctx.globalAlpha = 0.45;
      for (let n = 0; n < 45; n++) {
        const wx = (hash2(world.seed + 411, n, 1) * WORLD_W + visualTime * 0.18) % WORLD_W;
        const wy = hash2(world.seed + 411, n, 2) * WORLD_H + Math.sin(visualTime + n) * 0.8;
        ctx.fillRect(sx(wx), sy(wy), 1, 1);
      }
      ctx.globalAlpha = 1;
    }
    if (!reducedMotion && (env.seasonIndex === 2 || weatherVisual.gust > 0.5)) {
      for (let n = 0; n < 24; n++) {
        const wx = (hash2(world.seed + 510, n, 1) * WORLD_W + visualTime * (0.6 + n % 3 * 0.1)) % WORLD_W;
        const wy = (hash2(world.seed + 510, n, 2) * WORLD_H + visualTime * 0.35) % WORLD_H;
        ctx.fillStyle = n % 2 ? '#d3a45f' : '#a96f4f';
        ctx.fillRect(sx(wx), sy(wy), Math.max(1, Math.floor(z * 0.2)), 1);
      }
    }
  }

  function drawWeather(): void {
    if (weatherVisual.cloud > 0.03) {
      ctx.fillStyle = '#4e5868'; ctx.globalAlpha = weatherVisual.cloud * 0.08; ctx.fillRect(0, 0, width, height);
    }
    const rainCount = Math.floor((reducedMotion ? 55 : 230) * weatherVisual.rain);
    const frame = visualTime * (23 + weatherVisual.storm * 15);
    ctx.fillStyle = '#d1d9d1';
    ctx.globalAlpha = 0.35 + weatherVisual.storm * 0.25;
    for (let n = 0; n < rainCount; n++) {
      const x = (hash2(world.seed + 708, n, 1) * (width + 100) + frame * (0.18 + weatherVisual.gust * 0.3)) % (width + 100) - 50;
      const y = (hash2(world.seed + 708, n, 2) * height + frame * (0.8 + hash2(world.seed, n, 3) * 0.4)) % height;
      ctx.fillRect(Math.round(x), Math.round(y), 1, weatherVisual.storm > 0.5 ? 6 : 4);
      if (y > height * 0.6 && n % 6 === 0) ctx.fillRect(Math.round(x) - 1, Math.round(y) + 3, 3, 1);
    }
    const snowCount = Math.floor((reducedMotion ? 40 : 130) * weatherVisual.snow);
    ctx.fillStyle = '#edf0e5'; ctx.globalAlpha = 0.82;
    for (let n = 0; n < snowCount; n++) {
      const drift = visualTime * (5 + weatherVisual.gust * 8);
      const x = (hash2(world.seed + 1708, n, 1) * (width + 40) + drift + Math.sin(visualTime + n) * 7) % (width + 40) - 20;
      const y = (hash2(world.seed + 1708, n, 2) * height + visualTime * (7 + n % 5)) % height;
      const size = n % 5 === 0 ? 2 : 1;
      ctx.fillRect(Math.round(x), Math.round(y), size, size);
    }
    if (weatherVisual.mist > 0.01) {
      ctx.fillStyle = '#c3d0c4';
      for (let n = 0; n < 9; n++) {
        const y = (n / 9 * height + visualTime * (1 + n % 2)) % height;
        const x = Math.sin(visualTime * 0.08 + n * 2) * width * 0.15;
        ctx.globalAlpha = weatherVisual.mist * (0.045 + n % 3 * 0.015);
        ctx.fillRect(Math.round(x - width * 0.2), Math.round(y), Math.round(width * 1.4), 4 + n % 3 * 3);
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawAuroraOverlay(): void {
    const env = environmentAt(world.time);
    const night = clamp((0.42 - env.daylight) / 0.42);
    if (weatherVisual.aurora < 0.01 || night < 0.3) return;
    const colors = ['#7ed5b0', '#86a9d0', '#b09bc5'];
    for (let band = 0; band < 3; band++) {
      ctx.fillStyle = colors[band]; ctx.globalAlpha = weatherVisual.aurora * night * (0.24 - band * 0.035);
      for (let x = -8; x < width + 8; x += 4) {
        const y = height * (0.08 + band * 0.04) + Math.sin(x * 0.035 + visualTime * 0.32 + band) * 11;
        ctx.fillRect(x, Math.round(y), 5, 5 + band * 2);
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawRune(wx: number, wy: number, radius: number, color: string): void {
    const x = sx(wx), y = sy(wy), r = Math.max(3, radius * scale());
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.8;
    for (let n = 0; n < 20; n += 2) {
      const a = n / 20 * Math.PI * 2;
      ctx.fillRect(Math.round(x + Math.cos(a) * r), Math.round(y + Math.sin(a) * r * 0.42), 2, 1);
    }
    ctx.globalAlpha = 1;
  }

  function drawEffects(dt: number): void {
    for (const effect of effects) {
      effect.life -= dt;
      const progress = 1 - effect.life / effect.maxLife;
      if (effect.kind === 'bless' || effect.kind === 'bond') {
        drawRune(effect.x, effect.y, 2 + progress * 8, effect.kind === 'bond' ? '#a9d8b5' : '#f1d58b');
        ctx.fillStyle = '#f4df9e';
        for (let n = 0; n < 28; n++) {
          const a = hash2(world.seed + 944, n, 1) * Math.PI * 2;
          const r = hash2(world.seed + 944, n, 2) * 8 * progress;
          const x = sx(effect.x + Math.cos(a) * r), y = sy(effect.y + Math.sin(a) * r) - Math.round(progress * 20);
          ctx.globalAlpha = 1 - progress;
          ctx.fillRect(x, y, n % 3 ? 1 : 2, n % 3 ? 1 : 2);
        }
      } else if (effect.kind === 'lightning') {
        const x = sx(effect.x), y = sy(effect.y);
        ctx.globalAlpha = clamp(effect.life * 4);
        ctx.fillStyle = '#f5edc8';
        let lx = x;
        for (let ly = 0; ly < y; ly += 4) {
          lx += ((ly / 4) % 3 === 0 ? 1 : -1) * 2;
          ctx.fillRect(lx, ly, 2, 5);
        }
        ctx.fillStyle = '#fff5ce'; ctx.fillRect(x - 5, y - 2, 11, 3);
      } else {
        drawRune(effect.x, effect.y, 0.8 + progress * 2, '#d7e2a4');
        const x = sx(effect.x), y = sy(effect.y), h = Math.max(1, Math.round(progress * 9));
        ctx.fillStyle = '#41634c'; ctx.globalAlpha = 1 - progress * 0.5;
        ctx.fillRect(x, y - h, 1, h);
        ctx.fillStyle = '#a9c477'; ctx.fillRect(x - 2, y - h + 2, 2, 1); ctx.fillRect(x + 1, y - h, 2, 1);
      }
    }
    ctx.globalAlpha = 1;
    effects = effects.filter(e => e.life > 0);
    if (hover && !['inspect', 'rain', 'sun', 'storm', 'mist', 'snow', 'aurora'].includes(power)) {
      const valid = power === 'bless' ? tileAt(world, hover.x, hover.y) >= 0 : isLand(world, hover.x, hover.y);
      drawRune(hover.x, hover.y, power === 'bless' ? 9 : power === 'lightning' ? 2 : 1.2, !valid ? '#df8a7d' : power === 'lightning' ? '#e7a088' : '#d7e2a4');
    }
  }

  function cancelFollow(): void {
    if (followId === null) return;
    followId = null;
    options.onFollow?.(null);
  }

  function updateCamera(dt: number): void {
    if (followId !== null) {
      const entity = findEntity(world, followId);
      const memorial = world.memorials.find(m => m.id === followId);
      if (entity) {
        const position = renderPosition(entity);
        cameraGoal.x = position.x; cameraGoal.y = position.y;
      } else if (memorial) {
        cameraGoal.x = memorial.x; cameraGoal.y = memorial.y;
      } else cancelFollow();
    }
    const t = reducedMotion ? 1 : 1 - Math.exp(-dt * 5.5);
    camera.x = lerp(camera.x, cameraGoal.x, t); camera.y = lerp(camera.y, cameraGoal.y, t);
    camera.zoom = Math.exp(lerp(Math.log(camera.zoom), Math.log(cameraGoal.zoom), t));
  }

  function playCast(result: ActionResult): void {
    if (!result.ok) return;
    terrainDirty = true;
    const power = result.power;
    const x = result.x ?? WORLD_W / 2, y = result.y ?? WORLD_H / 2;
    if (power === 'bless') effects.push({ kind: 'bless', x, y, life: 1.6, maxLife: 1.6 });
    if (power === 'lightning') {
      effects.push({ kind: 'lightning', x, y, life: 0.6, maxLife: 0.6 });
      flash = 0.4; shake = reducedMotion ? 0 : 0.32;
    }
    if (power && power in PLANT_RULES) effects.push({ kind: 'seed', x, y, life: 1, maxLife: 1 });
    if (power && power in ANIMAL_RULES) effects.push({ kind: 'bond', x, y, life: 1.1, maxLife: 1.1 });
    if (power === 'sun') flash = Math.max(flash, 0.08);
    const ids = [...result.entityIds ?? [], ...result.affectedIds ?? []];
    for (const id of ids) reactions.set(id, { kind: power === 'lightning' || power === 'storm' ? 'startle' : 'bless', until: visualTime + 1.6 });
    if (power === 'storm') for (const animal of world.animals) reactions.set(animal.id, { kind: 'startle', until: visualTime + 1.2 });
    if (power === 'aurora') for (const entity of [...world.animals, ...world.plants]) if (entity.bond) reactions.set(entity.id, { kind: 'bond', until: visualTime + 2.5 });
  }

  function drawGroundWeather(): void {
    const z = scale();
    const minX = Math.max(1, Math.floor(camera.x - width / z / 2) - 1), maxX = Math.min(WORLD_W - 2, Math.ceil(camera.x + width / z / 2) + 1);
    const minY = Math.max(1, Math.floor(camera.y - height / z / 2) - 1), maxY = Math.min(WORLD_H - 2, Math.ceil(camera.y + height / z / 2) + 1);
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const i = y * WORLD_W + x;
      if (!isLand(world, x, y)) continue;
      const h = hash2(world.seed + 1511, x, y);
      if (weatherVisual.rain > 0.08 && world.terrain.moisture[i] > 0.74 && h > 0.62) {
        ctx.fillStyle = '#769b9a'; ctx.globalAlpha = weatherVisual.rain * 0.42;
        ctx.fillRect(sx(x + 0.2), sy(y + 0.65), Math.max(2, Math.round(z * 0.55)), 1);
      }
      if (weatherVisual.snow > 0.08 && h > 0.45) {
        ctx.fillStyle = '#e4e8dd'; ctx.globalAlpha = weatherVisual.snow * 0.75;
        ctx.fillRect(sx(x + h), sy(y + 0.2 + h * 0.5), Math.max(1, Math.round(z * 0.25)), 1);
      }
    }
    ctx.globalAlpha = 1;
  }

  function render(dt: number): void {
    visualTime += dt;
    updateWeatherVisual(weatherVisual, world.weather.kind, world.aurora, dt);
    updateCamera(dt);
    shakeX = shake > 0 ? Math.sin(visualTime * 91) * 2 : 0;
    shakeY = shake > 0 ? Math.cos(visualTime * 77) : 0;
    shake = Math.max(0, shake - dt);
    if (terrainDirty || world.time - lastTerrainAt > 0.025 || terrainSeason !== environmentAt(world.time).seasonIndex || Math.abs(terrainSnow - weatherVisual.snow) > 0.045 || lastTerrainAt < 0) rebuildTerrain();
    drawBackground();
    const z = scale();
    ctx.drawImage(terrainCanvas, sx(0), sy(0), Math.round(WORLD_W * z), Math.round(WORLD_H * z));
    drawWater();
    drawGroundWeather();
    drawStructures();
    drawCloudShadows();
    drawEntities();
    drawFire();
    drawAmbient();
    drawEffects(dt);
    drawWeather();
    drawAuroraOverlay();
    const env = environmentAt(world.time);
    if (env.daylight < 0.3) {
      ctx.fillStyle = '#20243b';
      ctx.globalAlpha = (0.3 - env.daylight) * 1.05;
      ctx.fillRect(0, 0, width, height);
      ctx.globalAlpha = 1;
    }
    if (flash > 0) {
      ctx.fillStyle = '#f4eed7'; ctx.globalAlpha = clamp(flash * 3); ctx.fillRect(0, 0, width, height); ctx.globalAlpha = 1;
      flash = Math.max(0, flash - dt);
    }
  }

  function tick(now: number): void {
    if (disposed) return;
    const rawDt = lastTime ? Math.max(0, (now - lastTime) / 1000) : 1 / 60;
    lastTime = now;
    if (document.hidden) return;
    try {
      lastRawDt = rawDt;
      const visualDt = Math.min(1, rawDt);
      const simulationDt = Math.min(1, rawDt);
      if (!paused) {
        accumulator += simulationDt * speed * 4;
        let steps = 0;
        while (accumulator >= 1 && steps < 32) {
          for (const entity of [...world.plants, ...world.animals]) motionSamples.set(entity.id, { fromX: entity.x, fromY: entity.y, toX: entity.x, toY: entity.y });
          stepWorld(world);
          for (const entity of [...world.plants, ...world.animals]) {
            const sample = motionSamples.get(entity.id);
            if (sample) { sample.toX = entity.x; sample.toY = entity.y; }
            else motionSamples.set(entity.id, { fromX: entity.x, fromY: entity.y, toX: entity.x, toY: entity.y });
          }
          accumulator--;
          steps++;
        }
        if (steps === 32) accumulator = Math.min(accumulator, 4);
        const unseen = world.events.filter(event => event.id > lastEventId).sort((a, b) => a.id - b.id);
        for (const event of unseen) options.onEvent?.(event);
        if (unseen.length) lastEventId = unseen[unseen.length - 1].id;
      }
      render(visualDt);
      frames++;
      if (now - lastHud > 200) { lastHud = now; options.onTick?.(world); }
      if (frames % 120 === 0) {
        const ids = new Set([...world.plants, ...world.animals].map(entity => entity.id));
        for (const id of motionSamples.keys()) if (!ids.has(id)) motionSamples.delete(id);
        for (const [id, reaction] of reactions) if (reaction.until <= visualTime || !ids.has(id)) reactions.delete(id);
      }
    } catch (error) {
      paused = true;
      options.onError?.(error);
    }
  }

  function startMotionWorker(): void {
    if (motionWorker || disposed) return;
    try {
      motionWorkerUrl = URL.createObjectURL(new Blob(['setInterval(() => postMessage(0), 33)'], { type: 'text/javascript' }));
      motionWorker = new Worker(motionWorkerUrl);
      motionWorker.onmessage = () => {
        const now = performance.now();
        if (!document.hidden && now - lastTime > 32) { usedFallback = true; tick(now); }
      };
    } catch {
      motionWorker = null;
      if (motionWorkerUrl) URL.revokeObjectURL(motionWorkerUrl);
      motionWorkerUrl = '';
    }
  }

  function loop(now: number): void {
    if (disposed) return;
    fallbackStreak = 0;
    tick(now);
    raf = requestAnimationFrame(loop);
  }

  function watchdogTick(): void {
    const now = performance.now();
    if (!document.hidden && now - lastTime > 75) {
      usedFallback = true;
      fallbackStreak++;
      if (fallbackStreak >= 3) startMotionWorker();
      tick(now);
    }
  }

  function onVisibility(): void {
    lastTime = performance.now();
    accumulator = 0;
  }

  function pointFromEvent(event: PointerEvent | WheelEvent): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect();
    return { x: (event.clientX - rect.left) * width / rect.width, y: (event.clientY - rect.top) * height / rect.height };
  }

  function toWorld(point: { x: number; y: number }): { x: number; y: number } {
    return { x: (point.x - width / 2) / scale() + camera.x, y: (point.y - height / 2) / scale() + camera.y };
  }

  function hitTest(point: { x: number; y: number }): number | null {
    let best: number | null = null, bestD = Infinity;
    for (const entity of [...world.animals, ...world.plants]) {
      const position = renderPosition(entity);
      const dBase = Math.hypot(point.x - position.x, point.y - position.y);
      let d = dBase;
      if ('growth' in entity && (entity.species === 'oak' || entity.species === 'pine')) {
        const h = plantPixelHeight(entity, scale()) / scale();
        if (Math.abs(point.x - position.x) < 3.2 && point.y <= position.y && point.y >= position.y - h) d = dBase * 0.5;
      }
      const threshold = 'behavior' in entity ? 1.3 : entity.species === 'oak' || entity.species === 'pine' ? 3 : 1.1;
      if (d < threshold && d < bestD) { bestD = d; best = entity.id; }
    }
    return best;
  }

  function pointerDown(event: PointerEvent): void {
    const point = pointFromEvent(event);
    pointers.set(event.pointerId, point);
    try { canvas.setPointerCapture(event.pointerId); } catch { /* 合成事件或旧浏览器 */ }
    if (pointers.size === 1) drag = { id: event.pointerId, x: point.x, y: point.y, startX: point.x, startY: point.y, moved: false };
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { distance: Math.hypot(a.x - b.x, a.y - b.y), zoom: camera.zoom };
      drag = null;
    }
  }

  function pointerMove(event: PointerEvent): void {
    const point = pointFromEvent(event);
    hover = toWorld(point);
    if (power === 'inspect') for (const animal of world.animals) {
      if (!animal.alive || (!animal.bond && !animal.traits.includes('curious'))) continue;
      if (Math.hypot(animal.x - hover.x, animal.y - hover.y) < 2.2) reactions.set(animal.id, { kind: 'bond', until: visualTime + 0.35 });
    }
    if (pointers.has(event.pointerId)) pointers.set(event.pointerId, point);
    if (pointers.size === 2 && pinch) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      camera.zoom = clamp(pinch.zoom * d / Math.max(1, pinch.distance), 0.65, 3.4);
      cancelFollow(); cameraGoal = { ...camera };
      userMovedCamera = true;
      return;
    }
    if (!drag || drag.id !== event.pointerId) return;
    const dx = point.x - drag.x, dy = point.y - drag.y;
    if (Math.hypot(point.x - drag.startX, point.y - drag.startY) > 4) drag.moved = true;
    if (drag.moved) {
      camera.x = clamp(camera.x - dx / scale(), -5, WORLD_W + 5);
      camera.y = clamp(camera.y - dy / scale(), -5, WORLD_H + 5);
      cancelFollow(); cameraGoal = { ...camera };
      userMovedCamera = true;
    }
    drag.x = point.x; drag.y = point.y;
  }

  function pointerUp(event: PointerEvent): void {
    const point = pointFromEvent(event);
    const wasClick = drag && drag.id === event.pointerId && !drag.moved && pointers.size === 1;
    pointers.delete(event.pointerId);
    if (pointers.size < 2) pinch = null;
    drag = null;
    if (!wasClick) return;
    const position = toWorld(point);
    if (power === 'inspect') {
      selectedId = hitTest(position);
      options.onSelect?.(selectedId);
      if (selectedId === null) options.onMessage?.('这里没有可观察的生命。拖动可环游，滚轮可缩放。', true);
      return;
    }
    const result = options.onPower?.(position.x, position.y) ?? { ok: false, message: '神力尚未连接。' };
    options.onMessage?.(result.message, result.ok);
    if (result.ok) playCast(result);
  }

  function wheel(event: WheelEvent): void {
    event.preventDefault();
    const before = toWorld(pointFromEvent(event));
    camera.zoom = clamp(camera.zoom * Math.exp(-event.deltaY * 0.0012), 0.65, 3.4);
    const after = toWorld(pointFromEvent(event));
    camera.x += before.x - after.x; camera.y += before.y - after.y;
    cancelFollow(); cameraGoal = { ...camera };
    userMovedCamera = true;
  }

  function pointerLeave(): void { hover = null; }

  function setWorld(next: World): void {
    world = next; selectedId = null; lastEventId = world.events[0]?.id ?? 0;
    lastTerrainAt = -1; effects = []; accumulator = 0; previousFires = 0; terrainDirty = true;
    motionSamples.clear(); reactions.clear(); Object.assign(weatherVisual, createWeatherVisual());
    camera = { x: WORLD_W / 2, y: WORLD_H / 2, zoom: 1 }; cameraGoal = { ...camera }; userMovedCamera = false;
    followId = null; options.onFollow?.(null); lastTime = performance.now();
    resize();
    options.onSelect?.(null); options.onTick?.(world);
  }

  canvas.addEventListener('pointerdown', pointerDown);
  canvas.addEventListener('pointermove', pointerMove);
  canvas.addEventListener('pointerup', pointerUp);
  canvas.addEventListener('pointercancel', pointerUp);
  canvas.addEventListener('pointerleave', pointerLeave);
  canvas.addEventListener('wheel', wheel, { passive: false });
  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', onVisibility);
  resize();
  raf = requestAnimationFrame(loop);
  watchdog = window.setInterval(watchdogTick, 50);

  return {
    setWorld,
    setPower(next: Power) { power = next; canvas.style.cursor = next === 'inspect' ? 'grab' : 'crosshair'; },
    setSpeed(next: number) { speed = next; },
    setPaused(next: boolean) { paused = next; accumulator = 0; },
    select(id: number | null) { selectedId = id; },
    focus(x: number, y: number, zoom = 1.65) {
      cancelFollow(); cameraGoal = { x, y, zoom: clamp(zoom, 0.65, 3.4) }; userMovedCamera = true;
    },
    follow(id: number | null) {
      if (id === null || !findEntity(world, id)) { cancelFollow(); return; }
      followId = id; selectedId = id;
      const entity = findEntity(world, id)!;
      cameraGoal = { x: entity.x, y: entity.y, zoom: Math.max(cameraGoal.zoom, 1.85) };
      userMovedCamera = true; options.onFollow?.(id);
    },
    celebrateBond(id: number) {
      const entity = findEntity(world, id);
      if (!entity) return;
      effects.push({ kind: 'bond', x: entity.x, y: entity.y, life: 1.8, maxLife: 1.8 });
      reactions.set(id, { kind: 'bond', until: visualTime + 2.2 });
    },
    playCast,
    resetView() {
      cancelFollow(); camera = { x: WORLD_W / 2, y: WORLD_H / 2, zoom: 1 }; cameraGoal = { ...camera }; userMovedCamera = false; resize();
    },
    zoomBy(factor: number) {
      cancelFollow(); camera.zoom = clamp(camera.zoom * factor, 0.65, 3.4); cameraGoal = { ...camera }; userMovedCamera = true;
    },
    snapshot(): Promise<Blob | null> { return new Promise(resolve => canvas.toBlob(resolve, 'image/png')); },
    renderOnce() { render(0); },
    diagnostics() { return { frames, fps: lastRawDt > 0 ? 1 / lastRawDt : 0, usedFallback, worker: motionWorker !== null, visualTime, worldTime: world.time, followId }; },
    getSelected() { return findEntity(world, selectedId); },
    dispose() {
      disposed = true; cancelAnimationFrame(raf); clearInterval(watchdog);
      canvas.removeEventListener('pointerdown', pointerDown); canvas.removeEventListener('pointermove', pointerMove);
      canvas.removeEventListener('pointerup', pointerUp); canvas.removeEventListener('pointercancel', pointerUp);
      canvas.removeEventListener('pointerleave', pointerLeave);
      canvas.removeEventListener('wheel', wheel); window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVisibility);
      motionWorker?.terminate();
      if (motionWorkerUrl) URL.revokeObjectURL(motionWorkerUrl);
      motionWorker = null; motionWorkerUrl = '';
      pointers.clear(); effects = []; motionSamples.clear(); reactions.clear();
    },
  };
}
