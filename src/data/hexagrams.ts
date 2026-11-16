/**
 * 周易六十四卦 · 文王卦序与卦辞（公有领域古籍文本）
 * 卦辞为通行本原文；仅供娱乐参考，如需严谨研究请核对权威注本。
 */

export interface Hexagram {
  no: number;         // 文王卦序 1–64
  name: string;       // 卦名
  judgement: string;  // 卦辞
}

/** 八卦卦名，按三爻二进制值（下爻×1、中爻×2、上爻×4）排序：000…111 */
export const TRIGRAM_NAMES = ['坤', '震', '坎', '兑', '艮', '离', '巽', '乾'] as const;

/** 八卦取象（自然）：地雷水泽山火风天，与 TRIGRAM_NAMES 同序 */
export const TRIGRAM_NATURE = ['地', '雷', '水', '泽', '山', '火', '风', '天'] as const;

/** 上卦×下卦 → 文王卦序。行 = 上卦（外卦），列 = 下卦（内卦）。 */
export const COMPOSITION: number[][] = [
  /* 坤上 */ [2, 24, 7, 19, 15, 36, 46, 11],
  /* 震上 */ [16, 51, 40, 54, 62, 55, 32, 34],
  /* 坎上 */ [8, 3, 29, 60, 39, 63, 48, 5],
  /* 兑上 */ [45, 17, 47, 58, 31, 49, 28, 43],
  /* 艮上 */ [23, 27, 4, 41, 52, 22, 18, 26],
  /* 离上 */ [35, 21, 64, 38, 56, 30, 50, 14],
  /* 巽上 */ [20, 42, 59, 61, 53, 37, 57, 9],
  /* 乾上 */ [12, 25, 6, 10, 33, 13, 44, 1],
];

export const HEXAGRAMS: Hexagram[] = [
  { no: 1, name: '乾', judgement: '元，亨，利，贞。' },
  { no: 2, name: '坤', judgement: '元亨，利牝马之贞。君子有攸往，先迷后得主，利西南得朋，东北丧朋。安贞吉。' },
  { no: 3, name: '屯', judgement: '元亨利贞。勿用有攸往，利建侯。' },
  { no: 4, name: '蒙', judgement: '亨。匪我求童蒙，童蒙求我。初筮告，再三渎，渎则不告。利贞。' },
  { no: 5, name: '需', judgement: '有孚，光亨，贞吉。利涉大川。' },
  { no: 6, name: '讼', judgement: '有孚窒惕，中吉，终凶。利见大人，不利涉大川。' },
  { no: 7, name: '师', judgement: '贞，丈人吉，无咎。' },
  { no: 8, name: '比', judgement: '吉。原筮，元永贞，无咎。不宁方来，后夫凶。' },
  { no: 9, name: '小畜', judgement: '亨。密云不雨，自我西郊。' },
  { no: 10, name: '履', judgement: '履虎尾，不咥人，亨。' },
  { no: 11, name: '泰', judgement: '小往大来，吉，亨。' },
  { no: 12, name: '否', judgement: '否之匪人，不利君子贞，大往小来。' },
  { no: 13, name: '同人', judgement: '同人于野，亨。利涉大川，利君子贞。' },
  { no: 14, name: '大有', judgement: '元亨。' },
  { no: 15, name: '谦', judgement: '亨。君子有终。' },
  { no: 16, name: '豫', judgement: '利建侯行师。' },
  { no: 17, name: '随', judgement: '元亨利贞，无咎。' },
  { no: 18, name: '蛊', judgement: '元亨，利涉大川。先甲三日，后甲三日。' },
  { no: 19, name: '临', judgement: '元亨利贞。至于八月有凶。' },
  { no: 20, name: '观', judgement: '盥而不荐，有孚颙若。' },
  { no: 21, name: '噬嗑', judgement: '亨。利用狱。' },
  { no: 22, name: '贲', judgement: '亨。小利有攸往。' },
  { no: 23, name: '剥', judgement: '不利有攸往。' },
  { no: 24, name: '复', judgement: '亨。出入无疾，朋来无咎。反复其道，七日来复。利有攸往。' },
  { no: 25, name: '无妄', judgement: '元亨利贞。其匪正有眚，不利有攸往。' },
  { no: 26, name: '大畜', judgement: '利贞。不家食吉，利涉大川。' },
  { no: 27, name: '颐', judgement: '贞吉。观颐，自求口实。' },
  { no: 28, name: '大过', judgement: '栋桡。利有攸往，亨。' },
  { no: 29, name: '坎', judgement: '习坎，有孚，维心亨，行有尚。' },
  { no: 30, name: '离', judgement: '利贞，亨。畜牝牛吉。' },
  { no: 31, name: '咸', judgement: '亨，利贞，取女吉。' },
  { no: 32, name: '恒', judgement: '亨，无咎，利贞。利有攸往。' },
  { no: 33, name: '遁', judgement: '亨，小利贞。' },
  { no: 34, name: '大壮', judgement: '利贞。' },
  { no: 35, name: '晋', judgement: '康侯用锡马蕃庶，昼日三接。' },
  { no: 36, name: '明夷', judgement: '利艰贞。' },
  { no: 37, name: '家人', judgement: '利女贞。' },
  { no: 38, name: '睽', judgement: '小事吉。' },
  { no: 39, name: '蹇', judgement: '利西南，不利东北。利见大人，贞吉。' },
  { no: 40, name: '解', judgement: '利西南。无所往，其来复吉。有攸往，夙吉。' },
  { no: 41, name: '损', judgement: '有孚，元吉，无咎，可贞，利有攸往。曷之用？二簋可用享。' },
  { no: 42, name: '益', judgement: '利有攸往，利涉大川。' },
  { no: 43, name: '夬', judgement: '扬于王庭，孚号有厉。告自邑，不利即戎，利有攸往。' },
  { no: 44, name: '姤', judgement: '女壮，勿用取女。' },
  { no: 45, name: '萃', judgement: '亨。王假有庙，利见大人，亨，利贞。用大牲吉，利有攸往。' },
  { no: 46, name: '升', judgement: '元亨。用见大人，勿恤，南征吉。' },
  { no: 47, name: '困', judgement: '亨，贞，大人吉，无咎。有言不信。' },
  { no: 48, name: '井', judgement: '改邑不改井，无丧无得，往来井井。汔至亦未繘井，羸其瓶，凶。' },
  { no: 49, name: '革', judgement: '巳日乃孚，元亨利贞，悔亡。' },
  { no: 50, name: '鼎', judgement: '元吉，亨。' },
  { no: 51, name: '震', judgement: '亨。震来虩虩，笑言哑哑。震惊百里，不丧匕鬯。' },
  { no: 52, name: '艮', judgement: '艮其背，不获其身；行其庭，不见其人。无咎。' },
  { no: 53, name: '渐', judgement: '女归吉，利贞。' },
  { no: 54, name: '归妹', judgement: '征凶，无攸利。' },
  { no: 55, name: '丰', judgement: '亨，王假之。勿忧，宜日中。' },
  { no: 56, name: '旅', judgement: '小亨，旅贞吉。' },
  { no: 57, name: '巽', judgement: '小亨。利有攸往，利见大人。' },
  { no: 58, name: '兑', judgement: '亨，利贞。' },
  { no: 59, name: '涣', judgement: '亨。王假有庙，利涉大川，利贞。' },
  { no: 60, name: '节', judgement: '亨。苦节不可贞。' },
  { no: 61, name: '中孚', judgement: '豚鱼吉，利涉大川，利贞。' },
  { no: 62, name: '小过', judgement: '亨，利贞。可小事，不可大事。飞鸟遗之音，不宜上，宜下，大吉。' },
  { no: 63, name: '既济', judgement: '亨小，利贞。初吉终乱。' },
  { no: 64, name: '未济', judgement: '亨。小狐汔济，濡其尾，无攸利。' },
];

export const byNo = (no: number): Hexagram => HEXAGRAMS[no - 1];
