"""Config CRUD service."""
import datetime
import logging
from sqlalchemy import select
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
) -> ConfigItem:
    """Create or update a config item. Returns the item."""
    existing = await get_config(session, config_id)
    now = datetime.datetime.utcnow().isoformat()

    if existing:
        # P1-5: 敏感项写库前加密。是否敏感以**库中既有标记**为准，
        # 批量更新接口（PUT /config/batch）不传 is_secret，若以入参为准会把敏感项降级成明文。
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
        change_type = "update"
        item = existing
        audit_old = audit_display_value(secret_flag, old_plain)
        audit_new = audit_display_value(secret_flag, new_plain)
    else:
        audit_old = ""
        audit_new = audit_display_value(is_secret, value or "")
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
        change_type = "create"

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
    await session.commit()
    await session.refresh(item)
    return item


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
