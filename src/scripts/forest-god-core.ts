import {
  ANIMAL_RULES, ANIMAL_ORDER, DAYS_PER_SEASON, MAX_ANIMALS, MAX_EVENTS, MAX_PLANTS,
  PLANT_RULES, PLANT_ORDER, POWER_INFO, SEASONS, STEP_DAYS, WORLD_H, WORLD_VERSION, WORLD_W, clamp,
} from './forest-god-content';
import type {
  AnimalSpecies, Behavior, EventKind, PlantSpecies, Power, Season, WeatherKind,
} from './forest-god-content';

/** 0=界外，1=草甸，2=林地，3=河岸，4=水，5=岩石 */
export const BIOME = { VOID: 0, MEADOW: 1, FOREST: 2, BANK: 3, WATER: 4, ROCK: 5 } as const;

export interface Terrain {
  biome: Uint8Array;
  moisture: Float32Array;
  nutrients: Float32Array;
  fire: Float32Array;
  elevation: Float32Array;
}

export interface Plant {
  id: number;
  species: PlantSpecies;
  x: number;
  y: number;
  age: number;
  growth: number;
  health: number;
  fruit: number;
  pollinated: boolean;
  alive: boolean;
  deadFor: number;
  variant: number;
}

export interface Animal {
  id: number;
  species: AnimalSpecies;
  x: number;
  y: number;
  vx: number;
  vy: number;
  tx: number;
  ty: number;
  age: number;
  health: number;
  hunger: number;
  thirst: number;
  energy: number;
  sex: 0 | 1;
  behavior: Behavior;
  targetId: number | null;
  parentId: number | null;
  think: number;
  action: number;
  repro: number;
  alive: boolean;
  deadFor: number;
  variant: number;
}

export interface ForestEvent {
  id: number;
  at: number;
  kind: EventKind;
  text: string;
  x: number;
  y: number;
}

export interface World {
  version: number;
  seed: number;
  rng: number;
  nextId: number;
  time: number;
  weather: { kind: WeatherKind; remaining: number };
  sunBoost: number;
  rainbow: number;
  divine: number;
  nextMigration: number;
  terrain: Terrain;
  plants: Plant[];
  animals: Animal[];
  events: ForestEvent[];
}

export interface ActionResult { ok: boolean; message: string }
export interface Environment { day: number; daylight: number; season: Season; seasonIndex: number; year: number; temperature: number }

const TAU = Math.PI * 2;
const tileIndex = (x: number, y: number) => y * WORLD_W + x;
const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

export function hash2(seed: number, x: number, y: number): number {
  let h = (seed ^ Math.imul(x, 374761393) ^ Math.imul(y, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function noise2(seed: number, x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash2(seed, ix, iy), b = hash2(seed, ix + 1, iy);
  const c = hash2(seed, ix, iy + 1), d = hash2(seed, ix + 1, iy + 1);
  return (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sy;
}

function fbm(seed: number, x: number, y: number): number {
  return noise2(seed, x, y) * 0.57 + noise2(seed + 91, x * 2.03, y * 2.03) * 0.29 + noise2(seed + 733, x * 4.11, y * 4.11) * 0.14;
}

/** 可序列化的 Mulberry32；同一世界种子与操作序列会得到同一历史。 */
export function random(world: World): number {
  world.rng = (world.rng + 0x6D2B79F5) >>> 0;
  let t = world.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function environmentAt(time: number): Environment {
  const day = ((time % 1) + 1) % 1;
  const daylight = clamp(Math.sin((day - 0.25) * TAU) * 1.25 + 0.08);
  const seasonIndex = Math.floor(time / DAYS_PER_SEASON) % 4;
  const temperatures = [0.68, 1, 0.72, 0.38];
  return {
    day, daylight, season: SEASONS[seasonIndex], seasonIndex,
    year: Math.floor(time / (DAYS_PER_SEASON * 4)) + 1,
    temperature: temperatures[seasonIndex],
  };
}

export function tileAt(world: World, x: number, y: number): number {
  const tx = Math.floor(x), ty = Math.floor(y);
  if (tx < 0 || ty < 0 || tx >= WORLD_W || ty >= WORLD_H) return -1;
  return tileIndex(tx, ty);
}

export function isWater(world: World, x: number, y: number): boolean {
  const i = tileAt(world, x, y);
  return i >= 0 && world.terrain.biome[i] === BIOME.WATER;
}

export function isLand(world: World, x: number, y: number): boolean {
  const i = tileAt(world, x, y);
  return i >= 0 && world.terrain.biome[i] !== BIOME.VOID && world.terrain.biome[i] !== BIOME.WATER;
}

function generateTerrain(seed: number): Terrain {
  const size = WORLD_W * WORLD_H;
  const terrain: Terrain = {
    biome: new Uint8Array(size), moisture: new Float32Array(size),
    nutrients: new Float32Array(size), fire: new Float32Array(size), elevation: new Float32Array(size),
  };
  for (let y = 0; y < WORLD_H; y++) {
    for (let x = 0; x < WORLD_W; x++) {
      const i = tileIndex(x, y);
      const nx = (x + 0.5 - WORLD_W / 2) / (WORLD_W * 0.485);
      const ny = (y + 0.5 - WORLD_H / 2) / (WORLD_H * 0.47);
      const edgeNoise = (fbm(seed + 17, x * 0.11, y * 0.11) - 0.5) * 0.19;
      if (nx * nx + ny * ny > 0.96 + edgeNoise) {
        terrain.biome[i] = BIOME.VOID;
        continue;
      }
      const riverY = 40 + Math.sin(x * 0.085 + seed * 0.001) * 6 + Math.sin(x * 0.027) * 4;
      const riverWidth = 1.55 + noise2(seed + 33, x * 0.08, 2) * 1.15;
      const pond = ((x - 82) / 9) ** 2 + ((y - 38) / 6.5) ** 2 < 1;
      const river = Math.abs(y - riverY) < riverWidth || pond;
      const wetDistance = Math.abs(y - riverY);
      const elevation = fbm(seed + 103, x * 0.055, y * 0.055);
      terrain.elevation[i] = elevation;
      if (river) {
        terrain.biome[i] = BIOME.WATER;
        terrain.moisture[i] = 1;
        terrain.nutrients[i] = 0.25;
      } else {
        const bank = wetDistance < riverWidth + 2 || (((x - 82) / 11) ** 2 + ((y - 38) / 8.5) ** 2 < 1);
        const patch = fbm(seed + 307, x * 0.09, y * 0.09);
        terrain.biome[i] = bank ? BIOME.BANK : patch > 0.72 && elevation > 0.57 ? BIOME.ROCK : patch > 0.43 ? BIOME.FOREST : BIOME.MEADOW;
        terrain.moisture[i] = clamp(0.25 + patch * 0.34 + Math.max(0, 1 - wetDistance / 15) * 0.25);
        terrain.nutrients[i] = clamp(0.35 + fbm(seed + 601, x * 0.12, y * 0.12) * 0.5);
      }
    }
  }
  return terrain;
}

function logEvent(world: World, kind: EventKind, text: string, x: number, y: number): void {
  world.events.unshift({ id: world.nextId++, at: world.time, kind, text, x, y });
  if (world.events.length > MAX_EVENTS) world.events.length = MAX_EVENTS;
}

function spawnPlant(world: World, species: PlantSpecies, x: number, y: number, age = 0): Plant | null {
  if (world.plants.length >= MAX_PLANTS || !isLand(world, x, y)) return null;
  const plant: Plant = {
    id: world.nextId++, species, x, y, age,
    growth: age <= 0 ? 0.04 : clamp(age / PLANT_RULES[species].matureAt, 0.15, 1),
    health: 0.82 + random(world) * 0.18, fruit: age > PLANT_RULES[species].matureAt ? random(world) * 0.8 : 0,
    pollinated: false, alive: true, deadFor: 0, variant: Math.floor(random(world) * 8),
  };
  world.plants.push(plant);
  return plant;
}

function spawnAnimal(world: World, species: AnimalSpecies, x: number, y: number, age = 0, parentId: number | null = null): Animal | null {
  if (world.animals.length >= MAX_ANIMALS || tileAt(world, x, y) < 0) return null;
  if (species !== 'frog' && species !== 'bee' && !isLand(world, x, y)) return null;
  if (species === 'frog' && !nearWater(world, x, y, 5)) return null;
  const animal: Animal = {
    id: world.nextId++, species, x, y, vx: 0, vy: 0, tx: x, ty: y, age,
    health: 0.85 + random(world) * 0.15, hunger: random(world) * 0.3, thirst: random(world) * 0.25,
    energy: 0.65 + random(world) * 0.35, sex: random(world) < 0.5 ? 0 : 1,
    behavior: 'wander', targetId: null, parentId, think: random(world) * 0.03,
    action: 0, repro: age > ANIMAL_RULES[species].matureAt ? random(world) * 2 : 0,
    alive: true, deadFor: 0, variant: Math.floor(random(world) * 8),
  };
  world.animals.push(animal);
  return animal;
}

function findSpawn(world: World, species: PlantSpecies | AnimalSpecies, near?: { x: number; y: number }, radius = 8): { x: number; y: number } | null {
  for (let attempt = 0; attempt < 72; attempt++) {
    const x = near ? near.x + (random(world) * 2 - 1) * radius : 5 + random(world) * (WORLD_W - 10);
    const y = near ? near.y + (random(world) * 2 - 1) * radius : 5 + random(world) * (WORLD_H - 10);
    if (species === 'frog') {
      if (nearWater(world, x, y, 3) && isLand(world, x, y)) return { x, y };
    } else if (species === 'bee' ? tileAt(world, x, y) >= 0 && world.terrain.biome[tileAt(world, x, y)] !== BIOME.VOID : isLand(world, x, y)) {
      return { x, y };
    }
  }
  return null;
}

export function nearWater(world: World, x: number, y: number, radius: number): boolean {
  const r = Math.ceil(radius);
  for (let oy = -r; oy <= r; oy++) for (let ox = -r; ox <= r; ox++) {
    if (ox * ox + oy * oy <= radius * radius && isWater(world, x + ox, y + oy)) return true;
  }
  return false;
}

export function createWorld(seed = Math.floor(Math.random() * 0x7fffffff)): World {
  const world: World = {
    version: WORLD_VERSION, seed: seed >>> 0, rng: seed >>> 0, nextId: 1, time: 0.34,
    weather: { kind: 'clear', remaining: 1.8 }, sunBoost: 0, rainbow: 0, divine: 100,
    nextMigration: 4, terrain: generateTerrain(seed), plants: [], animals: [], events: [],
  };
  const initialPlants: [PlantSpecies, number][] = [
    ['grass', 64], ['flower', 24], ['berry', 14], ['oak', 20], ['pine', 17], ['fern', 18], ['mushroom', 8],
  ];
  for (const [species, count] of initialPlants) {
    for (let n = 0; n < count; n++) {
      const point = findSpawn(world, species);
      if (point) {
        const mature = species === 'oak' || species === 'pine';
        spawnPlant(world, species, point.x, point.y, random(world) * PLANT_RULES[species].matureAt * (mature ? 2.6 : 1.3));
      }
    }
  }
  const heart = findSpawn(world, 'oak', { x: 58, y: 29 }, 9);
  if (heart) {
    const ancient = spawnPlant(world, 'oak', heart.x, heart.y, 38);
    if (ancient) { ancient.variant = 7; ancient.growth = 1; ancient.health = 1; }
  }
  const initialAnimals: [AnimalSpecies, number][] = [['rabbit', 12], ['deer', 7], ['fox', 4], ['wolf', 3], ['bee', 10], ['frog', 6]];
  for (const [species, count] of initialAnimals) {
    for (let n = 0; n < count; n++) {
      const point = findSpawn(world, species, species === 'frog' ? { x: 80, y: 38 } : undefined, 25);
      if (point) spawnAnimal(world, species, point.x, point.y, random(world) * ANIMAL_RULES[species].matureAt * 1.8);
    }
  }
  logEvent(world, 'ecology', '第一缕风越过树冠。这里开始拥有自己的历史。', 60, 40);
  return world;
}

function killPlant(world: World, plant: Plant, reason: string): void {
  if (!plant.alive) return;
  plant.alive = false;
  plant.health = 0;
  plant.deadFor = 0;
  if (plant.species === 'oak' || plant.species === 'pine' || plant.species === 'berry') {
    logEvent(world, 'death', `${PLANT_RULES[plant.species].name}${reason}，慢慢归还给土壤。`, plant.x, plant.y);
  }
}

function killAnimal(world: World, animal: Animal, reason: string): void {
  if (!animal.alive) return;
  animal.alive = false;
  animal.health = 0;
  animal.vx = animal.vy = 0;
  animal.deadFor = 0;
  logEvent(world, 'death', `${ANIMAL_RULES[animal.species].name}${reason}。`, animal.x, animal.y);
}

function nearestWater(world: World, x: number, y: number, maxRadius = 22): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null;
  let bestD = maxRadius * maxRadius;
  const minX = Math.max(0, Math.floor(x - maxRadius)), maxX = Math.min(WORLD_W - 1, Math.ceil(x + maxRadius));
  const minY = Math.max(0, Math.floor(y - maxRadius)), maxY = Math.min(WORLD_H - 1, Math.ceil(y + maxRadius));
  for (let ty = minY; ty <= maxY; ty++) for (let tx = minX; tx <= maxX; tx++) {
    if (world.terrain.biome[tileIndex(tx, ty)] !== BIOME.WATER) continue;
    const d = (tx + 0.5 - x) ** 2 + (ty + 0.5 - y) ** 2;
    if (d < bestD) { bestD = d; best = { x: tx + 0.5, y: ty + 0.5 }; }
  }
  return best;
}

function nearestPlant(world: World, animal: Animal, accepted: string[]): Plant | null {
  let best: Plant | null = null, bestD = ANIMAL_RULES[animal.species].sense ** 2;
  for (const plant of world.plants) {
    if (!plant.alive || !accepted.includes(plant.species) || plant.growth < 0.25) continue;
    const d = (plant.x - animal.x) ** 2 + (plant.y - animal.y) ** 2;
    if (d < bestD) { bestD = d; best = plant; }
  }
  return best;
}

function nearestAnimal(world: World, animal: Animal, accepted: string[], includeDead = false): Animal | null {
  let best: Animal | null = null, bestD = ANIMAL_RULES[animal.species].sense ** 2;
  for (const candidate of world.animals) {
    if (candidate.id === animal.id || !accepted.includes(candidate.species) || (!includeDead && !candidate.alive)) continue;
    if (includeDead && !candidate.alive && candidate.deadFor > 1.5) continue;
    const d = (candidate.x - animal.x) ** 2 + (candidate.y - animal.y) ** 2;
    if (d < bestD) { bestD = d; best = candidate; }
  }
  return best;
}

function chooseBehavior(world: World, animal: Animal): void {
  const rule = ANIMAL_RULES[animal.species];
  const threat = rule.predators.length ? nearestAnimal(world, animal, rule.predators) : null;
  if (threat && distance(animal, threat) < rule.sense * 0.75) {
    animal.behavior = 'flee'; animal.targetId = threat.id;
    animal.think = 0.018 + random(world) * 0.02;
    return;
  }
  const tile = tileAt(world, animal.x, animal.y);
  if (tile >= 0 && world.terrain.fire[tile] > 0.05) {
    animal.behavior = 'flee'; animal.targetId = null;
    animal.tx = clamp(animal.x + (random(world) - 0.5) * 24, 2, WORLD_W - 2);
    animal.ty = clamp(animal.y + (random(world) - 0.5) * 24, 2, WORLD_H - 2);
    animal.think = 0.04;
    return;
  }
  if (animal.thirst > 0.48) {
    const water = nearestWater(world, animal.x, animal.y);
    if (water) {
      animal.behavior = 'drink'; animal.targetId = null; animal.tx = water.x; animal.ty = water.y;
      animal.think = 0.05 + random(world) * 0.03;
      return;
    }
  }
  if (animal.hunger > 0.38) {
    if (rule.diet === 'herbivore' || rule.diet === 'pollinator') {
      const food = nearestPlant(world, animal, rule.foods);
      if (food) {
        animal.behavior = 'seekFood'; animal.targetId = food.id; animal.tx = food.x; animal.ty = food.y;
        animal.think = 0.04 + random(world) * 0.04;
        return;
      }
    } else {
      const prey = nearestAnimal(world, animal, rule.foods, rule.diet === 'carnivore');
      if (prey) {
        animal.behavior = prey.alive ? 'hunt' : 'seekFood'; animal.targetId = prey.id; animal.tx = prey.x; animal.ty = prey.y;
        animal.think = 0.025 + random(world) * 0.025;
        return;
      }
      if (rule.diet === 'insectivore' && nearWater(world, animal.x, animal.y, 7)) {
        animal.hunger = clamp(animal.hunger - 0.3);
        animal.behavior = 'rest'; animal.think = 0.06;
        return;
      }
    }
  }
  const parent = animal.parentId === null ? null : world.animals.find(a => a.id === animal.parentId && a.alive);
  if (parent && animal.age < rule.matureAt * 0.75 && distance(animal, parent) > 2.5) {
    animal.behavior = 'follow'; animal.targetId = parent.id; animal.think = 0.06;
    return;
  }
  if (animal.energy < 0.24 || (animal.energy < 0.65 && random(world) < 0.28)) {
    animal.behavior = 'rest'; animal.targetId = null; animal.think = 0.08 + random(world) * 0.08;
    return;
  }
  if (animal.age >= rule.matureAt && animal.repro <= 0 && animal.hunger < 0.55 && animal.health > 0.5 && rule.diet !== 'pollinator') {
    const mate = world.animals.find(a => a.alive && a.id !== animal.id && a.species === animal.species && a.sex !== animal.sex && a.age >= rule.matureAt && a.repro <= 0 && distance(a, animal) < rule.sense);
    if (mate) {
      animal.behavior = 'court'; animal.targetId = mate.id; animal.think = 0.05;
      return;
    }
  }
  const angle = random(world) * TAU, length = 3 + random(world) * 8;
  animal.behavior = 'wander'; animal.targetId = null;
  animal.tx = clamp(animal.x + Math.cos(angle) * length, 2, WORLD_W - 2);
  animal.ty = clamp(animal.y + Math.sin(angle) * length, 2, WORLD_H - 2);
  animal.think = 0.045 + random(world) * 0.09;
}

function updatePlants(world: World, dt: number, env: Environment): void {
  const births: { species: PlantSpecies; x: number; y: number }[] = [];
  const fungi: { x: number; y: number }[] = [];
  const raining = world.weather.kind !== 'clear';
  for (const plant of world.plants) {
    if (!plant.alive) {
      plant.deadFor += dt;
      const decay = plant.species === 'oak' || plant.species === 'pine' ? 12 : plant.species === 'berry' ? 4 : 1.5;
      if (plant.deadFor >= decay) {
        const i = tileAt(world, plant.x, plant.y);
        if (i >= 0) world.terrain.nutrients[i] = clamp(world.terrain.nutrients[i] + (decay > 5 ? 0.35 : 0.12));
        if (random(world) < 0.3) fungi.push({ x: plant.x, y: plant.y });
        plant.deadFor = -9999;
      }
      continue;
    }
    plant.age += dt;
    const i = tileAt(world, plant.x, plant.y);
    if (i < 0) { killPlant(world, plant, '消失在界外'); continue; }
    const rule = PLANT_RULES[plant.species];
    const moisture = world.terrain.moisture[i];
    const nutrients = world.terrain.nutrients[i];
    const wetFit = clamp(1 - Math.abs(moisture - rule.moisture) * 1.65);
    const light = clamp(env.daylight + world.sunBoost * 0.35);
    const lightFit = clamp(1 - Math.abs(light - rule.light) * 0.65, 0.2, 1);
    const quality = clamp(wetFit * 0.55 + nutrients * 0.25 + lightFit * 0.2) * env.temperature;
    plant.health = clamp(plant.health + dt * (quality > 0.42 ? 0.045 : -(0.42 - quality) * 0.2));
    if (world.terrain.fire[i] > 0.05) plant.health -= dt * world.terrain.fire[i] * 2.5;
    if (plant.age > rule.lifespan) plant.health -= dt * 0.12;
    plant.growth = clamp(plant.growth + dt / rule.matureAt * quality, 0.02, 1);
    if (plant.growth > 0.8 && quality > 0.35) plant.fruit = clamp(plant.fruit + dt * quality * 0.16);
    if (plant.growth > 0.82 && plant.health > 0.48 && world.plants.length + births.length < MAX_PLANTS) {
      const pollination = plant.species === 'flower' ? (plant.pollinated ? 2.8 : 0.14) : 1;
      if (random(world) < dt * rule.spread * quality * pollination) {
        const angle = random(world) * TAU, r = 1.2 + random(world) * rule.spreadRadius;
        const x = plant.x + Math.cos(angle) * r, y = plant.y + Math.sin(angle) * r;
        if (isLand(world, x, y)) {
          births.push({ species: plant.species, x, y });
          plant.pollinated = false;
          plant.fruit = clamp(plant.fruit - 0.15);
        }
      }
    }
    if (plant.health <= 0) killPlant(world, plant, world.terrain.fire[i] > 0.05 ? '在火中倒下' : '走到了生命的尽头');
  }
  world.plants = world.plants.filter(p => p.deadFor > -1000);
  for (const birth of births) spawnPlant(world, birth.species, birth.x, birth.y);
  if (raining || random(world) < 0.5) for (const spot of fungi) {
    const i = tileAt(world, spot.x, spot.y);
    if (i >= 0 && world.terrain.moisture[i] > 0.55) spawnPlant(world, 'mushroom', spot.x + random(world) - 0.5, spot.y + random(world) - 0.5);
  }
}

function updateAnimal(world: World, animal: Animal, dt: number, env: Environment): void {
  const rule = ANIMAL_RULES[animal.species];
  if (!animal.alive) {
    animal.deadFor += dt;
    return;
  }
  animal.age += dt;
  animal.hunger = clamp(animal.hunger + dt * rule.hungerRate);
  animal.thirst = clamp(animal.thirst + dt * rule.thirstRate);
  animal.repro = Math.max(0, animal.repro - dt);
  animal.think -= dt;
  animal.action = Math.max(0, animal.action - dt);
  if (animal.hunger > 0.88) animal.health -= dt * (animal.hunger - 0.82) * 0.5;
  if (animal.thirst > 0.88) animal.health -= dt * (animal.thirst - 0.82) * 0.65;
  if (animal.age > rule.lifespan) animal.health -= dt * 0.14;
  const i = tileAt(world, animal.x, animal.y);
  if (i >= 0 && world.terrain.fire[i] > 0.05) {
    animal.health -= dt * world.terrain.fire[i] * 1.8;
    animal.think = 0;
  }
  if (animal.health <= 0) {
    killAnimal(world, animal, animal.hunger > 0.9 ? '死于饥饿' : animal.thirst > 0.9 ? '死于干渴' : '结束了它的一生');
    return;
  }
  if (animal.think <= 0) chooseBehavior(world, animal);

  let targetPlant: Plant | undefined;
  let targetAnimal: Animal | undefined;
  if (animal.targetId !== null) {
    targetPlant = world.plants.find(p => p.id === animal.targetId);
    targetAnimal = world.animals.find(a => a.id === animal.targetId);
    if (targetPlant) { animal.tx = targetPlant.x; animal.ty = targetPlant.y; }
    if (targetAnimal) { animal.tx = targetAnimal.x; animal.ty = targetAnimal.y; }
  }
  if (animal.behavior === 'flee' && targetAnimal) {
    const d = Math.max(0.1, distance(animal, targetAnimal));
    animal.tx = clamp(animal.x + (animal.x - targetAnimal.x) / d * 12, 2, WORLD_W - 2);
    animal.ty = clamp(animal.y + (animal.y - targetAnimal.y) / d * 12, 2, WORLD_H - 2);
  }

  if (animal.behavior === 'drink' && nearWater(world, animal.x, animal.y, 1.7)) {
    animal.thirst = 0; animal.behavior = 'rest'; animal.think = 0.035;
  }
  if ((animal.behavior === 'seekFood' || animal.behavior === 'hunt') && animal.action <= 0) {
    if (targetPlant && targetPlant.alive && distance(animal, targetPlant) < 1.2) {
      const amount = animal.species === 'deer' ? 0.2 : 0.12;
      targetPlant.growth = clamp(targetPlant.growth - amount, 0.03, 1);
      targetPlant.health = clamp(targetPlant.health - amount * 0.3);
      targetPlant.fruit = clamp(targetPlant.fruit - 0.3);
      if (animal.species === 'bee') {
        if (!targetPlant.pollinated && random(world) < 0.12) logEvent(world, 'ecology', '一只野蜂完成了授粉，新的花种正在形成。', targetPlant.x, targetPlant.y);
        targetPlant.pollinated = true;
      }
      animal.hunger = clamp(animal.hunger - 0.5);
      animal.action = 0.045;
      animal.behavior = 'rest'; animal.think = 0.04;
    } else if (targetAnimal && distance(animal, targetAnimal) < 1.25) {
      if (!targetAnimal.alive) {
        animal.hunger = clamp(animal.hunger - 0.65);
        targetAnimal.deadFor += 0.5;
        animal.action = 0.06; animal.behavior = 'rest';
      } else if (animal.behavior === 'hunt') {
        targetAnimal.health -= rule.attack * (0.65 + random(world) * 0.65);
        targetAnimal.think = 0;
        animal.action = 0.025;
        if (targetAnimal.health <= 0) {
          killAnimal(world, targetAnimal, `被${rule.name}捕猎`);
          animal.hunger = clamp(animal.hunger - 0.75);
          animal.behavior = 'seekFood'; animal.action = 0.02;
        }
      }
    }
  }

  if (rule.diet === 'pollinator' && animal.age >= rule.matureAt && animal.repro <= 0 && animal.hunger < 0.35 && world.animals.length < MAX_ANIMALS) {
    const child = spawnAnimal(world, animal.species, animal.x + random(world) - 0.5, animal.y + random(world) - 0.5, 0, animal.id);
    if (child) {
      animal.repro = 1.4;
      if (random(world) < 0.2) logEvent(world, 'birth', '花海旁分出了一个新的蜂群。', animal.x, animal.y);
    }
  } else if (animal.behavior === 'court' && targetAnimal?.alive && targetAnimal.species === animal.species && animal.action <= 0 && distance(animal, targetAnimal) < 1.5) {
    if (animal.id < targetAnimal.id && world.animals.length < MAX_ANIMALS) {
      const litter = animal.species === 'rabbit' && random(world) < 0.45 ? 2 : 1;
      for (let n = 0; n < litter; n++) spawnAnimal(world, animal.species, animal.x + random(world), animal.y + random(world), 0, animal.id);
      animal.repro = animal.species === 'rabbit' ? 2.2 : animal.species === 'deer' || animal.species === 'wolf' ? 6 : 4;
      targetAnimal.repro = animal.repro;
      logEvent(world, 'birth', litter > 1 ? `两只${rule.name}幼崽出生了。` : `一只${rule.name}幼崽出生了。`, animal.x, animal.y);
    }
    animal.action = 0.1; animal.behavior = 'rest';
  }

  if (animal.behavior === 'rest') {
    animal.vx *= 0.5; animal.vy *= 0.5;
    animal.energy = clamp(animal.energy + dt * 0.7);
    return;
  }
  const dx = animal.tx - animal.x, dy = animal.ty - animal.y;
  const d = Math.hypot(dx, dy);
  if (d < 0.3) {
    animal.vx = animal.vy = 0;
    if (animal.behavior === 'wander' || animal.behavior === 'follow') { animal.behavior = 'rest'; animal.think = 0.03 + random(world) * 0.06; }
    return;
  }
  let speed = rule.speed * (animal.age < rule.matureAt ? 0.65 : 1) * (0.55 + animal.health * 0.45);
  if (animal.behavior === 'flee' || animal.behavior === 'hunt') speed *= 1.35;
  if (env.seasonIndex === 3) speed *= 0.86;
  const nx = animal.x + dx / d * speed * dt, ny = animal.y + dy / d * speed * dt;
  if ((animal.species === 'frog' || animal.species === 'bee') || isLand(world, nx, ny)) {
    animal.vx = dx / d * speed; animal.vy = dy / d * speed;
    animal.x = clamp(nx, 0.5, WORLD_W - 0.5); animal.y = clamp(ny, 0.5, WORLD_H - 0.5);
    animal.energy = clamp(animal.energy - dt * (animal.behavior === 'flee' ? 0.16 : 0.065));
  } else {
    animal.think = 0; animal.vx = animal.vy = 0;
  }
}

function updateAnimals(world: World, dt: number, env: Environment): void {
  const fungi: { x: number; y: number }[] = [];
  for (const animal of world.animals) {
    updateAnimal(world, animal, dt, env);
    if (!animal.alive && animal.deadFor >= 2.2) {
      const i = tileAt(world, animal.x, animal.y);
      if (i >= 0) world.terrain.nutrients[i] = clamp(world.terrain.nutrients[i] + 0.28);
      if (random(world) < 0.55) fungi.push({ x: animal.x, y: animal.y });
      animal.deadFor = -9999;
    }
  }
  world.animals = world.animals.filter(a => a.deadFor > -1000);
  for (const spot of fungi) spawnPlant(world, 'mushroom', spot.x, spot.y);
}

export function strike(world: World, x: number, y: number, divine = false): void {
  const i = tileAt(world, x, y);
  if (i < 0) return;
  if (world.terrain.biome[i] !== BIOME.WATER && world.terrain.biome[i] !== BIOME.VOID) world.terrain.fire[i] = 1;
  for (const plant of world.plants) if (plant.alive && Math.hypot(plant.x - x, plant.y - y) < 2.5) plant.health -= 0.5;
  for (const animal of world.animals) if (animal.alive && Math.hypot(animal.x - x, animal.y - y) < 2) animal.health -= 0.65;
  if (divine) logEvent(world, 'divine', '一道神雷劈落。火焰开始寻找可燃之物。', x, y);
}

function updateTerrain(world: World, dt: number, env: Environment): void {
  const terrain = world.terrain;
  const previousFire = terrain.fire.slice();
  const raining = world.weather.kind !== 'clear';
  const rain = world.weather.kind === 'storm' ? 1.5 : raining ? 1 : 0;
  for (let y = 0; y < WORLD_H; y++) for (let x = 0; x < WORLD_W; x++) {
    const i = tileIndex(x, y);
    if (terrain.biome[i] === BIOME.VOID) continue;
    if (terrain.biome[i] === BIOME.WATER) { terrain.moisture[i] = 1; terrain.fire[i] = 0; continue; }
    const evaporation = (0.015 + env.daylight * 0.032 + world.sunBoost * 0.06) * (env.seasonIndex === 3 ? 0.55 : 1);
    terrain.moisture[i] = clamp(terrain.moisture[i] + dt * (rain * 0.7 - evaporation));
    const old = previousFire[i];
    if (old > 0) {
      terrain.fire[i] = clamp(old + dt * (0.16 - terrain.moisture[i] * 0.65) - dt * (raining ? 4.5 : 0.85));
      terrain.nutrients[i] = clamp(terrain.nutrients[i] - dt * old * 0.025, 0.05, 1);
      if (!raining && terrain.fire[i] > 0.25) {
        const neighbors = [i - 1, i + 1, i - WORLD_W, i + WORLD_W];
        for (const n of neighbors) {
          if (n < 0 || n >= terrain.fire.length || terrain.biome[n] === BIOME.WATER || terrain.biome[n] === BIOME.VOID) continue;
          if (previousFire[n] <= 0 && random(world) < dt * old * (1 - terrain.moisture[n]) * 1.8) terrain.fire[n] = Math.max(terrain.fire[n], 0.5);
        }
      }
    } else terrain.fire[i] = 0;
  }
  if (world.weather.kind === 'storm' && random(world) < dt * 1.4) {
    for (let attempt = 0; attempt < 20; attempt++) {
      const x = random(world) * WORLD_W, y = random(world) * WORLD_H;
      if (isLand(world, x, y)) { strike(world, x, y); break; }
    }
  }
}

function updateWeather(world: World, dt: number): void {
  const previous = world.weather.kind;
  world.weather.remaining -= dt;
  world.sunBoost = Math.max(0, world.sunBoost - dt * 0.5);
  world.rainbow = Math.max(0, world.rainbow - dt * 0.4);
  if (world.weather.remaining > 0) return;
  if (previous !== 'clear') world.rainbow = 1;
  const roll = random(world);
  const kind: WeatherKind = roll < 0.58 ? 'clear' : roll < 0.9 ? 'rain' : 'storm';
  world.weather = { kind, remaining: kind === 'clear' ? 1.2 + random(world) * 2.8 : kind === 'rain' ? 0.5 + random(world) * 0.8 : 0.25 + random(world) * 0.35 };
  const text = kind === 'clear' ? '云层散开，暖光重新落到叶尖。' : kind === 'rain' ? '一场自然雨抵达了森林。' : '远雷滚过山谷，风暴来了。';
  logEvent(world, 'weather', text, 60, 40);
}

function maybeMigration(world: World): void {
  if (world.time < world.nextMigration) return;
  world.nextMigration = world.time + 4 + random(world) * 5;
  const counts = new Map<AnimalSpecies, number>();
  for (const animal of world.animals) if (animal.alive) counts.set(animal.species, (counts.get(animal.species) ?? 0) + 1);
  const candidates = ANIMAL_ORDER.filter(s => (counts.get(s) ?? 0) < (s === 'wolf' || s === 'fox' ? 2 : 4));
  if (!candidates.length || world.animals.length > MAX_ANIMALS - 6) return;
  const species = candidates[Math.floor(random(world) * candidates.length)];
  const point = findSpawn(world, species);
  if (!point) return;
  const count = species === 'bee' ? 4 : species === 'rabbit' || species === 'frog' ? 3 : 2;
  for (let n = 0; n < count; n++) spawnAnimal(world, species, point.x + random(world) * 2, point.y + random(world) * 2, ANIMAL_RULES[species].matureAt * (0.8 + random(world) * 0.4));
  logEvent(world, 'ecology', `迁徙的${ANIMAL_RULES[species].name}穿过边界，选择在这里停留。`, point.x, point.y);
}

/** 推进一个固定生态步长。直接修改 world，避免每帧复制大对象。 */
export function stepWorld(world: World): void {
  const dt = STEP_DAYS;
  world.time += dt;
  world.divine = clamp(world.divine + dt * 20, 0, 100);
  updateWeather(world, dt);
  const env = environmentAt(world.time);
  updateTerrain(world, dt, env);
  updatePlants(world, dt, env);
  updateAnimals(world, dt, env);
  maybeMigration(world);
}

export function advanceWorld(world: World, steps: number): void {
  for (let i = 0; i < steps; i++) stepWorld(world);
}

function pay(world: World, cost: number): ActionResult | null {
  if (world.divine + 1e-6 < cost) return { ok: false, message: `灵力不足，还需要 ${Math.ceil(cost - world.divine)} 点` };
  world.divine -= cost;
  return null;
}

export function applyPower(world: World, power: Power, x = WORLD_W / 2, y = WORLD_H / 2): ActionResult {
  if (power === 'inspect') return { ok: false, message: '点选一个生命，静静读它的故事。' };
  if (power === 'rain' || power === 'sun' || power === 'storm') {
    const info = POWER_INFO[power];
    const failure = pay(world, info.cost);
    if (failure) return failure;
    if (power === 'sun') {
      world.weather = { kind: 'clear', remaining: 1.5 }; world.sunBoost = 1; world.rainbow = 0;
      logEvent(world, 'divine', '你拨开云层，赐下一片晴光。', x, y);
      return { ok: true, message: '晴光降临，植物生长加快，水分也会更快蒸发。' };
    }
    world.weather = { kind: power, remaining: power === 'storm' ? 0.65 : 1.1 };
    logEvent(world, 'divine', power === 'storm' ? '你召来雷暴。森林在雨与火之间屏息。' : '你召来一场温柔而持久的雨。', x, y);
    return { ok: true, message: power === 'storm' ? '雷暴已抵达：强降雨中仍可能落下惊雷。' : '雨水正在渗入土壤。' };
  }
  if (power === 'bless') {
    const failure = pay(world, POWER_INFO.bless.cost);
    if (failure) return failure;
    for (const plant of world.plants) if (plant.alive && Math.hypot(plant.x - x, plant.y - y) < 9) plant.health = clamp(plant.health + 0.55);
    for (const animal of world.animals) if (animal.alive && Math.hypot(animal.x - x, animal.y - y) < 9) {
      animal.health = clamp(animal.health + 0.55); animal.hunger *= 0.25; animal.thirst *= 0.25;
    }
    for (let oy = -9; oy <= 9; oy++) for (let ox = -9; ox <= 9; ox++) {
      if (ox * ox + oy * oy > 81) continue;
      const i = tileAt(world, x + ox, y + oy);
      if (i >= 0) {
        world.terrain.moisture[i] = clamp(world.terrain.moisture[i] + 0.25);
        world.terrain.nutrients[i] = clamp(world.terrain.nutrients[i] + 0.2);
        world.terrain.fire[i] = 0;
      }
    }
    logEvent(world, 'divine', '金色孢子落下，这一片土地获得了赐福。', x, y);
    return { ok: true, message: '附近的创伤被抚平，土壤也恢复了生机。' };
  }
  if (power === 'lightning') {
    if (!isLand(world, x, y)) return { ok: false, message: '落雷需要一片真实的林地。' };
    const failure = pay(world, POWER_INFO.lightning.cost);
    if (failure) return failure;
    strike(world, x, y, true);
    return { ok: true, message: '雷霆落下。雨水、湿度和可燃物将决定火的去向。' };
  }
  if (PLANT_ORDER.includes(power as PlantSpecies)) {
    const species = power as PlantSpecies, rule = PLANT_RULES[species];
    if (!isLand(world, x, y)) return { ok: false, message: '种子只能落在岛屿的土壤中。' };
    const failure = pay(world, rule.cost);
    if (failure) return failure;
    const plant = spawnPlant(world, species, x, y);
    if (!plant) { world.divine += rule.cost; return { ok: false, message: '这里的植物已经太密集了。' }; }
    logEvent(world, 'divine', `你种下一粒${rule.name}的种子。`, x, y);
    return { ok: true, message: `${rule.name}已种下。湿度、光照与邻居会决定它的命运。` };
  }
  if (ANIMAL_ORDER.includes(power as AnimalSpecies)) {
    const species = power as AnimalSpecies, rule = ANIMAL_RULES[species];
    const point = findSpawn(world, species, { x, y }, 2.5);
    if (!point || Math.hypot(point.x - x, point.y - y) > 4) return { ok: false, message: species === 'frog' ? '树蛙需要临近水源的湿润林地。' : '这里没有适合它落脚的地方。' };
    const failure = pay(world, rule.cost);
    if (failure) return failure;
    const count = species === 'bee' ? 3 : 1;
    for (let n = 0; n < count; n++) spawnAnimal(world, species, point.x + random(world), point.y + random(world), rule.matureAt * 0.75);
    logEvent(world, 'divine', `你将${count > 1 ? '一小群' : '一只'}${rule.name}带入森林。`, point.x, point.y);
    return { ok: true, message: `${rule.name}已经到来。它会自己寻找食物、伴侣与归处。` };
  }
  return { ok: false, message: '未知神力。' };
}

export interface WorldStats {
  plants: number; animals: number; species: number; health: number; fires: number; births: number; deaths: number;
}

export function worldStats(world: World): WorldStats {
  let plants = 0, animals = 0, health = 0, fires = 0;
  const species = new Set<string>();
  for (const plant of world.plants) if (plant.alive) { plants++; species.add(plant.species); health += plant.health; }
  for (const animal of world.animals) if (animal.alive) { animals++; species.add(animal.species); health += animal.health; }
  for (const fire of world.terrain.fire) if (fire > 0.05) fires++;
  return {
    plants, animals, species: species.size, health: plants + animals ? health / (plants + animals) : 0, fires,
    births: world.events.filter(e => e.kind === 'birth').length, deaths: world.events.filter(e => e.kind === 'death').length,
  };
}

export function findEntity(world: World, id: number | null): Plant | Animal | null {
  if (id === null) return null;
  return world.plants.find(p => p.id === id) ?? world.animals.find(a => a.id === id) ?? null;
}

interface SavedWorld extends Omit<World, 'terrain'> {
  terrain: { biome: number[]; moisture: number[]; nutrients: number[]; fire: number[]; elevation: number[] };
}

export function serializeWorld(world: World): string {
  const saved: SavedWorld = {
    ...world,
    terrain: {
      biome: Array.from(world.terrain.biome),
      moisture: Array.from(world.terrain.moisture),
      nutrients: Array.from(world.terrain.nutrients),
      fire: Array.from(world.terrain.fire),
      elevation: Array.from(world.terrain.elevation),
    },
  };
  return JSON.stringify(saved);
}

export function deserializeWorld(text: string): World {
  const data = JSON.parse(text) as SavedWorld;
  const size = WORLD_W * WORLD_H;
  if (data.version !== WORLD_VERSION || !Number.isFinite(data.seed) || !data.terrain || data.terrain.biome.length !== size || !Array.isArray(data.plants) || !Array.isArray(data.animals)) throw new Error('无效或不兼容的森林存档');
  for (const key of ['moisture', 'nutrients', 'fire', 'elevation'] as const) if (data.terrain[key].length !== size) throw new Error('森林地形存档不完整');
  return {
    ...data,
    rng: data.rng >>> 0,
    terrain: {
      biome: new Uint8Array(data.terrain.biome), moisture: new Float32Array(data.terrain.moisture),
      nutrients: new Float32Array(data.terrain.nutrients), fire: new Float32Array(data.terrain.fire), elevation: new Float32Array(data.terrain.elevation),
    },
  };
}
