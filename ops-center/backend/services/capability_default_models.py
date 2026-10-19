"""能力默认模型的规范化、迁移回填与总览聚合。

voice-model-program-resolved（2026-10-18）引入：运营中心「能力默认模型」从「仅多模态」扩展到
所有 provider，桌面端在用户不选具体模型的情况下按此解析实际模型 ID。

独立成模块的原因：`model_preset_service.py` 是 `check-max-lines.js` 的**点名还账对象**
（零增长容差），新增逻辑必须靠结构性拆分落地，不能撑大原文件。
"""
from __future__ import annotations

import json
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models import ModelPreset

# 总览的能力分组顺序：llm/tts/image/video/speech_recognition 为桌面端能力选择器会消费的类别；
# audio 仅作运营参考。capabilities 里出现但不在本表的能力键不会进任何分组（已知限制，见 PRD m3）。
CAPABILITY_OVERVIEW_ORDER = ["llm", "tts", "image", "video", "speech_recognition", "audio"]


def normalize_capability_models(
    capability_models: dict,
    category: str,
    capabilities: list,
    normalized_models: list,
) -> dict:
    """校验并规范化 capability_models（完整性 + 键归属 + 值类型 + ∈ models），返回 trim 后的字典。

    - 完整性（多模态既有契约）：每个声明的能力都必须有默认模型。
    - 键必须落在该预设的 `{category} ∪ capabilities` 内（抓 `{image: …}` 填在 tts 预设上的笔误）；
    - 值只接受字符串或 null（int/bool 在桌面端两层解析里都被 `typeof === 'string'` 静默跳过，
      会形成「校验通过 / 总览显示已配置 / 运行期当未配置」三面不一致）；
    - 非空值必须 ∈ models（防止运营填错导致运行期 fail-closed）。
    """
    for cap in capabilities:
        if cap not in capability_models:
            raise ValueError(f"能力 {cap} 缺少默认模型（capability_models）")
    allowed_keys = {category} | {str(c) for c in capabilities}
    normalized: dict[str, str] = {}
    for cap_key, cap_model in capability_models.items():
        if str(cap_key) not in allowed_keys:
            raise ValueError(
                f"能力默认模型键 {cap_key} 不属于该预设的类别/能力（允许：{', '.join(sorted(allowed_keys))}）"
            )
        if cap_model is not None and not isinstance(cap_model, str):
            raise ValueError(f"能力 {cap_key} 的默认模型必须是字符串（收到 {type(cap_model).__name__}）")
        text = (cap_model or "").strip()
        if text and normalized_models and text not in normalized_models:
            raise ValueError(f"能力 {cap_key} 的默认模型 {text} 不在模型列表中")
        normalized[str(cap_key)] = text
    return normalized


def backfill_single_category_capability_model(row: ModelPreset) -> bool:
    """存量单能力预设迁移：capability_models[category] 缺失时按 default_model 补齐。

    幂等且不破坏运营手填值——仅当该键**不存在**时写（键存在即跳过，含空串值，因此运营
    「显式清空」不会被回填复活）。多模态行不参与（其键由 capabilities 驱动，创建时已写全）。
    返回是否发生了修改。
    """
    if row.category == "multimodal":
        return False
    try:
        existing = json.loads(row.capability_models or "{}")
    except (ValueError, TypeError):
        existing = {}
    if not isinstance(existing, dict):
        existing = {}
    if row.category in existing or not (row.default_model or "").strip():
        return False
    existing[row.category] = row.default_model.strip()
    row.capability_models = json.dumps(existing, ensure_ascii=False)
    return True


def _load_json_object(raw: Any, fallback: Any) -> Any:
    try:
        value = json.loads(raw or "null")
    except (ValueError, TypeError):
        return fallback
    return value if isinstance(value, type(fallback)) else fallback


async def capability_overview(db: AsyncSession) -> list[dict]:
    """按能力类别聚合「每个模型提供方的默许模型」（admin-only 总览）。

    只统计 `is_visible == 1` 的预设：隐藏/下线项不计入缺口，避免运营被无效数据干扰。
    多模态 provider 按其 capabilities 出现在多个分组；单能力 provider 按 category 出现在唯一分组。
    `is_configured=False` 即该能力存在缺口——桌面端无法在该能力下使用这个提供方。
    """
    rows = (await db.execute(select(ModelPreset).where(ModelPreset.is_visible == 1))).scalars().all()
    grouped: dict[str, list[dict]] = {cap: [] for cap in CAPABILITY_OVERVIEW_ORDER}
    for row in rows:
        caps = _load_json_object(row.capabilities, [])
        cap_models = _load_json_object(row.capability_models, {})
        if row.category == "multimodal":
            own_caps = [str(c) for c in caps if str(c) in grouped]
        elif row.category in grouped:
            own_caps = [row.category]
        else:
            own_caps = []
        for cap in own_caps:
            model = cap_models.get(cap)
            model_text = str(model).strip() if model is not None else ""
            grouped[cap].append({
                "id": row.id,
                "name": row.name,
                "category": row.category,
                "model": model_text,
                "is_configured": bool(model_text),
            })
    for cap in grouped:
        grouped[cap].sort(key=lambda item: (item["is_configured"] is False, item["name"], item["id"]))
    return [
        {"capability": cap, "providers": grouped[cap]}
        for cap in CAPABILITY_OVERVIEW_ORDER
        if grouped[cap]
    ]
