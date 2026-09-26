"""Feature flag service — 桌面端功能开关管理（CRUD/校验/种子/运行时下发）。"""
import datetime
import math
import re

import sqlalchemy as sa
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from models import FeatureFlag

KEY_RE = re.compile(r"^[A-Za-z0-9_.-]{1,128}$")
_NUMBER_RE = re.compile(r"^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$")
VALUE_TYPES = ("string", "boolean", "number")
MAX_FEATURE_FLAGS = 100

# 种子：首个真实用例 = 4K 输出能力开关（PRD 7.1.20）；已存在即跳过，不覆盖运营修改
SEED_FLAGS = [
    {
        "key": "videoCreation.maxOutputResolution",
        "value_type": "string",
        "value": "1080p",
        "description": "输出分辨率能力开关：1080p（默认，禁止 4K）| 4k（开启）；桌面端引擎 fail-closed 拒绝越界分辨率",
    },
    {
        # 账号云镜像同步入口（ADR-0006 / PRD-CLOUD-ACCOUNT-SYNC-2026-09-27 §15）：
        # 默认关，由运营在灰度就绪后手动打开。缺了这条种子，存量部署的管理页永远看不到该项
        # （「表为空才播种」的供给逻辑对存量部署无效），只能靠运营手敲 key。
        "key": "account_cloud_sync",
        "value_type": "boolean",
        "value": "false",
        "enabled": 0,
        "description": "账号管理页【同步云端】入口开关：默认关闭；开启（enabled=true 且 value=true）后桌面端才请求云端账号摘要并允许上传/恢复凭证镜像",
    },
]


class FeatureFlagError(ValueError):
    """功能开关校验/业务错误基类（400）。"""


class FeatureFlagExists(FeatureFlagError):
    """开关 key 已存在（409）。"""


def _now() -> str:
    return datetime.datetime.utcnow().isoformat()


def _to_dict(row: FeatureFlag) -> dict:
    return {
        "key": row.key, "value_type": row.value_type or "string",
        "value": row.value or "", "typed_value": typed_value(row),
        "description": row.description or "", "enabled": bool(row.enabled),
        "updated_at": row.updated_at, "updated_by": row.updated_by or "",
    }


def typed_value(row: FeatureFlag):
    """按 value_type 解析 value 为布尔/数字/字符串；解析失败按类型安全值返回（boolean False / number 0 / string raw），不抛。"""
    raw = (row.value or "").strip()
    vt = row.value_type or "string"
    if vt == "boolean":
        low = raw.lower()
        if low in ("true", "1"):
            return True
        if low in ("false", "0"):
            return False
        return False
    if vt == "number":
        try:
            f = float(raw)
        except (TypeError, ValueError):
            return 0
        if not math.isfinite(f):
            return 0
        return int(f) if f.is_integer() else f
    return raw



def validate_feature_flag(body: dict) -> dict:
    key = str(body.get("key") or "").strip()
    if not key:
        raise FeatureFlagError("key 不能为空")
    if not KEY_RE.match(key):
        raise FeatureFlagError("key 只能包含字母/数字/点/下划线/短横线（1-128 位）")
    if key in ("__proto__", "constructor", "prototype"):
        raise FeatureFlagError("key 不能使用保留键名")
    vt = str(body.get("value_type") or "string").strip().lower()
    if vt not in VALUE_TYPES:
        raise FeatureFlagError(f"value_type 必须是 {'/'.join(VALUE_TYPES)} 之一")
    # value 按类型校验可解析
    raw = body.get("value")
    if raw is None:
        raw = ""
    if not isinstance(raw, str):
        raw = str(raw)
    raw = raw.strip()
    if len(raw) > 512:
        raise FeatureFlagError("value 过长（≤512）")
    if vt == "boolean" and raw.lower() not in ("true", "false", "1", "0"):
        raise FeatureFlagError("boolean 类型 value 必须是 true/false/1/0")
    if vt == "number":
        if not _NUMBER_RE.match(raw):
            raise FeatureFlagError("number 类型 value 必须是十进制数字（如 12 / 3.5 / 1e3）")
        f = float(raw)
        if not math.isfinite(f):
            raise FeatureFlagError("number 类型 value 超出可表示范围")
    desc = str(body.get("description") or "").strip()
    if len(desc) > 200:
        raise FeatureFlagError("description 过长（≤200）")
    enabled = 1 if str(body.get("enabled", 1)).lower() in ("true", "1") else 0
    return {"key": key, "value_type": vt, "value": raw, "description": desc, "enabled": enabled}


async def _get(db: AsyncSession, key: str) -> FeatureFlag | None:
    return (await db.execute(sa.select(FeatureFlag).where(FeatureFlag.key == key))).scalar_one_or_none()


async def ensure_feature_flags_seeded(db: AsyncSession) -> None:
    now = _now()
    for s in SEED_FLAGS:
        if await _get(db, s["key"]) is not None:
            continue
        db.add(FeatureFlag(key=s["key"], value_type=s["value_type"], value=s["value"],
                           description=s["description"], enabled=int(s.get("enabled", 1)),
                           updated_at=now, updated_by="seed"))
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()  # 并发种子冲突：忽略（已存在）


async def list_feature_flags(db: AsyncSession) -> list[dict]:
    rows = (await db.execute(sa.select(FeatureFlag).order_by(FeatureFlag.key))).scalars().all()
    return [_to_dict(r) for r in rows]


async def create_feature_flag(db: AsyncSession, body: dict, updated_by: str) -> dict:
    data = validate_feature_flag(body)
    if await _get(db, data["key"]) is not None:
        raise FeatureFlagExists(f"开关 {data['key']} 已存在")
    total = (await db.execute(sa.select(sa.func.count()).select_from(FeatureFlag))).scalar_one()
    if total >= MAX_FEATURE_FLAGS:
        raise FeatureFlagError(f"功能开关数量已达上限（{MAX_FEATURE_FLAGS}）")
    row = FeatureFlag(**data, updated_at=_now(), updated_by=updated_by)
    db.add(row)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise FeatureFlagExists(f"开关 {data['key']} 已存在")
    await db.refresh(row)
    return _to_dict(row)


async def update_feature_flag(db: AsyncSession, key: str, body: dict, updated_by: str) -> dict:
    row = await _get(db, key)
    if row is None:
        raise KeyError(key)  # 404
    merged = {**{k: getattr(row, k) for k in ("value_type", "value", "description")},
              "key": key, "enabled": 1 if row.enabled else 0}
    # key 不可变：忽略 body 中的 key（路径参数优先）
    merged.update({k: v for k, v in body.items() if v is not None and k != "key"})
    data = validate_feature_flag(merged)
    for k, v in data.items():
        setattr(row, k, v)
    row.updated_at = _now()
    row.updated_by = updated_by
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise FeatureFlagExists(f"开关 {key} 已存在")
    await db.refresh(row)
    return _to_dict(row)


async def delete_feature_flag(db: AsyncSession, key: str) -> bool:
    row = await _get(db, key)
    if row is None:
        return False
    await db.delete(row)
    await db.commit()
    return True


async def list_runtime_feature_flags(db: AsyncSession) -> dict:
    """运行时下发：{key: typed_value}，仅 enabled=1。"""
    rows = (await db.execute(
        sa.select(FeatureFlag).where(FeatureFlag.enabled == 1).order_by(FeatureFlag.key)
    )).scalars().all()
    result = {}
    for r in rows:
        result[r.key] = typed_value(r)
    return result
