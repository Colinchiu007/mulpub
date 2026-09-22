"""Config CRUD API endpoints."""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from middleware.auth import get_current_user, require_admin
from services import config_service, key_service
from models import ConfigItem

router = APIRouter(prefix="/api/v1/config", tags=["config"])


@router.get("/projects")
async def list_projects(
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
):
    """List all registered projects."""
    projects = await config_service.get_all_projects(db)
    return {
        "projects": [
            {"code": p.code, "name": p.name, "description": p.description,
             "config_format": p.config_format, "enabled": bool(p.enabled)}
            for p in projects
        ]
    }


async def _mask_audit_value(db: AsyncSession, config_id: str, value: str) -> str:
    """审计日志值掩码：secret 配置项的 old/new 值不返回明文。"""
    item = await config_service.get_config(db, config_id)
    if item is not None and item.is_secret and value:
        # P1-5: 审计值已在写库时掩码，此处只兜底存量明文行（幂等：已含 *** 不再二次掩码）
        if "***" in value:
            return value
        return value[:4] + "***" + value[-4:] if len(value) > 8 else "***"
    return value


@router.get("/audit-log")
async def get_audit_log(
    config_id: str | None = Query(None),
    limit: int = Query(100, le=500),
    offset: int = Query(0),
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
):
    """Query config change audit log."""
    logs = await config_service.get_audit_logs(db, config_id=config_id, limit=limit, offset=offset)
    result = []
    for log in logs:
        result.append({
            "id": log.id,
            "config_id": log.config_id,
            "old_value": await _mask_audit_value(db, log.config_id, log.old_value),
            "new_value": await _mask_audit_value(db, log.config_id, log.new_value),
            "changed_by": log.changed_by,
            "changed_at": log.changed_at,
            "change_type": log.change_type,
        })
    return {"logs": result}


@router.get("/{project_code}")
async def get_project_config(
    project_code: str,
    category: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
):
    """Get all config items for a project, optionally filtered by category."""
    project = await config_service.get_project(db, project_code)
    if not project:
        raise HTTPException(404, f"Project not found: {project_code}")
    items = await config_service.get_configs_by_project(db, project_code, category)
    return {
        "project": project_code,
        "items": [_item_to_dict(it) for it in items],
        "count": len(items),
    }


@router.get("/{project_code}/{category}/{key}")
async def get_config_item(
    project_code: str,
    category: str,
    key: str,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
):
    """Get a single config item."""
    config_id = f"{project_code}.{category}.{key}"
    item = await config_service.get_config(db, config_id)
    if not item:
        raise HTTPException(404, f"Config not found: {config_id}")
    return _item_to_dict(item)


@router.put("/{project_code}/{category}/{key}")
async def update_config_item(
    project_code: str,
    category: str,
    key: str,
    body: dict,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_admin),
):
    """Create or update a config item."""
    config_id = f"{project_code}.{category}.{key}"
    item = await config_service.upsert_config(
        session=db,
        config_id=config_id,
        project_code=project_code,
        category=category,
        key=key,
        value=str(body.get("value", "")),
        value_type=body.get("value_type", "string"),
        description=body.get("description", ""),
        is_secret=body.get("is_secret", 0),
        is_required=body.get("is_required", 0),
        default_value=str(body.get("default_value", "")),
        updated_by=user.get("username", "unknown"),
    )
    return _item_to_dict(item)


@router.put("/batch")
async def batch_update_config(
    body: dict,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_admin),
):
    """Batch update config items."""
    items_data = body.get("items", [])
    if not items_data:
        raise HTTPException(400, "No items provided")

    results = []
    for item_data in items_data:
        project_code = item_data["project_code"]
        category = item_data["category"]
        key = item_data["key"]
        config_id = f"{project_code}.{category}.{key}"
        item = await config_service.upsert_config(
            session=db,
            config_id=config_id,
            project_code=project_code,
            category=category,
            key=key,
            value=str(item_data.get("value", "")),
            value_type=item_data.get("value_type", "string"),
            updated_by=user.get("username", "unknown"),
        )
        results.append(_item_to_dict(item))

    return {"updated": len(results), "items": results}





def _item_to_dict(item) -> dict:
    """Convert ConfigItem to API response dict."""
    d = {
        "id": item.id,
        "project_code": item.project_code,
        "category": item.category,
        "key": item.key,
        "value_type": item.value_type,
        "description": item.description,
        "is_secret": bool(item.is_secret),
        "is_required": bool(item.is_required),
        "default_value": item.default_value,
        "updated_at": item.updated_at,
        "updated_by": item.updated_by,
    }
    # P1-5: 敏感项库里存密文，掩码必须基于**明文**
    # （对密文取前后缀会泄露 enc:v1: 前缀，且不同明文的密文前后缀无业务含义）
    if item.is_secret and item.value:
        try:
            plain = config_service.plaintext_value(item)
        except ValueError:
            plain = ""
        d["value"] = (plain[:4] + "***" + plain[-4:]) if len(plain) > 8 else "***"
        d["is_masked"] = True
    else:
        d["value"] = item.value
        d["is_masked"] = False
    d["is_encrypted"] = bool(item.is_secret and key_service.is_encrypted(item.value))
    return d
