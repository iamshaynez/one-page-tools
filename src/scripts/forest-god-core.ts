import {
  ANIMAL_RULES, ANIMAL_ORDER, DAYS_PER_SEASON, MAX_ANIMALS, MAX_BONDS, MAX_BURROWS, MAX_DAMS, MAX_EVENTS, MAX_MEMORIALS, MAX_MEMORIES, MAX_PLANTS,
  PLANT_RULES, PLANT_ORDER, POWER_INFO, SEASONS, STEP_DAYS, WORLD_H, WORLD_VERSION, WORLD_W, clamp,
} from './forest-god-content';
import type {
  AnimalSpecies, Behavior, EventKind, PlantSpecies, Power, Season, WeatherKind,
} from './forest-god-content';
import { OBJECTIVES, TRAITS, identityFor } from './forest-god-identity';
import type { Bond, LifeMemory, MemoryKind, ObjectiveId, TraitId } from './forest-god-identity';

/** 0=界外，1=草甸，2=林地，3=河岸，4=水，5=岩石 */
export const BIOME = { VOID: 0, MEADOW: 1, FOREST: 2, BANK: 3, WATER: 4, ROCK: 5 } as const;

export interface Terrain {
  biome: Uint8Array;
  moisture: Float32Array;
  nutrients: Float32Array;
  fire: Float32Array;
  elevation: Float32Array;
  trail: Uint8Array;
  water: Float32Array;
  succession: Uint8Array;
}

export interface IdentityState {
  name: string;
  traits: TraitId[];
  bond: Bond | null;
  memories: LifeMemory[];
  generation: number;
  parentIds: number[];
  offspring: number[];
  homeX: number;
  homeY: number;
}

export interface Plant extends IdentityState {
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

export interface CarriedSeed {
  species: 'berry';
  parentId: number;
  originX: number;
  originY: number;
  delay: number;
}

export interface Animal extends IdentityState {
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
  wood: number;
  seed: CarriedSeed | null;
  structureId: number | null;
  lastTrailTile: number;
}

export interface ForestEvent {
  id: number;
  at: number;
  kind: EventKind;
  text: string;
  x: number;
  y: number;
  entityId?: number;
}

export interface Memorial {
  id: number;
  kind: 'plant' | 'animal';
  species: PlantSpecies | AnimalSpecies;
  name: string;
  traits: TraitId[];
  bond: Bond;
  generation: number;
  parentIds: number[];
  offspring: number[];
  memories: LifeMemory[];
  age: number;
  diedAt: number;
  x: number;
  y: number;
  variant: number;
}

export interface WorldProgress {
  completed: ObjectiveId[];
  lifetimeBonds: number;
  lifetimeBirths: number;
  bondedBirths: number;
  maxGeneration: number;
  pollinations: number;
  fireSeen: boolean;
}

export interface WorldStructure {
  id: number;
  kind: 'burrow' | 'dam';
  x: number;
  y: number;
  progress: number;
  integrity: number;
  ownerId: number;
  createdAt: number;
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
  aurora: number;
  nextMigration: number;
  terrain: Terrain;
  plants: Plant[];
  animals: Animal[];
  events: ForestEvent[];
  memorials: Memorial[];
  progress: WorldProgress;
  structures: WorldStructure[];
  terrainTick: number;
  pathRecorded: boolean;
}

export interface ActionResult {
  ok: boolean;
  message: string;
  power?: Power;
  x?: number;
  y?: number;
  entityIds?: number[];
  affectedIds?: number[];
}
export interface Environment { day: number; daylight: number; season: Season; seasonIndex: number; year: number; temperature: number }

const TAU = Math.PI * 2;
const TOTAL_SPECIES = PLANT_ORDER.length + ANIMAL_ORDER.length;
const PLANT_CAPACITY: Record<PlantSpecies, number> = { grass: 115, flower: 52, berry: 28, oak: 40, pine: 36, fern: 42, mushroom: 42 };
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
  return i >= 0 && (world.terrain.biome[i] === BIOME.WATER || world.terrain.water[i] > 0.28);
}

export function isLand(world: World, x: number, y: number): boolean {
  const i = tileAt(world, x, y);
  return i >= 0 && world.terrain.biome[i] !== BIOME.VOID && !isWater(world, x, y);
}

function generateTerrain(seed: number): Terrain {
  const size = WORLD_W * WORLD_H;
  const terrain: Terrain = {
    biome: new Uint8Array(size), moisture: new Float32Array(size),
    nutrients: new Float32Array(size), fire: new Float32Array(size), elevation: new Float32Array(size),
    trail: new Uint8Array(size), water: new Float32Array(size), succession: new Uint8Array(size),
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
        terrain.water[i] = 0.65;
        terrain.succession[i] = 128;
      } else {
        const bank = wetDistance < riverWidth + 2 || (((x - 82) / 11) ** 2 + ((y - 38) / 8.5) ** 2 < 1);
        const patch = fbm(seed + 307, x * 0.09, y * 0.09);
        terrain.biome[i] = bank ? BIOME.BANK : patch > 0.72 && elevation > 0.57 ? BIOME.ROCK : patch > 0.43 ? BIOME.FOREST : BIOME.MEADOW;
        terrain.moisture[i] = clamp(0.25 + patch * 0.34 + Math.max(0, 1 - wetDistance / 15) * 0.25);
        terrain.nutrients[i] = clamp(0.35 + fbm(seed + 601, x * 0.12, y * 0.12) * 0.5);
        terrain.succession[i] = terrain.biome[i] === BIOME.FOREST ? 255 : terrain.biome[i] === BIOME.MEADOW ? 0 : 128;
      }
    }
  }
  return terrain;
}

function remember(world: World, entity: Plant | Animal, kind: MemoryKind, text: string, relatedId?: number): void {
  entity.memories.push({ at: world.time, kind, text, x: entity.x, y: entity.y, ...(relatedId === undefined ? {} : { relatedId }) });
  if (entity.memories.length > MAX_MEMORIES) entity.memories.splice(0, entity.memories.length - MAX_MEMORIES);
}

function hasTrait(entity: Plant | Animal, trait: TraitId): boolean {
  return entity.traits.includes(trait);
}

function logEvent(world: World, kind: EventKind, text: string, x: number, y: number, entityId?: number): void {
  world.events.unshift({ id: world.nextId++, at: world.time, kind, text, x, y, ...(entityId === undefined ? {} : { entityId }) });
  if (world.events.length > MAX_EVENTS) world.events.length = MAX_EVENTS;
}

function spawnPlant(world: World, species: PlantSpecies, x: number, y: number, age = 0, parent: Plant | null = null): Plant | null {
  if (world.plants.length >= MAX_PLANTS || !isLand(world, x, y)) return null;
  const id = world.nextId++;
  const identity = identityFor(world.seed, id, parent?.traits);
  const plant: Plant = {
    id, species, x, y, age,
    growth: age <= 0 ? 0.04 : clamp(age / PLANT_RULES[species].matureAt, 0.15, 1),
    health: 0.82 + random(world) * 0.18, fruit: age > PLANT_RULES[species].matureAt ? random(world) * 0.8 : 0,
    pollinated: false, alive: true, deadFor: 0, variant: Math.floor(random(world) * 8),
    name: identity.name, traits: identity.traits, bond: null, memories: [],
    generation: parent ? parent.generation + 1 : 1, parentIds: parent ? [parent.id] : [], offspring: [], homeX: x, homeY: y,
  };
  world.plants.push(plant);
  if (parent) {
    if (!parent.offspring.includes(id)) parent.offspring.push(id);
    remember(world, plant, 'birth', `从${parent.name}的种子中萌芽。`, parent.id);
    remember(world, parent, 'offspring', `${plant.name}在附近萌芽。`, id);
    world.progress.lifetimeBirths++;
    if (parent.bond) world.progress.bondedBirths++;
    world.progress.maxGeneration = Math.max(world.progress.maxGeneration, plant.generation);
  }
  return plant;
}

function spawnAnimal(world: World, species: AnimalSpecies, x: number, y: number, age = 0, parent: Animal | number | null = null, secondParent: Animal | null = null): Animal | null {
  if (world.animals.length >= MAX_ANIMALS || tileAt(world, x, y) < 0) return null;
  if (species !== 'frog' && species !== 'bee' && species !== 'beaver' && !isLand(world, x, y)) return null;
  if ((species === 'frog' || species === 'beaver') && !nearWater(world, x, y, 5)) return null;
  const primary = typeof parent === 'number' ? world.animals.find(a => a.id === parent) ?? null : parent;
  const parents = [...new Set([primary, secondParent].filter((p): p is Animal => !!p))];
  const id = world.nextId++;
  const identity = identityFor(world.seed, id, parents.flatMap(p => p.traits));
  const animal: Animal = {
    id, species, x, y, vx: 0, vy: 0, tx: x, ty: y, age,
    health: 0.85 + random(world) * 0.15, hunger: random(world) * 0.3, thirst: random(world) * 0.25,
    energy: 0.65 + random(world) * 0.35, sex: random(world) < 0.5 ? 0 : 1,
    behavior: 'wander', targetId: null, parentId: primary?.id ?? null, think: random(world) * 0.03,
    action: 0, repro: age > ANIMAL_RULES[species].matureAt ? random(world) * 2 : 0,
    alive: true, deadFor: 0, variant: Math.floor(random(world) * 8),
    name: identity.name, traits: identity.traits, bond: null, memories: [],
    generation: parents.length ? Math.max(...parents.map(p => p.generation)) + 1 : 1,
    parentIds: parents.map(p => p.id), offspring: [], homeX: x, homeY: y,
    wood: 0, seed: null, structureId: null, lastTrailTile: -1,
  };
  world.animals.push(animal);
  if (parents.length && age === 0) {
    for (const p of parents) {
      if (!p.offspring.includes(id)) p.offspring.push(id);
      remember(world, p, 'offspring', `${animal.name}出生了，世界多了一段新的血脉。`, id);
    }
    remember(world, animal, 'birth', `在${parents.map(p => p.name).join('与')}的陪伴下来到森林。`, primary?.id);
    world.progress.lifetimeBirths++;
    if (parents.some(p => p.bond)) world.progress.bondedBirths++;
    world.progress.maxGeneration = Math.max(world.progress.maxGeneration, animal.generation);
  }
  return animal;
}

function findSpawn(world: World, species: PlantSpecies | AnimalSpecies, near?: { x: number; y: number }, radius = 8): { x: number; y: number } | null {
  for (let attempt = 0; attempt < 72; attempt++) {
    const x = near ? near.x + (random(world) * 2 - 1) * radius : 5 + random(world) * (WORLD_W - 10);
    const y = near ? near.y + (random(world) * 2 - 1) * radius : 5 + random(world) * (WORLD_H - 10);
    if (species === 'frog' || species === 'beaver') {
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
    weather: { kind: 'clear', remaining: 1.8 }, sunBoost: 0, rainbow: 0, divine: 100, aurora: 0,
    nextMigration: 4, terrain: generateTerrain(seed), plants: [], animals: [], events: [], memorials: [], structures: [], terrainTick: 0, pathRecorded: false,
    progress: { completed: [], lifetimeBonds: 0, lifetimeBirths: 0, bondedBirths: 0, maxGeneration: 1, pollinations: 0, fireSeen: false },
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
  const initialAnimals: [AnimalSpecies, number][] = [['rabbit', 12], ['deer', 7], ['fox', 4], ['wolf', 3], ['bee', 10], ['frog', 6], ['beaver', 3]];
  for (const [species, count] of initialAnimals) {
    for (let n = 0; n < count; n++) {
      const point = findSpawn(world, species, species === 'frog' || species === 'beaver' ? { x: 80, y: 38 } : undefined, 25);
      if (point) spawnAnimal(world, species, point.x, point.y, random(world) * ANIMAL_RULES[species].matureAt * 1.8);
    }
  }
  logEvent(world, 'ecology', '第一缕风越过树冠。这里开始拥有自己的历史。', 60, 40);
  return world;
}

function createMemorial(world: World, entity: Plant | Animal, kind: 'plant' | 'animal', reason: string): void {
  if (!entity.bond || world.memorials.some(m => m.id === entity.id)) return;
  remember(world, entity, 'death', `${reason}。它的一生被森林保留了下来。`);
  world.memorials.unshift({
    id: entity.id, kind, species: entity.species, name: entity.bond.name, traits: [...entity.traits],
    bond: { ...entity.bond }, generation: entity.generation, parentIds: [...entity.parentIds],
    offspring: [...entity.offspring], memories: entity.memories.map(m => ({ ...m })), age: entity.age,
    diedAt: world.time, x: entity.x, y: entity.y, variant: entity.variant,
  });
  if (world.memorials.length > MAX_MEMORIALS) world.memorials.length = MAX_MEMORIALS;
}

function killPlant(world: World, plant: Plant, reason: string): void {
  if (!plant.alive) return;
  plant.alive = false;
  plant.health = 0;
  plant.deadFor = 0;
  createMemorial(world, plant, 'plant', reason);
  if (plant.species === 'oak' || plant.species === 'pine' || plant.species === 'berry' || plant.bond) {
    logEvent(world, 'death', `${plant.bond?.name ?? PLANT_RULES[plant.species].name}${reason}，慢慢归还给土壤。`, plant.x, plant.y, plant.id);
  }
}

function killAnimal(world: World, animal: Animal, reason: string): void {
  if (!animal.alive) return;
  animal.alive = false;
  animal.health = 0;
  animal.vx = animal.vy = 0;
  animal.deadFor = 0;
  createMemorial(world, animal, 'animal', reason);
  logEvent(world, 'death', `${animal.bond?.name ?? ANIMAL_RULES[animal.species].name}${reason}。`, animal.x, animal.y, animal.id);
}

function nearestWater(world: World, x: number, y: number, maxRadius = 22): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null;
  let bestD = maxRadius * maxRadius;
  const minX = Math.max(0, Math.floor(x - maxRadius)), maxX = Math.min(WORLD_W - 1, Math.ceil(x + maxRadius));
  const minY = Math.max(0, Math.floor(y - maxRadius)), maxY = Math.min(WORLD_H - 1, Math.ceil(y + maxRadius));
  for (let ty = minY; ty <= maxY; ty++) for (let tx = minX; tx <= maxX; tx++) {
    if (!isWater(world, tx + 0.5, ty + 0.5)) continue;
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

function hasPopulationRoom(world: World, species: AnimalSpecies): boolean {
  const count = world.animals.filter(a => a.alive && a.species === species).length;
  const caps: Record<AnimalSpecies, number> = { rabbit: 30, deer: 18, fox: 10, wolf: 8, bee: 28, frog: 16, beaver: 8 };
  if (count >= caps[species]) return false;
  if (species === 'bee') {
    const flowers = world.plants.filter(p => p.alive && p.species === 'flower' && p.growth > 0.5).length;
    return count < Math.min(28, 6 + flowers);
  }
  return true;
}

function createStructure(world: World, kind: 'burrow' | 'dam', x: number, y: number, ownerId: number): WorldStructure | null {
  const count = world.structures.filter(s => s.kind === kind).length;
  if ((kind === 'dam' ? count >= MAX_DAMS : count >= MAX_BURROWS)) return null;
  if (world.structures.some(s => Math.hypot(s.x - x, s.y - y) < 1)) return null;
  if (kind === 'burrow' && (!isLand(world, x, y) || world.terrain.biome[tileAt(world, x, y)] === BIOME.ROCK)) return null;
  if (kind === 'dam') {
    if (!isWater(world, x, y)) return null;
    if (!isLand(world, x + 1, y) && !isLand(world, x - 1, y) && !isLand(world, x, y + 1) && !isLand(world, x, y - 1)) return null;
  }
  const structure: WorldStructure = { id: world.nextId++, kind, x, y, progress: 0, integrity: 1, ownerId, createdAt: world.time };
  world.structures.push(structure);
  return structure;
}

function findDamSite(world: World, animal: Animal): WorldStructure | null {
  let best: { x: number; y: number } | null = null, bestD = 14 * 14;
  for (let y = Math.max(2, Math.floor(animal.y) - 14); y <= Math.min(WORLD_H - 3, Math.ceil(animal.y) + 14); y++) {
    for (let x = Math.max(2, Math.floor(animal.x) - 14); x <= Math.min(WORLD_W - 3, Math.ceil(animal.x) + 14); x++) {
      if (!isWater(world, x + 0.5, y + 0.5)) continue;
      if (!isLand(world, x + 1.5, y + 0.5) && !isLand(world, x - 1.5, y + 0.5) && !isLand(world, x + 0.5, y + 1.5) && !isLand(world, x + 0.5, y - 1.5)) continue;
      if (world.structures.some(s => s.kind === 'dam' && Math.hypot(s.x - x, s.y - y) < 3)) continue;
      const d = (x - animal.x) ** 2 + (y - animal.y) ** 2;
      if (d < bestD) { bestD = d; best = { x: x + 0.5, y: y + 0.5 }; }
    }
  }
  return best ? createStructure(world, 'dam', best.x, best.y, animal.id) : null;
}

function shareWolfTarget(world: World, wolf: Animal, prey: Animal): void {
  let shared = 0;
  for (const pack of world.animals) {
    if (shared >= 3 || pack.id === wolf.id || !pack.alive || pack.species !== 'wolf' || Math.hypot(pack.x - wolf.x, pack.y - wolf.y) > ANIMAL_RULES.wolf.sense * 1.25) continue;
    const existing = pack.targetId === null ? null : world.animals.find(a => a.id === pack.targetId && a.alive);
    if (existing) continue;
    pack.behavior = 'hunt'; pack.targetId = prey.id; pack.tx = prey.x; pack.ty = prey.y; pack.think = 0.04;
    shared++;
  }
}

function chooseBehavior(world: World, animal: Animal, env: Environment): void {
  const rule = ANIMAL_RULES[animal.species];
  animal.structureId = null;
  const threat = rule.predators.length ? nearestAnimal(world, animal, rule.predators) : null;
  if (threat && distance(animal, threat) < rule.sense * 0.75) {
    const close = distance(animal, threat) < rule.sense * (hasTrait(animal, 'swift') ? 0.65 : 0.48);
    animal.behavior = close ? 'flee' : 'alert'; animal.targetId = threat.id;
    animal.think = close ? 0.012 + random(world) * 0.015 : 0.018;
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
  if ((world.weather.kind === 'storm' || world.weather.kind === 'snow') && animal.species !== 'bee' && animal.species !== 'frog' && animal.hunger < 0.7) {
    let shelter: Plant | null = null, shelterD = 18 * 18;
    for (const plant of world.plants) {
      if (!plant.alive || (plant.species !== 'oak' && plant.species !== 'pine') || plant.growth < 0.65) continue;
      const d = (plant.x - animal.x) ** 2 + (plant.y - animal.y) ** 2;
      if (d < shelterD) { shelterD = d; shelter = plant; }
    }
    if (shelter) {
      animal.behavior = 'shelter'; animal.targetId = shelter.id; animal.tx = shelter.x; animal.ty = shelter.y;
      animal.think = 0.08 + random(world) * 0.05;
      return;
    }
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
        if (animal.species === 'wolf' && prey.alive) shareWolfTarget(world, animal, prey);
        return;
      }
      if (rule.diet === 'insectivore' && nearWater(world, animal.x, animal.y, 7)) {
        animal.hunger = clamp(animal.hunger - 0.3);
        animal.behavior = 'rest'; animal.think = 0.06;
        return;
      }
    }
  }
  if (animal.species === 'beaver') {
    if (animal.wood <= 0) {
      let tree: Plant | null = null, treeD = 22 * 22;
      for (const plant of world.plants) {
        if (!plant.alive || (plant.species !== 'oak' && plant.species !== 'pine') || plant.growth < 0.75) continue;
        const d = (plant.x - animal.x) ** 2 + (plant.y - animal.y) ** 2;
        if (d < treeD) { treeD = d; tree = plant; }
      }
      if (tree) {
        animal.behavior = 'fell'; animal.targetId = tree.id; animal.tx = tree.x; animal.ty = tree.y; animal.think = 0.05;
        return;
      }
    } else {
      let dam = world.structures.find(s => s.kind === 'dam' && (s.progress < 1 || s.integrity < 0.8) && Math.hypot(s.x - animal.x, s.y - animal.y) < 20) ?? null;
      if (!dam) dam = findDamSite(world, animal);
      if (dam) {
        animal.behavior = 'build'; animal.targetId = null; animal.structureId = dam.id;
        animal.tx = dam.x; animal.ty = dam.y; animal.think = 0.05;
        return;
      }
    }
  }
  if (animal.species === 'rabbit') {
    let burrow: WorldStructure | null = null, burrowD = 14 * 14;
    for (const structure of world.structures) {
      if (structure.kind !== 'burrow') continue;
      const d = (structure.x - animal.x) ** 2 + (structure.y - animal.y) ** 2;
      if (d < burrowD) { burrowD = d; burrow = structure; }
    }
    const adverse = world.weather.kind === 'rain' || world.weather.kind === 'storm' || world.weather.kind === 'snow';
    if (burrow && burrow.progress >= 1 && adverse) {
      animal.behavior = 'shelter'; animal.targetId = null; animal.structureId = burrow.id;
      animal.tx = burrow.x; animal.ty = burrow.y; animal.think = 0.08;
      return;
    }
    if (burrow && burrow.progress < 1) {
      animal.behavior = 'dig'; animal.targetId = null; animal.structureId = burrow.id;
      animal.tx = burrow.x; animal.ty = burrow.y; animal.think = 0.05;
      return;
    }
    if (!burrow && (adverse || random(world) < 0.35)) {
      const created = createStructure(world, 'burrow', animal.x, animal.y, animal.id);
      if (created) {
        animal.behavior = 'dig'; animal.targetId = null; animal.structureId = created.id;
        animal.tx = created.x; animal.ty = created.y; animal.think = 0.05;
        return;
      }
    }
  }
  const parent = animal.parentId === null ? null : world.animals.find(a => a.id === animal.parentId && a.alive);
  if (parent && animal.age < rule.matureAt * 0.75 && distance(animal, parent) > 2.5) {
    animal.behavior = 'follow'; animal.targetId = parent.id; animal.think = 0.06;
    return;
  }
  if ((animal.species === 'deer' || animal.species === 'rabbit') && animal.age >= rule.matureAt && random(world) < (hasTrait(animal, 'gentle') ? 0.5 : 0.28)) {
    const herd = world.animals.find(a => a.alive && a.id !== animal.id && a.species === animal.species && distance(a, animal) > 4 && distance(a, animal) < rule.sense * 1.5);
    if (herd) {
      animal.behavior = 'follow'; animal.targetId = herd.id; animal.think = 0.06;
      return;
    }
  }
  const sleepTime = rule.nocturnal ? env.daylight > 0.72 : env.daylight < 0.06;
  if (animal.energy < 0.2 || (sleepTime && animal.energy < 0.82) || (animal.energy < 0.65 && random(world) < 0.16)) {
    animal.behavior = 'rest'; animal.targetId = null; animal.think = 0.04 + random(world) * 0.06;
    return;
  }
  if (animal.age >= rule.matureAt && animal.repro <= 0 && animal.hunger < 0.55 && animal.health > 0.5 && rule.diet !== 'pollinator' && hasPopulationRoom(world, animal.species)) {
    const mate = world.animals.find(a => a.alive && a.id !== animal.id && a.species === animal.species && a.sex !== animal.sex && a.age >= rule.matureAt && a.repro <= 0 && distance(a, animal) < rule.sense);
    if (mate) {
      animal.behavior = 'court'; animal.targetId = mate.id; animal.think = 0.05;
      return;
    }
  }
  const playful = animal.age < rule.matureAt || hasTrait(animal, 'curious') || (animal.species === 'frog' && world.weather.kind === 'rain');
  if (playful && random(world) < 0.48) {
    const angle = random(world) * TAU;
    animal.behavior = 'play'; animal.targetId = null;
    animal.tx = clamp(animal.x + Math.cos(angle) * 4, 2, WORLD_W - 2);
    animal.ty = clamp(animal.y + Math.sin(angle) * 4, 2, WORLD_H - 2);
    animal.think = 0.025 + random(world) * 0.035;
    return;
  }
  if (random(world) < (hasTrait(animal, 'gentle') ? 0.38 : 0.2)) {
    animal.behavior = 'groom'; animal.targetId = null; animal.think = 0.035 + random(world) * 0.04;
    return;
  }
  if (animal.species === 'deer') {
    let trailTile = -1, trailStrength = 45;
    for (let oy = -8; oy <= 8; oy++) for (let ox = -8; ox <= 8; ox++) {
      if (ox * ox + oy * oy < 4 || ox * ox + oy * oy > 64) continue;
      const i = tileAt(world, animal.x + ox, animal.y + oy);
      if (i >= 0 && world.terrain.trail[i] > trailStrength) { trailStrength = world.terrain.trail[i]; trailTile = i; }
    }
    if (trailTile >= 0) {
      animal.behavior = 'wander'; animal.targetId = null;
      animal.tx = trailTile % WORLD_W + 0.5; animal.ty = Math.floor(trailTile / WORLD_W) + 0.5;
      animal.think = 0.06 + random(world) * 0.05;
      return;
    }
  }
  const angle = random(world) * TAU, length = 4 + random(world) * 10;
  const origin = hasTrait(animal, 'curious') ? animal : { x: animal.homeX, y: animal.homeY };
  animal.behavior = 'wander'; animal.targetId = null;
  animal.tx = clamp(origin.x + Math.cos(angle) * length, 2, WORLD_W - 2);
  animal.ty = clamp(origin.y + Math.sin(angle) * length, 2, WORLD_H - 2);
  animal.think = 0.045 + random(world) * 0.09;
}

function updatePlants(world: World, dt: number, env: Environment): void {
  const births: { species: PlantSpecies; x: number; y: number; parent: Plant }[] = [];
  const fungi: { x: number; y: number }[] = [];
  const living: Record<PlantSpecies, number> = { grass: 0, flower: 0, berry: 0, oak: 0, pine: 0, fern: 0, mushroom: 0 };
  for (const plant of world.plants) if (plant.alive) living[plant.species]++;
  const raining = world.weather.kind === 'rain' || world.weather.kind === 'storm' || world.weather.kind === 'mist';
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
    const biome = world.terrain.biome[i];
    const biomeFit = biome === BIOME.FOREST
      ? (plant.species === 'fern' || plant.species === 'mushroom' || plant.species === 'oak' || plant.species === 'pine' ? 1.1 : 0.9)
      : biome === BIOME.MEADOW ? (plant.species === 'grass' || plant.species === 'flower' ? 1.12 : 0.95) : 1;
    const floodStress = Math.max(0, world.terrain.water[i] - 0.28);
    const quality = clamp(wetFit * 0.55 + nutrients * 0.25 + lightFit * 0.2) * env.temperature * biomeFit * clamp(1 - floodStress)
      * (hasTrait(plant, 'fertile') ? 1.18 : 1) * (hasTrait(plant, 'deepRoot') ? 1.12 : 1);
    plant.health = clamp(plant.health + dt * (quality > 0.42 ? 0.045 : -(0.42 - quality) * (hasTrait(plant, 'hardy') ? 0.12 : 0.2)));
    if (world.terrain.fire[i] > 0.05) plant.health -= dt * world.terrain.fire[i] * 2.5;
    if (floodStress > 0) plant.health -= dt * floodStress * (plant.species === 'fern' ? 0.08 : 0.24);
    if (plant.age > rule.lifespan) plant.health -= dt * 0.12;
    plant.growth = clamp(plant.growth + dt / rule.matureAt * quality, 0.02, 1);
    if (plant.growth >= 0.82 && !plant.memories.some(m => m.kind === 'adult')) {
      remember(world, plant, 'adult', plant.species === 'oak' || plant.species === 'pine' ? '树冠终于能够为别的生命遮风挡雨。' : '第一次真正繁茂地展开。');
      if (plant.bond) logEvent(world, 'milestone', `${plant.bond.name}进入了最繁茂的年岁。`, plant.x, plant.y, plant.id);
    }
    if (plant.growth > 0.8 && quality > 0.35) plant.fruit = clamp(plant.fruit + dt * quality * (hasTrait(plant, 'sweet') ? 0.23 : 0.16));
    if (plant.growth > 0.82 && plant.health > 0.48 && world.plants.length + births.length < MAX_PLANTS && living[plant.species] < PLANT_CAPACITY[plant.species]) {
      const pollination = plant.species === 'flower' ? (plant.pollinated ? 2.8 : 0.14) : 1;
      if (random(world) < dt * rule.spread * quality * pollination) {
        let neighbors = 0;
        for (const other of world.plants) if (other.alive && other.species === plant.species && Math.hypot(other.x - plant.x, other.y - plant.y) < 2.2) neighbors++;
        if (neighbors >= 5) continue;
        const angle = random(world) * TAU, r = 1.2 + random(world) * rule.spreadRadius;
        const x = plant.x + Math.cos(angle) * r, y = plant.y + Math.sin(angle) * r;
        if (isLand(world, x, y)) {
          births.push({ species: plant.species, x, y, parent: plant });
          living[plant.species]++;
          plant.pollinated = false;
          plant.fruit = clamp(plant.fruit - 0.15);
        }
      }
    }
    if (plant.health <= 0) killPlant(world, plant, world.terrain.fire[i] > 0.05 ? '在火中倒下' : '走到了生命的尽头');
  }
  world.plants = world.plants.filter(p => p.deadFor > -1000);
  for (const birth of births) spawnPlant(world, birth.species, birth.x, birth.y, 0, birth.parent);
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
  animal.hunger = clamp(animal.hunger + dt * rule.hungerRate * (hasTrait(animal, 'hardy') ? 0.86 : 1));
  animal.thirst = clamp(animal.thirst + dt * rule.thirstRate * (hasTrait(animal, 'hardy') ? 0.86 : 1));
  if (animal.age >= rule.matureAt && !animal.memories.some(m => m.kind === 'adult')) {
    remember(world, animal, 'adult', '长大了，开始独自寻找食物、领地与伴侣。');
    if (animal.bond) logEvent(world, 'milestone', `${animal.bond.name}成年了。`, animal.x, animal.y, animal.id);
  }
  animal.repro = Math.max(0, animal.repro - dt);
  animal.think -= dt;
  animal.action = Math.max(0, animal.action - dt);
  if (animal.hunger > 0.88) animal.health -= dt * (animal.hunger - 0.82) * 0.5;
  if (animal.thirst > 0.88) animal.health -= dt * (animal.thirst - 0.82) * 0.65;
  if (animal.age > rule.lifespan * (hasTrait(animal, 'hardy') ? 1.16 : 1)) animal.health -= dt * 0.14;
  const i = tileAt(world, animal.x, animal.y);
  if (i >= 0 && world.terrain.fire[i] > 0.05) {
    animal.health -= dt * world.terrain.fire[i] * 1.8;
    animal.think = 0;
  }
  if (i >= 0 && world.terrain.water[i] > 0.32 && animal.species !== 'frog' && animal.species !== 'bee' && animal.species !== 'beaver') {
    animal.behavior = 'flee'; animal.targetId = null; animal.structureId = null; animal.think = 0;
    animal.tx = isLand(world, animal.homeX, animal.homeY) ? animal.homeX : clamp(animal.x + 4, 2, WORLD_W - 2);
    animal.ty = isLand(world, animal.homeX, animal.homeY) ? animal.homeY : animal.y;
  }
  if (animal.health < 0.35 && !animal.memories.some(m => m.kind === 'injury')) {
    remember(world, animal, 'injury', '经历了一次重伤，仍努力寻找活下去的办法。');
  }
  if (animal.health <= 0) {
    killAnimal(world, animal, animal.hunger > 0.9 ? '死于饥饿' : animal.thirst > 0.9 ? '死于干渴' : '结束了它的一生');
    return;
  }
  if (animal.seed) {
    animal.seed.delay -= dt;
    if (animal.seed.delay <= 0 && Math.hypot(animal.x - animal.seed.originX, animal.y - animal.seed.originY) >= 3 && isLand(world, animal.x, animal.y)) {
      const seed = animal.seed;
      const berryCount = world.plants.filter(p => p.alive && p.species === 'berry').length;
      if (berryCount < PLANT_CAPACITY.berry) {
        const parent = world.plants.find(p => p.id === seed.parentId && p.alive) ?? null;
        const child = spawnPlant(world, 'berry', animal.x, animal.y, 0, parent);
        if (child) {
          remember(world, animal, 'offspring', `把${parent?.name ?? '一株浆果'}的种子带到了新的土地。`, child.id);
          if (animal.bond || parent?.bond) logEvent(world, 'ecology', `${animal.name}传播的一粒浆果种子，在远离母株的地方发芽了。`, child.x, child.y, child.id);
          animal.seed = null;
        }
      }
    }
  }
  if (animal.think <= 0) chooseBehavior(world, animal, env);

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
  const structure = animal.structureId === null ? null : world.structures.find(s => s.id === animal.structureId);
  if (animal.behavior === 'fell' && targetPlant?.alive && animal.action <= 0 && distance(animal, targetPlant) < 1.5) {
    targetPlant.health -= 0.28;
    animal.action = 0.04; animal.vx = animal.vy = 0;
    if (targetPlant.health <= 0) {
      killPlant(world, targetPlant, '被河狸啃倒');
      animal.wood = 1;
      remember(world, animal, 'offspring', `啃倒${targetPlant.name}，把木材留作筑坝。`, targetPlant.id);
      animal.think = 0;
    }
  }
  if ((animal.behavior === 'build' || animal.behavior === 'dig') && structure && animal.action <= 0 && distance(animal, structure) < 1.5) {
    animal.vx = animal.vy = 0;
    if (animal.behavior === 'build' && structure.kind === 'dam' && animal.wood > 0) {
      animal.wood--;
      structure.progress = clamp(structure.progress + 0.5);
      structure.integrity = clamp(structure.integrity + 0.4);
      animal.action = 0.05;
      if (structure.progress >= 1) {
        remember(world, animal, 'offspring', '亲手修筑了一座会改变水流与栖息地的堤坝。', structure.id);
        logEvent(world, 'ecology', `${animal.name}修筑的木坝完工了，上游开始蓄水。`, structure.x, structure.y, animal.id);
        animal.think = 0;
      }
    } else if (animal.behavior === 'dig' && structure.kind === 'burrow') {
      structure.progress = clamp(structure.progress + 0.34);
      animal.action = 0.05;
      if (structure.progress >= 1) {
        animal.homeX = structure.x; animal.homeY = structure.y;
        remember(world, animal, 'offspring', '挖好了一处可以遮风避雨的洞穴。', structure.id);
        if (animal.bond || world.structures.filter(s => s.kind === 'burrow').length <= 2) logEvent(world, 'ecology', `${animal.name}的兔穴落成了。`, structure.x, structure.y, animal.id);
        animal.think = 0;
      }
    }
  }
  if ((animal.behavior === 'seekFood' || animal.behavior === 'hunt') && animal.action <= 0) {
    if (targetPlant && targetPlant.alive && distance(animal, targetPlant) < 1.2) {
      const amount = animal.species === 'deer' ? 0.2 : 0.12;
      targetPlant.growth = clamp(targetPlant.growth - amount, 0.03, 1);
      targetPlant.health = clamp(targetPlant.health - amount * 0.3);
      targetPlant.fruit = clamp(targetPlant.fruit - 0.3);
      if (targetPlant.species === 'berry' && targetPlant.growth > 0.75 && !animal.seed && (animal.species === 'rabbit' || animal.species === 'deer' || animal.species === 'beaver')) {
        animal.seed = { species: 'berry', parentId: targetPlant.id, originX: targetPlant.x, originY: targetPlant.y, delay: 0.35 + random(world) * 0.25 };
      }
      if (animal.species === 'bee') {
        if (!targetPlant.pollinated) {
          world.progress.pollinations++;
          remember(world, targetPlant, 'pollination', `${animal.name}把花粉带到了这里。`, animal.id);
          remember(world, animal, 'pollination', `为${targetPlant.name}完成了一次授粉。`, targetPlant.id);
          if (targetPlant.bond || animal.bond) logEvent(world, 'ecology', `${animal.name}为${targetPlant.name}完成了授粉。`, targetPlant.x, targetPlant.y, targetPlant.id);
        }
        targetPlant.pollinated = true;
      }
      animal.hunger = clamp(animal.hunger - 0.5);
      animal.action = 0.045;
      animal.behavior = 'seekFood'; animal.think = 0.04;
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

  if (rule.diet === 'pollinator' && animal.age >= rule.matureAt && animal.repro <= 0 && animal.hunger < 0.35 && world.animals.length < MAX_ANIMALS && hasPopulationRoom(world, animal.species) && random(world) < dt * 1.4) {
    const child = spawnAnimal(world, animal.species, animal.x + random(world) - 0.5, animal.y + random(world) - 0.5, 0, animal.id);
    if (child) {
      animal.repro = 1.4;
      if (random(world) < 0.04) logEvent(world, 'birth', '花海旁分出了一个新的蜂群。', animal.x, animal.y);
    }
  } else if (animal.behavior === 'court' && targetAnimal?.alive && targetAnimal.species === animal.species && animal.action <= 0 && distance(animal, targetAnimal) < 1.5) {
    if (animal.id < targetAnimal.id && world.animals.length < MAX_ANIMALS && hasPopulationRoom(world, animal.species)) {
      const litter = animal.species === 'rabbit' && random(world) < 0.45 ? 2 : 1;
      for (let n = 0; n < litter && hasPopulationRoom(world, animal.species); n++) spawnAnimal(world, animal.species, animal.x + random(world), animal.y + random(world), 0, animal, targetAnimal);
      animal.repro = (animal.species === 'rabbit' ? 2.2 : animal.species === 'deer' || animal.species === 'wolf' ? 6 : 4) * (hasTrait(animal, 'fertile') ? 0.8 : 1);
      targetAnimal.repro = animal.repro;
      logEvent(world, 'birth', litter > 1 ? `两只${rule.name}幼崽出生了。` : `一只${rule.name}幼崽出生了。`, animal.x, animal.y);
    }
    animal.action = 0.1; animal.behavior = 'rest';
  }

  const settledShelter = animal.behavior === 'shelter' && !!targetPlant && distance(animal, targetPlant) < 2.4;
  const settledBurrow = animal.behavior === 'shelter' && structure?.kind === 'burrow' && structure.progress >= 1 && distance(animal, structure) < 1.6;
  if (animal.behavior === 'rest' || animal.behavior === 'groom' || animal.behavior === 'alert' || settledShelter || settledBurrow) {
    if (settledShelter && targetPlant) { animal.homeX = targetPlant.x; animal.homeY = targetPlant.y; }
    if (settledBurrow && structure) { animal.homeX = structure.x; animal.homeY = structure.y; }
    animal.vx *= 0.5; animal.vy *= 0.5;
    animal.energy = clamp(animal.energy + dt * (animal.behavior === 'alert' ? 0.25 : 0.7));
    return;
  }
  const dx = animal.tx - animal.x, dy = animal.ty - animal.y;
  const d = Math.hypot(dx, dy);
  if (d < 0.3) {
    animal.vx = animal.vy = 0;
    if (animal.behavior === 'wander' || animal.behavior === 'follow') { animal.behavior = 'rest'; animal.think = 0.03 + random(world) * 0.06; }
    return;
  }
  let speed = rule.speed * (animal.age < rule.matureAt ? 0.65 : 1) * (0.55 + animal.health * 0.45) * (hasTrait(animal, 'swift') ? 1.18 : 1);
  if (animal.behavior === 'flee' || animal.behavior === 'hunt') speed *= 1.35;
  if (animal.behavior === 'play') speed *= 1.15;
  if (env.seasonIndex === 3) speed *= 0.86;
  if (world.weather.kind === 'mist') speed *= 0.86;
  if (world.weather.kind === 'snow') speed *= 0.76;
  if (animal.species === 'frog' && world.weather.kind === 'rain') speed *= 1.18;
  if (animal.species === 'deer' && i >= 0 && world.terrain.trail[i] > 40) speed *= 1.18;
  if (animal.species === 'beaver' && isWater(world, animal.x, animal.y)) speed *= 0.85;
  const nx = animal.x + dx / d * speed * dt, ny = animal.y + dy / d * speed * dt;
  const nextTile = tileAt(world, nx, ny);
  const amphibious = animal.species === 'frog' || animal.species === 'bee' || animal.species === 'beaver';
  const canEnter = nextTile >= 0 && world.terrain.biome[nextTile] !== BIOME.VOID && (amphibious || isLand(world, nx, ny));
  if (canEnter) {
    animal.vx = dx / d * speed; animal.vy = dy / d * speed;
    animal.x = clamp(nx, 0.5, WORLD_W - 0.5); animal.y = clamp(ny, 0.5, WORLD_H - 0.5);
    if (nextTile !== animal.lastTrailTile) {
      if ((animal.species === 'deer' || animal.species === 'rabbit' || animal.species === 'beaver') && isLand(world, animal.x, animal.y) && world.terrain.biome[nextTile] !== BIOME.ROCK) {
        const previous = world.terrain.trail[nextTile];
        const wear = animal.species === 'deer' ? 18 : animal.species === 'beaver' ? 12 : 8;
        world.terrain.trail[nextTile] = Math.min(255, previous + wear);
        if (previous < 80 && previous + wear >= 80 && !world.pathRecorded) {
          world.pathRecorded = true;
          logEvent(world, 'ecology', `${ANIMAL_RULES[animal.species].name}反复经过同一条路线，一条小径出现了。`, animal.x, animal.y, animal.id);
        }
      }
      animal.lastTrailTile = nextTile;
    }
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
  if (world.terrain.biome[i] !== BIOME.VOID && !isWater(world, x, y)) world.terrain.fire[i] = 1;
  world.progress.fireSeen = true;
  for (const plant of world.plants) if (plant.alive && Math.hypot(plant.x - x, plant.y - y) < 2.5) plant.health -= 0.5;
  for (const animal of world.animals) if (animal.alive && Math.hypot(animal.x - x, animal.y - y) < 6) {
    if (Math.hypot(animal.x - x, animal.y - y) < 2) animal.health -= 0.65;
    animal.behavior = 'flee'; animal.targetId = null; animal.think = 0.03;
    animal.tx = clamp(animal.x + (animal.x - x) * 4, 2, WORLD_W - 2);
    animal.ty = clamp(animal.y + (animal.y - y) * 4, 2, WORLD_H - 2);
    if (animal.bond) remember(world, animal, 'injury', '亲历落雷与火焰，拼命逃离了灼热之地。');
  }
  if (divine) logEvent(world, 'divine', '一道神雷劈落。火焰开始寻找可燃之物。', x, y);
}

function updateHydrology(world: World, dt: number): void {
  const { terrain } = world;
  const before = terrain.water.slice();
  const delta = new Float32Array(before.length);
  const dams = new Uint8Array(before.length);
  for (const structure of world.structures) if (structure.kind === 'dam' && structure.progress >= 1 && structure.integrity > 0) {
    const i = tileAt(world, structure.x, structure.y);
    if (i >= 0) dams[i] = 1;
  }
  const rain = world.weather.kind === 'storm' ? 1.6 : world.weather.kind === 'rain' ? 1 : world.weather.kind === 'snow' ? 0.25 : 0;
  for (let y = 0; y < WORLD_H; y++) for (let x = 0; x < WORLD_W; x++) {
    const i = tileIndex(x, y);
    if (terrain.biome[i] === BIOME.VOID) continue;
    const permanent = terrain.biome[i] === BIOME.WATER;
    if (permanent) delta[i] += Math.max(0, 0.65 - before[i]);
    else {
      const infiltration = Math.max(0, terrain.moisture[i] - 0.68);
      delta[i] += rain * infiltration * dt * 1.6;
      delta[i] -= dt * (world.weather.kind === 'mist' ? 0.015 : 0.1 + environmentAt(world.time).daylight * 0.08);
      if (before[i] > 0) delta[i] -= dt * 0.08; // 土壤持续吸收浅水
    }
    if (before[i] < 0.025) continue;
    const head = terrain.elevation[i] + before[i];
    let lowest = -1, lowestHead = head;
    const neighbors = [i - 1, i + 1, i - WORLD_W, i + WORLD_W];
    for (const n of neighbors) {
      if (n < 0 || n >= before.length || terrain.biome[n] === BIOME.VOID) continue;
      const nx = n % WORLD_W, ny = Math.floor(n / WORLD_W);
      if (Math.abs(nx - x) + Math.abs(ny - y) !== 1) continue;
      const nextHead = terrain.elevation[n] + before[n];
      if (nextHead < lowestHead) { lowestHead = nextHead; lowest = n; }
    }
    if (lowest >= 0) {
      let flow = Math.min(before[i] * 0.16, (head - lowestHead) * 0.08, 0.035);
      if (dams[i] && before[i] < 1.02) flow *= 0.04;
      delta[i] -= flow; delta[lowest] += flow;
    }
  }
  for (let i = 0; i < before.length; i++) {
    if (terrain.biome[i] === BIOME.VOID) { terrain.water[i] = 0; continue; }
    terrain.water[i] = clamp(before[i] + delta[i], 0, 1.25);
    if (terrain.biome[i] === BIOME.WATER) terrain.water[i] = Math.max(0.65, terrain.water[i]);
  }
  // 完整坝体在较低的上游土地形成真实回水；坝消失后这里不再补水。
  for (const dam of world.structures) {
    if (dam.kind !== 'dam' || dam.progress < 1 || dam.integrity <= 0) continue;
    const damTile = tileAt(world, dam.x, dam.y);
    if (damTile < 0) continue;
    for (let y = Math.max(1, Math.floor(dam.y) - 4); y <= Math.min(WORLD_H - 2, Math.floor(dam.y) + 4); y++) {
      for (let x = Math.max(1, Math.floor(dam.x) - 8); x <= Math.floor(dam.x); x++) {
        const i = tileIndex(x, y);
        if (terrain.biome[i] !== BIOME.VOID && terrain.elevation[i] <= terrain.elevation[damTile] + 0.2) {
          terrain.water[i] = clamp(terrain.water[i] + dt * 1.8 * (1 - terrain.water[i] / 1.2), 0, 1.2);
        }
      }
    }
  }
  for (let i = 0; i < before.length; i++) if (terrain.water[i] > 0.28) {
    terrain.moisture[i] = Math.max(terrain.moisture[i], 0.78);
    terrain.fire[i] = 0;
  }
}

function updateSlowTerrain(world: World): void {
  const { terrain } = world;
  if (world.weather.kind === 'storm') for (const structure of world.structures) if (structure.kind === 'dam') structure.integrity = clamp(structure.integrity - 0.08);
  const breached = world.structures.filter(s => s.integrity <= 0);
  if (breached.length) {
    world.structures = world.structures.filter(s => s.integrity > 0);
    for (const structure of breached) logEvent(world, 'ecology', '一座旧坝在风雨中溃决，蓄水重新寻找出路。', structure.x, structure.y);
  }
  const roots = new Float32Array(WORLD_W * WORLD_H);
  const canopy = new Float32Array(WORLD_W * WORLD_H);
  for (const plant of world.plants) {
    if (!plant.alive || (plant.species !== 'oak' && plant.species !== 'pine') || plant.growth < 0.6) continue;
    for (let oy = -5; oy <= 5; oy++) for (let ox = -5; ox <= 5; ox++) {
      const x = Math.floor(plant.x) + ox, y = Math.floor(plant.y) + oy;
      if (x < 0 || y < 0 || x >= WORLD_W || y >= WORLD_H) continue;
      const d = Math.hypot(ox, oy);
      if (d > 5) continue;
      const value = plant.growth * plant.health * (1 - d / 5) * (hasTrait(plant, 'deepRoot') ? 1.3 : 1);
      const i = tileIndex(x, y);
      roots[i] += value; canopy[i] += value;
    }
  }
  let transitions = 0, transitionX = 0, transitionY = 0;
  for (let y = 1; y < WORLD_H - 1; y++) for (let x = 1; x < WORLD_W - 1; x++) {
    const i = tileIndex(x, y);
    const decay = world.weather.kind === 'storm' ? 4 : world.weather.kind === 'rain' ? 2 : 1;
    terrain.trail[i] = Math.max(0, terrain.trail[i] - decay);
    if (terrain.biome[i] === BIOME.MEADOW || terrain.biome[i] === BIOME.FOREST) {
      const previousBiome = terrain.biome[i];
      let next = terrain.succession[i];
      if (terrain.water[i] > 0.28 || terrain.fire[i] > 0.1) next -= 14;
      else if (canopy[i] > 0.2) next += 7;
      else next -= 2;
      terrain.succession[i] = Math.max(0, Math.min(255, next));
      if (terrain.biome[i] === BIOME.MEADOW && next >= 220) terrain.biome[i] = BIOME.FOREST;
      else if (terrain.biome[i] === BIOME.FOREST && next <= 35) terrain.biome[i] = BIOME.MEADOW;
      if (terrain.biome[i] !== previousBiome) { transitions++; transitionX += x; transitionY += y; }
    }
    if ((world.weather.kind === 'rain' || world.weather.kind === 'storm') && terrain.biome[i] !== BIOME.WATER && terrain.biome[i] !== BIOME.VOID) {
      let lowest = i, low = terrain.elevation[i];
      for (const n of [i - 1, i + 1, i - WORLD_W, i + WORLD_W]) if (terrain.elevation[n] < low) { low = terrain.elevation[n]; lowest = n; }
      const slope = terrain.elevation[i] - low;
      const protection = clamp(roots[i], 0, 0.95);
      const erosion = Math.min(0.004, slope * 0.003 * (1 - protection) * (world.weather.kind === 'storm' ? 1.7 : 1));
      if (erosion > 0 && lowest !== i) {
        terrain.elevation[i] = Math.max(0.05, terrain.elevation[i] - erosion);
        terrain.elevation[lowest] = Math.min(1, terrain.elevation[lowest] + erosion * 0.8);
      }
    }
  }
  if (transitions >= 4) logEvent(world, 'ecology', '树冠与空地缓慢改变了边界，一片新的栖息地正在形成。', transitionX / transitions, transitionY / transitions);
}

function updateTerrain(world: World, dt: number, env: Environment): void {
  const terrain = world.terrain;
  world.terrainTick++;
  if (world.terrainTick % 5 === 0) updateHydrology(world, dt * 5);
  if (world.terrainTick % 50 === 0) updateSlowTerrain(world);
  const previousFire = terrain.fire.slice();
  const raining = world.weather.kind === 'rain' || world.weather.kind === 'storm';
  const rain = world.weather.kind === 'storm' ? 1.5 : raining ? 1 : 0;
  for (let y = 0; y < WORLD_H; y++) for (let x = 0; x < WORLD_W; x++) {
    const i = tileIndex(x, y);
    if (terrain.biome[i] === BIOME.VOID) continue;
    if (terrain.biome[i] === BIOME.WATER) { terrain.moisture[i] = 1; terrain.fire[i] = 0; continue; }
    const evaporation = (0.015 + env.daylight * 0.032 + world.sunBoost * 0.06) * (env.seasonIndex === 3 ? 0.55 : 1) * (world.weather.kind === 'mist' ? 0.3 : world.weather.kind === 'snow' ? 0.4 : 1);
    const dew = world.weather.kind === 'mist' ? 0.09 : world.weather.kind === 'snow' ? 0.025 : 0;
    terrain.moisture[i] = clamp(terrain.moisture[i] + dt * (rain * 0.7 + dew - evaporation));
    const old = previousFire[i];
    if (old > 0) {
      terrain.fire[i] = clamp(old + dt * (0.16 - terrain.moisture[i] * 0.65) - dt * (raining ? 4.5 : world.weather.kind === 'snow' ? 1.6 : 0.85));
      terrain.nutrients[i] = clamp(terrain.nutrients[i] - dt * old * 0.025, 0.05, 1);
      if (!raining && world.weather.kind !== 'snow' && terrain.fire[i] > 0.25) {
        const neighbors = [i - 1, i + 1, i - WORLD_W, i + WORLD_W];
        for (const n of neighbors) {
          if (n < 0 || n >= terrain.fire.length || terrain.biome[n] === BIOME.VOID || isWater(world, n % WORLD_W, Math.floor(n / WORLD_W))) continue;
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
  world.aurora = Math.max(0, world.aurora - dt * 0.28);
  if (world.weather.remaining > 0) return;
  if (previous === 'rain' || previous === 'storm') world.rainbow = 1;
  const roll = random(world);
  const kind: WeatherKind = roll < 0.58 ? 'clear' : roll < 0.9 ? 'rain' : 'storm';
  world.weather = { kind, remaining: kind === 'clear' ? 1.2 + random(world) * 2.8 : kind === 'rain' ? 0.5 + random(world) * 0.8 : 0.25 + random(world) * 0.35 };
  const text = kind === 'clear' ? '云层散开，暖光重新落到叶尖。' : kind === 'rain' ? '一场自然雨抵达了森林。' : '远雷滚过山谷，风暴来了。';
  logEvent(world, 'weather', text, 60, 40);
  if (kind === 'storm') for (const entity of [...world.plants, ...world.animals]) if (entity.alive && entity.bond) {
    remember(world, entity, 'storm', '在一场自然雷暴中紧紧守住了自己的栖息地。');
  }
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

export function spiritRegenRate(world: World): number {
  const stats = worldStats(world);
  const bonds = [...world.plants, ...world.animals].filter(e => e.alive && e.bond);
  const luminous = bonds.filter(e => hasTrait(e, 'luminous')).length;
  return 4 + stats.health * 8 + Math.min(1, stats.species / TOTAL_SPECIES) * 6 + Math.min(1, stats.plants / 120) * 2 + bonds.length * 0.8 + luminous * 0.4;
}

export function bondCapacity(world: World): number {
  return Math.min(MAX_BONDS, 1 + (world.progress.completed.includes('firstBond') ? 1 : 0) + (world.progress.completed.includes('bondedBirth') ? 1 : 0));
}

export function isUnlocked(world: World, power: Power): boolean {
  if (power === 'mist') return world.progress.completed.includes('pollination');
  if (power === 'snow') return world.progress.completed.includes('threeGenerations');
  if (power === 'aurora') return world.progress.completed.includes('diversity');
  return true;
}

export function objectiveProgress(world: World, id: ObjectiveId): { current: number; target: number } {
  if (id === 'firstBond') return { current: world.progress.lifetimeBonds, target: 1 };
  if (id === 'pollination') return { current: world.progress.pollinations, target: 1 };
  if (id === 'bondedBirth') return { current: world.progress.bondedBirths, target: 1 };
  if (id === 'threeGenerations') return { current: world.progress.maxGeneration, target: 3 };
  if (id === 'diversity') return { current: worldStats(world).species, target: TOTAL_SPECIES };
  if (id === 'ancientTree') {
    const oldest = Math.max(0, ...world.plants.filter(p => p.alive && p.bond && (p.species === 'oak' || p.species === 'pine')).map(p => p.age / (PLANT_RULES[p.species].matureAt * 1.15)));
    return { current: Math.min(1, oldest), target: 1 };
  }
  return { current: world.progress.fireSeen && worldStats(world).fires === 0 && worldStats(world).health > 0.55 ? 1 : 0, target: 1 };
}

function evaluateObjectives(world: World): void {
  const stats = worldStats(world);
  const ancient = world.plants.some(p => p.alive && p.bond && (p.species === 'oak' || p.species === 'pine') && p.age >= PLANT_RULES[p.species].matureAt * 1.15 && p.growth > 0.85);
  const conditions: Record<ObjectiveId, boolean> = {
    firstBond: world.progress.lifetimeBonds >= 1,
    pollination: world.progress.pollinations >= 1,
    bondedBirth: world.progress.bondedBirths >= 1,
    threeGenerations: world.progress.maxGeneration >= 3 && world.progress.bondedBirths > 0,
    diversity: stats.species >= TOTAL_SPECIES && world.progress.lifetimeBonds >= 1 && world.progress.lifetimeBirths >= 3,
    ancientTree: ancient,
    fireRecovery: world.progress.fireSeen && stats.fires === 0 && stats.health > 0.55,
  };
  for (const objective of OBJECTIVES) {
    if (!conditions[objective.id] || world.progress.completed.includes(objective.id)) continue;
    world.progress.completed.push(objective.id);
    logEvent(world, 'milestone', `心愿达成「${objective.name}」——${objective.reward}`, 60, 40);
  }
}

export function bondEntity(world: World, id: number, requestedName?: string): ActionResult {
  const entity = findEntity(world, id);
  if (!entity || !entity.alive) return { ok: false, message: '只有仍在生长的生命才能与你结缘。' };
  if (entity.bond) return { ok: true, message: `${entity.bond.name}已经是你的神眷。`, entityIds: [id], x: entity.x, y: entity.y };
  const livingBonds = [...world.plants, ...world.animals].filter(e => e.alive && e.bond).length;
  if (livingBonds >= bondCapacity(world)) return { ok: false, message: '当前神眷已满。让一段血脉延续，可建立更深的纽带。' };
  const name = (requestedName?.trim() || entity.name).slice(0, 12);
  entity.bond = { name, since: world.time };
  entity.name = name;
  world.progress.lifetimeBonds++;
  remember(world, entity, 'bond', '被神明看见、命名，并成为这片森林的神眷。');
  logEvent(world, 'bond', `${name}与你结缘。从今以后，它的故事有了见证者。`, entity.x, entity.y, entity.id);
  evaluateObjectives(world);
  return { ok: true, message: `${name}成为了你的神眷。它仍会自由生活，也会经历真实的衰老与死亡。`, entityIds: [id], x: entity.x, y: entity.y };
}

export function renameBond(world: World, id: number, requestedName: string): ActionResult {
  const entity = findEntity(world, id);
  const name = requestedName.trim().slice(0, 12);
  if (!entity?.bond || !name) return { ok: false, message: '请先结缘，并写下一个名字。' };
  const previous = entity.bond.name;
  entity.bond.name = name; entity.name = name;
  remember(world, entity, 'bond', `神明将名字从「${previous}」改作「${name}」。`);
  return { ok: true, message: `从现在起，它叫${name}。`, entityIds: [id], x: entity.x, y: entity.y };
}

export function findMemorial(world: World, id: number | null): Memorial | null {
  if (id === null) return null;
  return world.memorials.find(m => m.id === id) ?? null;
}

/** 推进一个固定生态步长。直接修改 world，避免每帧复制大对象。 */
export function stepWorld(world: World): void {
  const dt = STEP_DAYS;
  world.time += dt;
  world.divine = clamp(world.divine + dt * spiritRegenRate(world), 0, 100);
  updateWeather(world, dt);
  const env = environmentAt(world.time);
  updateTerrain(world, dt, env);
  updatePlants(world, dt, env);
  updateAnimals(world, dt, env);
  maybeMigration(world);
  evaluateObjectives(world);
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
  if (power === 'rain' || power === 'sun' || power === 'storm' || power === 'mist' || power === 'snow') {
    const info = POWER_INFO[power];
    if (!isUnlocked(world, power)) return { ok: false, message: `${info.name}仍沉睡在心愿中。先完成对应的生态心愿。`, power, x, y };
    const failure = pay(world, info.cost);
    if (failure) return failure;
    if (power === 'sun') {
      world.weather = { kind: 'clear', remaining: 1.5 }; world.sunBoost = 1; world.rainbow = 0;
      logEvent(world, 'divine', '你拨开云层，赐下一片晴光。', x, y);
      return { ok: true, message: '晴光降临，植物生长加快，水分也会更快蒸发。', power, x, y };
    }
    world.weather = { kind: power, remaining: power === 'storm' ? 0.65 : power === 'snow' ? 1.3 : power === 'mist' ? 0.9 : 1.1 };
    const messages = { rain: '你召来一场温柔而持久的雨。', storm: '你召来雷暴。森林在雨与火之间屏息。', mist: '你请晨雾漫过河谷，世界缓慢而安静。', snow: '你唤来初雪，枝叶将一点点积起白色。' };
    const feedback = { rain: '雨水正在渗入土壤。', storm: '雷暴已抵达：强降雨中仍可能落下惊雷。', mist: '晨雾会降低蒸发，也会改变动物的行路。', snow: '雪会覆盖地表、减缓火焰，并让动物寻找庇护。' };
    logEvent(world, 'divine', messages[power], x, y);
    if (power === 'storm' || power === 'snow') for (const entity of [...world.plants, ...world.animals]) if (entity.alive && entity.bond) {
      remember(world, entity, power === 'storm' ? 'storm' : 'snow', power === 'storm' ? '与你召来的雷暴相遇，并在风雨中坚持了下来。' : '看见了此生第一场由神明唤来的雪。');
    }
    return { ok: true, message: feedback[power], power, x, y };
  }
  if (power === 'aurora') {
    if (!isUnlocked(world, power)) return { ok: false, message: '极光需要一片万物并育的森林。', power, x, y };
    const failure = pay(world, POWER_INFO.aurora.cost);
    if (failure) return failure;
    world.aurora = 1;
    for (const entity of [...world.plants, ...world.animals]) if (entity.alive && entity.bond) remember(world, entity, 'aurora', '与神明一起看过一片流动的极光。');
    logEvent(world, 'divine', '你掀起夜空，极光如河般流过森林。', x, y);
    return { ok: true, message: '极光将持续一段时间；神眷会记住这片天空。', power, x, y };
  }
  if (power === 'bless') {
    const failure = pay(world, POWER_INFO.bless.cost);
    if (failure) return failure;
    const affected: number[] = [];
    for (const plant of world.plants) if (plant.alive && Math.hypot(plant.x - x, plant.y - y) < 9) {
      plant.health = clamp(plant.health + 0.55); affected.push(plant.id);
      if (plant.bond) remember(world, plant, 'bless', '被金色孢子覆盖，伤痕与枯萎得到了抚慰。');
    }
    for (const animal of world.animals) if (animal.alive && Math.hypot(animal.x - x, animal.y - y) < 9) {
      animal.health = clamp(animal.health + 0.55); animal.hunger *= 0.25; animal.thirst *= 0.25; affected.push(animal.id);
      if (animal.bond) remember(world, animal, 'bless', '在神明的赐福中恢复了健康与气力。');
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
    return { ok: true, message: '附近的创伤被抚平，土壤也恢复了生机。', power, x, y, affectedIds: affected };
  }
  if (power === 'lightning') {
    if (!isLand(world, x, y)) return { ok: false, message: '落雷需要一片真实的林地。' };
    const failure = pay(world, POWER_INFO.lightning.cost);
    if (failure) return failure;
    strike(world, x, y, true);
    return { ok: true, message: '雷霆落下。雨水、湿度和可燃物将决定火的去向。', power, x, y, affectedIds: world.animals.filter(a => Math.hypot(a.x - x, a.y - y) < 6).map(a => a.id) };
  }
  if (PLANT_ORDER.includes(power as PlantSpecies)) {
    const species = power as PlantSpecies, rule = PLANT_RULES[species];
    if (!isLand(world, x, y)) return { ok: false, message: '种子只能落在岛屿的土壤中。' };
    const failure = pay(world, rule.cost);
    if (failure) return failure;
    const plant = spawnPlant(world, species, x, y);
    if (!plant) { world.divine += rule.cost; return { ok: false, message: '这里的植物已经太密集了。' }; }
    logEvent(world, 'divine', `你种下一粒${rule.name}的种子，${plant.name}开始生长。`, x, y, plant.id);
    evaluateObjectives(world);
    return { ok: true, message: `${rule.name}「${plant.name}」已种下。湿度、光照与邻居会决定它的命运。`, power, x, y, entityIds: [plant.id] };
  }
  if (ANIMAL_ORDER.includes(power as AnimalSpecies)) {
    const species = power as AnimalSpecies, rule = ANIMAL_RULES[species];
    const point = findSpawn(world, species, { x, y }, 2.5);
    if (!point || Math.hypot(point.x - x, point.y - y) > 4) return { ok: false, message: species === 'frog' ? '树蛙需要临近水源的湿润林地。' : '这里没有适合它落脚的地方。' };
    const failure = pay(world, rule.cost);
    if (failure) return failure;
    const count = species === 'bee' ? 3 : 1;
    const created: Animal[] = [];
    for (let n = 0; n < count; n++) {
      const animal = spawnAnimal(world, species, point.x + random(world), point.y + random(world), rule.matureAt * 0.75);
      if (animal) created.push(animal);
    }
    if (!created.length) { world.divine += rule.cost; return { ok: false, message: '这里的生命已经太密集，无法再迎来新的居民。', power, x, y }; }
    logEvent(world, 'divine', `你将${created.length > 1 ? '一小群' : '一只'}${rule.name}带入森林。`, point.x, point.y, created[0].id);
    evaluateObjectives(world);
    return { ok: true, message: `${rule.name}「${created[0].name}」已经到来。它会自己寻找食物、伴侣与归处。`, power, x: point.x, y: point.y, entityIds: created.map(a => a.id) };
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
  terrain: { biome: number[]; moisture: number[]; nutrients: number[]; fire: number[]; elevation: number[]; trail: number[]; water: number[]; succession: number[] };
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
      trail: Array.from(world.terrain.trail),
      water: Array.from(world.terrain.water),
      succession: Array.from(world.terrain.succession),
    },
  };
  return JSON.stringify(saved);
}

function migrateIdentity<T extends Plant | Animal>(entity: T, seed: number): T {
  const identity = identityFor(seed, entity.id);
  const traits = Array.isArray(entity.traits) ? entity.traits.filter((t): t is TraitId => typeof t === 'string' && t in TRAITS).slice(0, 2) : [];
  const parentIds = Array.isArray(entity.parentIds) ? entity.parentIds.filter(Number.isFinite) : 'parentId' in entity && Number.isFinite(entity.parentId) ? [entity.parentId as number] : [];
  entity.name = typeof entity.name === 'string' && entity.name ? entity.name : identity.name;
  entity.traits = traits.length === 2 ? traits : identity.traits;
  entity.bond = entity.bond && typeof entity.bond.name === 'string' ? entity.bond : null;
  entity.memories = Array.isArray(entity.memories) ? entity.memories.filter(m => m && Number.isFinite(m.at) && typeof m.text === 'string').slice(-MAX_MEMORIES) : [];
  entity.generation = Number.isFinite(entity.generation) ? Math.max(1, entity.generation) : 1;
  entity.parentIds = parentIds;
  entity.offspring = Array.isArray(entity.offspring) ? entity.offspring.filter(Number.isFinite) : [];
  entity.homeX = Number.isFinite(entity.homeX) ? entity.homeX : entity.x;
  entity.homeY = Number.isFinite(entity.homeY) ? entity.homeY : entity.y;
  if ('behavior' in entity) {
    const animal = entity as Animal;
    animal.wood = Number.isFinite(animal.wood) ? Math.max(0, animal.wood) : 0;
    animal.seed = animal.seed?.species === 'berry' ? animal.seed : null;
    animal.structureId = Number.isFinite(animal.structureId) ? animal.structureId : null;
    animal.lastTrailTile = Number.isFinite(animal.lastTrailTile) ? animal.lastTrailTile : -1;
  }
  return entity;
}

export function deserializeWorld(text: string): World {
  const data = JSON.parse(text) as SavedWorld;
  const size = WORLD_W * WORLD_H;
  if ((data.version !== 1 && data.version !== 2 && data.version !== WORLD_VERSION) || !Number.isFinite(data.seed) || !data.terrain || data.terrain.biome.length !== size || !Array.isArray(data.plants) || !Array.isArray(data.animals)) throw new Error('无效或不兼容的森林存档');
  for (const key of ['moisture', 'nutrients', 'fire', 'elevation'] as const) if (data.terrain[key].length !== size) throw new Error('森林地形存档不完整');
  const progress = data.progress;
  const completed = Array.isArray(progress?.completed) ? progress.completed.filter(id => OBJECTIVES.some(o => o.id === id)) : [];
  const biome = new Uint8Array(data.terrain.biome);
  for (const key of ['trail', 'water', 'succession'] as const) if (Array.isArray(data.terrain[key]) && data.terrain[key].length !== size) throw new Error('森林地貌存档不完整');
  const trail = Array.isArray(data.terrain.trail) ? new Uint8Array(data.terrain.trail) : new Uint8Array(size);
  const water = Array.isArray(data.terrain.water) ? new Float32Array(data.terrain.water) : new Float32Array(size);
  const succession = Array.isArray(data.terrain.succession) ? new Uint8Array(data.terrain.succession) : new Uint8Array(size);
  if (!Array.isArray(data.terrain.water)) for (let i = 0; i < size; i++) if (biome[i] === BIOME.WATER) water[i] = 0.65;
  if (!Array.isArray(data.terrain.succession)) for (let i = 0; i < size; i++) succession[i] = biome[i] === BIOME.FOREST ? 255 : biome[i] === BIOME.MEADOW ? 0 : 128;
  return {
    ...data,
    version: WORLD_VERSION,
    rng: data.rng >>> 0,
    aurora: Number.isFinite(data.aurora) ? data.aurora : 0,
    memorials: Array.isArray(data.memorials) ? data.memorials.filter(m => m && Number.isFinite(m.id) && m.bond).slice(0, MAX_MEMORIALS) : [],
    structures: Array.isArray(data.structures) ? data.structures.filter(s => s && (s.kind === 'dam' || s.kind === 'burrow') && Number.isFinite(s.id)).slice(0, MAX_DAMS + MAX_BURROWS).map(s => ({ ...s, progress: clamp(s.progress), integrity: clamp(s.integrity) })) : [],
    terrainTick: Number.isFinite(data.terrainTick) ? data.terrainTick : 0,
    pathRecorded: data.pathRecorded ?? false,
    progress: {
      completed,
      lifetimeBonds: progress?.lifetimeBonds ?? 0,
      lifetimeBirths: progress?.lifetimeBirths ?? 0,
      bondedBirths: progress?.bondedBirths ?? 0,
      maxGeneration: progress?.maxGeneration ?? 1,
      pollinations: progress?.pollinations ?? 0,
      fireSeen: progress?.fireSeen ?? false,
    },
    plants: data.plants.map(p => migrateIdentity(p, data.seed)),
    animals: data.animals.map(a => migrateIdentity(a, data.seed)),
    terrain: {
      biome, moisture: new Float32Array(data.terrain.moisture),
      nutrients: new Float32Array(data.terrain.nutrients), fire: new Float32Array(data.terrain.fire), elevation: new Float32Array(data.terrain.elevation),
      trail, water, succession,
    },
  };
}
