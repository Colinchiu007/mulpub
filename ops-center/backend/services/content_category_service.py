"""统一内容类别服务（2026-10-03）— 热门选题 / 采集库 / 账号标签 的唯一真源。

跨端契约
--------
CATALOG 的 category_key 与桌面端
`apps/desktop/electron/services/hot-topics/classifier.js` 的 `CATEGORY_KEYS`
严格对齐（键名与顺序），是唯一的跨端契约。桌面端读不到下发值时 fail-open
回退内置 10 类，因此本目录**必须**保持那 10 个 key 不变。

目录供给
--------
`_provision_from_catalog` 在每次读取 / 写入 / 下发前按 CATALOG 补齐缺失行，
采用「只补欠账、不覆盖运营已改字段」语义（与 app_menu_service 同口径）。

为什么不用「表空才播种」：存量部署表非空后旧逻辑永不再写入，新增类别会在
运营端页面永久缺失（feature_flag_service.py:26-28 已记录该陷阱）。

内置类保护
----------
`is_preset=1` 的类别可改名 / 禁用 / 排序，但**不可删除**——删除会让桌面端
历史引用（采集条目 tags、账号分组标签）指向一个不存在的 key。
"""

import datetime
import re

import sqlalchemy as sa
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession

from models import ContentCategory

# 类别标识规则：小写字母开头，仅小写字母/数字/下划线，长度 2-32
CATEGORY_KEY_RE = re.compile(r"^[a-z][a-z0-9_]{1,31}$")

# 上限：防超大 payload 造成桌面端渲染负担（与 app_menu MAX_MENU_ITEMS 同量级）
MAX_CATEGORIES = 50
MAX_NAME_LEN = 20
MAX_DESC_LEN = 200
MAX_SORT_ORDER = 9999

# 内置目录：(key, 默认名, 说明)
# 顺序即默认排序，与桌面端 classifier.js CATEGORY_KEYS 严格一致
CATALOG = (
    ("general", "综合", "未命中其它分类时的兜底分类"),
    ("society", "社会", "民生、法治、事故、就业等社会新闻"),
    ("finance", "财经", "股市、楼市、宏观、公司财报等"),
    ("tech", "科技", "芯片、互联网、数码、航天等（不含 AI，见 ai）"),
    ("ai", "AI", "大模型、AIGC、智能体、算力、AI 应用等"),
    ("entertainment", "娱乐", "明星、影视、综艺、音乐、游戏等"),
    ("sports", "体育", "赛事、球队、运动员等"),
    ("emotion", "情感", "恋爱、婚姻、亲子、家庭关系等"),
    ("education", "教育", "升学、招生、校园、教师等"),
    ("health", "健康", "医疗、疾病、养生、医保等"),
    ("international", "国际", "海外、外交、国际局势等"),
)

CATALOG_KEYS = tuple(key for key, _name, _desc in CATALOG)
CATALOG_MAP = {key: (key, name, desc) for key, name, desc in CATALOG}

REORDER_ACTIONS = ("top", "up", "down", "bottom")


def _now() -> str:
    return datetime.datetime.utcnow().isoformat() + "Z"


def _to_dict(row: ContentCategory) -> dict:
    return {
        "category_key": row.category_key,
        "name": row.name or "",
        "sort_order": row.sort_order or 0,
        "enabled": bool(row.enabled),
        "is_preset": bool(row.is_preset),
        "description": row.description or "",
        "updated_at": row.updated_at,
        "updated_by": row.updated_by or "",
    }


def _validate_key(raw) -> str:
    key = str(raw or "").strip()
    if not key:
        raise ValueError("类别标识不能为空")
    if not CATEGORY_KEY_RE.match(key):
        raise ValueError("类别标识只能由小写字母、数字、下划线组成，且以字母开头，长度 2-32")
    return key


def _validate_name(raw) -> str:
    name = str(raw or "").strip()
    if not name:
        raise ValueError("名称不能为空")
    if len(name) > MAX_NAME_LEN:
        raise ValueError(f"名称不能超过 {MAX_NAME_LEN} 个字符")
    return name


def _validate_sort_order(raw, fallback: int = 0) -> int:
    if raw is None or raw == "":
        return fallback
    if isinstance(raw, bool) or not isinstance(raw, int):
        raise ValueError("排序值必须是非负整数")
    if raw < 0:
        raise ValueError("排序值必须是非负整数")
    return min(raw, MAX_SORT_ORDER)


def _validate_description(raw) -> str:
    desc = str(raw or "").strip()
    if len(desc) > MAX_DESC_LEN:
        raise ValueError(f"备注不能超过 {MAX_DESC_LEN} 个字符")
    return desc


async def _provision_from_catalog(db: AsyncSession) -> None:
    """按目录供给库：补齐目录缺失项（幂等、并发安全）。

    只 flush 不 commit：事务由调用方统一收口，避免「补齐已落盘而后续校验抛错」
    留下部分写入。ON CONFLICT DO NOTHING 防止并发双插打成 IntegrityError。
    """
    existing = set(
        (await db.execute(sa.select(ContentCategory.category_key))).scalars().all()
    )
    rows = []
    for index, (key, name, desc) in enumerate(CATALOG):
        if key in existing:
            continue
        rows.append(
            {
                "category_key": key,
                "name": name,
                "sort_order": index,
                "enabled": 1,
                "is_preset": 1,
                "description": desc,
                "updated_at": _now(),
                "updated_by": "catalog",
            }
        )
    if not rows:
        return
    await db.execute(
        sqlite_insert(ContentCategory)
        .values(rows)
        .on_conflict_do_nothing(index_elements=["category_key"])
    )
    await db.flush()


async def _ordered_rows(db: AsyncSession) -> list[ContentCategory]:
    return list(
        (
            await db.execute(
                sa.select(ContentCategory).order_by(
                    ContentCategory.sort_order, ContentCategory.category_key
                )
            )
        )
        .scalars()
        .all()
    )


async def _get(db: AsyncSession, key: str) -> ContentCategory | None:
    return (
        await db.execute(
            sa.select(ContentCategory).where(ContentCategory.category_key == key)
        )
    ).scalar_one_or_none()


async def list_categories(db: AsyncSession) -> list[dict]:
    await _provision_from_catalog(db)
    rows = await _ordered_rows(db)
    return [_to_dict(r) for r in rows]


async def _count(db: AsyncSession) -> int:
    return (
        await db.execute(sa.select(sa.func.count(ContentCategory.id)))
    ).scalar_one()


async def create_category(db: AsyncSession, body: dict, updated_by: str) -> dict:
    await _provision_from_catalog(db)
    key = _validate_key(body.get("category_key") or body.get("key"))
    name = _validate_name(body.get("name"))
    desc = _validate_description(body.get("description"))

    if await _get(db, key) is not None:
        raise ValueError("类别标识已存在")
    if any(r.name == name for r in await _ordered_rows(db)):
        raise ValueError("名称已存在")
    if await _count(db) >= MAX_CATEGORIES:
        raise ValueError(f"类别数量已达上限 {MAX_CATEGORIES}")

    last_order = max((r.sort_order or 0 for r in await _ordered_rows(db)), default=-1)
    row = ContentCategory(
        category_key=key,
        name=name,
        sort_order=last_order + 1,
        enabled=1,
        is_preset=0,
        description=desc,
        updated_at=_now(),
        updated_by=updated_by or "",
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return _to_dict(row)


async def update_category(db: AsyncSession, key: str, body: dict, updated_by: str) -> dict:
    await _provision_from_catalog(db)
    row = await _get(db, key)
    if row is None:
        raise KeyError(key)

    if "name" in body:
        name = _validate_name(body.get("name"))
        if any(r.name == name and r.category_key != key for r in await _ordered_rows(db)):
            raise ValueError("名称已存在")
        row.name = name
    if "description" in body:
        row.description = _validate_description(body.get("description"))
    if "enabled" in body:
        raw = body.get("enabled")
        if isinstance(raw, bool):
            row.enabled = 1 if raw else 0
        elif isinstance(raw, int) and raw in (0, 1):
            row.enabled = raw
        elif isinstance(raw, str) and raw.strip().lower() in ("true", "1", "false", "0"):
            row.enabled = 1 if raw.strip().lower() in ("true", "1") else 0
        else:
            raise ValueError("enabled 必须是布尔值（true/false/1/0）")
    if "sort_order" in body:
        row.sort_order = _validate_sort_order(body.get("sort_order"), row.sort_order or 0)

    row.updated_at = _now()
    row.updated_by = updated_by or ""
    await db.commit()
    await db.refresh(row)
    return _to_dict(row)


async def delete_category(db: AsyncSession, key: str, updated_by: str) -> bool:
    await _provision_from_catalog(db)
    row = await _get(db, key)
    if row is None:
        raise KeyError(key)
    if row.is_preset:
        raise ValueError("内置类别不可删除，可改为禁用")
    await db.delete(row)
    await db.commit()
    return True


async def reorder_category(db: AsyncSession, key: str, action: str) -> str:
    """单条排序：action ∈ top/up/down/bottom，全列表归一化 0..n-1，边界幂等。

    返回 "changed" | "noop" | "not-found"。
    """
    await _provision_from_catalog(db)
    if action not in REORDER_ACTIONS:
        raise ValueError(f"action 必须是 {'/'.join(REORDER_ACTIONS)} 之一")
    rows = await _ordered_rows(db)
    idx = next((i for i, r in enumerate(rows) if r.category_key == key), None)
    if idx is None:
        return "not-found"

    target = {"top": 0, "up": idx - 1, "down": idx + 1, "bottom": len(rows) - 1}[action]
    target = max(0, min(target, len(rows) - 1))
    if target == idx:
        return "noop"

    moved = rows.pop(idx)
    rows.insert(target, moved)
    now = _now()
    for order, r in enumerate(rows):
        if r.sort_order != order:
            r.sort_order = order
            r.updated_at = now
    await db.commit()
    return "changed"


async def reset_categories(db: AsyncSession, updated_by: str) -> list[dict]:
    """恢复目录默认：只把内置 10 类的名称/说明/排序/启用回退到 CATALOG，自定义类保留。"""
    await _provision_from_catalog(db)
    rows = await _ordered_rows(db)
    now = _now()
    by_key = {r.category_key: r for r in rows}

    preset_order = 0
    for key, name, desc in CATALOG:
        row = by_key.get(key)
        if row is None:
            continue
        row.name = name
        row.description = desc
        row.sort_order = preset_order
        row.enabled = 1
        row.updated_at = now
        row.updated_by = updated_by or ""
        preset_order += 1

    # 自定义类整体排在内置类之后，保持其相对顺序
    for r in rows:
        if not r.is_preset:
            r.sort_order = preset_order
            r.updated_at = now
            r.updated_by = updated_by or ""
            preset_order += 1

    await db.commit()
    return [_to_dict(r) for r in await _ordered_rows(db)]


async def get_bootstrap_content_categories(db: AsyncSession) -> dict:
    """桌面端 runtime bootstrap 下发载荷（只下发 enabled=1）。

    位于 Ed25519 签名覆盖范围内（runtime_service.sign_runtime_payload 对整体
    payload 签名），新增字段不会被篡改。
    """
    await _provision_from_catalog(db)
    rows = await _ordered_rows(db)
    items = [
        {"category_key": r.category_key, "name": r.name, "sort_order": r.sort_order or 0}
        for r in rows
        if r.enabled
    ]
    return {"items": items, "count": len(items), "synced_at": _now()}


async def ensure_content_categories_seeded(db: AsyncSession) -> None:
    """启动时按目录供给（生命周期钩子调用）。"""
    await _provision_from_catalog(db)
    await db.commit()
