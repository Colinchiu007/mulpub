#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
fetch-hell-grind-kit.py - 从《Hell Grind》全量语料生成 film-kit 数据资产（可复现重建）

上游数据源（公开 API，无需登录）：
  https://fnf-api-gw.higgsfield.ai/fnf/folders/3caa2f3a-52b5-4293-9237-0c8f76c7158a/children
  items/v2 返回每文件夹全部素材元数据（含完整真实提示词、结果 URL）

用法：
  python scripts/film-engineering/fetch-hell-grind-kit.py \
      --source-dir D:/Data/projects/mp-research/hell-grind-full \
      --out-dir apps/desktop/electron/film-kit

输出（精选版，目标 <6MB；图片统一压缩为 512px webp；真实提示词 39KB 级，上限 50000 字符）：
  film-manifest.json / shot-library.json / reference-registry.json /
  prompt-doctrine.json / prompt-doctrine.zh.md / images/（精选参考图）
"""
import argparse
import hashlib
import json
import os
import re
import sys
import urllib.request
from urllib.parse import urlparse

UUID_RE = re.compile(r"<<<([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})>>>")
VIDEO_MODEL_HINT = re.compile(r"seedance|soul_cinematic|video|v2_0|veo", re.I)
# 图片模型黑名单（术语表：soul_cinematic/nano_banana 等为图片模型）——--full 视频分镜口径必须排除，
# 否则 soul_cinematic 的 3,313 个图片 job 会污染唯一分镜统计（1.3 对账修正 2026-09-23）
IMAGE_MODEL_HINT = re.compile(r"nano_banana|imagegen|gpt_image|seedream|text2image|image_auto|soul_cinematic|soul_cinema_studio|cinematic_studio_image", re.I)

ASPECT_RATIO_RE = re.compile(r"^\d+:\d+$")


def normalize_aspect_ratio(value):
    """aspectRatio 归一：kit-loader schema 只接受 "W:H" 字符串或 null。

    源语料存在 "auto"（自动比例）等非 "W:H" 形态，未采纳具体比例，
    一律归一为 None；否则整个全量 kit 会被 fail-closed 拒绝（4.4 取证）。
    """
    if isinstance(value, str) and ASPECT_RATIO_RE.match(value):
        return value
    return None


# FILM_PROMPT_MAX_LEN：prompt 长度单一上限（D4 收口：导入器/loader schema/IPC 校验/前端截断四处同源）
FILM_PROMPT_MAX_LEN = 50000

FILM_META = {
    "title": "Hell Grind",
    "durationSec": 5706,
    "logline": "Street kids who gain forbidden powers must stand against an ancient evil that is grinding the city down.",
    "characters": [
        {"name": "ROKO", "descriptor": "Determined street kid; crystal arm; glowing red fist when charged."},
        {"name": "JAXX", "descriptor": "Reckless, hungry street kid; always half-joking; London street voice."},
        {"name": "LULU", "descriptor": "Clever street kid; technical voice; flat, fast, precise."},
        {"name": "REIN", "descriptor": "Mysterious street kid; calm under pressure; carries the coordinates."},
    ],
    "source": {
        "projectUrl": "https://higgsfield.ai/@higgsfield.studio/projects/hell-grind",
        "skillRepo": "https://github.com/OSideMedia/higgsfield-ai-prompt-skill (MIT)",
        "apiBase": "https://fnf-api-gw.higgsfield.ai/fnf",
    },
}

DOCTRINE_MD = """# 《Hell Grind》影视工程 — 提示词方法论（中文版）

> 本文档由 `fetch-hell-grind-kit.py` 从《Hell Grind》公开项目语料（higgsfield.studio）提炼生成。
> 原始项目：<https://higgsfield.ai/@higgsfield.studio/projects/hell-grind>
> 对应机器可读结构：`prompt-doctrine.json`（blocks / rules / glossary 同构）。

## 一、核心问题：模型没有记忆

视频模型在两次生成之间什么都不记得。角色没有在**每一句**提示词里被完整描述，
下一镜就会换一张脸、换一件外套。下面每一条规则都是因为某次镜头失败才存在的。

**每次全量描述，逐字粘贴，永不缩写。** 一致性不是设置项，是重复。

## 二、七大提示词块（HELL GRIND 提示词架构）

每个分镜提示词由以下块按顺序组装。真实分镜提示词可达 3.9 万字符，其中角色/场景描述符
（descriptor）跨镜原样复用。

### 1. SCENE CONTEXT — 场景上下文
- 以角色计数头开篇：`EXACT 3 CHARACTERS — NO DUPLICATES`（写死人数，防模型加戏）。
- 随后是场景动作与每个角色的出场行：名字、站位、正在做的事。

### 2. GEO SPATIAL LAYOUT — 地理空间布局
- 纯场景平面图：地标、左右方位、相机站位、180° 轴线。
- **不含角色、不含动作**；一场戏的所有镜头逐字粘贴同一份 GEO，锁定地理关系。

### 3. ACTION TIMING — 动作时间线
- 0.0-2.0s 逐秒动作；镜头运动写进动作（而非作为独立指令）。
- `INNER (unspoken)` 标记内心独白；分阶段眨眼与微表情按秒写。

### 4. AUDIO — 对白与音效
- **台词只存在于 AUDIO 块**（无台词者完全沉默）。
- 音色描述符（register/tempo/accent/manner）原样粘贴、永不改变。
- 写明混音：人声近麦、环境底噪、说话时压低其他声源。

### 5. CHARACTER ACTING — 角色表演
- 情绪状态 · 此刻所求 · 隐瞒之物 · 身体节奏 · 可见习惯 · 本镜变化。
- 每镜从角色的"行为母本"适配当下姿势，但核心行为段永不改变。

### 6. STYLE — 风格前缀
- 逐字粘贴：`Photoreal. NON-IP. 16:9. 12s. SFX only. NO CGI. Cinematic.`

### 7. POSITIVE CONSTRAINTS — 正向锁定
- 8K 细节、毛孔级皮肤、无抖动闪烁；被计数的物体写成「是什么在画面中」。
- **点名失败镜头长什么样**（例：巨人高度比例——"画框同时容不下脚和头 = 失败镜头"）。

## 三、十条铁律

| # | 铁律 | 说明 |
|---|------|------|
| 1 | **Assets first** | 素材先行：角色/场景/道具全部锁定并压力测试之前，不生成任何镜头 |
| 2 | **Describe everything, every time** | 每次全量描述：描述符逐字粘贴、永不缩写 |
| 3 | **Change one thing at a time** | 一次只改一处：整段重写会丢掉生效部分；每次迭代记录日志 |
| 4 | **Give the model less freedom** | 少给自由：角落而非房间、锚点而非空地、地图而非猜测、每镜一个动作 |
| 5 | **Simplify the shot, not the words** | 10-15 次迭代不出片 → 简化镜头本身：拆两镜、删动作、换角度 |
| 6 | **The first second is always a wide** | 每场第一秒固定广角：无人声无动作，把站位/光线「拍」进模型 |
| 7 | **Physics, not adjectives** | 写肌肉不写形容词：颤抖、下颌咬紧、颧骨绷紧、鼻息；静止写成绷住的张力 |
| 8 | **The voice is a locked descriptor** | 音色是锁定描述符：register/tempo/accent/manner 前期锁定，逐次粘贴 |
| 9 | **Point changes go on with masks** | 点修改用蒙版合回原图；图片绝不全图二过模型 |
| 10 | **Dialogue lives only in the audio block** | 声音+情绪→引号台词→肢体动作→面部反应；无台词者完全沉默 |

## 四、术语表

| 术语 | 含义 |
|------|------|
| seedance_2_0 | 视频生成模型（剧情镜头主力） |
| nano_banana_2 | 图片生成模型（角色定妆/素材图） |
| soul_cinematic | 电影感图片模型（氛围/质感图） |
| reference token | 引用令牌：`<<<uuid>>>` 形式的资产引用，逐字保留 |
| character sheet | 角色定妆三视图：面部特写 + 正面无头全身 + 背面全身 |
| GEO block | 地理空间布局块（每场锁定，逐镜粘贴不变） |

## 五、前期制作工作流（照抄管线）

1. **角色定妆三视图**：面部特写 / 正面全身（**无头**）/ 背面全身。正面去头是刻意的——
   广角镜头下模型会从小全身图上取脸，去掉头后脸只有唯一来源：特写图。
   定妆图刻意无聊：中性灰背景、平光、真实毛孔皮肤、不修图。电影感属于场景与视频提示词。
2. **音色锁定**：开拍前把 register/tempo/accent/manner 写进描述符，此后逐镜原样粘贴。
3. **点修改用蒙版**：衣服/伤疤/血只改局部，手工蒙版合回原图，图片绝不全图二过模型。
4. **GEO 锁定**：每场一份 GEO 布局，逐镜粘贴不变；转场空间用门槛+明暗对比衔接。
5. **对白纪律**：台词只在 AUDIO 块；情绪冲击后留 1/3 秒反应时间；情绪不瞬断，尾韵带入下一镜。
6. **迭代循环**：按场景批量生成；每轮只改一行并记日志；10-15 次不收敛就简化镜头。

## 六、在本流水线中的用法

- **复制**：每个分镜提供「复制完整提示词 / 复制参考令牌列表」——提示词内 `<<<uuid>>>`
  即 reference-registry 的 key，令牌必须原样保留（模型侧引用资产）。
- **剧本套用**：输入自己的剧本 → 系统把剧情行映射到 Hell Grind 分场结构 → 生成分镜时
  保留全部七块架构与描述符，仅替换剧情内容。
"""

DOCTRINE = {
    "blocks": [
        {"key": "scene_context", "label": "SCENE CONTEXT", "zh": "场景上下文：以角色计数头开篇（如 EXACT 3 CHARACTERS — NO DUPLICATES），后接场景动作与角色行", "en": "Opens with a count header (EXACT 3 CHARACTERS — NO DUPLICATES), then scene action and character lines"},
        {"key": "geo_spatial_layout", "label": "GEO SPATIAL LAYOUT", "zh": "地理空间布局：纯场景平面图（地标、左右、相机站位、180° 轴线），不含角色与动作；每场锁定逐镜粘贴不变", "en": "Pure floor plan of the place (landmarks, left/right, camera side, 180° axis); no characters, no action; locked across every shot of the scene"},
        {"key": "action_timing", "label": "ACTION TIMING", "zh": "动作时间线：0.0-2.0s 逐秒动作；镜头运动写进动作；INNER (unspoken) 内心独白；分阶段眨眼与微表情", "en": "Per-second action timeline; camera written inside the action; INNER (unspoken) monologue; phased blinking and micro-expressions"},
        {"key": "audio", "label": "AUDIO", "zh": "对白与音效：台词只存在于 AUDIO 块；音色锁定描述符原样粘贴；写明混音（人声近麦、环境底噪、说话时压低）", "en": "Dialogue lives only here; voice descriptor pasted verbatim; write the mix (voices close, ambience under, dips when someone speaks)"},
        {"key": "character_acting", "label": "CHARACTER ACTING", "zh": "角色表演：情绪状态·此刻所求·隐瞒之物·身体节奏·可见习惯·本镜变化；核心行为段永不改变", "en": "Emotional state · want in this moment · what they hide · body rhythm · visible habits · what changes across the shot"},
        {"key": "style", "label": "STYLE", "zh": "风格前缀：逐字粘贴（Photoreal. NON-IP. 16:9. 12s. SFX only. NO CGI. Cinematic.）", "en": "Style prefix pasted word for word (Photoreal. NON-IP. 16:9. 12s. SFX only. NO CGI. Cinematic.)"},
        {"key": "positive_constraints", "label": "POSITIVE CONSTRAINTS", "zh": "正向锁定：8K 细节、毛孔级皮肤、无抖动闪烁；计数物体以「是什么在画面中」表述；点名失败镜头长什么样", "en": "Positive locks: 8K detail, pore-level skin, no jitter; counted objects phrased as what IS in frame; name what a failed shot looks like"},
    ],
    "rules": [
        {"key": "assets-first", "title": "Assets first", "zh": "素材先行：角色/场景/道具全部锁定并压力测试之前，不生成任何一个镜头", "en": "Do not generate a single shot until every character, location, and prop is locked and stress-tested"},
        {"key": "describe-everything", "title": "Describe everything, every time", "zh": "每次全量描述：模型没有记忆，描述符逐字粘贴、永不缩写", "en": "The model has no memory; the descriptor goes into every prompt word for word, never shortened"},
        {"key": "one-change-at-a-time", "title": "Change one thing at a time", "zh": "一次只改一处：整段重写会丢掉生效的部分；每次迭代记录日志", "en": "Rewrite a prompt fully and you lose the parts that worked; one line per iteration, everything into the log"},
        {"key": "less-freedom", "title": "Give the model less freedom", "zh": "少给自由：角落而非房间、锚点而非空地、地图而非猜测、每镜一个动作", "en": "A corner instead of a room, an anchor instead of open space, a map instead of guesswork, one action per shot"},
        {"key": "simplify-shot", "title": "Simplify the shot, not the words", "zh": "镜头不出来就简化镜头：拆成两镜、删一个动作、换角度；10-15 次迭代上限", "en": "If a shot will not come together in 10-15 iterations, split it, remove an action, change the angle"},
        {"key": "first-second-wide", "title": "The first second is always a wide", "zh": "每场第一秒固定广角：无人声无动作，把站位/光线“拍”进模型", "en": "One second at the start of a scene, no lines and no action: locks positions and light"},
        {"key": "physics-not-adjectives", "title": "Physics, not adjectives", "zh": "写肌肉不写形容词：颤抖、下颌咬紧、颧骨绷紧、鼻息；静止写成“绷住的张力”而非“别动”", "en": "Describe the work of muscles and body, not emotion words; stillness as held tension, never a freeze"},
        {"key": "voice-is-descriptor", "title": "The voice is a locked descriptor", "zh": "音色是锁定描述符：register/tempo/accent/manner 在 pre-production 锁定，逐次粘贴", "en": "Lock register, tempo, accent, manner before any dialogue; pasted as-is every time the character speaks"},
        {"key": "mask-point-changes", "title": "Point changes go on with masks", "zh": "点修改用蒙版：衣服/伤疤/血在 Nano Banana 改后手工蒙版合回原图；图片绝不全图二过模型", "en": "Clothes, scars, blood are point changes masked onto the original; an image never runs through a model twice in full"},
        {"key": "dialogue-only-in-audio", "title": "Dialogue lives only in the audio block", "zh": "台词只在 AUDIO 块：声音+情绪→引号台词→肢体动作→面部反应；无台词者完全沉默", "en": "Voice+emotion → line in quotes → physical action → facial reaction; everyone else stays completely silent"},
    ],
    "glossary": [
        {"term": "seedance_2_0", "zh": "视频生成模型（Seedance 2.0，剧情镜头主力）", "en": "Video generation model (Seedance 2.0)"},
        {"term": "nano_banana_2", "zh": "图片生成模型（Nano Banana 2，角色定妆/素材图）", "en": "Image generation model (Nano Banana 2)"},
        {"term": "soul_cinematic", "zh": "电影感图片模型（氛围/质感图）", "en": "Cinematic image model"},
        {"term": "reference token", "zh": "引用令牌：<<<uuid>>> 形式的资产引用，逐字保留", "en": "Reference token: <<<uuid>>> asset reference kept verbatim"},
        {"term": "character sheet", "zh": "角色定妆三视图：面部特写 + 正面无头全身 + 背面全身", "en": "Character sheet: face close-up + headless front full-body + back"},
        {"term": "GEO block", "zh": "地理空间布局块（每场锁定，逐镜粘贴不变）", "en": "Geo spatial layout block (locked per scene)"},
    ],
}


def load_jsonl(path):
    items = []
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                d = json.loads(line)
            except Exception:
                continue
            if d.get("type") == "job" and isinstance(d.get("job"), dict):
                items.append(d["job"])
    return items


def pick_representative(jobs):
    valid = []
    for j in jobs:
        params = j.get("params") or {}
        prompt = str(params.get("prompt") or "").strip()
        if j.get("status") != "completed" or not prompt:
            continue
        valid.append(j)
    if not valid:
        return None
    videos = [j for j in valid if VIDEO_MODEL_HINT.search(str(j.get("job_set_type") or ""))]
    pool = videos if videos else valid
    pool.sort(key=lambda j: float(j.get("created_at") or 0))
    return pool[-1]


def extract_tokens(prompt):
    return sorted(set(UUID_RE.findall(prompt or "")))


# ---------- L1 全量导入（film-full-corpus-production D3/D4/D7） ----------

def normalize_prompt(prompt):
    """去重键规范化：trim + 折叠任意连续空白（含换行/制表）为单个空格。"""
    return re.sub(r"\s+", " ", str(prompt or "").strip())


def prompt_key(prompt):
    """去重键 = 规范化 prompt 的 SHA1（D3）。"""
    return hashlib.sha1(normalize_prompt(prompt).encode("utf-8")).hexdigest()


def _is_video_job(j):
    t = str(j.get("job_set_type") or "")
    return bool(VIDEO_MODEL_HINT.search(t)) and not IMAGE_MODEL_HINT.search(t)


def _completed_prompt(j):
    """completed 且 prompt 非空的 job 的 prompt；否则返回 None（与 pick_representative 有效口径一致）。"""
    if j.get("status") != "completed":
        return None
    return str((j.get("params") or {}).get("prompt") or "").strip() or None


def _result_urls(j):
    results = j.get("results") or {}
    raw = results.get("raw") or {}
    minres = results.get("min") or {}
    return (raw.get("url") or minres.get("url")), (raw.get("thumbnail_url") or minres.get("thumbnail_url"))


def pick_adopted_for_prompt(jobs):
    """同一唯一 prompt 分组内选采纳版（D3）。

    仅计视频 model 且 completed、prompt 非空的 job：
      - iterationCount = 该组 completed job 数（失败/无结果/图像不计入迭代口径）
      - 采纳版 = 按 created_at 末次且带 results.url 的 job（is_favourite 不参与，取证全 false）
    返回 (adopted_job | None, iterationCount)。
    """
    group = [j for j in jobs if _is_video_job(j) and _completed_prompt(j)]
    group.sort(key=lambda j: float(j.get("created_at") or 0))
    with_results = [j for j in group if _result_urls(j)[0]]
    return ((with_results[-1] if with_results else None), len(group))


def _make_full_shot(job, scene_id):
    params = job.get("params") or {}
    prompt = str(params.get("prompt") or "")
    url, thumb = _result_urls(job)
    return {
        "shotId": job["id"],
        "sceneId": scene_id,
        "prompt": prompt,
        "model": job.get("job_set_type") or "unknown",
        "refTokens": extract_tokens(prompt),
        "resultUrl": url or None,
        "thumbnailUrl": thumb or None,
        "width": params.get("width"),
        "height": params.get("height"),
        "durationSec": params.get("duration"),
        "aspectRatio": normalize_aspect_ratio(params.get("aspect_ratio")),
        "iterationCount": None,   # 调用方填充
        "adoptedJobAt": float(job.get("created_at") or 0),
        "promptKey": prompt_key(prompt),
    }


def _iter_folder_jobs(source_dir, tree):
    """按 tree 遍历顺序产出 (folder_node, jobs)。"""
    stack = []
    seen = set()

    def walk(node):
        fid = node["id"]
        if fid in seen:
            return
        seen.add(fid)
        if node.get("count", 0) > 0:
            path = os.path.join(source_dir, "items", "%s_%s.jsonl" % (fid[:8], sanitize(node["name"])))
            yield node, (load_jsonl(path) if os.path.exists(path) else [])
        for child in node.get("children") or []:
            for item in walk(child):
                yield item

    return walk(tree)


def build_full_shot_library(source_dir, tree):
    """--full 模式：每场景文件夹内按唯一 prompt 去重，全部采纳版入库（修复 94.5% 丢失）。

    返回 (shots, rejected)；超限镜（>FILM_PROMPT_MAX_LEN）拒绝并进 rejected。
    """
    shots = []
    rejected = []
    seen_ids = set()
    for node, jobs in _iter_folder_jobs(source_dir, tree):
        groups = {}
        order = []
        for j in jobs:
            prompt = _completed_prompt(j)
            if not prompt or not _is_video_job(j):
                continue
            key = prompt_key(prompt)
            if key not in groups:
                groups[key] = []
                order.append(key)
            groups[key].append(j)
        for key in order:
            group = groups[key]
            adopted, iteration = pick_adopted_for_prompt(group)
            if adopted is None:
                continue  # 全部无结果（如未出片），既不成镜也不进超限清单
            prompt = str((adopted.get("params") or {}).get("prompt") or "")
            if len(prompt) > FILM_PROMPT_MAX_LEN:
                rejected.append({
                    "shotId": adopted["id"],
                    "sceneId": node["id"],
                    "promptLength": len(prompt),
                    "reason": "prompt 超限（%d > %d 字符）" % (len(prompt), FILM_PROMPT_MAX_LEN),
                })
                continue
            shot = _make_full_shot(adopted, node["id"])
            shot["iterationCount"] = iteration
            if shot["shotId"] not in seen_ids:
                seen_ids.add(shot["shotId"])
                shots.append(shot)
    return shots, rejected


def compute_full_stats(source_dir, tree):
    """--dry-run 统计口径（任务 1.3 对账）：与 build_full_shot_library 同源。"""
    total_video_jobs = 0
    keys = set()
    for node, jobs in _iter_folder_jobs(source_dir, tree):
        for j in jobs:
            if _is_video_job(j) and _completed_prompt(j):
                total_video_jobs += 1
                keys.add(prompt_key(j["params"]["prompt"]))
    shots, rejected = build_full_shot_library(source_dir, tree)
    return {
        "totalVideoJobs": total_video_jobs,
        "uniqueVideoPrompts": len(keys),
        "adoptedShots": len(shots),
        "rejectedOverLimit": len(rejected),
        "filmKitMaxPromptLen": FILM_PROMPT_MAX_LEN,
    }


def enrich_manifest_with_hosts(manifest, shots):
    """D7：导入时登记 resultUrl 域名清单，下载器只信该清单（不通配）。"""
    hosts = set()
    for s in shots:
        url = s.get("resultUrl")
        if not url:
            continue
        parsed = urlparse(url)
        if parsed.scheme == "https" and parsed.hostname:
            hosts.add(parsed.hostname)
    manifest["allowedHosts"] = sorted(hosts)
    return manifest


def write_json_atomic(path, obj):
    """`.tmp` → os.replace 原子写（任务 2.4），杜绝中断留半成品 kit。"""
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(obj, fh, ensure_ascii=False, indent=1)
    os.replace(tmp, path)


def build_manifest(tree):
    scenes = []
    stack = [(tree, None, 0)]
    seen = set()
    while stack:
        node, parent_id, level = stack.pop()
        fid = node["id"]
        if fid in seen:
            continue
        seen.add(fid)
        scenes.append({
            "id": fid,
            "name": node["name"],
            "count": int(node.get("count") or 0),
            "parentId": parent_id,
            "level": level,
        })
        for child in reversed(node.get("children") or []):
            stack.append((child, fid, level + 1))
    scenes.sort(key=lambda s: (s["level"], s["name"]))
    return {"schemaVersion": 1, "filmMeta": FILM_META, "scenes": scenes}


def sanitize(name):
    return re.sub(r'[\\/:?*"<>|]', "_", name)[:80]


def build_shot_library(source_dir, tree):
    shots = []
    seen_ids = set()

    def walk(node):
        fname = node["name"]
        fid = node["id"]
        if node.get("count", 0) > 0:
            path = os.path.join(source_dir, "items", "%s_%s.jsonl" % (fid[:8], sanitize(fname)))
            jobs = load_jsonl(path) if os.path.exists(path) else []
            rep = pick_representative(jobs)
            if rep:
                params = rep.get("params") or {}
                results = rep.get("results") or {}
                raw = results.get("raw") or {}
                minres = results.get("min") or {}
                prompt = str(params.get("prompt") or "")
                shot = {
                    "shotId": rep["id"],
                    "sceneId": fid,
                    "prompt": prompt,
                    "model": rep.get("job_set_type") or "unknown",
                    "refTokens": extract_tokens(prompt),
                    "resultUrl": raw.get("url") or minres.get("url") or None,
                    "thumbnailUrl": raw.get("thumbnail_url") or minres.get("thumbnail_url") or None,
                    "width": params.get("width"),
                    "height": params.get("height"),
                }
                if shot["shotId"] not in seen_ids:
                    seen_ids.add(shot["shotId"])
                    shots.append(shot)
        for child in node.get("children") or []:
            walk(child)

    walk(tree)
    return shots


def build_reference_registry(source_dir, tree, shots):
    job_meta = {}
    assets_names = ("assets", "character", "sheet")

    def collect(node):
        fname = node["name"]
        path = os.path.join(source_dir, "items", "%s_%s.jsonl" % (node["id"][:8], sanitize(fname)))
        if os.path.exists(path):
            for j in load_jsonl(path):
                job_meta[j["id"]] = {
                    "folder": fname,
                    "prompt": str((j.get("params") or {}).get("prompt") or "")[:400],
                    "url": ((j.get("results") or {}).get("min") or {}).get("url"),
                    "isAsset": any(a in fname.lower() for a in assets_names),
                }
        for child in node.get("children") or []:
            collect(child)

    collect(tree)

    # 主索引：提示词里的 <<<uuid>>> token 指向 params.reference_elements[].id
    # （实测：job 的 params.reference_elements[0].id 与 prompt 内 token 一一对应）
    ref_index = {}
    for path in os.listdir(os.path.join(source_dir, "items")):
        if not path.endswith(".jsonl"):
            continue
        for j in load_jsonl(os.path.join(source_dir, "items", path)):
            for ref in (j.get("params") or {}).get("reference_elements") or []:
                rid = ref.get("id")
                if not rid or rid in ref_index:
                    continue
                ref_index[rid] = {
                    "name": ref.get("name"),
                    "category": ref.get("category"),
                    "imageUrls": [m.get("url") for m in (ref.get("medias") or []) if m.get("url")],
                }

    all_tokens = set()
    for s in shots:
        all_tokens.update(s["refTokens"])
    for path in os.listdir(os.path.join(source_dir, "items")):
        if not path.endswith(".jsonl"):
            continue
        for j in load_jsonl(os.path.join(source_dir, "items", path)):
            p = str((j.get("params") or {}).get("prompt") or "")
            all_tokens.update(extract_tokens(p))

    registry = {}
    for token in all_tokens:
        ref = ref_index.get(token)
        meta = job_meta.get(token)
        if ref:
            cat = str(ref.get("category") or "").lower()
            if "character" in cat:
                kind = "character"
            elif "environment" in cat or "scene" in cat or "location" in cat:
                kind = "scene"
            else:
                kind = "prop"
            name = str(ref.get("name") or "").strip()
            if not name:
                name = None
            elif kind == "character":
                name = name.upper()
            entry = {"kind": kind, "name": name, "category": ref.get("category"), "imageUrls": ref["imageUrls"]}
            if meta:
                entry["folder"] = meta["folder"]
            registry[token] = entry
        elif meta and meta["isAsset"]:
            kind = "character" if any(k in meta["folder"].lower() for k in ("character", "sheet")) else "prop"
            name = meta["prompt"].splitlines()[0][:80] if meta["prompt"] else meta["folder"]
            registry[token] = {"kind": kind, "name": name, "folder": meta["folder"], "imageUrls": [meta["url"]] if meta["url"] else []}
        elif meta:
            kind = "scene" if any(k in meta["folder"].lower() for k in ("scene", "location", "assets final", "flashback")) else "unknown"
            registry[token] = {"kind": kind, "name": meta["prompt"].splitlines()[0][:80] if meta["prompt"] else meta["folder"], "folder": meta["folder"], "imageUrls": [meta["url"]] if meta["url"] else []}
        else:
            registry[token] = {"kind": "unknown", "name": None, "imageUrls": []}

    known = {k: v for k, v in registry.items() if v["kind"] != "unknown"}
    unknown_sample = [k for k, v in registry.items() if v["kind"] == "unknown"][:20]
    result = dict(known)
    for k in unknown_sample:
        result[k] = {"kind": "unknown", "name": None, "imageUrls": []}
    return result


def download_image(url, dest, timeout=20):
    """下载并压缩为 max_edge 边长 webp（默认 512px），体积控制在几十 KB 级。"""
    if not url:
        return False
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            data = r.read()
        if len(data) < 256:
            return False
        tmp = dest + ".tmp"
        with open(tmp, "wb") as fh:
            fh.write(data)
        try:
            from PIL import Image
            im = Image.open(tmp)
            im.thumbnail((512, 512))
            im.convert("RGB").save(dest, "WEBP", quality=82, method=6)
        except Exception:
            with open(dest, "wb") as fh:
                fh.write(data)
        os.remove(tmp)
        return True
    except Exception:
        return False


def _run_full_import(source_dir, out_dir, tree, with_images):
    """--full 全量导入：原子写 + import-report.json（任务 2.2-2.4）。"""
    shots, rejected = build_full_shot_library(source_dir, tree)
    manifest = build_manifest(tree)
    enrich_manifest_with_hosts(manifest, shots)
    registry = build_reference_registry(source_dir, tree, shots)

    write_json_atomic(os.path.join(out_dir, "film-manifest.json"), manifest)
    write_json_atomic(os.path.join(out_dir, "shot-library.json"), shots)
    write_json_atomic(os.path.join(out_dir, "reference-registry.json"), registry)
    write_json_atomic(os.path.join(out_dir, "prompt-doctrine.json"), DOCTRINE)
    with open(os.path.join(out_dir, "prompt-doctrine.zh.md"), "w", encoding="utf-8") as fh:
        fh.write(DOCTRINE_MD)

    report = {
        "mode": "full",
        "shotCount": len(shots),
        "sceneCount": len(manifest["scenes"]),
        "rejectedCount": len(rejected),
        "rejected": rejected,
        "allowedHosts": manifest["allowedHosts"],
        "stats": compute_full_stats(source_dir, tree),
        "maxPromptLength": max((len(s["prompt"]) for s in shots), default=0),
    }
    write_json_atomic(os.path.join(out_dir, "import-report.json"), report)

    print("[full] manifest scenes:", len(manifest["scenes"]))
    print("[full] shots:", len(shots), "rejected:", len(rejected))

    if with_images:
        _download_curated_images(out_dir, registry, shots)

    print("DONE")
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source-dir", required=True)
    ap.add_argument("--out-dir", required=False, default=None,
                    help="kit 输出目录；--full 时建议指向用户数据目录 film-kit/（不入 asar）")
    ap.add_argument("--full", action="store_true",
                    help="全量模式：每场景全部唯一分镜采纳版（默认精选模式，向后兼容）")
    ap.add_argument("--dry-run", action="store_true",
                    help="只输出 --full 口径统计（uniqueVideoPrompts/adoptedShots/超限拒绝），不落盘")
    ap.add_argument("--with-images", action="store_true",
                    help="--full 模式下额外下载精选参考图（默认跳过，OQ3）")
    args = ap.parse_args()

    source_dir = args.source_dir
    if not args.dry_run and not args.out_dir:
        ap.error("--out-dir 为必填（除 --dry-run）")

    with open(os.path.join(source_dir, "folder-tree.json"), encoding="utf-8") as fh:
        tree = json.load(fh)

    if args.dry_run:
        print(json.dumps(compute_full_stats(source_dir, tree), ensure_ascii=False, indent=1))
        return 0

    out_dir = args.out_dir
    os.makedirs(out_dir, exist_ok=True)

    if args.full:
        return _run_full_import(source_dir, out_dir, tree, args.with_images)

    os.makedirs(os.path.join(out_dir, "images"), exist_ok=True)

    manifest = build_manifest(tree)
    shots = build_shot_library(source_dir, tree)
    registry = build_reference_registry(source_dir, tree, shots)

    with open(os.path.join(out_dir, "film-manifest.json"), "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, ensure_ascii=False, indent=1)
    with open(os.path.join(out_dir, "shot-library.json"), "w", encoding="utf-8") as fh:
        json.dump(shots, fh, ensure_ascii=False, indent=1)
    with open(os.path.join(out_dir, "reference-registry.json"), "w", encoding="utf-8") as fh:
        json.dump(registry, fh, ensure_ascii=False, indent=1)
    with open(os.path.join(out_dir, "prompt-doctrine.json"), "w", encoding="utf-8") as fh:
        json.dump(DOCTRINE, fh, ensure_ascii=False, indent=1)
    with open(os.path.join(out_dir, "prompt-doctrine.zh.md"), "w", encoding="utf-8") as fh:
        fh.write(DOCTRINE_MD)

    print("manifest scenes:", len(manifest["scenes"]))
    print("shots:", len(shots))
    print("registry entries:", len(registry))

    _download_curated_images(out_dir, registry, shots)
    print("DONE")
    return 0


def _download_curated_images(out_dir, registry, shots):
    """下载精选参考图（4 角色图 + 6 场景缩略图）；OQ3 默认维持精选规模。"""
    os.makedirs(os.path.join(out_dir, "images"), exist_ok=True)
    downloaded = 0
    images_manifest = {}
    main_chars = ["ROKO", "JAXX", "LULU", "REIN"]
    chars = []
    for k, v in registry.items():
        if v.get("kind") != "character" or not v.get("imageUrls"):
            continue
        nm = str(v.get("name") or "").upper()
        if nm in main_chars and nm not in [c.get("name") for c in chars]:
            chars.append(v)
    if len(chars) < 4:
        for k, v in registry.items():
            if v.get("kind") != "character" or not v.get("imageUrls"):
                continue
            if v.get("name") not in [c.get("name") for c in chars]:
                chars.append(v)
            if len(chars) >= 4:
                break
    for i, v in enumerate(chars[:4]):
        url = v["imageUrls"][0]
        dest = os.path.join(out_dir, "images", "char_%d.webp" % (i + 1))
        if download_image(url, dest):
            images_manifest["char_%d.webp" % (i + 1)] = {"name": v.get("name")}
            downloaded += 1
    thumb_count = 0
    for s in shots:
        if thumb_count >= 6:
            break
        url = s.get("thumbnailUrl") or s.get("resultUrl")
        if not url:
            continue
        dest = os.path.join(out_dir, "images", "scene_%d.webp" % (thumb_count + 1))
        if download_image(url, dest):
            images_manifest["scene_%d.webp" % (thumb_count + 1)] = {"shotId": s["shotId"], "sceneId": s["sceneId"]}
            downloaded += 1
            thumb_count += 1
    with open(os.path.join(out_dir, "images", "images-manifest.json"), "w", encoding="utf-8") as fh:
        json.dump(images_manifest, fh, ensure_ascii=False, indent=1)
    print("images downloaded:", downloaded)


if __name__ == "__main__":
    sys.exit(main())
