/** 《森林之神》物种与规则图鉴。数值的时间单位均为世界日。 */

export const WORLD_W = 120;
export const WORLD_H = 80;
export const WORLD_VERSION = 1;
export const STEP_DAYS = 0.005;
export const DAYS_PER_SEASON = 12;
export const MAX_PLANTS = 380;
export const MAX_ANIMALS = 120;
export const MAX_EVENTS = 48;

export type PlantSpecies = 'grass' | 'flower' | 'berry' | 'oak' | 'pine' | 'fern' | 'mushroom';
export type AnimalSpecies = 'rabbit' | 'deer' | 'fox' | 'wolf' | 'bee' | 'frog';
export type WeatherKind = 'clear' | 'rain' | 'storm';
export type Season = '春' | '夏' | '秋' | '冬';
export type Behavior = 'wander' | 'rest' | 'seekFood' | 'drink' | 'flee' | 'hunt' | 'court' | 'follow';
export type Power = 'inspect' | 'rain' | 'sun' | 'storm' | 'bless' | 'lightning' | PlantSpecies | AnimalSpecies;
export type EventKind = 'birth' | 'death' | 'weather' | 'divine' | 'ecology' | 'fire';

export interface PlantRule {
  name: string;
  latin: string;
  lifespan: number;
  matureAt: number;
  spread: number;
  spreadRadius: number;
  moisture: number;
  light: number;
  cost: number;
  color: string;
  description: string;
}

export const PLANT_RULES: Record<PlantSpecies, PlantRule> = {
  grass: { name: '青草', latin: 'Gramineae', lifespan: 7, matureAt: 0.7, spread: 1.7, spreadRadius: 4, moisture: 0.35, light: 0.65, cost: 2, color: '#77945b', description: '铺住裸土，也填饱植食动物。' },
  flower: { name: '野花', latin: 'Anthophyta', lifespan: 6, matureAt: 1.2, spread: 0.8, spreadRadius: 6, moisture: 0.42, light: 0.8, cost: 3, color: '#e7b5c4', description: '经蜂授粉后会散播更多种子。' },
  berry: { name: '浆果丛', latin: 'Rubus silva', lifespan: 30, matureAt: 5, spread: 0.18, spreadRadius: 7, moisture: 0.5, light: 0.65, cost: 6, color: '#a74c62', description: '结果时供养鹿、兔与鸟类。' },
  oak: { name: '橡树', latin: 'Quercus dea', lifespan: 110, matureAt: 14, spread: 0.035, spreadRadius: 10, moisture: 0.45, light: 0.7, cost: 10, color: '#4d704d', description: '缓慢长大的庇荫者，枯木孕育菌落。' },
  pine: { name: '松树', latin: 'Pinus vetus', lifespan: 135, matureAt: 17, spread: 0.028, spreadRadius: 11, moisture: 0.3, light: 0.75, cost: 10, color: '#345b4c', description: '耐旱常青，秋冬仍为动物遮蔽风寒。' },
  fern: { name: '蕨类', latin: 'Pteris umbra', lifespan: 16, matureAt: 2.5, spread: 0.4, spreadRadius: 4, moisture: 0.65, light: 0.3, cost: 4, color: '#54836a', description: '偏爱湿润林荫，是蛙的藏身处。' },
  mushroom: { name: '蘑菇', latin: 'Fungi renovatio', lifespan: 4, matureAt: 0.45, spread: 0.75, spreadRadius: 3, moisture: 0.72, light: 0.15, cost: 4, color: '#d49a75', description: '分解遗骸，把死亡重新写成养分。' },
};

export interface AnimalRule {
  name: string;
  latin: string;
  diet: 'herbivore' | 'carnivore' | 'pollinator' | 'insectivore';
  foods: string[];
  predators: AnimalSpecies[];
  lifespan: number;
  matureAt: number;
  speed: number;
  hungerRate: number;
  thirstRate: number;
  sense: number;
  attack: number;
  cost: number;
  color: string;
  nocturnal?: boolean;
  description: string;
}

export const ANIMAL_RULES: Record<AnimalSpecies, AnimalRule> = {
  rabbit: { name: '野兔', latin: 'Lepus silva', diet: 'herbivore', foods: ['grass', 'flower', 'berry'], predators: ['fox', 'wolf'], lifespan: 14, matureAt: 1.8, speed: 9, hungerRate: 0.18, thirstRate: 0.12, sense: 9, attack: 0.08, cost: 8, color: '#d7c6aa', description: '繁殖迅速，靠警觉与奔跑活下去。' },
  deer: { name: '梅花鹿', latin: 'Cervus maculatus', diet: 'herbivore', foods: ['grass', 'berry', 'fern'], predators: ['wolf'], lifespan: 30, matureAt: 4, speed: 7.2, hungerRate: 0.12, thirstRate: 0.14, sense: 10, attack: 0.16, cost: 14, color: '#b78359', description: '成群啃食嫩芽，也会避开狼群。' },
  fox: { name: '赤狐', latin: 'Vulpes ignis', diet: 'carnivore', foods: ['rabbit'], predators: ['wolf'], lifespan: 24, matureAt: 3.2, speed: 8.2, hungerRate: 0.1, thirstRate: 0.1, sense: 13, attack: 0.5, cost: 14, color: '#c87546', nocturnal: true, description: '暮色里的独行者，控制着兔群数量。' },
  wolf: { name: '灰狼', latin: 'Lupus chorus', diet: 'carnivore', foods: ['rabbit', 'deer', 'fox'], predators: [], lifespan: 30, matureAt: 4.5, speed: 8.5, hungerRate: 0.085, thirstRate: 0.1, sense: 15, attack: 0.7, cost: 18, color: '#858a89', nocturnal: true, description: '顶级捕食者，饥饿时也会与狐争斗。' },
  bee: { name: '野蜂', latin: 'Apis aurea', diet: 'pollinator', foods: ['flower'], predators: ['frog'], lifespan: 3.5, matureAt: 0.35, speed: 12, hungerRate: 0.3, thirstRate: 0.04, sense: 12, attack: 0.05, cost: 5, color: '#e7bd50', description: '追逐花期；蜂群繁盛时，花海也会扩张。' },
  frog: { name: '树蛙', latin: 'Rana pluvia', diet: 'insectivore', foods: ['bee'], predators: ['fox'], lifespan: 10, matureAt: 1.2, speed: 5.5, hungerRate: 0.16, thirstRate: 0.2, sense: 7, attack: 0.25, cost: 7, color: '#6f9b62', nocturnal: true, description: '依水而居，雨后和昆虫多的地方最活跃。' },
};

export const POWER_INFO: Record<Exclude<Power, PlantSpecies | AnimalSpecies>, { name: string; cost: number; hint: string }> = {
  inspect: { name: '观察', cost: 0, hint: '点选生命，阅读它此刻的命运' },
  rain: { name: '唤雨', cost: 18, hint: '降水滋润土壤，也能扑灭山火' },
  sun: { name: '晴光', cost: 12, hint: '驱散雨云，令植物沐浴暖阳' },
  storm: { name: '雷暴', cost: 30, hint: '暴雨与随机落雷，美丽而危险' },
  bless: { name: '赐福', cost: 25, hint: '疗愈一片土地及其中所有生命' },
  lightning: { name: '落雷', cost: 20, hint: '击中林地；火焰会真实蔓延' },
};

export const SEASONS: Season[] = ['春', '夏', '秋', '冬'];
export const PLANT_ORDER: PlantSpecies[] = ['grass', 'flower', 'berry', 'oak', 'pine', 'fern', 'mushroom'];
export const ANIMAL_ORDER: AnimalSpecies[] = ['rabbit', 'deer', 'fox', 'wolf', 'bee', 'frog'];

export const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
