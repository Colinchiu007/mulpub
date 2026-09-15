"""Pipeline option control service (2026-08-31) — 视频创作流水线选项显示/隐藏与默认值 CRUD。"""
import datetime
import json
import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession
from models import PipelineOption

OPTION_GROUPS = ("basic", "visual", "videoEnhance", "voice", "advanced", "publish")
VALID_KEY_RE = __import__("re").compile(r"^[a-z]+\.[a-zA-Z_][a-zA-Z0-9_]*$")

def _now() -> str:
    return datetime.datetime.utcnow().isoformat() + "Z"

def _validate_option_key(key: str) -> None:
    if not VALID_KEY_RE.match(key):
        raise ValueError(f"option_key 格式错误，需为 group.field 格式（如 basic.speechRate），收到: {key}")
    group = key.split(".")[0]
    if group not in OPTION_GROUPS:
        raise ValueError(f"option_key 的 group 必须为 {OPTION_GROUPS} 之一，收到: {group}")


def _reject_nonfinite_constant(name: str):
    """json.loads 的 parse_constant 钩子：裸 NaN/Infinity/-Infinity 字面量一律拒绝。

    D-7.3 背景：这类字面量被 Python json 默认放行 → 落库后 bootstrap 时 json.loads
    产出 float('nan') → canonical_json 输出裸 NaN（非法 JSON）→ 桌面端整包丢弃
    bootstrap，内容安全等全部运行时策略随之失效且运营端零告警。
    """
    raise ValueError(f"default_value 含非法数值字面量（{name}），禁止写入")


def _validate_default_value(value: str) -> None:
    """写入侧守卫：default_value 允许任意字符串，但含裸 NaN/Infinity 字面量（含嵌套）时拒绝。"""
    try:
        json.loads(value, parse_constant=_reject_nonfinite_constant)
    except ValueError as e:
        if "非法数值字面量" in str(e):
            raise
        # 其余 ValueError 是普通 JSON 语法错误——default_value 允许任意字符串，放行
    except (TypeError, RecursionError):
        pass

async def list_options(db: AsyncSession) -> list[dict]:
    result = await db.execute(
        sa.select(PipelineOption).order_by(PipelineOption.sort_order, PipelineOption.option_key)
    )
    rows = result.scalars().all()
    return [_option_to_dict(r) for r in rows]

async def upsert_options(db: AsyncSession, items: list[dict], updated_by: str = "") -> list[dict]:
    saved = []
    for item in items:
        key = str(item.get("option_key", "")).strip()
        if not key:
            raise ValueError("option_key 不能为空")
        _validate_option_key(key)
        parts = key.split(".", 1)
        group = parts[0]
        field = parts[1]
        label = str(item.get("label", "")).strip()
        visible = 1 if item.get("visible") in (True, 1, "1", "true") else 0
        default_value = str(item.get("default_value", "") or "")
        _validate_default_value(default_value)
        description = str(item.get("description", "")).strip()
        sort_order = int(item.get("sort_order", 0) or 0)

        result = await db.execute(
            sa.select(PipelineOption).where(PipelineOption.option_key == key)
        )
        row = result.scalar_one_or_none()
        now = _now()
        if row:
            row.group = group
            row.field = field
            row.label = label
            row.visible = visible
            row.default_value = default_value
            row.description = description
            row.sort_order = sort_order
            row.updated_at = now
            row.updated_by = updated_by
        else:
            row = PipelineOption(
                option_key=key,
                group=group,
                field=field,
                label=label,
                visible=visible,
                default_value=default_value,
                description=description,
                sort_order=sort_order,
                updated_at=now,
                updated_by=updated_by,
            )
            db.add(row)
        saved.append(row)
    await db.commit()
    return [_option_to_dict(r) for r in saved]

async def get_bootstrap_options(db: AsyncSession) -> dict:
    result = await db.execute(
        sa.select(PipelineOption).order_by(PipelineOption.sort_order, PipelineOption.option_key)
    )
    rows = result.scalars().all()
    visibility = {}
    defaults = {}
    for r in rows:
        visibility[r.option_key] = bool(r.visible)
        if r.default_value:
            try:
                # D-7.3 下发侧守卫：parse_constant 拒绝裸 NaN/Infinity——历史脏行
                # （守卫生效前落库）降级为原字符串下发，绝不产出非有限浮点。
                defaults[r.option_key] = json.loads(
                    r.default_value, parse_constant=_reject_nonfinite_constant
                )
            except (json.JSONDecodeError, TypeError, ValueError, RecursionError):
                defaults[r.option_key] = r.default_value
    return {"visibility": visibility, "defaults": defaults}

def _option_to_dict(row: PipelineOption) -> dict:
    return {
        "id": row.id,
        "option_key": row.option_key,
        "group": row.group,
        "field": row.field,
        "label": row.label,
        "visible": bool(row.visible),
        "default_value": row.default_value,
        "description": row.description,
        "sort_order": row.sort_order,
        "updated_at": row.updated_at,
        "updated_by": row.updated_by,
    }