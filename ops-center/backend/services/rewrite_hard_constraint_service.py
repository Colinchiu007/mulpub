"""Rewrite hard constraint service — 改写硬约束管理（CRUD/唯一默认/种子/运行时下发）。

硬约束是最高优先级的改写规则：无论改写模式和策略如何选择都强制生效，
与策略/模式指令冲突时以硬约束为准。多版本管理，唯一默认（is_default=1 至多一条）。
"""
import datetime
import re

import sqlalchemy as sa
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from models import RewriteHardConstraint

ID_RE = re.compile(r"^[a-z0-9_-]{1,100}$")

MAX_TITLE_LENGTH = 200
MAX_CONTENT_LENGTH = 5000
MAX_DESCRIPTION_LENGTH = 2000

# 种子数据：初始硬约束（v1）。
# 来源：2026-09-18 用户反馈「改写结果混入『开头（悬念钩子）』等结构标题」的修复约束，
# 原硬编码于引擎 _buildPrompt，现升级为运营中心可维护的硬约束种子。
SEED_HARD_CONSTRAINTS = [
    {
        "id": "hard-constraint-default-v1",
        "title": "默认硬约束（纯文案输出）",
        "content": (
            "1. 只输出改写后的文案本身，不要包含任何小节标题（如「开头」「中间」「结尾」"
            "「悬念钩子」「情感转折」「共鸣与号召」等）、结构说明、写作指导或 Markdown 标题。\n"
            "2. 文案内部如需分段，使用空行分隔即可。\n"
            "3. 不要输出任何与文案内容无关的说明、注释或元信息。"
        ),
        "description": "初始版本：纯文案输出约束（源自 2026-09-18 结构标题混入修复）",
        "is_default": 1,
    },
]

SEED_IDS = {s["id"] for s in SEED_HARD_CONSTRAINTS}


def _now() -> str:
    return datetime.datetime.utcnow().isoformat()


def _to_dict(row: RewriteHardConstraint) -> dict:
    return {
        "id": row.id,
        "title": row.title or "",
        "content": row.content or "",
        "description": row.description or "",
        "isDefault": bool(row.is_default),
        "enabled": bool(row.enabled),
        "builtin": row.id in SEED_IDS,
        "createdAt": row.created_at or "",
        "updatedAt": row.updated_at or "",
        "updatedBy": row.updated_by or "",
    }


def validate_payload(data: dict, *, partial: bool = False) -> tuple[dict | None, str]:
    """校验创建/更新载荷。partial=True 时允许缺省字段（仅校验出现的字段）。"""
    if not isinstance(data, dict):
        return None, "请求体必须是 JSON 对象"
    out: dict = {}

    if "id" in data or not partial:
        raw_id = str(data.get("id") or "").strip()
        if not raw_id or not ID_RE.match(raw_id):
            return None, "id 必须是 1-100 位的 a-z0-9_- 字符串"
        out["id"] = raw_id

    if "title" in data or not partial:
        title = str(data.get("title") or "").strip()
        if not title:
            return None, "标题不能为空"
        if len(title) > MAX_TITLE_LENGTH:
            return None, f"标题不能超过 {MAX_TITLE_LENGTH} 字"
        out["title"] = title

    if "content" in data or not partial:
        content = str(data.get("content") or "").strip()
        if not content:
            return None, "硬约束内容不能为空"
        if len(content) > MAX_CONTENT_LENGTH:
            return None, f"硬约束内容不能超过 {MAX_CONTENT_LENGTH} 字"
        out["content"] = content

    if "description" in data:
        description = str(data.get("description") or "").strip()
        if len(description) > MAX_DESCRIPTION_LENGTH:
            return None, f"描述不能超过 {MAX_DESCRIPTION_LENGTH} 字"
        out["description"] = description

    if "enabled" in data:
        out["enabled"] = 1 if data.get("enabled") else 0

    return out, ""


async def list_constraints(db: AsyncSession) -> list[dict]:
    rows = (
        await db.execute(
            sa.select(RewriteHardConstraint)
            .where(RewriteHardConstraint.deleted_at.is_(None))
            .order_by(RewriteHardConstraint.is_default.desc(), RewriteHardConstraint.created_at.asc())
        )
    ).scalars().all()
    return [_to_dict(r) for r in rows]


async def get_default_runtime(db: AsyncSession) -> dict | None:
    """运行时下发：返回唯一默认版本（enabled 且未删）。无默认时返回 None。"""
    row = (
        await db.execute(
            sa.select(RewriteHardConstraint)
            .where(
                RewriteHardConstraint.deleted_at.is_(None),
                RewriteHardConstraint.is_default == 1,
                RewriteHardConstraint.enabled == 1,
            )
            .limit(1)
        )
    ).scalar_one_or_none()
    if not row:
        return None
    return {"title": row.title or "", "content": row.content or ""}


async def create_constraint(db: AsyncSession, payload: dict, updated_by: str = "") -> tuple[dict | None, str]:
    safe, err = validate_payload(payload, partial=False)
    if err:
        return None, err
    existing = await db.get(RewriteHardConstraint, safe["id"])
    if existing and existing.deleted_at is None:
        return None, f"硬约束 {safe['id']} 已存在"
    row = RewriteHardConstraint(
        id=safe["id"],
        title=safe["title"],
        content=safe["content"],
        description=safe.get("description", ""),
        is_default=0,
        enabled=1,
        created_at=_now(),
        updated_at=_now(),
        updated_by=updated_by,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return _to_dict(row), ""


async def update_constraint(db: AsyncSession, constraint_id: str, payload: dict, updated_by: str = "") -> tuple[dict | None, str]:
    row = await db.get(RewriteHardConstraint, constraint_id)
    if not row or row.deleted_at is not None:
        return None, "硬约束不存在"
    safe, err = validate_payload(payload, partial=True)
    if err:
        return None, err
    for k in ("title", "content", "description"):
        if k in safe:
            setattr(row, k, safe[k])
    if "enabled" in safe:
        row.enabled = safe["enabled"]
    row.updated_at = _now()
    row.updated_by = updated_by
    await db.commit()
    await db.refresh(row)
    return _to_dict(row), ""


async def delete_constraint(db: AsyncSession, constraint_id: str, updated_by: str = "") -> tuple[bool, str]:
    row = await db.get(RewriteHardConstraint, constraint_id)
    if not row or row.deleted_at is not None:
        return False, "硬约束不存在"
    if row.is_default:
        return False, "默认硬约束不可删除，请先将其他版本设为默认"
    row.deleted_at = _now()
    row.updated_at = _now()
    row.updated_by = updated_by
    await db.commit()
    return True, ""


async def set_default(db: AsyncSession, constraint_id: str, updated_by: str = "") -> tuple[dict | None, str]:
    """设为默认（事务内先清空其他默认，再设置目标——保证唯一默认）。"""
    row = await db.get(RewriteHardConstraint, constraint_id)
    if not row or row.deleted_at is not None:
        return None, "硬约束不存在"
    if not row.enabled:
        return None, "已停用的硬约束不能设为默认"
    # 唯一默认：先清空所有默认
    await db.execute(
        sa.update(RewriteHardConstraint)
        .where(RewriteHardConstraint.is_default == 1)
        .values(is_default=0, updated_at=_now(), updated_by=updated_by)
    )
    row.is_default = 1
    row.updated_at = _now()
    row.updated_by = updated_by
    await db.commit()
    await db.refresh(row)
    return _to_dict(row), ""


async def ensure_rewrite_hard_constraints_seeded(db: AsyncSession) -> None:
    """启动时幂等播种：按 id 存在即跳过（不覆盖用户修改）。"""
    for seed in SEED_HARD_CONSTRAINTS:
        existing = await db.get(RewriteHardConstraint, seed["id"])
        if existing is not None:
            continue
        row = RewriteHardConstraint(
            id=seed["id"],
            title=seed["title"],
            content=seed["content"],
            description=seed.get("description", ""),
            is_default=seed.get("is_default", 0),
            enabled=1,
            created_at=_now(),
            updated_at=_now(),
            updated_by="seed",
        )
        db.add(row)
        try:
            await db.commit()
        except IntegrityError:
            await db.rollback()
