/**
 * 工具注册表 — 全站唯一数据源
 * 大厅卡片、分类筛选、Feel Lucky、页脚导航、统计全部由此生成。
 * 新增一个玩具 = 一个 .astro 页面 + 这里一条记录。
 */

export type Category = 'classic' | 'create' | 'dev' | 'play';

export interface Tool {
  key: string;          // URL: /tools/{key}/
  name: string;
  desc: string;
  icon: string;         // 单字符符号，玄墨风不用彩色 emoji
  category: Category;
  since: string;        // 首次诞生（v1 或 v2）
  featured?: boolean;   // 大厅置顶
}

export const CATEGORIES: Record<Category, { label: string; en: string }> = {
  classic: { label: '经典玩具', en: 'Classics' },
  create: { label: '创作工坊', en: 'Studio' },
  dev: { label: '开发者工具', en: 'Dev' },
  play: { label: '趣味游戏', en: 'Playground' },
};

export const TOOLS: Tool[] = [
  // ---- 经典玩具（v1 传承） ----
  { key: 'asakusa', name: '浅草观音寺抽签', desc: '观音灵签一百首，签文与解曰全本地化，摇签筒求一支今日运。', icon: '籤', category: 'classic', since: '2024-07', featured: true },
  { key: 'randomrole', name: '角色随机分配器', desc: '剧本杀选择困难症专用。角色库记忆、狼人杀模板、结果卡片。', icon: '角', category: 'classic', since: '2024-07' },
  { key: 'mbti', name: 'MBTI 测试', desc: '六十题迫选快测（情境题 + 官方式词对题）：四维倾向四档偏好、十六型人格图鉴，全本地作答。', icon: '格', category: 'classic', since: '2026-11' },
  { key: 'enneagram', name: '九型人格快测', desc: '三十六对陈述二选一迫选：主型、翼型、成长与压力箭头、九型全谱，图鉴全本地。', icon: '九', category: 'classic', since: '2026-11' },
  { key: 'snake', name: '贪食蛇', desc: '速度渐进、滑动手势、最高分记忆。别咬到自己。', icon: '蛇', category: 'classic', since: '2024-07' },
  { key: 'mine', name: '扫雷', desc: '首击必安全，三档难度，双击快开，长按插旗，最佳时间。', icon: '雷', category: 'classic', since: '2024-07' },
  { key: 'mermaid', name: 'Mermaid 图表', desc: '左右分栏实时渲染，PNG/SVG 导出，语法错误行内提示。', icon: '圖', category: 'classic', since: '2024-07' },
  { key: 'score', name: '牌局计分板', desc: '多人每轮记分与汇总，撤销重做、趋势图、CSV 导出、多局存档。', icon: '計', category: 'classic', since: '2024-07', featured: true },
  { key: 'subtitle', name: '字幕图片生成', desc: '多行字幕复合长图，模糊拉伸延伸，字体颜色全参数化。', icon: '幕', category: 'classic', since: '2024-07' },
  { key: 'yijing', name: '周易铜钱卦', desc: '摇三枚铜钱六次成卦，六十四卦卦辞全本地，老阴老阳变之卦。', icon: '卦', category: 'classic', since: '2026-11' },

  // ---- 创作工坊 ----
  { key: 'poem', name: '每日诗签', desc: '唐诗宋词随机一首，玄墨卡片生成，一日一诗。', icon: '詩', category: 'create', since: '2026-11' },
  { key: 'wordclock', name: '汉字时钟', desc: '一整版汉字方阵，时间到了谁，谁就亮起漆红。分钟一换。', icon: '刻', category: 'create', since: '2026-11' },
  { key: 'vertical', name: '竖排文字器', desc: '中文竖排版式，从右往左，杂志感长图一键导出。', icon: '排', category: 'create', since: '2026-11' },
  { key: 'seal', name: '印章生成器', desc: '朱文白文，一方小印。输入名字，得一枚 SVG 闲章。', icon: '印', category: 'create', since: '2026-11' },
  { key: 'endtime', name: '时间的尽头', desc: '一座巨钟坍缩成黑洞：引力透镜、时间膨胀双时钟、潮汐撕裂、霍金辐射、彭罗斯弹弓，按住倒流至 t=0 见证宇宙重生。', icon: '終', category: 'create', since: '2026-11', featured: true },
  { key: 'cosmos', name: '宇宙漫游', desc: '从地球出发驾驶视角漫游太阳系：九大天体按真实 J2000 轨道根数运行，土星环、小行星带、流星雨与五个漂浮彩蛋。', icon: '宇', category: 'play', since: '2026-11', featured: true },
  { key: 'party', name: '聚会抽奖分组', desc: '随机分组、幸运轮盘抽奖、名单记忆，聚会不冷场。', icon: '聚', category: 'create', since: '2026-11' },
  { key: 'pomodoro', name: '玄墨番茄钟', desc: '专注二十五分钟，歇五分钟。今日番茄数本地累计。', icon: '茄', category: 'create', since: '2026-11' },

  // ---- 开发者工具 ----
  { key: 'json', name: 'JSON 工具台', desc: '格式化、压缩、校验、转义，JSON 与 YAML 互转。', icon: 'J', category: 'dev', since: '2026-11' },
  { key: 'regex', name: '正则测试器', desc: '实时高亮匹配，分组捕获展示，常用正则速查。', icon: 'R', category: 'dev', since: '2026-11' },
  { key: 'cron', name: 'Cron 解释器', desc: '表达式译成人话，未来十次触发时间一目了然。', icon: 'C', category: 'dev', since: '2026-11' },
  { key: 'timestamp', name: '时间戳工具', desc: '毫秒秒级互转，自然语言解析，当前时间常显。', icon: 'T', category: 'dev', since: '2026-11' },
  { key: 'password', name: '密码与 UUID', desc: '强密码批量生成，UUID v4 一打一打地来。', icon: 'P', category: 'dev', since: '2026-11' },

  // ---- 趣味游戏 ----
  { key: 'g2048', name: '2048', desc: '数字合成经典。键盘方向键或滑动，冲击 2048。', icon: '肆', category: 'play', since: '2026-11' },
  { key: 'bulls', name: '猜数字 1A2B', desc: '四位不重复数字，几 A 几 B 推理对决，三分钟一局。', icon: '猜', category: 'play', since: '2026-11' },
  { key: 'wheel', name: '今晚吃什么轮盘', desc: '漆红指针转盘，编辑你的选项清单，让命运决定。', icon: '盤', category: 'play', since: '2026-11' },
  { key: 'noise', name: '白噪音小屋', desc: '雨声、篝火、风。Web Audio 纯合成，零素材离线可用。', icon: '音', category: 'play', since: '2026-11' },
  { key: 'gomoku', name: '五子棋', desc: '本地双人对弈，或挑战简单 AI。落子无悔。', icon: '棋', category: 'play', since: '2026-11' },
  { key: 'twentyfour', name: '24 点扑克', desc: '四张牌算 24，输入式子即时判定，内置分数求解器看答案。', icon: '算', category: 'play', since: '2026-11' },
];

export const byKey = (key: string) => TOOLS.find((t) => t.key === key);
export const byCategory = (cat: Category) => TOOLS.filter((t) => t.category === cat);
