"""Config CRUD service."""
import datetime
import logging
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from models import ConfigItem, ConfigAuditLog, Project
from services.key_service import (
    encrypt_secret_value, decrypt_secret_value, is_encrypted, mask_key,
)

logger = logging.getLogger(__name__)


def plaintext_value(item) -> str:
    """P1-5: 取配置项明文值 —— 受管密文解密，存量明文原样返回。

    不可解时**抛错**而不是返回空串：配置导出（file_writer）静默写空凭据比写失败更危险
    （下游服务会拿着空 credential 反复 401，且掩盖密钥轮换事故）。
    """
    stored = item.value or ""
    if not getattr(item, "is_secret", 0) or not is_encrypted(stored):
        return stored
    try:
        return decrypt_secret_value(stored)
    except Exception as e:
        raise ValueError(
            f"[P1-5] 配置项 {item.id} 的密文不可解（OPS_ENCRYPTION_KEY 已轮换？），"
            f"请在运维中心重新录入该值。原因: {type(e).__name__}"
        ) from e


def audit_display_value(secret_flag, plaintext: str) -> str:
    """P1-5: 审计落库值 —— 敏感项只存掩码，明文绝不进 config_audit_log（掩码在写库时完成）。"""
    if not secret_flag or not plaintext:
        return plaintext or ""
    return mask_key(str(plaintext))


async def get_project(session: AsyncSession, code: str) -> Project | None:
    result = await session.execute(select(Project).where(Project.code == code))
    return result.scalar_one_or_none()


async def get_all_projects(session: AsyncSession) -> list[Project]:
    result = await session.execute(select(Project).order_by(Project.code))
    return list(result.scalars().all())


async def get_config(session: AsyncSession, config_id: str) -> ConfigItem | None:
    result = await session.execute(select(ConfigItem).where(ConfigItem.id == config_id))
    return result.scalar_one_or_none()


async def get_configs_by_project(session: AsyncSession, project_code: str, category: str | None = None) -> list[ConfigItem]:
    stmt = select(ConfigItem).where(ConfigItem.project_code == project_code)
    if category:
        stmt = stmt.where(ConfigItem.category == category)
    stmt = stmt.order_by(ConfigItem.key)
    result = await session.execute(stmt)
    return list(result.scalars().all())


async def get_configs_by_category(session: AsyncSession, category: str) -> list[ConfigItem]:
    result = await session.execute(
        select(ConfigItem).where(ConfigItem.category == category).order_by(ConfigItem.project_code, ConfigItem.key)
    )
    return list(result.scalars().all())


async def get_configs_by_ids(session: AsyncSession, config_ids: list[str]) -> dict[str, ConfigItem]:
    """按主键批量预取，避免逐条 SELECT（N+1）。"""
    ids = [i for i in config_ids if i]
    if not ids:
        return {}
    result = await session.execute(select(ConfigItem).where(ConfigItem.id.in_(ids)))
    return {row.id: row for row in result.scalars().all()}


async def get_config_counts_by_project(session: AsyncSession) -> dict[str, int]:
    """一次 GROUP BY 统计各项目配置条数（替代逐项目 COUNT/SELECT 的 N+1）。"""
    result = await session.execute(
        select(ConfigItem.project_code, func.count(ConfigItem.id)).group_by(ConfigItem.project_code)
    )
    return {str(code): int(count) for code, count in result.all()}


async def get_secret_flags(session: AsyncSession, config_ids: list[str]) -> dict[str, bool]:
    """批量取 is_secret 标记，供审计日志掩码使用（替代逐行回查）。"""
    ids = [i for i in config_ids if i]
    if not ids:
        return {}
    result = await session.execute(select(ConfigItem.id, ConfigItem.is_secret).where(ConfigItem.id.in_(ids)))
    return {str(cid): bool(flag) for cid, flag in result.all()}


def _apply_upsert(
    session: AsyncSession,
    existing: ConfigItem | None,
    config_id: str,
    project_code: str,
    category: str,
    key: str,
    value: str,
    value_type: str,
    description: str,
    is_secret: int,
    is_required: int,
    default_value: str,
    updated_by: str,
    now: str,
) -> tuple[ConfigItem, str, str, str]:
    """在 session 内落一条 upsert（不提交），返回 (item, audit_old, audit_new, change_type)。

    P1-5 语义在此单点化：敏感项**写库前加密**、客户端回填的掩码回显值不覆盖真实凭据、
    审计日志只存掩码。单条接口与批量接口必须共用本函数 —— 批量路径若绕开它，等于给
    敏感配置留了一个「明文进库」的后门（PUT /config/batch 正是不传 is_secret 的入口）。

    ``plaintext_value`` 对不可解密文会抛错：批量场景下这意味着整批回滚，属有意 fail-closed
    （审计掩码必须读旧明文，读不出来就不能写）。
    """
    if existing:
        # 是否敏感以**库中既有标记**为准；批量接口不传 is_secret，以入参为准会把敏感项降级成明文
        secret_flag = int(existing.is_secret or 0) or int(is_secret or 0)
        old_plain = plaintext_value(existing)
        new_plain = value or ""
        # 客户端回填掩码显示值（含 "***"）→ 视为未变更，避免掩码串覆盖真实凭据（同 OfficialKey C2 范式）
        if secret_flag and "***" in new_plain and new_plain != old_plain:
            logger.info(f"[P1-5] {config_id}: 提交了掩码回显值，保留原凭据不覆盖")
            new_plain = old_plain
            stored_value = existing.value
        else:
            stored_value = encrypt_secret_value(new_plain) if secret_flag else new_plain
        existing.value = stored_value
        existing.is_secret = secret_flag
        existing.updated_at = now
        existing.updated_by = updated_by
        return (
            existing,
            audit_display_value(secret_flag, old_plain),
            audit_display_value(secret_flag, new_plain),
            "update",
        )
    item = ConfigItem(
        id=config_id,
        project_code=project_code,
        category=category,
        key=key,
        value=encrypt_secret_value(value) if int(is_secret or 0) else value,
        value_type=value_type,
        description=description,
        is_secret=is_secret,
        is_required=is_required,
        default_value=default_value,
        created_at=now,
        updated_at=now,
        updated_by=updated_by,
    )
    session.add(item)
    return item, "", audit_display_value(is_secret, value or ""), "create"


async def upsert_config(
    session: AsyncSession,
    config_id: str,
    project_code: str,
    category: str,
    key: str,
    value: str,
    value_type: str = "string",
    description: str = "",
    is_secret: int = 0,
    is_required: int = 0,
    default_value: str = "",
    updated_by: str = "",
    commit: bool = True,
) -> ConfigItem:
    """Create or update a config item. Returns the item.

    ``commit=False`` 只 flush 不提交，供 ``batch_upsert_configs`` 把整批写入
    收进同一个事务（单条接口默认仍自行提交，行为不变）。
    """
    existing = await get_config(session, config_id)
    now = datetime.datetime.utcnow().isoformat()

    item, audit_old, audit_new, change_type = _apply_upsert(
        session, existing, config_id, project_code, category, key, value,
        value_type, description, is_secret, is_required, default_value, updated_by, now,
    )

    # Audit log
    audit = ConfigAuditLog(
        config_id=config_id,
        old_value=audit_old,
        new_value=audit_new,
        changed_by=updated_by,
        changed_at=now,
        change_type=change_type,
    )
    session.add(audit)
    if not commit:
        await session.flush()
        return item
    await session.commit()
    await session.refresh(item)
    return item


async def batch_upsert_configs(
    session: AsyncSession,
    payloads: list[dict[str, Any]],
    updated_by: str = "",
) -> list[ConfigItem]:
    """整批单事务写入：全部成功才提交，任一条异常则整体回滚。

    旧实现是「逐条 upsert_config」，每条一次 SELECT + 一次 COMMIT：中途失败会留下
    「前半已生效、后半未写入」的半更新状态，且配置写库与审计日志不成套。
    现在按主键批量预取（1 次 SELECT）+ 单次 COMMIT，异常统一 rollback 后上抛。

    写入语义与单条接口完全一致（共用 ``_apply_upsert``）：敏感项加密入库、掩码回显不覆盖
    真实凭据、审计落库的是掩码值。批量接口不传 is_secret，因此敏感判定取库中既有标记。
    """
    if not payloads:
        return []
    now = datetime.datetime.utcnow().isoformat()
    ids = [str(p.get("config_id") or "") for p in payloads]
    existing_map = await get_configs_by_ids(session, ids)
    items: list[ConfigItem] = []
    try:
        for p in payloads:
            config_id = str(p.get("config_id") or "")
            item, audit_old, audit_new, change_type = _apply_upsert(
                session,
                existing_map.get(config_id),
                config_id,
                str(p.get("project_code") or ""),
                str(p.get("category") or ""),
                str(p.get("key") or ""),
                str(p.get("value") or ""),
                str(p.get("value_type") or "string"),
                str(p.get("description") or ""),
                int(p.get("is_secret") or 0),
                int(p.get("is_required") or 0),
                str(p.get("default_value") or ""),
                updated_by,
                now,
            )
            session.add(ConfigAuditLog(
                config_id=config_id,
                old_value=audit_old,
                new_value=audit_new,
                changed_by=updated_by,
                changed_at=now,
                change_type=change_type,
            ))
            items.append(item)
        await session.commit()
    except Exception:
        await session.rollback()
        logger.exception("batch_upsert_configs 失败，已整批回滚（%d 条）", len(payloads))
        raise
    return items


async def get_audit_logs(
    session: AsyncSession,
    config_id: str | None = None,
    limit: int = 100,
    offset: int = 0,
) -> list[ConfigAuditLog]:
    stmt = select(ConfigAuditLog).order_by(ConfigAuditLog.changed_at.desc())
    if config_id:
        stmt = stmt.where(ConfigAuditLog.config_id == config_id)
    stmt = stmt.offset(offset).limit(limit)
    result = await session.execute(stmt)
    return list(result.scalars().all())
