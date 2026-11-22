import { describe, expect, it } from 'vitest';
import {
  MAX_ANIMALS, MAX_EVENTS, MAX_MEMORIES, MAX_MEMORIALS, MAX_PLANTS, STEP_DAYS, WORLD_H, WORLD_W,
} from '../src/scripts/forest-god-content';
import { OBJECTIVES, identityFor } from '../src/scripts/forest-god-identity';
import {
  BIOME, advanceWorld, applyPower, bondCapacity, bondEntity, createWorld, deserializeWorld, environmentAt, findMemorial, isLand, isWater, isUnlocked, nearWater, renameBond, serializeWorld, spiritRegenRate, stepWorld, tileAt, worldStats,
} from '../src/scripts/forest-god-core';
import type { Animal, Plant, World } from '../src/scripts/forest-god-core';

function firstTile(world: World, predicate: (biome: number) => boolean): { x: number; y: number; i: number } {
  for (let y = 1; y < WORLD_H - 1; y++) for (let x = 1; x < WORLD_W - 1; x++) {
    const i = tileAt(world, x, y);
    if (predicate(world.terrain.biome[i])) return { x: x + 0.5, y: y + 0.5, i };
  }
  throw new Error('没有符合条件的土地');
}

function isolatedWorld(): { world: World; land: { x: number; y: number; i: number } } {
  const world = createWorld(424242);
  const land = firstTile(world, biome => biome === BIOME.FOREST || biome === BIOME.MEADOW);
  world.plants = [];
  world.animals = [];
  world.events = [];
  world.weather = { kind: 'clear', remaining: 100 };
  world.time = 0.5;
  return { world, land };
}

function firstShore(world: World): { x: number; y: number; i: number } {
  for (let y = 2; y < WORLD_H - 2; y++) for (let x = 2; x < WORLD_W - 2; x++) {
    if (isLand(world, x + 0.5, y + 0.5) && nearWater(world, x + 0.5, y + 0.5, 3)) return { x: x + 0.5, y: y + 0.5, i: tileAt(world, x, y) };
  }
  throw new Error('没有河岸');
}

function distantLand(world: World, origin: { x: number; y: number }, minDistance = 5): { x: number; y: number } {
  for (let y = 2; y < WORLD_H - 2; y++) for (let x = 2; x < WORLD_W - 2; x++) {
    if (Math.hypot(x - origin.x, y - origin.y) >= minDistance && isLand(world, x + 0.5, y + 0.5)) return { x: x + 0.5, y: y + 0.5 };
  }
  throw new Error('没有远处土地');
}

function plantAt(world: World, species: Plant['species'], x: number, y: number): Plant {
  const result = applyPower(world, species, x, y);
  expect(result.ok).toBe(true);
  return world.plants.at(-1)!;
}

function animalAt(world: World, species: Animal['species'], x: number, y: number): Animal {
  const result = applyPower(world, species, x, y);
  expect(result.ok).toBe(true);
  return world.animals.at(-1)!;
}

describe('森林之神 · 世界生成与时间', () => {
  it('相同种子生成完全相同的世界，不同种子改变地形', () => {
    const a = createWorld(12345), b = createWorld(12345), c = createWorld(54321);
    expect(serializeWorld(a)).toBe(serializeWorld(b));
    expect(Array.from(a.terrain.biome)).not.toEqual(Array.from(c.terrain.biome));
  });

  it('昼夜与四季连续循环，数值始终有界', () => {
    expect(environmentAt(0.5).daylight).toBeGreaterThan(0.9);
    expect(environmentAt(0.01).daylight).toBe(0);
    expect(environmentAt(0.25).season).toBe('春');
    expect(environmentAt(12.25).season).toBe('夏');
    expect(environmentAt(24.25).season).toBe('秋');
    expect(environmentAt(36.25).season).toBe('冬');
    expect(environmentAt(48.25).year).toBe(2);
  });

  it('固定步长推进世界并缓慢恢复灵力', () => {
    const world = createWorld(8);
    const before = world.time;
    world.divine = 20;
    stepWorld(world);
    expect(world.time).toBeCloseTo(before + STEP_DAYS, 8);
    expect(world.divine).toBeGreaterThan(20);
    expect(world.divine).toBeLessThanOrEqual(100);
  });
});

describe('森林之神 · 生态规则', () => {
  it('晴光蒸发水分，降雨使土地湿润并扑灭火焰', () => {
    const { world, land } = isolatedWorld();
    world.terrain.moisture[land.i] = 0.3;
    world.terrain.fire[land.i] = 1;
    world.weather = { kind: 'rain', remaining: 2 };
    const before = world.terrain.moisture[land.i];
    advanceWorld(world, 60);
    expect(world.terrain.moisture[land.i]).toBeGreaterThan(before);
    expect(world.terrain.fire[land.i]).toBe(0);
    world.weather = { kind: 'clear', remaining: 2 };
    world.sunBoost = 1;
    const wet = world.terrain.moisture[land.i];
    advanceWorld(world, 8);
    expect(world.terrain.moisture[land.i]).toBeLessThan(wet);
  });

  it('植物随适宜环境成长，授粉会真实改变花朵状态', () => {
    const { world, land } = isolatedWorld();
    const flower = plantAt(world, 'flower', land.x, land.y);
    flower.growth = 1;
    world.terrain.moisture[land.i] = 0.5;
    world.terrain.nutrients[land.i] = 1;
    const bee = animalAt(world, 'bee', land.x, land.y);
    bee.x = flower.x; bee.y = flower.y;
    bee.hunger = 0.9;
    bee.think = 0;
    const growth = flower.growth;
    const untouched = plantAt(world, 'flower', land.x, land.y);
    const untouchedGrowth = untouched.growth;
    stepWorld(world);
    expect(flower.pollinated).toBe(true);
    expect(untouched.growth).toBeGreaterThan(untouchedGrowth);
    expect(flower.growth).toBeLessThan(growth); // 蜜蜂采食会消耗花量
    expect(bee.hunger).toBeLessThan(0.9);
  });

  it('捕食者会追猎并杀死猎物，而非只播放战斗动画', () => {
    const { world, land } = isolatedWorld();
    const fox = animalAt(world, 'fox', land.x, land.y);
    const rabbit = animalAt(world, 'rabbit', land.x, land.y);
    fox.x = land.x; fox.y = land.y; rabbit.x = land.x; rabbit.y = land.y;
    fox.hunger = 0.95; fox.think = 0;
    rabbit.health = 0.03; rabbit.think = 100;
    stepWorld(world);
    expect(rabbit.alive).toBe(false);
    expect(fox.hunger).toBeLessThan(0.3);
    expect(world.events.some(event => event.kind === 'death' && event.text.includes('捕猎'))).toBe(true);
  });

  it('成熟伴侣会繁衍幼崽，幼崽保留亲代关联', () => {
    const { world, land } = isolatedWorld();
    const a = animalAt(world, 'rabbit', land.x, land.y);
    const b = animalAt(world, 'rabbit', land.x + 0.2, land.y);
    for (const rabbit of [a, b]) {
      rabbit.age = 4; rabbit.repro = 0; rabbit.hunger = 0; rabbit.thirst = 0;
      rabbit.health = 1; rabbit.energy = 1; rabbit.think = 0;
    }
    a.sex = 0; b.sex = 1;
    a.x = land.x; a.y = land.y; b.x = land.x + 0.2; b.y = land.y;
    const count = world.animals.length;
    stepWorld(world);
    expect(world.animals.length).toBeGreaterThan(count);
    expect(world.animals.at(-1)!.parentId).not.toBeNull();
    expect(world.animals.at(-1)!.parentIds).toEqual(expect.arrayContaining([a.id, b.id]));
    expect(world.animals.at(-1)!.generation).toBe(2);
    expect(a.offspring).toContain(world.animals.at(-1)!.id);
    expect(b.offspring).toContain(world.animals.at(-1)!.id);
    expect(world.events.some(event => event.kind === 'birth')).toBe(true);
  });

  it('遗骸分解后把养分还给土地，并可能催生菌落', () => {
    const { world, land } = isolatedWorld();
    const rabbit = animalAt(world, 'rabbit', land.x, land.y);
    rabbit.alive = false; rabbit.health = 0; rabbit.deadFor = 2.199;
    world.terrain.nutrients[land.i] = 0.2;
    world.terrain.moisture[land.i] = 0.9;
    stepWorld(world);
    expect(world.animals).not.toContain(rabbit);
    expect(world.terrain.nutrients[land.i]).toBeGreaterThan(0.2);
  });
});

describe('森林之神 · 神谕与存档', () => {
  it('落雷产生真实火焰，赐福疗愈并灭火', () => {
    const { world, land } = isolatedWorld();
    const rabbit = animalAt(world, 'rabbit', land.x, land.y);
    rabbit.health = 0.4; rabbit.hunger = 0.8; rabbit.thirst = 0.8;
    const lightning = applyPower(world, 'lightning', land.x, land.y);
    expect(lightning.ok).toBe(true);
    expect(world.terrain.fire[land.i]).toBe(1);
    const energy = world.divine;
    const blessed = applyPower(world, 'bless', land.x, land.y);
    expect(blessed.ok).toBe(true);
    expect(world.terrain.fire[land.i]).toBe(0);
    expect(rabbit.health).toBeGreaterThan(0.4);
    expect(rabbit.hunger).toBeLessThan(0.8);
    expect(world.divine).toBeLessThan(energy);
  });

  it('无效投放和灵力不足不会偷偷改变世界', () => {
    const world = createWorld(17);
    const water = firstTile(world, biome => biome === BIOME.WATER);
    const energy = world.divine;
    expect(applyPower(world, 'oak', water.x, water.y).ok).toBe(false);
    expect(world.divine).toBe(energy);
    world.divine = 0;
    expect(applyPower(world, 'rain').ok).toBe(false);
    expect(world.weather.kind).toBe('clear');
  });

  it('存档往返保留实体、随机序列与地形，后续历史保持确定', () => {
    const original = createWorld(98765);
    advanceWorld(original, 35);
    const restored = deserializeWorld(serializeWorld(original));
    expect(restored.rng).toBe(original.rng);
    expect(restored.plants).toEqual(original.plants);
    expect(restored.animals).toEqual(original.animals);
    expect(restored.terrain.moisture).toBeInstanceOf(Float32Array);
    advanceWorld(original, 20);
    advanceWorld(restored, 20);
    expect(serializeWorld(restored)).toBe(serializeWorld(original));
  });

  it('拒绝损坏或版本不兼容的存档', () => {
    expect(() => deserializeWorld('{broken')).toThrow();
    const data = JSON.parse(serializeWorld(createWorld(1))) as { version: number };
    data.version = 999;
    expect(() => deserializeWorld(JSON.stringify(data))).toThrow('不兼容');
  });

  it('长期运行仍遵守实体、事件与数值上限', () => {
    const world = createWorld(24680);
    advanceWorld(world, 1200);
    expect(world.plants.length).toBeLessThanOrEqual(MAX_PLANTS);
    expect(world.animals.length).toBeLessThanOrEqual(MAX_ANIMALS);
    expect(world.events.length).toBeLessThanOrEqual(MAX_EVENTS);
    for (const value of world.terrain.moisture) expect(Number.isFinite(value) && value >= 0 && value <= 1).toBe(true);
    for (const animal of world.animals) {
      expect(Number.isFinite(animal.x) && Number.isFinite(animal.y)).toBe(true);
      expect(animal.health).toBeLessThanOrEqual(1.00001);
    }
    expect(worldStats(world).species).toBeLessThanOrEqual(14);
    expect(world.terrain.biome[tileAt(world, WORLD_W / 2, WORLD_H / 2)]).not.toBe(BIOME.VOID);
  });
});

describe('森林之神 v2 · 神眷、心愿与记忆', () => {
  it('身份与特质确定，子代最多继承一项亲代特质', () => {
    const a = identityFor(42, 99), b = identityFor(42, 99);
    expect(a).toEqual(b);
    expect(a.name.length).toBeGreaterThanOrEqual(2);
    expect(new Set(a.traits).size).toBe(2);
    expect(identityFor(42, 100, ['swift']).traits[0]).toBe('swift');
  });

  it('结缘支持命名，心愿逐步增加栏位，重复结缘不重复计数', () => {
    const { world, land } = isolatedWorld();
    const a = animalAt(world, 'rabbit', land.x, land.y);
    const b = animalAt(world, 'rabbit', land.x + 1, land.y);
    const c = animalAt(world, 'rabbit', land.x + 2, land.y);
    expect(bondCapacity(world)).toBe(1);
    expect(bondEntity(world, a.id, '小满').ok).toBe(true);
    expect(a.name).toBe('小满');
    expect(bondCapacity(world)).toBe(2);
    expect(bondEntity(world, a.id, '另一个名字').ok).toBe(true);
    expect(world.progress.lifetimeBonds).toBe(1);
    expect(bondEntity(world, b.id).ok).toBe(true);
    expect(bondEntity(world, c.id).ok).toBe(false);
  });

  it('赐福和更名会写入个体记忆，记忆数量始终有界', () => {
    const { world, land } = isolatedWorld();
    const rabbit = animalAt(world, 'rabbit', land.x, land.y);
    bondEntity(world, rabbit.id, '苔芽');
    for (let i = 0; i < 24; i++) renameBond(world, rabbit.id, `名字${i}`);
    expect(rabbit.memories.length).toBeLessThanOrEqual(MAX_MEMORIES);
    applyPower(world, 'bless', land.x, land.y);
    expect(rabbit.memories.some(m => m.kind === 'bless')).toBe(true);
  });

  it('神眷死亡只生成一座纪念，遗骸分解后生命档案仍可读', () => {
    const { world, land } = isolatedWorld();
    const rabbit = animalAt(world, 'rabbit', land.x, land.y);
    bondEntity(world, rabbit.id, '溪跃');
    rabbit.health = 0;
    stepWorld(world);
    const memorial = findMemorial(world, rabbit.id);
    expect(memorial?.name).toBe('溪跃');
    expect(memorial?.memories.some(m => m.kind === 'death')).toBe(true);
    stepWorld(world);
    expect(world.memorials.filter(m => m.id === rabbit.id)).toHaveLength(1);
    rabbit.deadFor = 2.199;
    stepWorld(world);
    expect(world.animals).not.toContain(rabbit);
    expect(findMemorial(world, rabbit.id)?.offspring).toEqual([]);
    const restored = deserializeWorld(serializeWorld(world));
    expect(restored.memorials).toEqual(world.memorials);
    expect(restored.progress).toEqual(world.progress);
  });

  it('心愿只完成一次，授粉与三代血脉分别解锁雾和雪', () => {
    const { world, land } = isolatedWorld();
    expect(isUnlocked(world, 'mist')).toBe(false);
    const energy = world.divine;
    expect(applyPower(world, 'mist').ok).toBe(false);
    expect(world.divine).toBe(energy);
    world.progress.pollinations = 1;
    stepWorld(world);
    expect(isUnlocked(world, 'mist')).toBe(true);
    expect(applyPower(world, 'mist').ok).toBe(true);
    expect(world.weather.kind).toBe('mist');
    world.progress.maxGeneration = 3;
    world.progress.bondedBirths = 1;
    stepWorld(world);
    expect(isUnlocked(world, 'snow')).toBe(true);
    expect(applyPower(world, 'snow').ok).toBe(true);
    expect(world.weather.kind).toBe('snow');
    const count = world.progress.completed.length;
    advanceWorld(world, 20);
    expect(world.progress.completed.length).toBe(count);
    expect(new Set(world.progress.completed).size).toBe(world.progress.completed.length);
  });

  it('万物共存解锁极光，极光会进入神眷记忆', () => {
    const { world, land } = isolatedWorld();
    const rabbit = animalAt(world, 'rabbit', land.x, land.y);
    bondEntity(world, rabbit.id);
    world.progress.completed.push('diversity');
    expect(applyPower(world, 'aurora').ok).toBe(true);
    expect(world.aurora).toBe(1);
    expect(rabbit.memories.some(m => m.kind === 'aurora')).toBe(true);
    expect(OBJECTIVES.length).toBe(7);
  });

  it('健康多样的森林恢复更多灵力，荒芜世界也有恢复下限', () => {
    const { world: empty } = isolatedWorld();
    const healthy = createWorld(1122);
    expect(spiritRegenRate(empty)).toBe(4);
    expect(spiritRegenRate(healthy)).toBeGreaterThan(spiritRegenRate(empty));
    healthy.divine = 99.99;
    stepWorld(healthy);
    expect(healthy.divine).toBeLessThanOrEqual(100);
  });

  it('纪念林保留最近二十四段故事，纪念 ID 不重复', () => {
    const world = createWorld(9191);
    world.progress.completed.push('firstBond', 'bondedBirth');
    for (let i = 0; i < 30; i++) {
      const animal = world.animals.find(a => a.alive);
      if (!animal) break;
      bondEntity(world, animal.id);
      animal.health = 0;
      stepWorld(world);
      animal.deadFor = 2.199;
      stepWorld(world);
    }
    expect(world.memorials.length).toBeLessThanOrEqual(MAX_MEMORIALS);
    expect(new Set(world.memorials.map(m => m.id)).size).toBe(world.memorials.length);
  });

  it('长期生态受食物与栖息地承载力约束，不会被单一物种刷屏', () => {
    const world = createWorld(60606);
    advanceWorld(world, 2400);
    expect(world.animals.filter(a => a.alive && a.species === 'bee').length).toBeLessThanOrEqual(28);
    expect(world.animals.filter(a => a.alive && a.species === 'rabbit').length).toBeLessThanOrEqual(30);
    expect(world.plants.filter(p => p.alive && p.species === 'grass').length).toBeLessThanOrEqual(115);
    expect(world.events.filter(e => e.text.includes('新的蜂群')).length).toBeLessThan(12);
  });

  it('v1 存档原地升级，保留 RNG、ID、地形与既有亲代', () => {
    const source = createWorld(777);
    advanceWorld(source, 12);
    const legacy = JSON.parse(serializeWorld(source)) as any;
    legacy.version = 1;
    delete legacy.aurora; delete legacy.memorials; delete legacy.progress;
    delete legacy.structures; delete legacy.terrainTick; delete legacy.pathRecorded;
    delete legacy.terrain.trail; delete legacy.terrain.water; delete legacy.terrain.succession;
    for (const entity of [...legacy.plants, ...legacy.animals]) {
      delete entity.name; delete entity.traits; delete entity.bond; delete entity.memories;
      delete entity.generation; delete entity.parentIds; delete entity.offspring;
      delete entity.wood; delete entity.seed; delete entity.structureId; delete entity.lastTrailTile;
    }
    const rng = legacy.rng, nextId = legacy.nextId;
    const migrated = deserializeWorld(JSON.stringify(legacy));
    expect(migrated.version).toBe(3);
    expect(migrated.rng).toBe(rng);
    expect(migrated.nextId).toBe(nextId);
    expect(migrated.plants.map(p => p.id)).toEqual(source.plants.map(p => p.id));
    expect(migrated.terrain.moisture).toEqual(source.terrain.moisture);
    expect(migrated.animals[0].parentIds).toEqual(migrated.animals[0].parentId === null ? [] : [migrated.animals[0].parentId]);
    expect(migrated.animals[0].traits).toEqual(identityFor(777, migrated.animals[0].id).traits);
    expect(serializeWorld(deserializeWorld(serializeWorld(migrated)))).toBe(serializeWorld(migrated));
  });
});

describe('森林之神 v3 · 自主工程与动态地貌', () => {
  it('河狸需要近水栖息地，真实啃倒树木并分阶段筑坝', () => {
    const { world } = isolatedWorld();
    const shore = firstShore(world);
    const beaver = animalAt(world, 'beaver', shore.x, shore.y);
    const oak = plantAt(world, 'oak', shore.x, shore.y);
    oak.growth = 1; oak.health = 1; oak.age = 30;
    beaver.x = shore.x; beaver.y = shore.y; beaver.think = 0; beaver.hunger = 0; beaver.thirst = 0;
    advanceWorld(world, 35);
    expect(oak.alive).toBe(false);
    expect(beaver.wood).toBe(1);
    advanceWorld(world, 170);
    const dam = world.structures.find(s => s.kind === 'dam');
    expect(dam).toBeDefined();
    expect(dam!.progress).toBe(0.5);
    beaver.wood = 1; beaver.think = 0;
    advanceWorld(world, 80);
    expect(dam!.progress).toBe(1);
    expect(world.events.some(e => e.text.includes('木坝完工'))).toBe(true);
  });

  it('完整水坝形成局部回水，拆坝退水后保留原土地基底', () => {
    const { world } = isolatedWorld();
    const shore = firstShore(world);
    let waterTile: { x: number; y: number } | null = null;
    let best = Infinity;
    for (let y = 1; y < WORLD_H - 1; y++) for (let x = Math.floor(shore.x); x < WORLD_W - 1; x++) {
      const d = Math.hypot(x - shore.x, y - shore.y);
      if (x - shore.x <= 8 && Math.abs(y - shore.y) <= 4 && world.terrain.biome[tileAt(world, x, y)] === BIOME.WATER && d < best) {
        best = d; waterTile = { x: x + 0.5, y: y + 0.5 };
      }
    }
    expect(waterTile).not.toBeNull();
    const damTile = tileAt(world, waterTile!.x, waterTile!.y);
    world.terrain.elevation[shore.i] = world.terrain.elevation[damTile];
    world.structures.push({ id:world.nextId++, kind:'dam', x:waterTile!.x, y:waterTile!.y, progress:1, integrity:1, ownerId:1, createdAt:world.time });
    world.weather = { kind:'clear', remaining:100 };
    advanceWorld(world, 100);
    expect(world.terrain.water[shore.i]).toBeGreaterThan(0.28);
    expect(isWater(world, shore.x, shore.y)).toBe(true);
    const baseBiome = world.terrain.biome[shore.i];
    world.structures = [];
    const stored = world.terrain.water[shore.i];
    advanceWorld(world, 220);
    expect(world.terrain.water[shore.i]).toBeLessThan(stored);
    expect(world.terrain.biome[shore.i]).toBe(baseBiome);
  });

  it('强降雨会在饱和低地形成真实积水，而不仅是视觉粒子', () => {
    const { world, land } = isolatedWorld();
    world.terrain.moisture[land.i] = 1;
    world.terrain.water[land.i] = 0;
    world.weather = { kind:'storm', remaining:100 };
    advanceWorld(world, 200);
    expect(world.terrain.water[land.i]).toBeGreaterThan(0.2);
    expect(world.terrain.moisture[land.i]).toBeGreaterThan(0.75);
  });

  it('野兔挖穴、回穴，主人死亡后兔穴仍然保留', () => {
    const { world, land } = isolatedWorld();
    const rabbit = animalAt(world, 'rabbit', land.x, land.y);
    rabbit.x = land.x; rabbit.y = land.y; rabbit.think = 0; rabbit.hunger = 0; rabbit.thirst = 0;
    world.weather = { kind:'rain', remaining:100 };
    advanceWorld(world, 25);
    const burrow = world.structures.find(s => s.kind === 'burrow');
    expect(burrow?.progress).toBe(1);
    expect(rabbit.homeX).toBe(burrow!.x);
    rabbit.think = 0;
    stepWorld(world);
    expect(rabbit.structureId).toBe(burrow!.id);
    rabbit.health = 0; stepWorld(world); rabbit.deadFor = 2.199; stepWorld(world);
    expect(world.structures).toContain(burrow);
  });

  it('真实移动形成小径，闲置小径在雨中逐渐消退', () => {
    const { world } = isolatedWorld();
    const shore = firstShore(world);
    let start = shore, end = distantLand(world, shore, 3);
    for (let y = 3; y < WORLD_H - 3; y++) for (let x = 3; x < WORLD_W - 6; x++) {
      if (isLand(world, x + 0.5, y + 0.5) && isLand(world, x + 4.5, y + 0.5)) { start = { x:x+0.5,y:y+0.5,i:tileAt(world,x,y) }; end = { x:x+4.5,y:y+0.5 }; break; }
    }
    const deer = animalAt(world, 'deer', start.x, start.y);
    deer.x = start.x; deer.y = start.y; deer.age = 6; deer.hunger = 0; deer.thirst = 0; deer.energy = 1;
    deer.behavior = 'wander'; deer.think = 100; deer.tx = end.x; deer.ty = end.y;
    advanceWorld(world, 40);
    const worn = Math.max(...world.terrain.trail);
    expect(worn).toBeGreaterThan(0);
    world.weather = { kind:'rain', remaining:100 };
    world.animals = [];
    advanceWorld(world, 600);
    expect(Math.max(...world.terrain.trail)).toBeLessThan(worn);
  });

  it('狼把活跃猎物共享给附近同伴', () => {
    const { world, land } = isolatedWorld();
    const wolf = animalAt(world, 'wolf', land.x, land.y);
    const pack = animalAt(world, 'wolf', land.x + 2, land.y);
    const rabbit = animalAt(world, 'rabbit', land.x, land.y);
    wolf.x = land.x; wolf.y = land.y; pack.x = land.x + 2; pack.y = land.y; rabbit.x = land.x; rabbit.y = land.y;
    wolf.hunger = 0.9; wolf.think = 0; pack.think = 100; rabbit.think = 100;
    stepWorld(world);
    expect(pack.behavior).toBe('hunt');
    expect(pack.targetId).toBe(rabbit.id);
  });

  it('动物携带浆果种子到远处，新植株保留亲代', () => {
    const { world, land } = isolatedWorld();
    const berry = plantAt(world, 'berry', land.x, land.y);
    berry.growth = 1; berry.health = 1; berry.fruit = 1;
    const deer = animalAt(world, 'deer', land.x, land.y);
    deer.x = land.x; deer.y = land.y; deer.hunger = 0.9; deer.thirst = 0; deer.think = 0;
    stepWorld(world);
    expect(deer.seed?.parentId).toBe(berry.id);
    const destination = distantLand(world, land, 7);
    deer.x = destination.x; deer.y = destination.y; deer.seed!.delay = 0; deer.think = 100;
    const before = world.plants.length;
    stepWorld(world);
    expect(world.plants.length).toBe(before + 1);
    expect(world.plants.at(-1)!.species).toBe('berry');
    expect(world.plants.at(-1)!.parentIds).toContain(berry.id);
  });

  it('树根减少暴雨侵蚀，林地与草甸按持续压力转换', () => {
    const bare = isolatedWorld();
    const rooted = isolatedWorld();
    for (const fixture of [bare, rooted]) {
      fixture.world.weather = { kind:'storm', remaining:100 };
      fixture.world.terrain.elevation.fill(0.1);
      fixture.world.terrain.elevation[fixture.land.i] = 0.5;
      fixture.world.terrain.elevation[fixture.land.i + 1] = 0.05;
    }
    const oak = plantAt(rooted.world, 'oak', rooted.land.x, rooted.land.y);
    oak.growth = 1; oak.health = 1;
    advanceWorld(bare.world, 50); advanceWorld(rooted.world, 50);
    expect(rooted.world.terrain.elevation[rooted.land.i]).toBeGreaterThan(bare.world.terrain.elevation[bare.land.i]);
    rooted.world.weather = { kind:'clear', remaining:100 };
    rooted.world.terrain.succession[rooted.land.i] = 210;
    rooted.world.terrain.biome[rooted.land.i] = BIOME.MEADOW;
    advanceWorld(rooted.world, 100);
    expect(rooted.world.terrain.biome[rooted.land.i]).toBe(BIOME.FOREST);
    rooted.world.plants = [];
    rooted.world.terrain.succession[rooted.land.i] = 40;
    advanceWorld(rooted.world, 150);
    expect(rooted.world.terrain.biome[rooted.land.i]).toBe(BIOME.MEADOW);
  });

  it('v2 存档迁移 v3 时补齐地貌与工程状态而不消耗 RNG', () => {
    const source = createWorld(2026);
    const data = JSON.parse(serializeWorld(source)) as any;
    data.version = 2;
    delete data.terrain.trail; delete data.terrain.water; delete data.terrain.succession;
    delete data.structures; delete data.terrainTick; delete data.pathRecorded;
    for (const animal of data.animals) { delete animal.wood; delete animal.seed; delete animal.structureId; delete animal.lastTrailTile; }
    const rng = data.rng, nextId = data.nextId;
    const migrated = deserializeWorld(JSON.stringify(data));
    expect(migrated.version).toBe(3);
    expect(migrated.rng).toBe(rng);
    expect(migrated.nextId).toBe(nextId);
    expect(migrated.structures).toEqual([]);
    expect(migrated.animals[0].wood).toBe(0);
    expect(Math.max(...migrated.terrain.trail)).toBe(0);
    for (let i = 0; i < migrated.terrain.biome.length; i++) if (migrated.terrain.biome[i] === BIOME.WATER) expect(migrated.terrain.water[i]).toBeCloseTo(0.65, 5);
  });
});
