"""PromptEval 分句服务（Python）— 桌面端 text-segmentation.ts 的**简化移植**。

## 覆盖范围（2026-10-19 更正）

本文件此前自称「完整移植」，那是**不准确的**，且这种不准确会误导人以为这里有一层保护。
实测核对后的真实覆盖如下；对外承诺以 `PORTED_SURFACE` / `NOT_PORTED_SURFACE` 两个常量
为准，`tests/test_prompt_eval_segmentation.py` 有一致性锁（声明与源码必须互相印证）。

- 已移植：句子切分、引号/括号配对、优先级标点切分、枚举位移、超长句 200 字强制分段、
  场景级目标字数分配、字幕长度切分的**标点驱动主干**。
- **未移植**：桌面端字幕切分的「词边界子系统」——`good_lead` / `good_tail` /
  `semantic_lead` / `no_cut_bigrams` / `tailMin` 软约束，以及 v1.3 的 `phrase_boundary`。
  也就是说：本服务在**无标点长块**上的切点与桌面端**并不保证一致**（桌面端会找不劈词的
  安全切点，本服务退化为算术/枚举位置）。

## 一致性测试的真实边界

`tests/test_prompt_eval_segmentation.py` 用 esbuild 打包桌面端 TS 做输入→输出对照，
但语料是**硬编码的少量标点丰富句式**——它验证的是「主干对齐」，不是「全量等价」。
新增语料时请优先覆盖已移植面；若把无标点长块加进语料，本服务会红——那是真实的能力缺口，
不是测试写错。

另：`ops-center-ci.yml` 只在 `ops-center/**` 变更时触发，所以**改桌面端 TS 不会跑这条对照**。
这条缺口不在这里修（该 job 已长期卡在 10 分钟超时临界，加触发只会加剧取消率）；
真正的补偿是 `packages/story2video-engine` 侧的 TS↔Python sidecar 金标对账
（见 `packages/story2video-engine/tests/sidecar-golden.test.ts`）。
"""
from __future__ import annotations

# 已移植的上游子系统（与 text-segmentation.ts 逐项对应；新增能力时同步改这两个常量，
# 否则 tests/test_prompt_eval_segmentation.py 的声明一致性锁会红）。
PORTED_SURFACE = (
    "sentence_boundary",
    "quote_pairing",
    "priority_punct_split",
    "enumeration_shift",
    "max_sentence_length_fallback",
    "scene_target_chars",
    "subtitle_length_split_punct_driven",
)

# 明确未移植：桌面端字幕切分的词边界子系统 + v1.3 短语边界。
NOT_PORTED_SURFACE = (
    "word_good_lead",
    "word_good_tail",
    "word_semantic_lead",
    "word_no_cut_bigrams",
    "word_tail_min_soft_constraint",
    "phrase_boundary_v1_3",
)

import re

SENTENCE_BOUNDARY = set("。！？….!?")
PRIORITY_PUNCT = set("。！？；.!?;，,、")
LEADING_PUNCT = set("，、。！？；,!?;.")
TRAILING_PUNCT = set("。！？；，、.!?;…")
QUOTE_PAIRS = [
    ("\u201c", "\u201d"), ("\u2018", "\u2019"), ("\u300c", "\u300d"), ("\u300e", "\u300f"),
    ("\u300a", "\u300b"), ("\uff08", "\uff09"), ("\u3010", "\u3011"), ("[", "]"),
    ('"', '"'), ("'", "'"),
]
LEFT_QUOTES = {q[0] for q in QUOTE_PAIRS}
RIGHT_QUOTES = {q[1] for q in QUOTE_PAIRS}
QUOTE_MAP = dict(QUOTE_PAIRS)

DEFAULT_SCENE = {"targetCharsPerScene": 20, "baseWordsPerSecond": 3.3, "speechRate": 1.0,
                 "minWordsPerSegment": 10, "maxWordsPerSegment": 50, "enforceSentenceBoundary": True,
                 "allowSingleSentenceOverflow": True}
DEFAULT_SUBTITLE = {"minCharsPerBlock": 8, "maxCharsPerBlock": 15, "timeCalculationMethod": "proportional"}

# 对齐 text-segmentation.ts：超长句上限（SentenceTokenizer.maxSentenceLength=200）
MAX_SENTENCE_LENGTH = 200
# v1.1 枚举位移：subtitle-rules.json enum.higher_punct / predicate_starters
ENUM_HIGHER_PUNCT = set("。！？；…,!?;.，")
ENUM_PREDICATE_STARTERS = set("那我这就便都很更将会要能可是有为")

_SENT_RE = re.compile(r"[^。！？]+[。！？]")


class SegmentationError(Exception):
    pass


def _force_chunk_long(text: str) -> list[str]:
    """TS step5：整段无有效句末标点且超长 → 按 maxSentenceLength 强制分段，末尾短段(<0.3 上限)并入前段。"""
    chunks: list[str] = []
    chunk = ""
    for ch in text:
        chunk += ch
        if len(chunk) >= MAX_SENTENCE_LENGTH:
            chunks.append(chunk.strip())
            chunk = ""
    if chunk.strip():
        if chunks and len(chunk) < MAX_SENTENCE_LENGTH * 0.3:
            chunks[-1] += chunk.strip()
        else:
            chunks.append(chunk.strip())
    return chunks or [text]


def _split_long_sentence(sentence: str) -> list[str]:
    """TS splitLongSentence：>maxSentenceLength 的单句按 [，,;；] 拆分并合并 ≤ 上限。"""
    parts = [p for p in re.split(r"[，,;；]", sentence) if p]
    result: list[str] = []
    current = ""
    for part in parts:
        if not current:
            current = part
        elif len(current) + len(part) + 1 <= MAX_SENTENCE_LENGTH:
            current += "，" + part
        else:
            result.append(current)
            current = part
    if current:
        result.append(current)
    return result


def split_sentences(text: str) -> list[str]:
    t = re.sub(r"\s+", " ", text or "").strip()
    if not t:
        return []
    parts = _SENT_RE.findall(t)
    tail = _SENT_RE.sub("", t).strip()
    if tail:
        parts.append(tail)
    parts = [p.strip() for p in parts if p.strip()]
    # TS step5：整段无句末标点且超长 → 200 字强制分段
    if len(parts) == 1 and len(parts[0]) > MAX_SENTENCE_LENGTH and not _SENT_RE.search(parts[0]):
        return _force_chunk_long(parts[0])
    out: list[str] = []
    for s in parts:
        out.extend(_split_long_sentence(s) if len(s) > MAX_SENTENCE_LENGTH else [s])
    return out


def split_to_scenes(text: str, target_chars_per_scene: int = 20, config: dict | None = None) -> list[str]:
    cfg = {**DEFAULT_SCENE, **(config or {})}
    budget = int(target_chars_per_scene or cfg["targetCharsPerScene"])
    budget = max(cfg.get("minWordsPerSegment", 10), min(budget, cfg.get("maxWordsPerSegment", 50)))
    sentences = split_sentences(text)
    scenes: list[str] = []
    current = ""
    for s in sentences:
        if len(s) >= budget and cfg.get("allowSingleSentenceOverflow", True):
            if current:
                scenes.append(current.strip())
                current = ""
            scenes.append(s.strip())
            continue
        if current and len(current) + len(s) > budget:
            scenes.append(current.strip())
            current = s
        else:
            current += s
    if current:
        scenes.append(current.strip())
    return [s for s in scenes if s]


def _is_trailing_punct_or_quote(c: str) -> bool:
    return c in TRAILING_PUNCT or c in LEFT_QUOTES or c in RIGHT_QUOTES


def _split_sentences_quoted(text: str) -> list[str]:
    out: list[str] = []
    cur = ""
    stack: list[str] = []
    for ch in text:
        cur += ch
        if ch in LEFT_QUOTES:
            stack.append(ch)
        elif ch in RIGHT_QUOTES and stack and QUOTE_MAP.get(stack[-1]) == ch:
            stack.pop()
        if ch in SENTENCE_BOUNDARY and not stack:
            out.append(cur)
            cur = ""
    if cur.strip():
        out.append(cur)
    return [s for s in out if s.strip()]


def _split_quote_boundaries(text: str, min_chars: int) -> list[str]:
    fragments: list[str] = []
    cur = ""
    stack: list[tuple[str, int]] = []
    for ch in text:
        if ch in LEFT_QUOTES:
            stack.append((ch, len(cur)))
            cur += ch
        elif ch in RIGHT_QUOTES and stack and QUOTE_MAP.get(stack[-1][0]) == ch:
            top_q, top_start = stack.pop()
            content_len = len(cur) - top_start - 1
            cur += ch
            if not stack and content_len >= min_chars:
                fragments.append(cur)
                cur = ""
        else:
            cur += ch
    if cur.strip():
        fragments.append(cur)
    return [f for f in fragments if f.strip()]


def _find_split_pos(text: str) -> int:
    # TS findSplitPos：非顿号优先级标点（从后往前）→ 空白 → 顿号（最低优先级）
    for i in range(len(text) - 1, -1, -1):
        if text[i] in PRIORITY_PUNCT and text[i] != "、":
            return i + 1
    for i in range(len(text) - 1, -1, -1):
        if text[i] in (" ", "\n", "\u3000"):
            return i + 1
    for i in range(len(text) - 1, -1, -1):
        if text[i] == "、":
            return i + 1
    return -1


def _enumeration_end(text: str, pos: int) -> int:
    for i in range(pos, len(text)):
        if text[i] in ENUM_HIGHER_PUNCT or text[i] in ENUM_PREDICATE_STARTERS:
            return i
    return len(text)


def _apply_enumeration_shift(text: str, pos: int, require_tail_min: bool, min_chars: int, max_chars: int) -> int:
    """TS applyEnumerationShift：切分锚点在顿号上时，把切点前移到枚举单元结束之后。"""
    if pos <= 0 or pos >= len(text) or text[pos - 1] != "、":
        return pos
    eend = _enumeration_end(text, pos)
    if eend > pos and eend <= max_chars:
        if not require_tail_min or len(text) - eend >= min_chars:
            return eend
    return pos


def _find_split_pos_in_range(text: str, lo: int, hi: int) -> int:
    for i in range(hi, lo - 1, -1):
        if text[i] in PRIORITY_PUNCT:
            return i + 1
    for i in range(hi, lo - 1, -1):
        if text[i] in (" ", "\n", "\u3000"):
            return i + 1
    return -1


def _length_split(text: str, min_chars: int, max_chars: int) -> list[str]:
    blocks: list[str] = []
    cur = ""
    stack: list[str] = []
    last_hard_cut = False
    for ch in text:
        cur += ch
        if ch in LEFT_QUOTES:
            stack.append(ch)
        elif ch in RIGHT_QUOTES and stack and QUOTE_MAP.get(stack[-1]) == ch:
            stack.pop()
        is_punct = ch in PRIORITY_PUNCT or ch in (" ", "\n", "\u3000")
        if is_punct and len(cur) >= min_chars:
            blocks.append(cur)
            cur = ""
            last_hard_cut = False
        elif len(cur) >= max_chars and not stack:
            pos = _apply_enumeration_shift(cur, _find_split_pos(cur), False, min_chars, max_chars)
            if pos > 0:
                blocks.append(cur[:pos])
                cur = cur[pos:]
                last_hard_cut = False
            else:
                blocks.append(cur)
                cur = ""
                last_hard_cut = True
        elif len(cur) >= max_chars * 2 and stack:
            blocks.append(cur)
            cur = ""
            last_hard_cut = True
    if cur:
        tail_clean = re.sub(r"[。！？；，、.!?;…]+$", "", cur.strip())
        if last_hard_cut and blocks and 3 < len(tail_clean) < min_chars and len(blocks[-1]) >= min_chars:
            need = min_chars - len(tail_clean)
            lo = max(1, len(blocks[-1]) - need)
            hi = len(blocks[-1]) - 1
            balanced = _find_split_pos_in_range(blocks[-1], lo, hi)
            pos = balanced if balanced > 0 else lo
            blocks[-1], cur = blocks[-1][:pos], blocks[-1][pos:] + cur
        blocks.append(cur)
    return [b for b in blocks if b.strip()]


def _merge_short(blocks: list[str], min_chars: int) -> list[str]:
    if not blocks:
        return blocks
    merged = [blocks[0]]
    for b in blocks[1:]:
        stripped = b.strip()
        is_punct_tail = len(stripped) <= 2 and all(_is_trailing_punct_or_quote(c) for c in stripped)
        is_short_tail = len(stripped) <= 3 and len(merged[-1]) >= min_chars
        if len(merged[-1]) < min_chars or is_punct_tail or is_short_tail:
            merged[-1] = merged[-1] + b
        else:
            merged.append(b)
    return [b for b in merged if b.strip()]


def _drop_unpaired_quotes(text: str) -> str:
    drop = [False] * len(text)
    stack: list[int] = []
    chars = list(text)
    for i, ch in enumerate(chars):
        if ch in LEFT_QUOTES:
            stack.append(i)
        elif ch in RIGHT_QUOTES:
            if stack and QUOTE_MAP.get(chars[stack[-1]]) == ch:
                stack.pop()
            else:
                drop[i] = True
    for idx in stack:
        drop[idx] = True
    return "".join(ch for i, ch in enumerate(chars) if not drop[i])


def _clean(blocks: list[str]) -> list[str]:
    bs = [b.strip() for b in blocks if b.strip()]
    if not bs:
        return []
    fixed = [bs[0]]
    if fixed[0] and fixed[0][0] in LEADING_PUNCT:
        fixed[0] = fixed[0][1:]
    for i in range(1, len(bs)):
        b = bs[i]
        if b and b[0] in LEADING_PUNCT and fixed:
            fixed[-1] += b[0]
            b = b[1:]
        if b:
            fixed.append(b)
    bs = [b for b in fixed if b]
    bs = [_drop_unpaired_quotes(b) for b in bs]
    bs = [b for b in bs if b]
    bs = [re.sub(r"[。！？；，、.!?;…]+$", "", b) for b in bs]
    bs = [b for b in bs if b]
    out: list[str] = []
    for b in bs:
        nb = b
        if nb and nb[0] in LEADING_PUNCT and out:
            out[-1] += nb[0]
            nb = nb[1:]
        nb = re.sub(r"[。！？；，、.!?;…]+$", "", nb).strip()
        if nb:
            out.append(nb)
    return out


def _enforce_max(blocks: list[str], min_chars: int, max_chars: int) -> list[str]:
    out: list[str] = []
    for b in blocks:
        while len(b) > max_chars:
            pos = _apply_enumeration_shift(b, _find_split_pos(b), True, min_chars, max_chars)
            if pos <= 0 or pos >= len(b):
                pos = max_chars
            if len(b) - pos < min_chars:
                min_pos = max(1, len(b) - min_chars)
                balanced = _find_split_pos_in_range(b, min_pos, len(b) - 1)
                pos = balanced if balanced > 0 else min_pos
            out.append(b[:pos])
            b = b[pos:]
        if b:
            out.append(b)
    return out


def _split_to_blocks(text: str, min_chars: int, max_chars: int) -> list[str]:
    all_blocks: list[str] = []
    for sentence in _split_sentences_quoted(text):
        for fragment in _split_quote_boundaries(sentence, min_chars):
            blocks = _length_split(fragment, min_chars, max_chars)
            blocks = _merge_short(blocks, min_chars)
            blocks = _clean(blocks)
            blocks = _enforce_max(blocks, min_chars, max_chars)
            blocks = _clean(blocks)
            all_blocks.extend(blocks)
    return [b for b in all_blocks if b.strip() and not all(_is_trailing_punct_or_quote(c) for c in b.strip())]


def split_to_subtitles(text: str, min_chars: int = 8, max_chars: int = 15, config: dict | None = None) -> list[str]:
    cfg = {**DEFAULT_SUBTITLE, **(config or {})}
    lo = min_chars or cfg["minCharsPerBlock"]
    hi = max_chars or cfg["maxCharsPerBlock"]
    if lo >= hi:
        raise SegmentationError("subtitle_min_chars 必须小于 subtitle_max_chars")
    return _split_to_blocks(text or "", lo, hi)

def segment_subtitles(text: str, total_duration: float, min_chars: int = 8, max_chars: int = 15,
                      config: dict | None = None) -> list[dict]:
    """分块 + 时间戳（proportional/equal，2 位小数连续累加，对齐 calculateTimestamps）。"""
    cfg = {**DEFAULT_SUBTITLE, **(config or {})}
    blocks = split_to_subtitles(text, min_chars, max_chars, cfg)
    if not blocks:
        return []
    if cfg.get("timeCalculationMethod") == "equal":
        durs = [total_duration / len(blocks)] * len(blocks)
    else:
        total_chars = sum(len(b) for b in blocks)
        durs = [(len(b) / total_chars) * total_duration if total_chars > 0 else total_duration / len(blocks) for b in blocks]
    out: list[dict] = []
    t = 0.0
    for i, b in enumerate(blocks):
        d = round(durs[i] * 100) / 100
        out.append({"text": b, "displayOrder": i, "startTime": t, "duration": d})
        t = round((t + d) * 100) / 100
    return out


def build_subtitle_timeline(text: str, total_duration: float, min_chars: int = 8, max_chars: int = 15,
                            config: dict | None = None) -> list[dict]:
    """对外 timeline（含 endTime，对齐 buildSubtitleTimelineV2 语义）。"""
    blocks = segment_subtitles(text, total_duration, min_chars, max_chars, config)
    out = []
    for i, b in enumerate(blocks):
        end = total_duration if i == len(blocks) - 1 else blocks[i + 1]["startTime"]
        out.append({"text": b["text"], "startTime": b["startTime"], "endTime": round(end, 2)})
    return out


def normalize_scene_config(body: dict) -> dict:
    target = body.get("target_chars_per_scene", 20)
    if isinstance(target, bool) or not isinstance(target, int) or not (1 <= target <= 200):
        raise ValueError("target_chars_per_scene 必须是 1-200 的整数")
    sub_min = body.get("subtitle_min_chars", 8)
    sub_max = body.get("subtitle_max_chars", 15)
    if isinstance(sub_min, bool) or not isinstance(sub_min, int) or not (1 <= sub_min <= 50):
        raise ValueError("subtitle_min_chars 必须是 1-50 的整数")
    if isinstance(sub_max, bool) or not isinstance(sub_max, int) or not (sub_min + 1 <= sub_max <= 200):
        raise ValueError("subtitle_max_chars 必须大于 subtitle_min_chars 且 ≤200")
    timing = str(body.get("subtitle_timing", "proportional"))
    if timing not in ("proportional", "equal"):
        raise ValueError("subtitle_timing 必须是 proportional/equal")
    return {"target_chars_per_scene": target, "subtitle_min_chars": sub_min,
            "subtitle_max_chars": sub_max, "subtitle_timing": timing}
