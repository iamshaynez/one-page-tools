import { WORLD_H, WORLD_W, clamp } from './forest-god-content';
import type { Power } from './forest-god-content';
import { BIOME, environmentAt, findEntity, hash2, stepWorld, tileAt } from './forest-god-core';
import type { ActionResult, Animal, ForestEvent, Plant, World } from './forest-god-core';
import { drawAnimal, drawPlant, plantPixelHeight } from './forest-god-sprites';
import type { SpriteEnvironment } from './forest-god-sprites';

interface SceneOptions {
  onTick?(world: World): void;
  onSelect?(id: number | null): void;
  onPower?(x: number, y: number): ActionResult;
  onMessage?(message: string, ok?: boolean): void;
  onEvent?(event: ForestEvent): void;
}

interface Effect {
  kind: 'bless' | 'lightning' | 'seed';
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

export function createForestScene(canvas: HTMLCanvasElement, initialWorld: World, options: SceneOptions = {}) {
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('这片森林需要 Canvas 2D 支持。');
  const ctx: CanvasRenderingContext2D = context;
  let world = initialWorld;
  let width = 1, height = 1;
  let camera = { x: WORLD_W / 2, y: WORLD_H / 2, zoom: 1 };
  let fit = 4;
  let power: Power = 'inspect';
  let speed = 1;
  let paused = false;
  let disposed = false;
  let raf = 0;
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
  const sx = (x: number) => Math.round((x - camera.x) * scale() + width / 2);
  const sy = (y: number) => Math.round((y - camera.y) * scale() + height / 2);
  const spriteEnv = (): SpriteEnvironment => {
    const env = environmentAt(world.time);
    return { time: visualTime, daylight: env.daylight, seasonIndex: env.seasonIndex, weather: world.weather.kind, reducedMotion };
  };

  function resize(): void {
    const rect = canvas.getBoundingClientRect();
    const pixelSize = rect.width >= 900 ? 2 : 1;
    width = Math.max(1, Math.floor(rect.width / pixelSize));
    height = Math.max(1, Math.floor(rect.height / pixelSize));
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    ctx.imageSmoothingEnabled = false;
    fit = Math.min(width / (WORLD_W + 20), height / (WORLD_H + 20));
    if (!userMovedCamera) camera.zoom = rect.width < 760 ? 1.5 : 1;
  }

  function terrainColor(biome: number, x: number, y: number, wet: number, season: number): string {
    if (biome === BIOME.WATER) {
      const water = ['#5e989b', '#609a98', '#5c8e96', '#607e91'][season];
      return hash2(world.seed + 99, x, y) > 0.62 ? '#77aaab' : water;
    }
    const baseIndex = biome === BIOME.FOREST ? 1 : biome === BIOME.BANK ? 2 : biome === BIOME.ROCK ? 4 : 0;
    const base = GROUND[season][baseIndex];
    if (wet > 0.68 && biome !== BIOME.BANK && biome !== BIOME.ROCK) return season === 3 ? '#929f91' : '#5f7d5c';
    return base;
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
  }

  function drawBackground(): void {
    const env = environmentAt(world.time);
    const night = 1 - env.daylight;
    ctx.fillStyle = night > 0.58 ? VOID_NIGHT : VOID_DAY;
    ctx.fillRect(0, 0, width, height);
    if (night > 0.58) {
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
  }

  function drawWater(): void {
    const frame = Math.floor(visualTime * (reducedMotion ? 1 : 5));
    const z = scale();
    const minX = Math.max(0, Math.floor(camera.x - width / z / 2) - 2), maxX = Math.min(WORLD_W - 1, Math.ceil(camera.x + width / z / 2) + 2);
    const minY = Math.max(0, Math.floor(camera.y - height / z / 2) - 2), maxY = Math.min(WORLD_H - 1, Math.ceil(camera.y + height / z / 2) + 2);
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      if (world.terrain.biome[y * WORLD_W + x] !== BIOME.WATER) continue;
      const h = hash2(world.seed + 811, x, y);
      if ((frame + Math.floor(h * 10)) % 5 > 1) continue;
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
      if (tileAt(world, wx, wy) >= 0 && world.terrain.biome[tileAt(world, wx, wy)] === BIOME.WATER) {
        const px = sx(wx), py = sy(wy);
        ctx.fillRect(px, py, Math.max(2, Math.floor(z * 0.55)), 1);
        ctx.fillRect(px - 1, py - 1, 1, 3);
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawCloudShadows(): void {
    if (reducedMotion) return;
    ctx.fillStyle = '#34354c';
    ctx.globalAlpha = world.weather.kind === 'clear' ? 0.055 : 0.12;
    for (let n = 0; n < 5; n++) {
      const wx = ((visualTime * (0.5 + n * 0.06) + n * 31) % 160) - 20;
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
    if (behavior === 'rest') {
      ctx.fillStyle = '#e6dfc4';
      ctx.fillRect(px + 5, py - 4, 3, 1); ctx.fillRect(px + 7, py - 3, 1, 1); ctx.fillRect(px + 5, py - 2, 3, 1);
    } else if (behavior === 'flee' || behavior === 'hunt') {
      ctx.fillStyle = behavior === 'flee' ? '#f2d395' : '#d98778';
      ctx.fillRect(px, py - 5, 1, 4); ctx.fillRect(px, py, 1, 1);
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
    // 所有地面阴影先画，避免后出现的生命踩进前者的阴影。
    for (const entity of entities) {
      if (!entity.alive && entity.deadFor > 1) continue;
      const x = sx(entity.x), y = sy(entity.y);
      if (x < -60 || y < -80 || x > width + 60 || y > height + 50) continue;
      if ('growth' in entity && (entity.species === 'oak' || entity.species === 'pine')) {
        const heightPx = plantPixelHeight(entity, z);
        drawShadow(x, y + 2, Math.max(2, heightPx * 0.28), Math.round(heightPx * 0.34));
      } else if ('behavior' in entity && entity.species !== 'bee') drawShadow(x, y + 1, Math.max(1, z * 0.45));
    }
    for (const entity of entities) {
      const x = sx(entity.x), y = sy(entity.y);
      if (x < -70 || y < -100 || x > width + 70 || y > height + 50) continue;
      if (entity.id === selectedId) drawRune(entity.x, entity.y, 'behavior' in entity ? 1.4 : 'growth' in entity && (entity.species === 'oak' || entity.species === 'pine') ? 3 : 1.2, '#f2d386');
      if ('growth' in entity) drawPlant(ctx, entity, x, y, z, env);
      else { drawAnimal(ctx, entity, x, y, z, env); drawEntitySymbol(entity, x, y - z); }
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
    if (!reducedMotion && (env.seasonIndex === 2 || world.weather.kind === 'storm')) {
      for (let n = 0; n < 24; n++) {
        const wx = (hash2(world.seed + 510, n, 1) * WORLD_W + visualTime * (0.6 + n % 3 * 0.1)) % WORLD_W;
        const wy = (hash2(world.seed + 510, n, 2) * WORLD_H + visualTime * 0.35) % WORLD_H;
        ctx.fillStyle = n % 2 ? '#d3a45f' : '#a96f4f';
        ctx.fillRect(sx(wx), sy(wy), Math.max(1, Math.floor(z * 0.2)), 1);
      }
    }
  }

  function drawWeather(): void {
    if (world.weather.kind === 'clear') return;
    const storm = world.weather.kind === 'storm';
    const count = reducedMotion ? 45 : storm ? 230 : 150;
    const frame = visualTime * (storm ? 34 : 23);
    ctx.fillStyle = storm ? '#bac5cf' : '#d1d9d1';
    ctx.globalAlpha = storm ? 0.56 : 0.44;
    for (let n = 0; n < count; n++) {
      const x = (hash2(world.seed + 708, n, 1) * (width + 100) + frame * 0.18) % (width + 100) - 50;
      const y = (hash2(world.seed + 708, n, 2) * height + frame * (0.8 + hash2(world.seed, n, 3) * 0.4)) % height;
      ctx.fillRect(Math.round(x), Math.round(y), 1, storm ? 5 : 3);
      if (y > height * 0.65 && n % 8 === 0) ctx.fillRect(Math.round(x) - 1, Math.round(y) + 3, 3, 1);
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
      if (effect.kind === 'bless') {
        drawRune(effect.x, effect.y, 2 + progress * 8, '#f1d58b');
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
      }
    }
    ctx.globalAlpha = 1;
    effects = effects.filter(e => e.life > 0);
    if (hover && power !== 'inspect' && power !== 'rain' && power !== 'sun' && power !== 'storm') {
      drawRune(hover.x, hover.y, power === 'bless' ? 9 : power === 'lightning' ? 2 : 1.2, power === 'lightning' ? '#e7a088' : '#ead99b');
    }
  }

  function render(dt: number): void {
    visualTime += dt;
    if (world.time - lastTerrainAt > 0.025 || terrainSeason !== environmentAt(world.time).seasonIndex || lastTerrainAt < 0) rebuildTerrain();
    drawBackground();
    const z = scale();
    ctx.drawImage(terrainCanvas, sx(0), sy(0), Math.round(WORLD_W * z), Math.round(WORLD_H * z));
    drawWater();
    drawCloudShadows();
    drawEntities();
    drawFire();
    drawAmbient();
    drawEffects(dt);
    drawWeather();
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

  function loop(now: number): void {
    if (disposed) return;
    const dt = lastTime ? Math.min(0.05, (now - lastTime) / 1000) : 0;
    lastTime = now;
    if (!document.hidden) {
      if (!paused) {
        accumulator += dt * speed * 4;
        let steps = 0;
        while (accumulator >= 1 && steps < 32) {
          stepWorld(world);
          accumulator--;
          steps++;
        }
        if (steps === 32) accumulator = Math.min(accumulator, 4);
        const latest = world.events[0];
        if (latest && latest.id !== lastEventId) { lastEventId = latest.id; options.onEvent?.(latest); }
      }
      render(dt);
      if (now - lastHud > 200) { lastHud = now; options.onTick?.(world); }
    }
    raf = requestAnimationFrame(loop);
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
      const dBase = Math.hypot(point.x - entity.x, point.y - entity.y);
      let d = dBase;
      if ('growth' in entity && (entity.species === 'oak' || entity.species === 'pine')) {
        const h = plantPixelHeight(entity, scale()) / scale();
        if (Math.abs(point.x - entity.x) < 3.2 && point.y <= entity.y && point.y >= entity.y - h) d = dBase * 0.5;
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
    if (pointers.has(event.pointerId)) pointers.set(event.pointerId, point);
    if (pointers.size === 2 && pinch) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      camera.zoom = clamp(pinch.zoom * d / Math.max(1, pinch.distance), 0.65, 3.4);
      userMovedCamera = true;
      return;
    }
    if (!drag || drag.id !== event.pointerId) return;
    const dx = point.x - drag.x, dy = point.y - drag.y;
    if (Math.hypot(point.x - drag.startX, point.y - drag.startY) > 4) drag.moved = true;
    if (drag.moved) {
      camera.x = clamp(camera.x - dx / scale(), -5, WORLD_W + 5);
      camera.y = clamp(camera.y - dy / scale(), -5, WORLD_H + 5);
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
    if (result.ok) {
      if (power === 'bless') effects.push({ kind: 'bless', x: position.x, y: position.y, life: 1.4, maxLife: 1.4 });
      else if (power === 'lightning') { effects.push({ kind: 'lightning', x: position.x, y: position.y, life: 0.55, maxLife: 0.55 }); flash = 0.35; }
      else effects.push({ kind: 'seed', x: position.x, y: position.y, life: 0.8, maxLife: 0.8 });
    }
  }

  function wheel(event: WheelEvent): void {
    event.preventDefault();
    const before = toWorld(pointFromEvent(event));
    camera.zoom = clamp(camera.zoom * Math.exp(-event.deltaY * 0.0012), 0.65, 3.4);
    const after = toWorld(pointFromEvent(event));
    camera.x += before.x - after.x; camera.y += before.y - after.y;
    userMovedCamera = true;
  }

  function pointerLeave(): void { hover = null; }

  function setWorld(next: World): void {
    world = next; selectedId = null; lastEventId = world.events[0]?.id ?? 0;
    lastTerrainAt = -1; effects = []; accumulator = 0; previousFires = 0;
    camera = { x: WORLD_W / 2, y: WORLD_H / 2, zoom: 1 }; userMovedCamera = false;
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
  resize();
  raf = requestAnimationFrame(loop);

  return {
    setWorld,
    setPower(next: Power) { power = next; canvas.style.cursor = next === 'inspect' ? 'grab' : 'crosshair'; },
    setSpeed(next: number) { speed = next; },
    setPaused(next: boolean) { paused = next; accumulator = 0; },
    select(id: number | null) { selectedId = id; },
    focus(x: number, y: number, zoom = 1.65) { camera.x = x; camera.y = y; camera.zoom = clamp(zoom, 0.65, 3.4); userMovedCamera = true; },
    resetView() { camera = { x: WORLD_W / 2, y: WORLD_H / 2, zoom: 1 }; userMovedCamera = false; resize(); },
    zoomBy(factor: number) { camera.zoom = clamp(camera.zoom * factor, 0.65, 3.4); userMovedCamera = true; },
    snapshot(): Promise<Blob | null> { return new Promise(resolve => canvas.toBlob(resolve, 'image/png')); },
    renderOnce() { render(0); },
    getSelected() { return findEntity(world, selectedId); },
    dispose() {
      disposed = true; cancelAnimationFrame(raf);
      canvas.removeEventListener('pointerdown', pointerDown); canvas.removeEventListener('pointermove', pointerMove);
      canvas.removeEventListener('pointerup', pointerUp); canvas.removeEventListener('pointercancel', pointerUp);
      canvas.removeEventListener('pointerleave', pointerLeave);
      canvas.removeEventListener('wheel', wheel); window.removeEventListener('resize', resize);
      pointers.clear(); effects = [];
    },
  };
}
