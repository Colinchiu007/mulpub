"""Tests for pipeline options NaN 守卫（D-7.3）与 bootstrap 载荷卫生。

缺陷链（QA 验证报告 §6.2.5，CSO 独立核验）：
  1. PUT /pipeline-options 的 default_value 原样存字符串（无校验）→ "NaN" 可落库；
  2. bootstrap 时 json.loads 默认放行裸 NaN/Infinity 字面量 → float('nan') 进入 payload；
  3. runtime_service.canonical_json 无 allow_nan=False → 输出裸 NaN（非法 JSON）；
  4. 桌面端 JSON.parse 抛错 → 整包 bootstrap 被丢弃 → 内容安全（content_policy）
     等全部运行时策略随之失效，且运营端零告警。

本文件覆盖三层守卫：写入侧拒绝 / 下发侧降级 / 序列化侧显式失败。
"""
import math
import os
import sys
import tempfile
import uuid

import pytest
import pytest_asyncio

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

_RUN_ID = uuid.uuid4().hex[:8]
os.environ["OPS_DB_PATH"] = os.path.join(tempfile.gettempdir(), f"ops_pn_{_RUN_ID}.db")
os.environ["OPS_CONFIG_OUTPUT_DIR"] = os.path.join(tempfile.gettempdir(), f"ops_pn_cfg_{_RUN_ID}")
os.environ["OPS_SECRET_KEY"] = "test-secret"
os.environ["OPS_JWT_SECRET"] = "test-secret"
os.environ["OPS_CATALOG_API_KEY"] = "catalog-test-key"

import models  # noqa: F401
from config import settings


@pytest_asyncio.fixture(autouse=True)
async def setup_db():
    from database import Base, engine

    settings.catalog_api_key = os.environ.get("OPS_CATALOG_API_KEY", "catalog-test-key")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


# ─── 写入侧：拒绝裸 NaN / Infinity 字面量 ────────────────────


@pytest.mark.asyncio
async def test_upsert_rejects_bare_nan_literal():
    from database import async_session
    from services.pipeline_option_service import upsert_options

    async with async_session() as db:
        with pytest.raises(ValueError, match="NaN"):
            await upsert_options(db, [
                {"option_key": "basic.resolution", "label": "分辨率", "visible": True,
                 "default_value": "NaN", "sort_order": 0},
            ])


@pytest.mark.asyncio
async def test_upsert_rejects_infinity_and_nested_literals():
    from database import async_session
    from services.pipeline_option_service import upsert_options

    async with async_session() as db:
        for bad in ("Infinity", "-Infinity", '{"x": NaN}'):
            with pytest.raises(ValueError, match="非法数值"):
                await upsert_options(db, [
                    {"option_key": "basic.resolution", "label": "分辨率", "visible": True,
                     "default_value": bad, "sort_order": 0},
                ])


@pytest.mark.asyncio
async def test_upsert_allows_plain_strings_and_valid_json():
    """非 JSON 字符串（如分辨率枚举）与合法 JSON 不受影响——守卫只拦非有限数值。"""
    from database import async_session
    from services.pipeline_option_service import upsert_options

    async with async_session() as db:
        saved = await upsert_options(db, [
            {"option_key": "basic.resolution", "label": "分辨率", "visible": True,
             "default_value": "1920x1080", "sort_order": 0},
            {"option_key": "basic.speechRate", "label": "语速", "visible": True,
             "default_value": '{"speed": 1.5}', "sort_order": 1},
        ])
        assert saved[0]["default_value"] == "1920x1080"
        assert saved[1]["default_value"] == '{"speed": 1.5}'


# ─── 下发侧：历史脏数据不得污染 bootstrap payload ────────────


@pytest.mark.asyncio
async def test_bootstrap_options_fallback_for_poisoned_row():
    """已落库的脏行（修复上线前的历史存量）在下发侧降级为原字符串，
    不得产出 float('nan') / float('inf')。"""
    from sqlalchemy import insert

    from database import async_session
    from services.pipeline_option_service import get_bootstrap_options

    async with async_session() as db:
        await db.execute(
            insert(models.PipelineOption).values(
                option_key="advanced.debug", group="advanced", field="debug",
                label="调试", visible=1, default_value='{"x": NaN}',
                description="", sort_order=99, updated_at="2026-09-15T00:00:00Z",
                updated_by="legacy",
            )
        )
        await db.commit()

    async with async_session() as db:
        payload = await get_bootstrap_options(db)

    def _walk(v):
        if isinstance(v, float):
            assert math.isfinite(v), f"payload 含非有限浮点: {v}"
        elif isinstance(v, dict):
            for x in v.values():
                _walk(x)

    _walk(payload)
    # 脏值降级为原字符串下发（桌面端按字符串处理，不再炸解析）
    assert payload["defaults"]["advanced.debug"] == '{"x": NaN}'


# ─── 序列化侧：canonical_json 对非有限浮点显式失败 ────────────


def test_canonical_json_rejects_non_finite():
    from services.runtime_service import canonical_json

    with pytest.raises(ValueError):
        canonical_json({"a": float("nan")})
    with pytest.raises(ValueError):
        canonical_json({"a": float("inf")})


def test_canonical_json_output_unchanged_for_legal_data():
    """合法数据输出必须逐字节不变（Ed25519 签名兼容——改输出 = 全员验签失败）。"""
    from services.runtime_service import canonical_json

    assert canonical_json({"b": 1, "a": "中文"}) == '{"a":"中文","b":1}'
    assert canonical_json({"x": 1.5, "y": True, "z": None}) == '{"x":1.5,"y":true,"z":null}'
    assert canonical_json({"arr": [1, 2, 3]}) == '{"arr":[1,2,3]}'


# ─── API 层：历史脏行存在时 bootstrap 仍可用 ─────────────────


def _client():
    from httpx import ASGITransport, AsyncClient

    from main import app

    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


def _catalog_headers():
    return {"X-Catalog-Key": settings.catalog_api_key}


@pytest.mark.asyncio
async def test_bootstrap_survives_poisoned_pipeline_row():
    """端到端：历史脏行（裸 NaN/Infinity）存在时 bootstrap 仍 200、
    响应体是合法 JSON 且全部数值有限（桌面端可正常解析与验签）。"""
    from sqlalchemy import insert

    from database import async_session

    async with async_session() as db:
        await db.execute(
            insert(models.PipelineOption).values(
                option_key="advanced.debug", group="advanced", field="debug",
                label="调试", visible=1, default_value="Infinity",
                description="", sort_order=99, updated_at="2026-09-15T00:00:00Z",
                updated_by="legacy",
            )
        )
        await db.commit()

    async with _client() as client:
        resp = await client.get("/api/v1/runtime/bootstrap", headers=_catalog_headers())
        assert resp.status_code == 200
        data = resp.json()  # 合法 JSON（裸 NaN 会在此抛错）
        assert "signature" in data

        def _walk(v):
            if isinstance(v, float):
                assert math.isfinite(v), f"payload 含非有限浮点: {v}"
            elif isinstance(v, dict):
                for x in v.values():
                    _walk(x)

        _walk(data)
        # 脏值降级为原字符串下发（桌面端按字符串处理）
        assert data["pipelineOptions"]["defaults"]["advanced.debug"] == "Infinity"
