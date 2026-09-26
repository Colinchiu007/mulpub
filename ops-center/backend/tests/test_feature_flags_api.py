"""Tests for ops-center 桌面端功能开关管理与运行时下发。"""
import os
import sys
import tempfile
import uuid

import pytest
import pytest_asyncio

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

_RUN_ID = uuid.uuid4().hex[:8]
os.environ["OPS_DB_PATH"] = os.path.join(tempfile.gettempdir(), f"ops_feature_flags_{_RUN_ID}.db")
os.environ["OPS_CONFIG_OUTPUT_DIR"] = os.path.join(tempfile.gettempdir(), f"ops_ff_configs_{_RUN_ID}")
os.environ["OPS_SECRET_KEY"] = "test-secret"
os.environ["OPS_JWT_SECRET"] = "test-secret"
os.environ["OPS_CATALOG_API_KEY"] = "catalog-test-key"

import models  # noqa: F401
from config import settings


@pytest_asyncio.fixture(autouse=True)
async def setup_db():
    from database import engine, Base, async_session
    from services.feature_flag_service import ensure_feature_flags_seeded

    settings.catalog_api_key = os.environ.get("OPS_CATALOG_API_KEY", "catalog-test-key")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with async_session() as db:
        await ensure_feature_flags_seeded(db)
    yield
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


def _client():
    from httpx import AsyncClient, ASGITransport
    from main import app

    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


def _admin_headers():
    from datetime import datetime, timedelta, timezone
    from jose import jwt

    payload = {"sub": "admin", "username": "admin", "role": "admin", "exp": datetime.now(timezone.utc) + timedelta(hours=1)}
    token = jwt.encode(payload, settings.get_jwt_secret(), algorithm=settings.jwt_algorithm)
    return {"Authorization": f"Bearer {token}"}


def _normal_headers():
    from datetime import datetime, timedelta, timezone
    from jose import jwt

    payload = {"sub": "u1", "username": "u1", "role": "user", "exp": datetime.now(timezone.utc) + timedelta(hours=1)}
    token = jwt.encode(payload, settings.get_jwt_secret(), algorithm=settings.jwt_algorithm)
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_feature_flags_crud_seed_and_validation():
    async with _client() as client:
        h = _admin_headers()
        # 种子存在（4K 能力开关默认 1080p）
        lst = (await client.get("/api/v1/feature-flags", headers=h)).json()
        keys = [i["key"] for i in lst["items"]]
        assert "videoCreation.maxOutputResolution" in keys

        # 创建（string / boolean / number）
        r = await client.post("/api/v1/feature-flags", json={
            "key": "story2video.allow4k", "value_type": "boolean", "value": "true",
            "description": "测试开关", "enabled": True,
        }, headers=h)
        assert r.status_code == 200, r.text
        assert r.json()["typed_value"] is True

        r = await client.post("/api/v1/feature-flags", json={
            "key": "compose.maxSegments", "value_type": "number", "value": "12", "enabled": True,
        }, headers=h)
        assert r.status_code == 200 and r.json()["typed_value"] == 12

        # 校验：key 字符集 / value_type 枚举 / value 类型
        assert (await client.post("/api/v1/feature-flags", json={"key": "BAD KEY", "value_type": "string"}, headers=h)).status_code == 400
        assert (await client.post("/api/v1/feature-flags", json={"key": "a.b", "value_type": "weird"}, headers=h)).status_code == 400
        assert (await client.post("/api/v1/feature-flags", json={"key": "a.b", "value_type": "boolean", "value": "banana"}, headers=h)).status_code == 400
        assert (await client.post("/api/v1/feature-flags", json={"key": "a.b", "value_type": "number", "value": "x"}, headers=h)).status_code == 400

        # 校验边界：非有限数字 / 超长 value / 保留键名
        assert (await client.post("/api/v1/feature-flags", json={"key": "a.inf", "value_type": "number", "value": "9" * 400 + ".0"}, headers=h)).status_code == 400
        assert (await client.post("/api/v1/feature-flags", json={"key": "a.long", "value_type": "string", "value": "x" * 600}, headers=h)).status_code == 400
        assert (await client.post("/api/v1/feature-flags", json={"key": "__proto__", "value_type": "string", "value": "x"}, headers=h)).status_code == 400
        # 数字格式一致性：科学计数法可解析（前后端一致）
        r = await client.post("/api/v1/feature-flags", json={"key": "a.exp", "value_type": "number", "value": "1e3", "enabled": True}, headers=h)
        assert r.status_code == 200 and r.json()["typed_value"] == 1000
        r = await client.post("/api/v1/feature-flags", json={"key": "a.float", "value_type": "number", "value": "3.5", "enabled": True}, headers=h)
        assert r.status_code == 200 and r.json()["typed_value"] == 3.5
        r = await client.post("/api/v1/feature-flags", json={"key": "a.small", "value_type": "number", "value": "1e-3", "enabled": True}, headers=h)
        assert r.status_code == 200 and r.json()["typed_value"] == 0.001
        # 非十进制格式（hex/下划线）→ 400（前后端一致）
        assert (await client.post("/api/v1/feature-flags", json={"key": "a.hex", "value_type": "number", "value": "0x1f"}, headers=h)).status_code == 400
        assert (await client.post("/api/v1/feature-flags", json={"key": "a.under", "value_type": "number", "value": "1_000"}, headers=h)).status_code == 400
        # value 长度边界：512 接受 / 513 拒绝
        assert (await client.post("/api/v1/feature-flags", json={"key": "a.len512", "value_type": "string", "value": "x" * 512}, headers=h)).status_code == 200
        assert (await client.post("/api/v1/feature-flags", json={"key": "a.len513", "value_type": "string", "value": "x" * 513}, headers=h)).status_code == 400
        # PUT 修改 value_type 但值不兼容 → 400
        r = await client.post("/api/v1/feature-flags", json={"key": "a.typechange", "value_type": "string", "value": "hello", "enabled": True}, headers=h)
        assert r.status_code == 200
        assert (await client.put("/api/v1/feature-flags/a.typechange", json={"value_type": "boolean", "value": "notabool"}, headers=h)).status_code == 400

        # POST 重复 key → 409
        assert (await client.post("/api/v1/feature-flags", json={"key": "videoCreation.maxOutputResolution", "value_type": "string", "value": "4k"}, headers=h)).status_code == 409

        # PUT 部分更新（value/enabled）
        r = await client.put("/api/v1/feature-flags/videoCreation.maxOutputResolution", json={"value": "4k"}, headers=h)
        assert r.status_code == 200 and r.json()["value"] == "4k"

        # PUT body 携带 key 被忽略（key 不可变，路径参数优先）
        r = await client.put("/api/v1/feature-flags/videoCreation.maxOutputResolution", json={"key": "renamed", "value": "1080p"}, headers=h)
        assert r.status_code == 200 and r.json()["key"] == "videoCreation.maxOutputResolution"

        # PUT 不存在 → 404；DELETE 不存在 → 404
        assert (await client.put("/api/v1/feature-flags/nope", json={"value": "1"}, headers=h)).status_code == 404
        assert (await client.delete("/api/v1/feature-flags/nope", headers=h)).status_code == 404

        # 权限：非 admin 写 403 / 读 200
        assert (await client.post("/api/v1/feature-flags", json={"key": "x", "value_type": "string"}, headers=_normal_headers())).status_code == 403
        assert (await client.get("/api/v1/feature-flags", headers=_normal_headers())).status_code == 200


@pytest.mark.asyncio
async def test_feature_flags_runtime_bootstrap():
    async with _client() as client:
        h = _admin_headers()
        # 打开 4K → bootstrap 下发 "4k"
        await client.put("/api/v1/feature-flags/videoCreation.maxOutputResolution", json={"value": "4k"}, headers=h)
        r = await client.get("/api/v1/runtime/bootstrap", headers={"X-Catalog-Key": "catalog-test-key"})
        assert r.status_code == 200
        data = r.json()
        assert data["feature_flags"]["videoCreation.maxOutputResolution"] == "4k"

        # 停用 → bootstrap 不含
        await client.put("/api/v1/feature-flags/videoCreation.maxOutputResolution", json={"enabled": False}, headers=h)
        data2 = (await client.get("/api/v1/runtime/bootstrap", headers={"X-Catalog-Key": "catalog-test-key"})).json()
        assert "videoCreation.maxOutputResolution" not in data2["feature_flags"]

        # 删除后重建种子 key 可再创建
        await client.delete("/api/v1/feature-flags/videoCreation.maxOutputResolution", headers=h)
        r = await client.post("/api/v1/feature-flags", json={
            "key": "videoCreation.maxOutputResolution", "value_type": "string", "value": "1080p",
            "description": "重建", "enabled": True,
        }, headers=h)
        assert r.status_code == 200


@pytest.mark.asyncio
async def test_feature_flags_count_cap():
    from services.feature_flag_service import MAX_FEATURE_FLAGS, SEED_FLAGS
    async with _client() as client:
        h = _admin_headers()
        # 种子占 len(SEED_FLAGS) 个名额：余量填满后达到上限
        # （历史写法硬编码「种子占 1 个」，新增任何一枚种子都会让本用例假红——名额必须由种子清单推导）
        for i in range(MAX_FEATURE_FLAGS - len(SEED_FLAGS)):
            r = await client.post("/api/v1/feature-flags", json={"key": f"cap.{i}", "value_type": "string", "value": "v"}, headers=h)
            assert r.status_code == 200, r.text
        # 再一个 → 400（避免桌面端 100 项上限静默全丢）
        r = await client.post("/api/v1/feature-flags", json={"key": "cap.overflow", "value_type": "string", "value": "v"}, headers=h)
        assert r.status_code == 400 and "上限" in r.text


@pytest.mark.asyncio
async def test_cloud_sync_flag_seeded_into_existing_deployment():
    """存量部署必须增量补齐新种子（AGENTS.md「跨端目录常量 ↔ 存量数据必须前向兼容」）。

    桌面端按 feature flag 决定【同步云端】按钮显隐；若管理页永远看不到该开关，
    运营只能手敲 key 才能开灰度——「表为空才播种」的供给逻辑对存量部署完全无效。
    本用例从**非空旧状态**出发：先按旧清单种子、删掉新 key、再跑一次供给。
    """
    from services.feature_flag_service import ensure_feature_flags_seeded, list_feature_flags
    import sqlalchemy as sa
    from database import async_session
    from models import FeatureFlag

    new_key = "account_cloud_sync"
    old_key = "videoCreation.maxOutputResolution"

    async with async_session() as db:
        # 模拟存量库：只有旧种子，且运营已把旧种子改成非默认值
        await db.execute(sa.delete(FeatureFlag).where(FeatureFlag.key == new_key))
        existing = (await db.execute(sa.select(FeatureFlag).where(FeatureFlag.key == old_key))).scalar_one()
        existing.value = "4k"
        existing.enabled = 1
        existing.updated_by = "operator"
        await db.commit()

        await ensure_feature_flags_seeded(db)

        flags = {f["key"]: f for f in await list_feature_flags(db)}
        assert new_key in flags, "存量部署必须补齐新种子，否则管理页永远看不到该开关"
        assert flags[new_key]["enabled"] is False, "账号云同步开关必须默认关闭（ADR-0006）"
        assert flags[new_key]["value_type"] == "boolean"
        # 只补不改：覆盖运营配置比缺行更糟
        assert flags[old_key]["value"] == "4k"
        assert flags[old_key]["updated_by"] == "operator"
