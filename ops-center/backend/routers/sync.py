"""Config file generation and sync endpoints."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from middleware.auth import require_admin
from services import config_service, file_writer

router = APIRouter(prefix="/api/v1/sync", tags=["sync"])


@router.post("/feature-gates")
async def sync_feature_gates(
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_admin),
):
    """Generate feature_gates.yaml from DB and write to disk."""
    items = await config_service.get_configs_by_category(db, "feature_flag")
    if not items:
        raise HTTPException(400, "No feature gates found in database")

    path = file_writer.write_feature_gates(items)
    return {
        "status": "ok",
        "path": path,
        "gates": len(items),
        "message": f"Written {len(items)} feature gates to {path}"
    }

@router.post("/platforms")
async def sync_platforms(
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_admin),
):
    """Generate platforms.yaml from DB platform credentials."""
    items = await config_service.get_configs_by_category(db, "platform_credential")
    if not items:
        raise HTTPException(400, "No platform credentials found in database")
    path = file_writer.write_platforms_yaml(items)
    return {"status": "ok", "path": path, "platforms": len(items)}


@router.post("/{project_code}/params")
async def sync_project_params(
    project_code: str,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_admin),
):
    """Generate project parameter config file."""
    items = await config_service.get_configs_by_project(db, project_code, "project_param")
    if not items:
        raise HTTPException(400, f"No params found for {project_code}")

    project = await config_service.get_project(db, project_code)
    output_path = project.config_file_path if project and project.config_file_path else f"data/configs/{project_code}/params.yaml"
    path = file_writer.write_project_params(project_code, items, output_path)
    return {"status": "ok", "path": path, "params": len(items)}



@router.get("/status")
async def sync_status(
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_admin),
):
    """Check sync status across all projects."""
    projects = await config_service.get_all_projects(db)
    import os
    # 只需要条数，旧实现对每个项目各发一次全表 SELECT（N+1，且把整表配置行读进内存）。
    # 改为一次 GROUP BY 统计，2 条 SQL 覆盖全部项目。
    counts = await config_service.get_config_counts_by_project(db)
    result = []
    for p in projects:
        file_exists = os.path.exists(p.config_file_path) if p.config_file_path else False
        result.append({
            "project": p.code,
            "config_file": p.config_file_path,
            "file_exists": file_exists,
            "items_in_db": int(counts.get(p.code, 0)),
        })
    return {"projects": result}
