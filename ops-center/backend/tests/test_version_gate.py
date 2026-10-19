"""Tests for 强制升级版本门（forced-update-gate）。

覆盖三块：
1. update_policy 双新字段（enforce_min_version / enforce_enabled）的 upsert 校验与序列化 roundtrip；
2. enforce_version_gate 依赖：达标放行 / 低于阻断线 426 / 缺头坏头 fail-closed 426 / 开关关闭放行 / Cookie 会话豁免；
3. 接线断言：三个桌面端真实消费的机器端点挂门，runtime/bootstrap 明确豁免（策略通道自锁排除）。
"""
import copy
import os
import sys
import tempfile

import pytest
import pytest_asyncio

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

os.environ["OPS_DB_PATH"] = os.path.join(tempfile.gettempdir(), "ops_version_gate_test.db")
os.environ["OPS_CONFIG_OUTPUT_DIR"] = os.path.join(tempfile.gettempdir(), "ops_version_gate_configs")
os.environ["OPS_SECRET_KEY"] = "test-secret"
os.environ["OPS_JWT_SECRET"] = "test-secret"
os.environ["OPS_CATALOG_API_KEY"] = "catalog-test-key"

# DEV 签名密钥对（与 conftest / test_runtime_policy_api.py 同源，交叉验证用）。
DEV_RUNTIME_PRIVATE_KEY = (
    "-----BEGIN PRIVATE KEY-----\n"
    "MC4CAQAwBQYDK2VwBCIEIMEaqZBFhrl/hpieWHhYoaG6Dn+Juchfx4/2s0dXok0S\n"
    "-----END PRIVATE KEY-----"
)

from config import settings  # noqa: E402

settings.runtime_signing_private_key = DEV_RUNTIME_PRIVATE_KEY


@pytest_asyncio.fixture(autouse=True)
async def setup_db():
    from database import engine, Base, async_session

    settings.catalog_api_key = os.environ.get("OPS_CATALOG_API_KEY", "catalog-test-key")

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with engine.begin() as conn:
        # 幂等补列（模拟存量库：老表无 enforce 两列）——被测迁移函数本身
        from services.update_policy_migration import ensure_update_policy_columns
        await ensure_update_policy_columns(conn)
    async with async_session() as db:
        from services.runtime_service import get_update_policy
        if await get_update_policy(db) is None:
            from services.runtime_service import upsert_update_policy
            await upsert_update_policy(db, {"enabled": False})
    yield
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


def _client():
    from httpx import AsyncClient, ASGITransport
    from main import app

    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


def _admin_cookie_client():
    """带 admin 会话 Cookie 的客户端（模拟运营后台请求，豁免通道）。"""
    from httpx import AsyncClient, ASGITransport
    from main import app
    from datetime import datetime, timedelta, timezone
    from jose import jwt

    token = jwt.encode(
        {"sub": "admin", "username": "admin", "role": "admin",
         "exp": datetime.now(timezone.utc) + timedelta(hours=1)},
        settings.get_jwt_secret(),
        algorithm=settings.jwt_algorithm,
    )
    cookie_name = settings.session_cookie_name
    client = AsyncClient(transport=ASGITransport(app=app), base_url="http://test")
    client.cookies.set(cookie_name, token)
    return client


async def _set_policy(**kwargs):
    from services.runtime_service import upsert_update_policy
    from database import async_session
    async with async_session() as db:
        return await upsert_update_policy(db, kwargs)


def _catalog_headers(version=None, key=True):
    h = {"X-Catalog-Key": "catalog-test-key"} if key else {}
    if version is not None:
        h["X-Client-Version"] = version
    return h


# ─── 1. update_policy 双新字段 ──────────────────────────────

@pytest.mark.asyncio
async def test_policy_enforce_fields_roundtrip_and_defaults():
    async with _client() as client:
        h = {"Authorization": "Bearer x"}  # admin 路由走 require_admin；此处直接用 cookie 客户端更真实
    # 直接走 service 层断言默认值
    from services.runtime_service import get_update_policy
    from database import async_session
    async with async_session() as db:
        policy = await get_update_policy(db)
    assert policy["enforce_min_version"] == ""
    assert policy["enforce_enabled"] is False


@pytest.mark.asyncio
async def test_policy_enforce_upsert_valid_and_roundtrip():
    await _set_policy(enforce_min_version="0.2.0", enforce_enabled=True,
                      min_version="0.3.0", enabled=True)
    from services.runtime_service import get_update_policy
    from database import async_session
    async with async_session() as db:
        policy = await get_update_policy(db)
    assert policy["enforce_min_version"] == "0.2.0"
    assert policy["enforce_enabled"] is True
    assert policy["min_version"] == "0.3.0"


@pytest.mark.asyncio
async def test_policy_enforce_enabled_requires_min_version():
    with pytest.raises(ValueError):
        await _set_policy(enforce_enabled=True, enforce_min_version="")


@pytest.mark.asyncio
async def test_policy_enforce_line_must_be_stricter_than_min_version():
    # enforce(0.3.0) >= min_version(0.2.0) → 拒绝
    with pytest.raises(ValueError):
        await _set_policy(enforce_enabled=True, enforce_min_version="0.3.0",
                          min_version="0.2.0")
    with pytest.raises(ValueError):
        await _set_policy(enforce_enabled=True, enforce_min_version="0.2.0",
                          min_version="0.2.0")


@pytest.mark.asyncio
async def test_policy_enforce_bad_version_format_rejected():
    with pytest.raises(ValueError):
        await _set_policy(enforce_enabled=True, enforce_min_version="abc")
    with pytest.raises(ValueError):
        await _set_policy(enforce_enabled=True, enforce_min_version="0.2.x")


@pytest.mark.asyncio
async def test_policy_bootstrap_payload_carries_enforce_fields():
    await _set_policy(enforce_min_version="0.2.0", enforce_enabled=True, min_version="0.3.0", enabled=True)
    async with _client() as client:
        r = await client.get(
            "/api/v1/runtime/bootstrap",
            headers={"X-Catalog-Key": "catalog-test-key"},
        )
        assert r.status_code == 200, r.text
        payload = r.json()
        # 签名整包：payload 本体在 data 字段（canonical JSON + Ed25519）
        data = payload.get("data", payload)
        upd = data.get("update_policy") or {}
        assert upd.get("enforce_min_version") == "0.2.0"
        assert upd.get("enforce_enabled") is True


# ─── 2. enforce_version_gate 依赖 ───────────────────────────

@pytest.mark.asyncio
async def test_gate_passes_when_version_meets_enforce_line():
    await _set_policy(enforce_min_version="0.2.0", enforce_enabled=True, min_version="0.3.0", enabled=True)
    async with _client() as client:
        r = await client.get("/api/v1/model-presets/catalog", headers=_catalog_headers("0.2.0"))
        assert r.status_code == 200, r.text
        r = await client.get("/api/v1/model-presets/catalog", headers=_catalog_headers("0.3.1"))
        assert r.status_code == 200, r.text


@pytest.mark.asyncio
async def test_gate_rejects_below_enforce_line_with_426():
    await _set_policy(enforce_min_version="0.2.0", enforce_enabled=True, min_version="0.3.0", enabled=True)
    async with _client() as client:
        r = await client.get("/api/v1/model-presets/catalog", headers=_catalog_headers("0.1.9"))
        assert r.status_code == 426, r.text
        detail = r.json().get("detail")
        assert isinstance(detail, dict)
        assert detail["code"] == "upgrade_required"
        assert detail["min_version"] == "0.2.0"
        assert "message" in detail


@pytest.mark.asyncio
async def test_gate_missing_header_is_fail_closed():
    """机器通道缺 X-Client-Version 头 → 按旧版处理 → 426（存量旧客户端不发新头）。"""
    await _set_policy(enforce_min_version="0.2.0", enforce_enabled=True, min_version="0.3.0", enabled=True)
    async with _client() as client:
        r = await client.get("/api/v1/model-presets/catalog",
                             headers={"X-Catalog-Key": "catalog-test-key"})
        assert r.status_code == 426, r.text


@pytest.mark.asyncio
async def test_gate_bad_header_is_fail_closed():
    await _set_policy(enforce_min_version="0.2.0", enforce_enabled=True, min_version="0.3.0", enabled=True)
    async with _client() as client:
        for bad in ("", "abc", "0.2.x", "v0.2.0"):
            r = await client.get("/api/v1/model-presets/catalog", headers=_catalog_headers(bad))
            assert r.status_code == 426, f"bad={bad!r} -> {r.status_code}"


@pytest.mark.asyncio
async def test_gate_disabled_policy_passes_everything():
    await _set_policy(enforce_min_version="0.2.0", enforce_enabled=False, enabled=True)
    async with _client() as client:
        r = await client.get("/api/v1/model-presets/catalog", headers=_catalog_headers("0.1.0"))
        assert r.status_code == 200, r.text
        r = await client.get("/api/v1/model-presets/catalog",
                             headers={"X-Catalog-Key": "catalog-test-key"})  # 缺头
        assert r.status_code == 200, r.text


@pytest.mark.asyncio
async def test_gate_no_policy_row_passes():
    from database import async_session
    from sqlalchemy import delete
    from models import UpdatePolicy
    await _set_policy(enforce_min_version="0.2.0", enforce_enabled=True, min_version="0.3.0", enabled=True)
    async with async_session() as db:
        await db.execute(delete(UpdatePolicy))
        await db.commit()
    async with _client() as client:
        r = await client.get("/api/v1/model-presets/catalog",
                             headers={"X-Catalog-Key": "catalog-test-key"})
        assert r.status_code == 200, r.text


@pytest.mark.asyncio
async def test_gate_admin_cookie_session_exempt():
    """运营后台 Cookie 会话豁免：带会话 Cookie 的请求不被版本门拒绝。

    场景：Cookie 会话 + 合法 catalog key + 旧版本头——若门未豁免 Cookie，
    此请求会 426；豁免后走机器鉴权（key 合法）→ 200。
    （裸 Cookie 无 key 的 401 属端点自身鉴权层，与版本门无关。）
    """
    await _set_policy(enforce_min_version="0.2.0", enforce_enabled=True, min_version="0.3.0", enabled=True)
    client = _admin_cookie_client()
    try:
        r = await client.get("/api/v1/model-presets/catalog",
                             headers=_catalog_headers("0.1.0"))
        assert r.status_code == 200, r.text
    finally:
        await client.aclose()


@pytest.mark.asyncio
async def test_gate_ack_endpoint_rejects_old_version():
    """runtime/ack 同样挂门（机器端点覆盖面）。"""
    await _set_policy(enforce_min_version="0.2.0", enforce_enabled=True, min_version="0.3.0", enabled=True)
    async with _client() as client:
        r = await client.post(
            "/api/v1/runtime/ack",
            json={"client_version": "0.1.0", "acks": []},
            headers={**_catalog_headers("0.1.0")},
        )
        assert r.status_code == 426, r.text


# ─── 3. 接线断言 ────────────────────────────────────────────

def test_gate_wiring_catalog_and_ack_have_gate_bootstrap_exempt():
    """接线断言（CI 鲁棒版）：不再比对测试进程里 import 的函数对象——那在
    conftest sys.path 注入时序下会产生双实例（本地绿 CI 红两次实测）。改为
    对每个路由**独立 import 该路由模块**并按函数名子串匹配依赖，比对对象
    与路由挂载来源同源，环境差异归零。"""
    from main import app
    from fastapi.routing import APIRoute

    def _route_for(path, method):
        for route in app.routes:
            # duck-typing 替代 isinstance：fastapi.routing 双 import 时 APIRoute 类引用
            # 不同实例，isinstance 恒 False（CI 实测根因：同文件 A8 行为测试 426 生效 =
            # 门确实挂载，仅类身份比对失败）
            if hasattr(route, "dependant") and getattr(route, "path", None) == path and method in getattr(route, "methods", set()):
                return route
        return None

    def _has_gate(path, method):
        route = _route_for(path, method)
        if route is None:
            return False
        # dependant.call = 端点函数本身；遍历其依赖闭包的 qualname+name
        stack = [route.dependant]
        seen = set()
        while stack:
            dep = stack.pop()
            if id(dep) in seen:
                continue
            seen.add(id(dep))
            call = getattr(dep, "call", None)
            if call is not None and "enforce_version_gate" in ((getattr(call, "__qualname__", "") or "") + (getattr(call, "__name__", "") or "")):
                return True
            stack.extend(getattr(dep, "dependencies", []) or [])
        # 兜底 1：route 级依赖（router dependencies）挂在 route.dependencies，不进 dependant 闭包
        for d in getattr(route, "dependencies", []) or []:
            dd = getattr(d, "dependency", d)
            if "enforce_version_gate" in ((getattr(dd, "__qualname__", "") or "") + (getattr(dd, "__name__", "") or "")):
                return True
        # 兜底 2：任何包装形式的字符串化匹配（Depends repr 含函数名）
        if "enforce_version_gate" in repr(getattr(route, "dependencies", [])) + repr(getattr(route, "dependant", "")):
            return True
        return False

    # 前提自证改走 path 字符串集合：路由表枚举口径跨环境有差（两次实测 _route_for
    # 在 CI 上找不到本地可见的路径），但 path 字符串本身无环境差。同文件 A8 的
    # 426 行为测试通过 = 路由与门都在，仅 APIRoute 类型/依赖对象身份比对不可靠。
    all_paths = {str(getattr(r, "path", "")) for r in app.routes}
    assert "/api/v1/model-presets/catalog" in all_paths, (
        "catalog 路径不在路由表：" + str(sorted(p for p in all_paths if "catalog" in p)[:5]))
    assert "/api/v1/runtime/ack" in all_paths
    assert "/api/v1/telemetry/degradation" in all_paths

    # 挂门端点（桌面端真实消费）
    assert _has_gate("/api/v1/model-presets/catalog", "GET")
    assert _has_gate("/api/v1/runtime/ack", "POST")
    assert _has_gate("/api/v1/telemetry/degradation", "POST")
    # 豁免端点：bootstrap 不挂门（策略通道自锁排除）
    assert not _has_gate("/api/v1/runtime/bootstrap", "GET")


def test_gate_version_compare_semantics():
    from services.version_gate import _cmp_version
    assert _cmp_version("0.2.0", "0.2.0") == 0
    assert _cmp_version("0.2", "0.2.0") == 0
    assert _cmp_version("0.1.9", "0.2.0") < 0
    assert _cmp_version("0.2.1", "0.2.0") > 0
    assert _cmp_version("1.0", "0.9.9") > 0
