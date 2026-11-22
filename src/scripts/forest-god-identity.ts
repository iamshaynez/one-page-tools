/** 《森林之神》生命身份与里程碑；身份计算独立于世界随机数。 */

export type TraitId = 'swift' | 'gentle' | 'hardy' | 'curious' | 'fertile' | 'luminous' | 'deepRoot' | 'sweet';
export type MemoryKind = 'birth' | 'bond' | 'bless' | 'storm' | 'offspring' | 'adult' | 'injury' | 'death' | 'pollination' | 'snow' | 'aurora';
export type ObjectiveId = 'firstBond' | 'pollination' | 'bondedBirth' | 'threeGenerations' | 'diversity' | 'ancientTree' | 'fireRecovery';

export interface LifeMemory {
  at: number;
  kind: MemoryKind;
  text: string;
  x: number;
  y: number;
  relatedId?: number;
}

export interface Bond { name: string; since: number }

export interface ObjectiveDefinition {
  id: ObjectiveId;
  name: string;
  description: string;
  reward: string;
  unlock: 'bond2' | 'bond3' | 'mist' | 'snow' | 'aurora' | 'memorial' | null;
}

export const TRAITS: Record<TraitId, { name: string; description: string }> = {
  swift: { name: '迅捷', description: '脚步轻盈，行动与反应都如风一般敏捷。' },
  gentle: { name: '温驯', description: '性情柔和，愿意亲近同伴与注视它的神明。' },
  hardy: { name: '坚韧', description: '耐得住寒暑与伤痛，在艰难时节依然茁壮。' },
  curious: { name: '好奇', description: '总在探索陌生的林地，对世界怀有明亮的好奇。' },
  fertile: { name: '丰饶', description: '生命气息旺盛，花种与血脉都更易延续。' },
  luminous: { name: '辉光', description: '眼眸与枝叶藏着微光，雾夜也无法将它掩去。' },
  deepRoot: { name: '深根', description: '与土地紧密相连，懂得从深处汲取滋养。' },
  sweet: { name: '甘甜', description: '花蜜与果实格外甜美，引来蜂群与觅食者。' },
};

export const OBJECTIVES: readonly ObjectiveDefinition[] = [
  { id: 'firstBond', name: '初见神眷', description: '与一个生命缔结第一段神眷。', reward: '可同时维系两段神眷', unlock: 'bond2' },
  { id: 'pollination', name: '花间信使', description: '见证野蜂为野花完成一次授粉。', reward: '解锁神力「晨雾」', unlock: 'mist' },
  { id: 'bondedBirth', name: '血脉新生', description: '见证神眷生命迎来自己的后代。', reward: '可同时维系三段神眷', unlock: 'bond3' },
  { id: 'threeGenerations', name: '三代同林', description: '见证一条神眷血脉延续至第三代。', reward: '解锁神力「初雪」', unlock: 'snow' },
  { id: 'diversity', name: '万物并育', description: '结缘后，让十三类生命共存并迎来三次新生。', reward: '解锁神力「极光」', unlock: 'aurora' },
  { id: 'ancientTree', name: '岁月成冠', description: '与一棵历经漫长岁月的古树结缘。', reward: '纪念石会长出金色苔纹', unlock: 'memorial' },
  { id: 'fireRecovery', name: '灰烬春回', description: '让山火焚毁的土地重新孕育出繁茂生命。', reward: '将这场重生写入森林的历史', unlock: null },
];

const TRAIT_IDS: readonly TraitId[] = ['swift', 'gentle', 'hardy', 'curious', 'fertile', 'luminous', 'deepRoot', 'sweet'];
const NAME_HEADS = ['青', '溪', '松', '竹', '岚', '雨', '晴', '雪', '星', '月', '云', '风', '林', '山', '川', '露', '霞', '苔', '梅', '兰', '枫', '梧', '鹤', '鹿', '萤', '泉', '石', '春', '秋', '晨', '暮', '野'] as const;
const NAME_TAILS = ['汀', '涧', '笙', '眠', '深', '晖', '枝', '叶', '芽', '花', '落', '归', '栖', '鸣', '湍', '渚', '岑', '岫', '霭', '霁', '音', '歌', '语', '影', '听澜', '望舒', '扶苏', '初霁', '疏雨', '流萤', '凝霜', '照水'] as const;

function identityHash(seed: number, id: number, salt: number): number {
  let h = (seed ^ Math.imul(id, 0x9e3779b1) ^ salt) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x21f0aaad);
  h = Math.imul(h ^ (h >>> 15), 0x735a2d97);
  return (h ^ (h >>> 15)) >>> 0;
}

export function identityFor(seed: number, id: number, inherited: readonly TraitId[] = []): { name: string; traits: TraitId[] } {
  const name = NAME_HEADS[identityHash(seed, id, 0x68bc21eb) % NAME_HEADS.length]
    + NAME_TAILS[identityHash(seed, id, 0x02e5be93) % NAME_TAILS.length];
  const inheritedTrait = inherited.length > 0
    ? inherited[identityHash(seed, id, 0xa5a3564d) % inherited.length]
    : undefined;
  const first = inheritedTrait ?? TRAIT_IDS[identityHash(seed, id, 0x1b56c4e9) % TRAIT_IDS.length];
  const freshTraits = TRAIT_IDS.filter((trait) => trait !== first && !inherited.includes(trait));
  const secondPool = freshTraits.length > 0 ? freshTraits : TRAIT_IDS.filter((trait) => trait !== first);
  const second = secondPool[identityHash(seed, id, 0xc2b2ae35) % secondPool.length];
  return { name, traits: [first, second] };
}
