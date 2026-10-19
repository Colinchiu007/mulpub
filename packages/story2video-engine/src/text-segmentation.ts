/**
 * 文本句子分割模块 v1.0（TypeScript 移植版）
 *
 * 基于 text_segmentation_module.py 独立移植
 * 功能：将文章按照语义和时长要求进行智能分割
 * 三级分割流程：句子边界消歧 → 场景级分割 → 字幕级分割
 *
 * 设计原则：
 * - 完全独立的模块化设计，不依赖业务逻辑
 * - 配置驱动，所有参数可配置
 * - 纯客户端执行，无需网络请求
 * - 支持 API 增强（smart-sentence-splitter 服务）
 */

// 原依赖 @/services/external-config 和 @/services/sentence-splitter-api 已移除
// API 增强包装函数 (splitTextToScenesSmart, splitTextToSubtitlesSmart) 已移除

// 字幕分割规则单源（subtitle-rules.json，与 smart-sentence-splitter Python 共享同一份规则）
import subtitleRules from './subtitle-rules.json';
import { isUnitInterior } from './subtitle-unit-guard';
import { segmenterSpans } from './segment';
import { isPhraseBoundary, PHRASE_BOUNDARY_MIN_HEAD_RELAX } from './subtitle-phrase-boundary';
// ==================== 通用工具 ====================

/** 数字字符判定（v1.2.3 小数点豁免）：对齐 Python str.isdigit 的常用子集（Unicode 十进制数字）。 */
function isDigitChar (c: string): boolean {
  return c.length === 1 && /[\p{Nd}]/u.test(c);
}

function isAsciiWordChar (c: string | undefined): boolean {
  return c !== undefined && /[A-Za-z0-9_]/.test(c);
}

function isCodePointBoundary (text: string, index: number): boolean {
  if (index <= 0 || index >= text.length) return true;
  const previous = text.charCodeAt(index - 1);
  const current = text.charCodeAt(index);
  return !(previous >= 0xd800 && previous <= 0xdbff && current >= 0xdc00 && current <= 0xdfff);
}

function isDecimalToken(text: string, start: number, end: number): boolean {
  const token = text.slice(start, end);
  if (!/^\p{Nd}+\.\p{Nd}+$/u.test(token)) return false;
  return !isAsciiWordChar(text[start - 1]) && !isAsciiWordChar(text[end]);
}

// ==================== 配置类型定义 ====================

/** 句子边界消歧配置 */
export interface SentenceTokenizerConfig {
  language: string;
  handleAbbreviations: boolean;
  customAbbreviations: string[];
  maxSentenceLength: number;
}

/** 场景级分割配置 */
export interface SceneSegmentationConfig {
  targetSeconds: number;
  /** 分镜字数主控（三层模型①）：提供时直接作为目标字数，缺省回退 targetSeconds×bps×speechRate */
  targetCharsPerScene?: number;
  baseWordsPerSecond: number;
  speechRate: number;
  minWordsPerSegment: number;
  maxWordsPerSegment: number;
  enforceSentenceBoundary: boolean;
  allowSingleSentenceOverflow: boolean;
}

/** 字幕级分割配置 */
export interface SubtitleSegmentationConfig {
  minCharsPerBlock: number;
  maxCharsPerBlock: number;
  punctuationPriority: string[];
  timeCalculationMethod: 'proportional' | 'equal';
}

/** 完整的文本分割配置 */
export interface TextSegmentationConfig {
  sentenceTokenizer: SentenceTokenizerConfig;
  scene: SceneSegmentationConfig;
  subtitle: SubtitleSegmentationConfig;
}

// ==================== 默认配置 ====================

export const DEFAULT_CONFIG: TextSegmentationConfig = {
  sentenceTokenizer: {
    language: 'zh',
    handleAbbreviations: true,
    customAbbreviations: ['Dr.', 'Mr.', 'Ms.', '等', 'etc.', 'i.e.', 'e.g.'],
    maxSentenceLength: 200,
  },
  scene: {
    targetSeconds: 6.0,
    baseWordsPerSecond: 3.3,
    speechRate: 1.0,
    minWordsPerSegment: 10,
    maxWordsPerSegment: 50,
    enforceSentenceBoundary: true,
    allowSingleSentenceOverflow: true,
  },
  subtitle: {
    minCharsPerBlock: subtitleRules.defaults.min_chars_per_block,
    maxCharsPerBlock: subtitleRules.defaults.max_chars_per_block,
    punctuationPriority: [
      '。', '！', '？', '；',
      '.', '!', '?', ';',
      '，', ',',
      '、',
      ' ', '\n',
    ],
    timeCalculationMethod: 'proportional',
  },
};

/** 合并用户提供的部分配置与默认配置 */
function mergeConfig(partial?: Partial<TextSegmentationConfig>): TextSegmentationConfig {
  if (!partial) return DEFAULT_CONFIG;
  return {
    sentenceTokenizer: { ...DEFAULT_CONFIG.sentenceTokenizer, ...partial.sentenceTokenizer },
    scene: { ...DEFAULT_CONFIG.scene, ...partial.scene },
    subtitle: { ...DEFAULT_CONFIG.subtitle, ...partial.subtitle },
  };
}

// ==================== 数据类型 ====================

/** 字幕块数据结构 */
export interface SubtitleBlock {
  text: string;
  displayOrder: number;
  startTime: number;
  duration: number;
  parentSegmentId: number;
}

/** 语音段落数据结构 */
export interface SpeechSegment {
  text: string;
  estimatedDuration: number;
  segmentId: number;
  targetWords: number;
  subtitles: SubtitleBlock[];
}

/** 完整处理结果 */
export interface SegmentationResult {
  speechSegments: SpeechSegment[];
  totalDuration: number;
  totalWords: number;
  segmentCount: number;
  config: TextSegmentationConfig;
}

// ==================== 句子边界消歧器 ====================

export class SentenceTokenizer {
  private config: SentenceTokenizerConfig;
  private sentenceDelimiters: RegExp;

  constructor(config?: Partial<SentenceTokenizerConfig>) {
    this.config = { ...DEFAULT_CONFIG.sentenceTokenizer, ...config };
    this.sentenceDelimiters = /([。！？])/;
  }

  /** 将文本分割为句子列表 */
  split(text: string): string[] {
    if (!text || !text.trim()) return [];

    // 1. 预处理：合并空白字符
    let processed = text.replace(/\s+/g, ' ').trim();

    // 2. 处理缩写：将缩写替换为占位符，避免误分句
    const placeholder = '##ABBR##';
    const abbreviationsFound: Record<string, string> = {};

    if (this.config.handleAbbreviations) {
      for (let i = 0; i < this.config.customAbbreviations.length; i++) {
        const abbr = this.config.customAbbreviations[i];
        if (processed.includes(abbr)) {
          const placeholderKey = `${placeholder}${i}`;
          abbreviationsFound[placeholderKey] = abbr;
          processed = processed.split(abbr).join(placeholderKey);
        }
      }
    }

    // 3. 按句子分隔符分割
    const parts = processed.split(this.sentenceDelimiters);
    const sentences: string[] = [];
    let currentSentence = '';

    for (let i = 0; i < parts.length - 1; i += 2) {
      currentSentence += parts[i];
      if (i + 1 < parts.length) {
        const delimiter = parts[i + 1];
        currentSentence += delimiter;

        // 恢复缩写
        for (const [key, abbr] of Object.entries(abbreviationsFound)) {
          currentSentence = currentSentence.split(key).join(abbr);
        }

        sentences.push(currentSentence.trim());
        currentSentence = '';
      }
    }

    // 处理最后一部分（可能没有句末标点）
    if (currentSentence || (parts.length % 2 === 1 && parts[parts.length - 1])) {
      const lastPart = currentSentence + (parts.length % 2 === 1 ? parts[parts.length - 1] : '');
      if (lastPart.trim()) {
        let restored = lastPart;
        for (const [key, abbr] of Object.entries(abbreviationsFound)) {
          restored = restored.split(key).join(abbr);
        }
        sentences.push(restored.trim());
      }
    }

    // 4. 过滤空句子
    const filtered = sentences.filter((s) => s.length > 0);

    // 5. 若整段无有效句末标点且长度超过 maxSentenceLength，按字数强制分段
    if (filtered.length === 1 && filtered[0].length > this.config.maxSentenceLength) {
      const chunks: string[] = [];
      const chars = filtered[0].split('');
      let chunk = '';
      for (const ch of chars) {
        chunk += ch;
        if (chunk.length >= this.config.maxSentenceLength) {
          chunks.push(chunk.trim());
          chunk = '';
        }
      }
      if (chunk.trim()) {
        // 末尾短段合并到前一段
        if (chunks.length && chunk.length < this.config.maxSentenceLength * 0.3) {
          chunks[chunks.length - 1] += chunk.trim();
        } else {
          chunks.push(chunk.trim());
        }
      }
      return chunks.length > 0 ? chunks : filtered;
    }

    // 6. 处理过长的句子
    const result: string[] = [];
    for (const sentence of filtered) {
      if (sentence.length <= this.config.maxSentenceLength) {
        result.push(sentence);
      } else {
        result.push(...this.splitLongSentence(sentence));
      }
    }

    return result;
  }

  /** 分割过长的句子（在逗号/分号处分割） */
  private splitLongSentence(sentence: string): string[] {
    const parts = sentence.split(/[，,;；]/);
    const result: string[] = [];
    let currentPart = '';

    for (const part of parts) {
      if (!part) continue;
      if (!currentPart) {
        currentPart = part;
      } else if (currentPart.length + part.length + 1 <= this.config.maxSentenceLength) {
        currentPart += '，' + part;
      } else {
        result.push(currentPart);
        currentPart = part;
      }
    }

    if (currentPart) {
      result.push(currentPart);
    }

    return result;
  }
}

// ==================== 场景级分割器 ====================

export class SceneSegmenter {
  private config: SceneSegmentationConfig;
  private sentenceTokenizer: SentenceTokenizer;

  constructor(
    config?: Partial<SceneSegmentationConfig>,
    sentenceTokenizer?: SentenceTokenizer,
  ) {
    this.config = { ...DEFAULT_CONFIG.scene, ...config };
    this.sentenceTokenizer = sentenceTokenizer || new SentenceTokenizer();
  }

  /** 计算目标字数（分镜字数主控优先，缺省回退 时长×字速×语速 换算） */
  calculateTargetWords(): number {
    const derived = Math.round(
      this.config.targetSeconds * this.config.baseWordsPerSecond * this.config.speechRate,
    );
    const targetWords = this.config.targetCharsPerScene && this.config.targetCharsPerScene > 0
      ? Math.floor(this.config.targetCharsPerScene)
      : derived;
    return Math.max(
      this.config.minWordsPerSegment,
      Math.min(targetWords, this.config.maxWordsPerSegment),
    );
  }

  /** 将文本分割为语音段落 */
  segment(text: string): SpeechSegment[] {
    // 1. 首先分割为句子
    const sentences = this.sentenceTokenizer.split(text);
    if (!sentences.length) return [];

    // 2. 计算目标字数
    const targetWords = this.calculateTargetWords();

    // 3. 合并句子为段落
    const segments: SpeechSegment[] = [];
    let currentSegment: string[] = [];
    let currentWordCount = 0;
    let segmentId = 0;

    for (const sentence of sentences) {
      const sentenceWordCount = sentence.length;

      const canAppend =
        !currentSegment.length ||
        currentWordCount + sentenceWordCount <= targetWords ||
        (this.config.allowSingleSentenceOverflow && currentSegment.length === 0);

      if (canAppend) {
        currentSegment.push(sentence);
        currentWordCount += sentenceWordCount;
      } else {
        // 创建段落
        if (currentSegment.length) {
          const segmentText = currentSegment.join('');
          segments.push(this.createSpeechSegment(segmentText, segmentId, currentWordCount));
          segmentId++;
        }
        // 开始新段落
        currentSegment = [sentence];
        currentWordCount = sentenceWordCount;
      }
    }

    // 添加最后一个段落
    if (currentSegment.length) {
      const segmentText = currentSegment.join('');
      segments.push(this.createSpeechSegment(segmentText, segmentId, currentWordCount));
    }

    return segments;
  }

  private createSpeechSegment(text: string, segmentId: number, wordCount: number): SpeechSegment {
    const estimatedDuration =
      wordCount / (this.config.baseWordsPerSecond * this.config.speechRate);

    return {
      text,
      estimatedDuration: Math.round(estimatedDuration * 100) / 100,
      segmentId,
      targetWords: wordCount,
      subtitles: [],
    };
  }
}

// ==================== 字幕级分割器 ====================

export class SubtitleSegmenter {
  private config: SubtitleSegmentationConfig;
  private sentenceTokenizer: SentenceTokenizer;

  // 规范常量（规则单源：subtitle-rules.json，与 Python 共享同一份规则；禁止再手写硬编码字符集）
  private static SENTENCE_BOUNDARY = new Set(subtitleRules.sentence_boundary);
  private static PRIORITY_PUNCT = new Set(subtitleRules.priority_punct);
  // v1.1 顿号枚举单元保护：枚举结束判定用（顿号之上）更高优先级标点
  private static ENUM_HIGHER_PUNCT = new Set(subtitleRules.enum.higher_punct);
  // 枚举结束判定的谓词/主语引导词（常见分句起始字，启发式）
  private static ENUM_PREDICATE_STARTERS = new Set(subtitleRules.enum.predicate_starters);
  private static ENUM_CONNECTORS = new Set(subtitleRules.enum.connectors);
  private static LEADING_PUNCT = new Set(subtitleRules.leading_punct);
  private static TRAILING_PUNCT = new Set(subtitleRules.trailing_punct);
  private static QUOTE_PAIRS = subtitleRules.quote_pairs as [string, string][];
  private static LEFT_QUOTES = new Set(subtitleRules.quote_pairs.map((q) => q[0]));
  private static RIGHT_QUOTES = new Set(subtitleRules.quote_pairs.map((q) => q[1]));
  private static QUOTE_MAP = new Map<string, string>(subtitleRules.quote_pairs as [string, string][]);
  private static isSymmetricQuote(ch: string): boolean {
    return SubtitleSegmenter.LEFT_QUOTES.has(ch)
      && SubtitleSegmenter.RIGHT_QUOTES.has(ch)
      && SubtitleSegmenter.QUOTE_MAP.get(ch) === ch;
  }

  private static SYMMETRIC_QUOTE_INTRODUCERS = ['感慨', '写道', '说道', '说', '表示', '称', '指出', '告诉', '问', '回答', '引用', '诗句', '如下', '是'];

  private static isLikelySymmetricOpening(text: string, index: number): boolean {
    if (index <= 0) return true;
    const previous = text[index - 1];
    if ('：:，,；;（([{【「『\n '.includes(previous)) return true;
    const prefix = text.slice(Math.max(0, index - 6), index);
    return SubtitleSegmenter.SYMMETRIC_QUOTE_INTRODUCERS.some((word) => prefix.endsWith(word));
  }

  private static isLikelySymmetricClosing(text: string, index: number): boolean {
    if (index >= text.length - 1) return true;
    if (SubtitleSegmenter.isLikelySymmetricOpening(text, index)) return false;
    const next = text[index + 1];
    return '。！？；.!?;，,、:：）)]】」』\n '.includes(next);
  }

  private static hasUsableQuoteClose(text: string, start: number, quote: string): boolean {
    for (let i = start; i < text.length; i++) {
      if (text[i] === quote) {
        if (!SubtitleSegmenter.isSymmetricQuote(quote) || SubtitleSegmenter.isLikelySymmetricClosing(text, i)) return true;
        return false;
      }
      if (SubtitleSegmenter.SENTENCE_BOUNDARY.has(text[i])) return false;
    }
    return false;
  }

  /** 删除未配对引号，但保留引号后的正文；用于句界扫描前的输入归一化。 */
  private static stripUnpairedQuotes(text: string): string {
    const drop = new Array(text.length).fill(false);
    const stack: { q: string; index: number }[] = [];
    const symmetricOpeners = new Set<string>();
    for (const pair of SubtitleSegmenter.QUOTE_PAIRS) {
      if (pair[0] === pair[1]) symmetricOpeners.add(pair[0]);
    }
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (symmetricOpeners.has(ch)) {
        const top = stack[stack.length - 1];
        if (top?.q === ch && !SubtitleSegmenter.isLikelySymmetricOpening(text, i)) stack.pop();
        else if (top?.q === ch) {
          drop[top.index] = true;
          stack.pop();
          stack.push({ q: ch, index: i });
        }
        else stack.push({ q: ch, index: i });
      } else if (SubtitleSegmenter.LEFT_QUOTES.has(ch)) {
        stack.push({ q: ch, index: i });
      } else if (SubtitleSegmenter.RIGHT_QUOTES.has(ch)) {
        if (stack.length && SubtitleSegmenter.QUOTE_MAP.get(stack[stack.length - 1].q) === ch) stack.pop();
        else drop[i] = true;
      }
      if (SubtitleSegmenter.SENTENCE_BOUNDARY.has(ch)) {
        while (stack.length) {
          const top = stack[stack.length - 1];
          const close = SubtitleSegmenter.QUOTE_MAP.get(top.q);
          if (close && SubtitleSegmenter.hasUsableQuoteClose(text, i + 1, close)) break;
          drop[top.index] = true;
          stack.pop();
        }
      }
    }
    for (const entry of stack) drop[entry.index] = true;
    return [...text].filter((_, i) => !drop[i]).join('');
  }
  // Step 3/6 词边界感知切分（v1.2）：无标点硬切/平衡切分时优先在不劈词的位置切分。
  private static WORD_GOOD_LEAD = new Set(subtitleRules.word_split.good_lead);
  private static WORD_SEMANTIC_LEAD = new Set(subtitleRules.word_split.semantic_lead ?? '');
  private static WORD_SEMANTIC_LEAD_FOLLOWERS: Record<string, string> = subtitleRules.word_split.semantic_lead_followers ?? {};
  private static WORD_GOOD_TAIL = new Set(subtitleRules.word_split.good_tail);
  private static WORD_BAD_FOLLOWERS = new Set(subtitleRules.word_split.bad_followers);
  // v1.2.2：good_tail 路径的块首排除集（仅纯黏着后缀，如 "个|性" 的 性）。
  private static WORD_GOOD_TAIL_BLOCKERS = new Set(subtitleRules.word_split.good_tail_blockers ?? '');
  private static CUT_AFTER_LE_ALLOW = new Set(subtitleRules.word_split.cut_after_le_allow ?? '');
  private static WORD_ORACLE_MAX_TOKEN_LENGTH = subtitleRules.word_split.oracle_max_token_length ?? 8;
  // v1.2.3：成词保护（兼容字段名 no_cut_bigrams）——项目可以是任意长度短语，
  // 切点不得落在任一短语内部（如 "蒙古"、"江南"、"包税人"）。
  private static WORD_NO_CUT_PHRASES = new Set(subtitleRules.word_split.no_cut_bigrams ?? []);

  constructor(
    config?: Partial<SubtitleSegmentationConfig>,
    sentenceTokenizer?: SentenceTokenizer,
  ) {
    this.config = { ...DEFAULT_CONFIG.subtitle, ...config };
    this.sentenceTokenizer = sentenceTokenizer || new SentenceTokenizer();
  }

  /** 将文本分割为字幕块（规范 7 步流水线） */
  segment(text: string, parentDuration: number, parentId: number): SubtitleBlock[] {
    const trimmed = (text || '').trim();
    if (!trimmed) return [];
    const blocks = this.splitToBlocks(trimmed);
    return this.calculateTimestamps(blocks, parentDuration, parentId);
  }

  /** Step 1-6：分句 → 引号 → 长度 → 合并 → 标点 → 强制（强制后再清理一次） */
  private splitToBlocks(text: string): string[] {
    const all: string[] = [];
    const sanitizedText = SubtitleSegmenter.stripUnpairedQuotes(text);
    for (const sentence of this.splitSentences(sanitizedText)) {
      for (const fragment of this.splitQuoteBoundaries(sentence)) {
        let blocks = this.lengthSplit(fragment);
        blocks = this.mergeShort(blocks);
        blocks = this.clean(blocks);
        blocks = this.enforceMax(blocks);
        blocks = this.clean(blocks);
        all.push(...blocks);
      }
    }
    // 规范 3：过滤空块与纯标点块（含孤立引号）
    return all.filter((b) => {
      const s = b.trim();
      if (!s) return false;
      return ![...s].every((c) => this.isTrailingPunctOrQuote(c));
    });
  }

  private isTrailingPunctOrQuote(c: string): boolean {
    return SubtitleSegmenter.TRAILING_PUNCT.has(c)
      || SubtitleSegmenter.LEFT_QUOTES.has(c)
      || SubtitleSegmenter.RIGHT_QUOTES.has(c);
  }

  /** 小数点只在完整的数字 token（整数部分和小数部分都非空）内豁免。 */
  private static isDecimalPointAt(text: string, index: number): boolean {
    if (index < 0 || index >= text.length || text[index] !== '.') return false;
    let start = index;
    while (start > 0 && (isDigitChar(text[start - 1]) || text[start - 1] === '.')) start -= 1;
    let end = index + 1;
    while (end < text.length && (isDigitChar(text[end]) || text[end] === '.')) end += 1;
    return isDecimalToken(text, start, end);
  }

  /** Step 1：分句（句界归属前块；未闭合引号内的句界不生效） */
  private splitSentences(text: string): string[] {
    const out: string[] = [];
    let cur = '';
    const stack: string[] = [];
    let sourceOffset = 0;
    for (const ch of text) {
      const sourceIndex = sourceOffset;
      sourceOffset += ch.length;
      cur += ch;
      if (SubtitleSegmenter.isSymmetricQuote(ch)
        && stack.length && stack[stack.length - 1] === ch) {
        stack.pop();
      } else if (SubtitleSegmenter.LEFT_QUOTES.has(ch)) {
        stack.push(ch);
      } else if (SubtitleSegmenter.RIGHT_QUOTES.has(ch) && stack.length
        && SubtitleSegmenter.QUOTE_MAP.get(stack[stack.length - 1]) === ch) {
        stack.pop();
      }
      if (SubtitleSegmenter.SENTENCE_BOUNDARY.has(ch) && stack.length === 0
        && !(ch === '.' && SubtitleSegmenter.isDecimalPointAt(text, sourceIndex))) {
        out.push(cur);
        cur = '';
      }
    }
    if (cur.trim()) out.push(cur);
    return out.filter((s) => s.trim().length > 0);
  }

  /** Step 2：闭引号后切分（引号内容 >= minChars 才切）；短引号并入上下文 */
  private splitQuoteBoundaries(text: string): string[] {
    const fragments: string[] = [];
    let cur = '';
    const stack: { q: string; start: number }[] = [];
    for (const ch of text) {
      if (SubtitleSegmenter.isSymmetricQuote(ch)
        && stack.length && stack[stack.length - 1].q === ch) {
        const top = stack.pop()!;
        const contentLen = cur.length - top.start - 1;
        cur += ch;
        if (stack.length === 0 && contentLen >= this.config.minCharsPerBlock) {
          fragments.push(cur);
          cur = '';
        }
      } else if (SubtitleSegmenter.LEFT_QUOTES.has(ch)) {
        stack.push({ q: ch, start: cur.length });
        cur += ch;
      } else if (SubtitleSegmenter.RIGHT_QUOTES.has(ch) && stack.length
        && SubtitleSegmenter.QUOTE_MAP.get(stack[stack.length - 1].q) === ch) {
        const top = stack.pop()!;
        const contentLen = cur.length - top.start - 1;
        cur += ch;
        if (stack.length === 0 && contentLen >= this.config.minCharsPerBlock) {
          fragments.push(cur);
          cur = '';
        }
      } else {
        cur += ch;
      }
    }
    if (cur.trim()) fragments.push(cur);
    return fragments.filter((f) => f.trim().length > 0);
  }

  /** Step 3：长度切分（标点优先 + 配对引号保护，min/max） */
  private lengthSplit(text: string): string[] {
    const blocks: string[] = [];
    let cur = '';
    const stack: string[] = [];
    let lastHardCut = false; // 最近一次切分是否为无标点硬切
    let sourceOffset = 0;
    for (const ch of text) {
      const sourceIndex = sourceOffset;
      sourceOffset += ch.length;
      cur += ch;
      if (SubtitleSegmenter.isSymmetricQuote(ch)
        && stack.length && stack[stack.length - 1] === ch) {
        stack.pop();
      } else if (SubtitleSegmenter.LEFT_QUOTES.has(ch)) {
        stack.push(ch);
      } else if (SubtitleSegmenter.RIGHT_QUOTES.has(ch) && stack.length
        && SubtitleSegmenter.QUOTE_MAP.get(stack[stack.length - 1]) === ch) {
        stack.pop();
      }
      const isPunct = SubtitleSegmenter.PRIORITY_PUNCT.has(ch) || ch === ' ' || ch === '\n' || ch === '\u3000';
      const phraseAtStart = this.protectedPhraseStartingAt(cur);
      if (stack.length === 0 && phraseAtStart === cur && cur.length > this.config.maxCharsPerBlock) {
        // 显式短语是原子单元，允许它单独超过 max；后续字符从新块开始累积。
        blocks.push(cur);
        cur = '';
        lastHardCut = false;
        continue;
      }
      // v1.2.3：数字中的小数点（如 713.3）不是切分标点
      if (isPunct && cur.length >= this.config.minCharsPerBlock
        && !(ch === '.' && SubtitleSegmenter.isDecimalPointAt(text, sourceIndex))) {
        // v1.4 unit_guard：标点切点同样不得落在 数字│单位 或 引导字│数字 之间
        //（实测：'风速每秒 8 米' 的空格切点把 8│米 劈开）。拒绝时退回下个分支（短语边界/MAX 兜底重找）。
        if (isUnitInterior(text, sourceIndex + 1)) {
          // 不在此切；落入后续短语边界/MAX 分支处理
        } else {
          blocks.push(cur);
          cur = '';
          lastHardCut = false;
        }
      } else if (stack.length === 0 && isPhraseBoundary(text, sourceIndex + 1)
        && cur.length >= Math.max(1, this.config.minCharsPerBlock - PHRASE_BOUNDARY_MIN_HEAD_RELAX)) {
        // v1.3 短语边界与优先级标点等价：累积阶段即兑现切分，不等 MAX 分支的裸切兜底。
        blocks.push(cur);
        cur = '';
        lastHardCut = false;
      } else if (cur.length === this.config.maxCharsPerBlock
        && stack.length === 0 && cur.endsWith('了')) {
        // 满块刚好停在“了”时，先兑现已经可见的强语义边界（如“提前”），
        // 否则等待后续字，避免在尚未看到宾语时提前切分。
        const deferredPos = this.wordSafeSplit(
          cur,
          1,
          cur.length - 1,
          this.config.minCharsPerBlock,
          this.config.minCharsPerBlock,
        );
        if (deferredPos > 0
          && (this.isSemanticLeadAt(cur, deferredPos)
            || SubtitleSegmenter.WORD_GOOD_LEAD.has(cur[deferredPos]))) {
          blocks.push(cur.slice(0, deferredPos));
          cur = cur.slice(deferredPos);
          lastHardCut = false;
        } else {
          continue;
        }
      } else if (cur.length >= this.config.maxCharsPerBlock + 1
        && stack.length === 0
        && cur[this.config.maxCharsPerBlock - 1] === '了') {
        // “了”后的边界要等到后续字足够明确；普通宾语继续留在当前块，
        // 而“了他给……”在看到“给”后才允许从“了”后切开。
        if (SubtitleSegmenter.isLeBoundaryAllowed(cur, this.config.maxCharsPerBlock)) {
          blocks.push(cur.slice(0, this.config.maxCharsPerBlock));
          cur = cur.slice(this.config.maxCharsPerBlock);
          lastHardCut = false;
        } else {
          continue;
        }
      } else if (cur.length >= this.config.maxCharsPerBlock && stack.length === 0) {
        const requestedPos = this.applyEnumerationShift(cur, this.findSplitPos(cur), false);
        const pos = requestedPos > 0
          ? this.findSafeCutPosition(cur, requestedPos, 1, Math.min(this.config.maxCharsPerBlock, cur.length - 1))
          : -1;
        if (pos > 0) {
          blocks.push(cur.slice(0, pos));
          cur = cur.slice(pos);
          lastHardCut = false;
        } else {
          // v1.2 词边界感知：无标点硬切时优先不劈词（区间内找好切点/非黏着切点）
          const ws = this.wordSafeSplit(
            cur,
            Math.max(1, cur.length - this.config.maxCharsPerBlock - 1),
            cur.length - 1,
            this.config.minCharsPerBlock,
            this.config.minCharsPerBlock,
          );
          const hardPos = this.findSafeCutPosition(
            cur,
            ws > 0 ? ws : Math.min(this.config.maxCharsPerBlock, cur.length - 1),
            1,
            Math.min(this.config.maxCharsPerBlock, cur.length - 1),
          );
          const forcedPos = hardPos > 0 ? hardPos : -1;
          if (forcedPos <= 0) continue;
          blocks.push(cur.slice(0, forcedPos));
          cur = cur.slice(forcedPos);
          lastHardCut = true;
        }
      } else if (cur.length >= this.config.maxCharsPerBlock * 2 && stack.length > 0) {
        blocks.push(cur);
        cur = '';
        stack.length = 0;
        lastHardCut = true;
      }
    }
    if (cur) {
      // 平衡约束（与 Python 实现一致）：硬切后的尾块清理后为 4..min-1 字（非合法 ≤3 短尾）时，
      // 从上一块让字给尾块（区间内优先标点），避免孤悬尾块（如 15+4 → 11+8）
      const tailClean = cur.trim().replace(/[。！？；，、.!?;…]+$/, '');
      const startsSemanticLead = this.isSemanticLeadAt(cur.trim(), 0);
      if (lastHardCut && !startsSemanticLead && blocks.length > 0 && tailClean.length > 3
        && tailClean.length < this.config.minCharsPerBlock
        && blocks[blocks.length - 1].length >= this.config.minCharsPerBlock) {
        const prev = blocks[blocks.length - 1];
        const need = this.config.minCharsPerBlock - tailClean.length;
        const lo = Math.max(1, prev.length - need);
        const hi = prev.length - 1;
        let pos = this.findSplitPosInRange(prev, lo, hi);
        pos = pos > 0
          ? this.findSafeCutPosition(prev, pos, 1, Math.min(lo, prev.length - 1))
          : -1;
        if (pos <= 0) {
          // v1.2.2 词边界感知让字：区间内无标点时，向 lo 左侧找不劈词的好切点
          // （避免把 "…从文化认|同滑向…" 的 "同" 硬让出劈开 "文化认同"）。
          const ws = this.wordSafeSplit(prev, 1, lo, 1);
          pos = ws > 0
            ? this.findSafeCutPosition(prev, ws, 1, Math.min(lo, prev.length - 1))
            : -1;
        }
        if (pos > 0) {
          blocks[blocks.length - 1] = prev.slice(0, pos);
          cur = prev.slice(pos) + cur;
        }
      }
      blocks.push(cur);
    }
    return blocks.filter((b) => b.trim().length > 0);
  }

  /** 从后往前找切分锚点（切后索引；无则 -1）。v1.1 顿号优先级最低：更高优先级标点 → 空格 → 顿号兜底 */
  private findSplitPos(text: string): number {
    for (let i = text.length - 1; i >= 0; i--) {
      if (SubtitleSegmenter.PRIORITY_PUNCT.has(text[i]) && text[i] !== '、') {
        if (text[i] === '.' && SubtitleSegmenter.isDecimalPointAt(text, i)) {
          continue; // v1.2.3：数字中的小数点不是切分锚点
        }
        return i + 1;
      }
    }
    for (let i = text.length - 1; i >= 0; i--) {
      if (text[i] === ' ' || text[i] === '\n' || text[i] === '\u3000') return i + 1;
    }
    for (let i = text.length - 1; i >= 0; i--) {
      if (text[i] === '、') return i + 1;
    }
    return -1;
  }

  /** 顿号枚举单元结束位置（v1.1）：结束于更高优先级标点/谓词引导词/片段尾 */
  private enumerationEnd(text: string, pos: number): number {
    for (let i = pos; i < text.length; i++) {
      const ch = text[i];
      if (SubtitleSegmenter.ENUM_HIGHER_PUNCT.has(ch) || SubtitleSegmenter.ENUM_PREDICATE_STARTERS.has(ch)) {
        return i;
      }
    }
    return text.length;
  }

  /** 若切分锚点落在顿号上，把切分点前移到枚举单元结束之后（头块 ≤ max 才生效；requireTailMin 用于完整块） */
  private applyEnumerationShift(text: string, pos: number, requireTailMin: boolean): number {
    if (pos <= 0 || pos >= text.length || text[pos - 1] !== '、') return pos;
    const eend = this.enumerationEnd(text, pos);
    // v1.2.1 守卫：枚举单元扫到块尾仍无终止、且内部无更多顿号项时，疑似把谓语吞进
    // 枚举末项（如 "呐喊声混成一锅滚" 被整段吞并 → 15+3 劈词孤尾），不吞并回退锚点。
    if (eend === text.length && !text.slice(pos, eend).includes('、')) return pos;
    if (eend > pos && eend <= this.config.maxCharsPerBlock) {
      if (!requireTailMin || text.length - eend >= this.config.minCharsPerBlock) {
        return eend;
      }
    }
    return pos;
  }

  /** Step 4：短块合并（v1.2 修复机制三 + 防过度并入：clean 后长度判定、并入后 <=max、完整句不并入） */
  private mergeShort(blocks: string[]): string[] {
    if (!blocks.length) return blocks;
    const merged = [blocks[0]];
    for (let i = 1; i < blocks.length; i++) {
      const b = blocks[i];
      const stripped = b.trim();
      const bCleanLen = this.cleanLen(b);
      const prevCleanLen = this.cleanLen(merged[merged.length - 1]);
      const isPunctTail = stripped.length <= 2 && [...stripped].every((c) => this.isTrailingPunctOrQuote(c));
      const isShortTail = bCleanLen <= 3 && prevCleanLen >= this.config.minCharsPerBlock;
      const isSentenceEnd = stripped.length > 0
        && SubtitleSegmenter.SENTENCE_BOUNDARY.has(stripped[stripped.length - 1])
        && bCleanLen > 3;
      const startsSemanticLead = this.isSemanticLeadAt(stripped, 0);
      const mergedLen = prevCleanLen + bCleanLen;
      if (isSentenceEnd) {
        merged.push(b);
      } else if (!startsSemanticLead && (prevCleanLen < this.config.minCharsPerBlock || isPunctTail || isShortTail
        || bCleanLen < this.config.minCharsPerBlock) && mergedLen <= this.config.maxCharsPerBlock) {
        merged[merged.length - 1] = merged[merged.length - 1] + b;
      } else {
        merged.push(b);
      }
    }
    return merged.filter((b) => b.trim().length > 0);
  }

  /** Step 5：标点规范化（trim → 开头修正 → 跨块引号清理 → 末尾去除 → 再去除） */
  private clean(blocks: string[]): string[] {
    let bs = blocks.map((b) => b.trim()).filter(Boolean);
    if (!bs.length) return [];
    // 子步 1：开头标点修正（首块开头标点删除，后续块开头标点前移）
    const fixed: string[] = [bs[0]];
    if (fixed[0] && SubtitleSegmenter.LEADING_PUNCT.has(fixed[0][0])) {
      fixed[0] = fixed[0].slice(1);
    }
    for (let i = 1; i < bs.length; i++) {
      let b = bs[i];
      if (b && SubtitleSegmenter.LEADING_PUNCT.has(b[0]) && fixed.length) {
        fixed[fixed.length - 1] += b[0];
        b = b.slice(1);
      }
      if (b) fixed.push(b);
    }
    bs = fixed.filter(Boolean);
    // 子步 2：跨块引号清理（先删孤立引号，暴露末尾标点）
    bs = bs.map((b) => this.dropUnpairedQuotes(b)).filter(Boolean);
    // 子步 3：末尾标点去除
    bs = bs.map((b) => b.replace(/[。！？；，、.!?;…]+$/, '')).filter(Boolean);
    // 子步 4：再次开头修正 + 末尾去除 + trim
    const out: string[] = [];
    for (const b of bs) {
      let nb = b;
      if (nb && SubtitleSegmenter.LEADING_PUNCT.has(nb[0]) && out.length) {
        out[out.length - 1] += nb[0];
        nb = nb.slice(1);
      }
      nb = nb.replace(/[。！？；，、.!?;…]+$/, '').trim();
      if (nb) out.push(nb);
    }
    return out;
  }

  /** 删除文本中未配对的引号（块内成对保留） */
  private dropUnpairedQuotes(text: string): string {
    const drop = new Array(text.length).fill(false);
    const stack: number[] = [];
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (SubtitleSegmenter.isSymmetricQuote(ch)
        && stack.length && text[stack[stack.length - 1]] === ch) {
        stack.pop();
      } else if (SubtitleSegmenter.LEFT_QUOTES.has(ch)) {
        stack.push(i);
      } else if (SubtitleSegmenter.RIGHT_QUOTES.has(ch)) {
        if (stack.length && SubtitleSegmenter.QUOTE_MAP.get(text[stack[stack.length - 1]]) === ch) {
          stack.pop();
        } else {
          drop[i] = true;
        }
      }
    }
    for (const idx of stack) drop[idx] = true;
    return [...text].filter((_, i) => !drop[i]).join('');
  }

  /** Step 6：超长强制分割（平衡切分：尾块 < minChars 时前块让字，避免孤悬尾块；v1.2 词边界感知 + 越界修复） */
  private enforceMax(blocks: string[]): string[] {
    const out: string[] = [];
    for (let b of blocks) {
      while (b.length > this.config.maxCharsPerBlock) {
        const phraseAtStart = this.protectedPhraseStartingAt(b);
        if (phraseAtStart && phraseAtStart.length > this.config.maxCharsPerBlock) {
          // 显式保护短语是原子单元，允许它单独超过 max；后续文本继续处理。
          out.push(phraseAtStart);
          b = b.slice(phraseAtStart.length);
          continue;
        }
        const requestedPos = this.applyEnumerationShift(b, this.findSplitPos(b), true);
        let pos = requestedPos > 0
          ? this.findSafeCutPosition(b, requestedPos, 1, Math.min(this.config.maxCharsPerBlock, b.length - 1))
          : -1;
        const isWholeProtectedPhrase = this.isWholeProtectedPhrase(b);
        if (isWholeProtectedPhrase) {
          // 保护短语本身可能比 maxChars 更长；完整短语优先于违反长度上限。
          out.push(b);
          b = '';
          break;
        }
        if (pos <= 0 || pos >= b.length) {
          const fixedPos = Math.min(this.config.maxCharsPerBlock, b.length - 1);
          pos = this.findSafeCutPosition(b, fixedPos, 1, fixedPos);
          if (pos <= 0 || pos >= b.length) {
            // 当前长度区间没有合法边界时，扩大搜索；仍无边界则整体保留。
            pos = this.findSafeCutPosition(b, fixedPos, 1, b.length - 1);
            if (pos <= 0 || pos >= b.length) {
              out.push(b);
              b = '';
              break;
            }
          }
        }
        // 平衡约束：尾块 < minChars 时切分点前移至 len - minChars（区间内优先找标点/词边界）
        if (b.length - pos < this.config.minCharsPerBlock) {
          const minPos = Math.max(1, b.length - this.config.minCharsPerBlock);
          const hi = Math.min(b.length - 1, this.config.maxCharsPerBlock);
          const boundedMinPos = Math.min(minPos, hi);
          const ws = this.wordSafeSplit(b, minPos, hi, minPos, this.config.minCharsPerBlock);
          if (ws > 0 && ws < b.length) {
            pos = this.findSafeCutPosition(b, ws, boundedMinPos, hi);
          } else {
            // 越界修复：balanced == len(b)（尾字符恰为标点时 i+1 越界）视为无效
            const balanced = this.findSplitPosInRange(b, minPos, hi);
            pos = balanced > 0 && balanced < b.length
              ? this.findSafeCutPosition(b, balanced, boundedMinPos, hi)
              : -1;
            if (pos <= 0 || pos >= b.length) {
              pos = this.findSafeCutPosition(b, boundedMinPos, boundedMinPos, hi);
            }
          }
        }
        if (pos <= 0 || pos >= b.length) {
          // 不能为了满足 max 而绕过显式短语、了后宾语或小数边界守卫。
          out.push(b);
          b = '';
          break;
        }
        out.push(b.slice(0, pos));
        b = b.slice(pos);
      }
      if (b) out.push(b);
    }
    return out;
  }

  /** 在 [lo, hi] 范围内从后往前找最近优先级标点/空格（返回切后索引；无则 -1） */
  private findSplitPosInRange(text: string, lo: number, hi: number): number {
    for (let i = hi; i >= lo; i--) {
      if (SubtitleSegmenter.PRIORITY_PUNCT.has(text[i])) {
        if (text[i] === '.' && SubtitleSegmenter.isDecimalPointAt(text, i)) {
          continue; // v1.2.3：数字中的小数点不是切分锚点
        }
        return i + 1;
      }
    }
    for (let i = hi; i >= lo; i--) {
      if (text[i] === ' ' || text[i] === '\n' || text[i] === '\u3000') return i + 1;
    }
    return -1;
  }

  /** 剥离尾部标点后的长度（Step 4 短块判定用，v1.2）。 */
  private cleanLen(text: string): number {
    let s = text.trim();
    while (s.length > 0 && SubtitleSegmenter.TRAILING_PUNCT.has(s[s.length - 1])) {
      s = s.slice(0, -1);
    }
    return s.length;
  }

  /** 返回切点所在的受保护短语跨度；切点恰在短语两端时安全。 */
  private protectedPhraseSpanAtBoundary(text: string, i: number): { phrase: string; start: number; end: number } | null {
    if (i <= 0 || i >= text.length) return null;
    for (const phrase of SubtitleSegmenter.WORD_NO_CUT_PHRASES) {
      if (!phrase || phrase.length < 2) continue;
      let start = text.indexOf(phrase);
      while (start >= 0) {
        const end = start + phrase.length;
        if (start < i && i < end) return { phrase, start, end };
        if (start >= i) break;
        start = text.indexOf(phrase, start + 1);
      }
    }
    return null;
  }

  /** 返回文本开头匹配到的最长显式保护短语；普通分词 token 仅作软提示。 */
  private protectedPhraseStartingAt(text: string): string | null {
    let best: string | null = null;
    for (const phrase of SubtitleSegmenter.WORD_NO_CUT_PHRASES) {
      if (phrase && text.startsWith(phrase) && (!best || phrase.length > best.length)) best = phrase;
    }
    return best;
  }

  private isWholeProtectedPhrase(text: string): boolean {
    const phrase = this.protectedPhraseStartingAt(text);
    return phrase !== null && phrase.length === text.length;
  }

  /** 返回文本末尾尚未完整出现的受保护短语前缀，避免流式累积在前缀中间切断。 */
  private protectedPhrasePrefixAtEnd(text: string): { phrase: string; start: number; length: number } | null {
    let best: { phrase: string; start: number; length: number } | null = null;
    let completeLength = 0;
    for (const phrase of SubtitleSegmenter.WORD_NO_CUT_PHRASES) {
      if (!phrase || phrase.length < 2) continue;
      if (text.endsWith(phrase) && phrase.length > completeLength) completeLength = phrase.length;
      for (let prefixLength = 1; prefixLength < phrase.length; prefixLength++) {
        if (text.endsWith(phrase.slice(0, prefixLength))
          && (!best || prefixLength > best.length)) {
          best = { phrase, start: text.length - prefixLength, length: prefixLength };
        }
      }
    }
    if (best && completeLength >= best.length) return null;
    return best;
  }

  /** 将候选切点移到受保护短语外，保证字幕块边界不落在短语内部。 */
  private safeCutPosition(text: string, i: number): number {
    const span = this.protectedPhraseSpanAtBoundary(text, i);
    if (span) return span.start > 0 ? span.start : span.end;
    const prefix = this.protectedPhrasePrefixAtEnd(text);
    if (prefix && i >= prefix.start) return prefix.start > 0 ? prefix.start : 0;
    return i;
  }

  /** 判断候选切点是否可用；所有长度兜底都必须经过此守卫。 */
  private isSafeCutPosition(text: string, i: number): boolean {
    if (i <= 0 || i >= text.length) return false;
    if (!isCodePointBoundary(text, i)) return false;
    if (this.protectedPhraseSpanAtBoundary(text, i)) return false;
    if (!SubtitleSegmenter.isLeBoundaryAllowed(text, i)) return false;
    if (this.isDecimalInterior(text, i)) return false;
    if (isUnitInterior(text, i)) return false;
    return true;
  }

  /** 了后的边界保护：默认保护普通宾语，但保留标点/从句引导和显式语义转折。 */
  private static isLeBoundaryAllowed(text: string, i: number): boolean {
    if (i <= 0 || text[i - 1] !== '了') return true;
    if (SubtitleSegmenter.CUT_AFTER_LE_ALLOW.has(text[i])) return true;
    const nextPair = text.slice(i, i + 2);
    if (/^[他她它其这那][给在还就要将被从对是有能会想把]/u.test(nextPair)) return true;
    const before = text.slice(Math.max(0, i - 4), i);
    return before.endsWith('成了') && !before.endsWith('完成了') && !before.endsWith('做成了');
  }

  private isDecimalInterior(text: string, i: number): boolean {
    if (i <= 0 || i >= text.length) return false;
    const previous = text[i - 1];
    const current = text[i];
    if (!((isDigitChar(previous) && isDigitChar(current))
      || (isDigitChar(previous) && current === '.')
      || (previous === '.' && isDigitChar(current)))) return false;
    let start = i;
    while (start > 0 && (isDigitChar(text[start - 1]) || text[start - 1] === '.')) start -= 1;
    let end = i;
    while (end < text.length && (isDigitChar(text[end]) || text[end] === '.')) end += 1;
    return isDecimalToken(text, start, end);
  }

  /** 在候选点附近寻找合法边界，优先保持候选方向并限制在当前切分区间。 */
  private findSafeCutPosition(text: string, preferred: number, lo = 1, hi = text.length - 1): number {
    const lower = Math.max(1, lo);
    const upper = Math.min(text.length - 1, hi);
    if (lower > upper) return -1;
    const bounded = Math.min(upper, Math.max(lower, preferred));
    const direct = this.safeCutPosition(text, bounded);
    if (direct >= lower && direct <= upper && this.isSafeCutPosition(text, direct)) return direct;
    for (let distance = 1; distance <= upper - lower; distance++) {
      const right = bounded + distance;
      const left = bounded - distance;
      const candidates: number[] = [];
      if (right <= upper) {
        const safeRight = this.safeCutPosition(text, right);
        if (safeRight >= lower && safeRight <= upper && this.isSafeCutPosition(text, safeRight)) candidates.push(safeRight);
      }
      if (left >= lower) {
        const safeLeft = this.safeCutPosition(text, left);
        if (safeLeft >= lower && safeLeft <= upper && this.isSafeCutPosition(text, safeLeft)) candidates.push(safeLeft);
      }
      const soft = candidates.find((candidate) => SubtitleSegmenter.isSoftWordBoundary(text, candidate));
      if (soft !== undefined) return soft;
      if (candidates.length) return candidates[0];
    }
    return -1;
  }

  /** 分词器只作为等距候选的软 tie-break，不改变显式短语和字符规则。 */
  private static isSoftWordBoundary(text: string, i: number): boolean {
    return segmenterSpans(text).some((span) => span.end === i
      && span.end - span.start <= (subtitleRules.word_split.oracle_max_token_length ?? 8));
  }

  /** 词边界好切点：切点后为连词/介词（块首引导），或切点前为助词/副词/句内标点（块尾收束）。 */
  private isGoodCut(text: string, i: number): boolean {
    if (i <= 0 || i >= text.length) return false;
    if (!SubtitleSegmenter.isLeBoundaryAllowed(text, i)) return false;
    // v1.2.3：切点落在任意长度成词短语内部一律不是好切点。
    if (this.protectedPhraseSpanAtBoundary(text, i)) return false;
    if (!this.isSafeCutPosition(text, i)) return false;
    if (this.isSemanticLeadAt(text, i)) return true;
    if (SubtitleSegmenter.WORD_GOOD_LEAD.has(text[i])) return true;
    // v1.3：短语右边界（块尾短语末字 + 块首短语首字同时命中）。
    if (isPhraseBoundary(text, i)) return true;
    // v1.2.2：块尾收束路径额外要求切点后首字符非强黏着后缀（good_tail_blockers），
    // 避免 "…保持个|性独立" 类劈词（"个" 入 good_tail 后 "个性" 被拆）。
    return i > 0
      && SubtitleSegmenter.WORD_GOOD_TAIL.has(text[i - 1])
      && !SubtitleSegmenter.WORD_GOOD_TAIL_BLOCKERS.has(text[i])
      && this.isSafeCutPosition(text, i);
  }

  /**
   * 在 [lo, hi] 内找不劈词的切点索引；-1 表示无（v1.2）。
   * 策略（优先级）：后块引导字切点优先于普通尾部收束切点；同类切点从后往前找（头块尽量长），
   * 要求头块 >= minHead 且排除孤悬 ≤3 字短尾；
   * v1.2.2 软约束：头块欠长但 >= minHead-2 且尾块 >= tailMin 时仍接受；
   * 非黏着后缀切点从前往后找，要求头块 >= minHead；无则 -1，回退算术/标点切分。
   */
  private wordSafeSplit(text: string, lo: number, hi: number, minHead = 1, tailMin = 0): number {
    let fallback = -1;
    let tailFallback = -1;
    for (let i = hi; i >= lo; i--) {
      const tail = text.length - i;
      if (!(i >= minHead || (tailMin > 0 && i >= minHead - 2 && tail >= tailMin))) continue;
      if (!this.isGoodCut(text, i)) continue;
      const isSemanticLead = this.isSemanticLeadAt(text, i);
      // 语义引导允许短一字（如“他们甚至嚣张到｜把…”），但不再放宽到 min-2，
      // 避免在“成了”前形成 6 字头块。
      if (isSemanticLead && i < Math.max(1, minHead - 1)) continue;
      // “成了”是谓语起点，但不接受欠长头块；否则“硬生生让蒙元｜成了…”会只剩 6 字。
      if (text[i] === '成' && i < minHead) continue;
      if (tail > 3 && (tailMin === 0 || tail >= tailMin || tail >= 5 || SubtitleSegmenter.WORD_GOOD_LEAD.has(text[i]) || isSemanticLead)) {
        if (isSemanticLead) return i;
        if (SubtitleSegmenter.WORD_GOOD_LEAD.has(text[i])) return i;
        if (tailFallback < 0) tailFallback = i;
        continue;
      }
      // v1.2.3 孤悬尾防护（仅 tail==4 且块首非连词/介词）："着|脖" 劈 "脖子" → 前移找 tail 达标点
      if (fallback < 0 && tail === 4 && !SubtitleSegmenter.WORD_GOOD_LEAD.has(text[i])
        && (i === 0 || !isDigitChar(text[i - 1]))) {
        fallback = i;
      }
    }
    if (tailFallback >= 0) return tailFallback;
    if (fallback >= 0) return fallback;
    for (let i = Math.max(lo, minHead); i <= hi; i++) {
      if (i < text.length
        && !SubtitleSegmenter.WORD_BAD_FOLLOWERS.has(text[i])
        && (i === 0 || !isDigitChar(text[i - 1]))
        && this.isSafeCutPosition(text, i)
        && !this.protectedPhraseSpanAtBoundary(text, i)) {
        return i;
      }
    }
    return -1;
  }

  /** 语义引导字必须满足自身的词组后续约束（如“提”只在“提前”中生效）。 */
  private isSemanticLeadAt(text: string, i: number): boolean {
    if (i < 0 || i >= text.length || !SubtitleSegmenter.WORD_SEMANTIC_LEAD.has(text[i])) return false;
    const allowedFollowers = SubtitleSegmenter.WORD_SEMANTIC_LEAD_FOLLOWERS[text[i]];
    return allowedFollowers === undefined || [...allowedFollowers].includes(text[i + 1] ?? '');
  }

  /** Step 7：时间戳分配（proportional 按字数比例 / equal 等分） */
  private calculateTimestamps(
    blocks: string[],
    totalDuration: number,
    parentId: number,
  ): SubtitleBlock[] {
    if (!blocks.length) return [];

    const build = (blocks: string[], durs: number[]): SubtitleBlock[] => {
      const out: SubtitleBlock[] = [];
      let t = 0.0;
      for (let i = 0; i < blocks.length; i++) {
        const d = Math.round(durs[i] * 100) / 100;
        out.push({
          text: blocks[i],
          displayOrder: i,
          startTime: t,
          duration: d,
          parentSegmentId: parentId,
        });
        t = Math.round((t + d) * 100) / 100; // 舍入后连续累加，保证区间严格连续
      }
      return out;
    };

    if (this.config.timeCalculationMethod === 'equal') {
      const durs = blocks.map(() => totalDuration / blocks.length);
      return build(blocks, durs);
    }

    // proportional: 按字数比例分配时间
    const totalChars = blocks.reduce((sum, block) => sum + block.length, 0);
    const durs = blocks.map((b) =>
      totalChars > 0 ? (b.length / totalChars) * totalDuration : totalDuration / blocks.length,
    );
    return build(blocks, durs);
  }
}


// ==================== 主模块 ====================

export class TextSegmentationModule {
  private config: TextSegmentationConfig;
  private sentenceTokenizer: SentenceTokenizer;
  private sceneSegmenter: SceneSegmenter;
  private subtitleSegmenter: SubtitleSegmenter;

  constructor(config?: Partial<TextSegmentationConfig>) {
    this.config = mergeConfig(config);
    this.sentenceTokenizer = new SentenceTokenizer(this.config.sentenceTokenizer);
    this.sceneSegmenter = new SceneSegmenter(this.config.scene, this.sentenceTokenizer);
    this.subtitleSegmenter = new SubtitleSegmenter(this.config.subtitle, this.sentenceTokenizer);
  }

  /** 完整处理文本分割流程 */
  process(text: string): SegmentationResult {
    if (!text || !text.trim()) {
      throw new Error('输入文本不能为空');
    }

    // 1. 场景级分割
    const speechSegments = this.sceneSegmenter.segment(text);

    // 2. 为每个语音段落生成字幕
    for (const segment of speechSegments) {
      segment.subtitles = this.subtitleSegmenter.segment(
        segment.text,
        segment.estimatedDuration,
        segment.segmentId,
      );
    }

    // 3. 计算总体统计
    const totalDuration = speechSegments.reduce((sum, s) => sum + s.estimatedDuration, 0);
    const totalWords = speechSegments.reduce((sum, s) => sum + s.text.length, 0);

    return {
      speechSegments,
      totalDuration: Math.round(totalDuration * 100) / 100,
      totalWords,
      segmentCount: speechSegments.length,
      config: this.config,
    };
  }

  /** 获取配置摘要 */
  getConfigSummary(): Record<string, unknown> {
    return {
      sentenceTokenizerConfig: this.config.sentenceTokenizer,
      sceneConfig: {
        ...this.config.scene,
        targetWords: this.sceneSegmenter.calculateTargetWords(),
      },
      subtitleConfig: this.config.subtitle,
    };
  }
}

// ==================== 便捷函数 ====================

/**
 * 将文本按目标数量分割为场景（语音段落）
 * @param text 原始文案
 * @param options targetCount: 目标段数；config: 自定义配置
 * @returns 场景文本数组
 */
export function splitTextToScenes(
  text: string,
  options?: { targetCount?: number; config?: Partial<TextSegmentationConfig> },
): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const module = new TextSegmentationModule(options?.config);
  const result = module.process(trimmed);
  let segments = result.speechSegments.map((s) => s.text);

  // 适配目标数量
  if (options?.targetCount && options.targetCount > 0) {
    segments = adaptSegmentsToCount(segments, options.targetCount);
  }

  return segments;
}

/**
 * 将文本分割为字幕块
 * @param text 原始文案
 * @param options config: 自定义配置
 * @returns 字幕文本数组
 */
export function splitTextToSubtitles(
  text: string,
  options?: { config?: Partial<TextSegmentationConfig> },
): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const config = mergeConfig(options?.config);
  const tokenizer = new SentenceTokenizer(config.sentenceTokenizer);
  const segmenter = new SubtitleSegmenter(config.subtitle, tokenizer);
  const blocks = segmenter.segment(trimmed, 0, 0);
  return blocks.map((b) => b.text);
}

/**
 * 构建与语音时长同步的字幕时间线
 * @param text 原始文案
 * @param totalDuration 语音总时长（秒）
 * @param options config: 自定义配置
 */
export function buildSubtitleTimelineV2(
  text: string,
  totalDuration: number,
  options?: { config?: Partial<TextSegmentationConfig> },
): Array<{ text: string; startTime: number; endTime: number; charTimings: number[] }> {
  const lines = splitTextToSubtitles(text, options);
  if (!lines.length) return [];

  const totalChars = lines.reduce((sum, line) => sum + line.length, 0);
  const subtitles: Array<{ text: string; startTime: number; endTime: number; charTimings: number[] }> = [];
  let currentTime = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const duration =
      totalChars > 0 ? (line.length / totalChars) * totalDuration : totalDuration / lines.length;
    const endTime = i === lines.length - 1 ? totalDuration : currentTime + duration;

    // 逐字时间戳
    const charCount = line.length;
    const charDuration = charCount > 0 ? duration / charCount : duration;
    const charTimings: number[] = [];
    for (let c = 0; c < charCount; c++) {
      charTimings.push(currentTime + (c + 1) * charDuration);
    }

    subtitles.push({
      text: line,
      startTime: currentTime,
      endTime,
      charTimings,
    });
    currentTime = endTime;
  }

  return subtitles;
}

// ==================== 内部工具函数 ====================

/**
 * 将分断结果适配为目标数量
 * - 若分断数 > targetCount：等比合并相邻段
 * - 若分断数 < targetCount：用末尾段填充
 */
function adaptSegmentsToCount(segments: string[], targetCount: number): string[] {
  if (!segments.length) return [];
  if (targetCount <= 0) return segments;

  const merged = [...segments];

  // 合并：将最短相邻对合并直到数量满足
  while (merged.length > targetCount) {
    let minLen = Infinity;
    let minIdx = merged.length - 2;
    for (let i = 0; i < merged.length - 1; i++) {
      const combined = merged[i].length + merged[i + 1].length;
      if (combined < minLen) {
        minLen = combined;
        minIdx = i;
      }
    }
    merged.splice(minIdx, 2, merged[minIdx] + merged[minIdx + 1]);
  }

  // 填充：末尾段重复
  while (merged.length < targetCount) {
    merged.push(merged[merged.length - 1]);
  }

  return merged;
}

// ==================== 版本标识 ====================

export const TEXT_SEGMENTATION_VERSION = 'v1.0';

export function getSegmentationVersion(): string {
  return TEXT_SEGMENTATION_VERSION;
}
