/**
 * v1.3 短语边界感知切分（字幕 Step 3/6 的语义切点来源）。
 *
 * 为什么单独成文件：`text-segmentation.ts` 是债务门禁的「点名还账」对象（零增长容差），
 * 而这段逻辑本是纯函数 + 一张数据表，与分句器状态无关。抽出来既让门禁归零，
 * 也让「规则表 → 切点」这条链路可以被单独测试。
 *
 * 设计要点：**成对登记优于单侧字符集**。单侧的 `tail` / `head` 集合交集会产生假边界
 * （`了|拉` 既可能来自「为了拉拢」，也可能来自「完成了拉车」），成对登记把假阳性
 * 从集合交集降到显式枚举；同时它是纯字符串比较，不依赖分词器——三端
 * （Python jieba / TS segmentit / Electron JS segmentit）才能逐字一致。
 */
import subtitleRules from './subtitle-rules.json';

/** 规则表里的显式成对短语表：`[块尾短语, 允许的后续首字集]`。 */
const PHRASE_BOUNDARY_PAIRS: ReadonlyArray<readonly [string, string]> =
  subtitleRules.word_split.phrase_boundary?.pairs ?? [];

/** 短语边界路径允许头块放宽到 `min_chars - relax`（与既有 tailMin 软约束对齐）。 */
export const PHRASE_BOUNDARY_MIN_HEAD_RELAX: number =
  subtitleRules.word_split.phrase_boundary?.min_head_relax ?? 0;

/**
 * 切点 `i` 是否落在某显式短语对的右端：块以 `left` 逐字结尾，且 `text[i]` 命中 `next`。
 * `next` 为空串时退化为「块尾短语」单侧判定（规则表当前无此形态，保留为兼容）。
 */
export function isPhraseBoundary(text: string, i: number): boolean {
  if (i <= 0 || i >= text.length) return false;
  for (const [left, next] of PHRASE_BOUNDARY_PAIRS) {
    if (i < left.length) continue;
    if (text.slice(i - left.length, i) !== left) continue;
    if (next && !next.includes(text[i])) continue;
    return true;
  }
  return false;
}

/** 调用方提供的不变量守卫（保护短语 / 代理对 / 小数点 / “了”后宾语等）。 */
export type PhraseBoundaryGuard = (index: number) => boolean;

/**
 * 在 `[lo, hi]` 内从后往前找短语右边界切点（返回切后索引；无则 -1）。
 * 头块下限放宽到 `minChars - relax`；尾块仍要求 >= `minChars`，避免产生过短尾块。
 */
export function findPhraseBoundaryPos(
  text: string,
  lo: number,
  hi: number,
  minChars: number,
  guard: PhraseBoundaryGuard,
): number {
  const lower = Math.max(1, lo);
  const upper = Math.min(text.length - 1, hi);
  if (lower > upper) return -1;
  const minHead = Math.max(1, minChars - PHRASE_BOUNDARY_MIN_HEAD_RELAX);
  for (let i = upper; i >= lower; i--) {
    if (i < minHead) continue;
    if (text.length - i < minChars) continue;
    if (!isPhraseBoundary(text, i)) continue;
    if (!guard(i)) continue;
    return i;
  }
  return -1;
}
