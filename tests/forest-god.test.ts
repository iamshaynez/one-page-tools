import { describe, expect, it } from 'vitest';
import {
  MAX_ANIMALS, MAX_EVENTS, MAX_PLANTS, STEP_DAYS, WORLD_H, WORLD_W,
} from '../src/scripts/forest-god-content';
import {
  BIOME, advanceWorld, applyPower, createWorld, deserializeWorld, environmentAt, isLand, serializeWorld, stepWorld, tileAt, worldStats,
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
    expect(worldStats(world).species).toBeLessThanOrEqual(13);
    expect(isLand(world, WORLD_W / 2, WORLD_H / 2)).toBe(true);
  });
});
