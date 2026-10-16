"""运行时下发端点鉴权契约锁（harden-runtime-endpoints-auth，2026-10-16）。

**本文件只写「必须成立什么」，背景叙述（为什么曾免鉴权、失效证据、残留）的单一真源在
`openspec/records/harden-runtime-endpoints-auth.md`** —— 2026-10-16 的外部评审（i5）指出同一段
背景被复制到三处 router docstring + 本文件 + `auth_surface.py`，证据一变就要五处同步，
属多源漂移风险，故各处只留指针。摘要：

- 这三个 `GET /<资源>/runtime` 曾以「供 bootstrap 内部组装使用」为由免鉴权；该**理由与事实
  在同一次提交内即已矛盾**（bootstrap 从第一天起就走 `services/runtime_service.py` 的
  service 层直调，不经 HTTP）。
- 收紧后与**同 router 的兄弟读端点**对齐用 `get_current_user`：不用 `require_admin`（那会把
  **读**权限收紧成仅管理员，超出目标），也不用 `verify_bearer_or_catalog_key`（共享密钥面比
  会话面更宽）。
- **`auth_kinds=['session']` 是有意为之，不是遗漏**（外部评审 i6，已裁定成立）：这三个端点
  收紧后**不再对密钥面开放**；M2M 生产者必须走 `GET /api/v1/runtime/bootstrap`
  （`auth=["verify_bearer_or_catalog_key"]`, `kinds=["dual"]`，经 `tests/fixtures/auth-surface.json`
  核对）。这条是预期行为，已写入记录的残留章节。
- 本文件同时补上一个既有覆盖缺口：`rewrite_strategies` 此前**没有任何测试文件**，本文件是它
  的第一个端点级测试。
"""
from __future__ import annotations

import os
import sys
import tempfile
import uuid
from pathlib import Path

import pytest
import pytest_asyncio

BACKEND_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_ROOT))

_RUN_ID = uuid.uuid4().hex[:8]
os.environ["OPS_DB_PATH"] = os.path.join(tempfile.gettempdir(), f"ops_rta_{_RUN_ID}.db")
os.environ["OPS_CONFIG_OUTPUT_DIR"] = os.path.join(tempfile.gettempdir(), f"ops_rta_cfg_{_RUN_ID}")
os.environ["OPS_SECRET_KEY"] = "test-secret"
os.environ["OPS_JWT_SECRET"] = "test-secret"
os.environ["OPS_CATALOG_API_KEY"] = "catalog-test-key"

import models  # noqa: F401,E402
from config import settings  # noqa: E402

# 本次收紧的三个端点：路径 → 响应的形状键（用于「加鉴权没顺手弄坏数据契约」）
RUNTIME_ENDPOINTS = {
    "/api/v1/rewrite-ai-taste/runtime": ("items", "count"),
    "/api/v1/rewrite-hard-constraints/runtime": ("item",),
    "/api/v1/rewrite-strategies/runtime": ("items", "count"),
}


@pytest_asyncio.fixture(autouse=True)
async def setup_db():
    from database import engine, Base, async_session
    from services.rewrite_ai_taste_service import ensure_rewrite_ai_taste_seeded
    from services.rewrite_hard_constraint_service import ensure_rewrite_hard_constraints_seeded
    from services.rewrite_strategy_service import ensure_rewrite_strategies_seeded

    settings.catalog_api_key = os.environ.get("OPS_CATALOG_API_KEY", "catalog-test-key")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with async_session() as db:
        await ensure_rewrite_ai_taste_seeded(db)
        await ensure_rewrite_hard_constraints_seeded(db)
        await ensure_rewrite_strategies_seeded(db)
    yield
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


def _client():
    from httpx import AsyncClient, ASGITransport
    from main import app

    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


def _user_headers():
    """非 admin 的登录会话（role=operator）。"""
    from datetime import datetime, timedelta, timezone
    from jose import jwt

    payload = {
        "sub": "op", "username": "op", "role": "operator",
        "exp": datetime.now(timezone.utc) + timedelta(hours=1),
    }
    token = jwt.encode(payload, settings.get_jwt_secret(), algorithm=settings.jwt_algorithm)
    return {"Authorization": f"Bearer {token}"}


def _admin_headers():
    from datetime import datetime, timedelta, timezone
    from jose import jwt

    payload = {
        "sub": "admin", "username": "admin", "role": "admin",
        "exp": datetime.now(timezone.utc) + timedelta(hours=1),
    }
    token = jwt.encode(payload, settings.get_jwt_secret(), algorithm=settings.jwt_algorithm)
    return {"Authorization": f"Bearer {token}"}


# ── ① 核心：匿名必须被拒 ──────────────────────────────────────────────
@pytest.mark.asyncio
@pytest.mark.parametrize("path", sorted(RUNTIME_ENDPOINTS))
async def test_runtime_endpoint_rejects_anonymous(path):
    """无凭据必须 401，不能再返回 200。

    挡的是：有人把 `Depends(get_current_user)` 删掉（回到「匿名可读」）而没人发现。
    """
    async with _client() as c:
        r = await c.get(path)
    assert r.status_code == 401, f"{path} 匿名应 401，实测 {r.status_code}"


@pytest.mark.asyncio
@pytest.mark.parametrize("path", sorted(RUNTIME_ENDPOINTS))
async def test_runtime_endpoint_rejection_reason_is_missing_credential(path):
    """401 的原因必须是「未提供认证令牌」，不是别的失败被误读成鉴权拦截。"""
    async with _client() as c:
        r = await c.get(path)
    assert r.status_code == 401
    assert r.json()["detail"] == "未提供认证令牌"


@pytest.mark.asyncio
@pytest.mark.parametrize("path", sorted(RUNTIME_ENDPOINTS))
async def test_runtime_endpoint_rejects_forged_bearer(path):
    """伪造令牌必须 401（而不是 500，也不是放行）。"""
    async with _client() as c:
        r = await c.get(path, headers={"Authorization": "Bearer not-a-real-token"})
    assert r.status_code == 401, f"{path} 伪造令牌应 401，实测 {r.status_code}"


# ── ② 权限边界：不得顺手收紧成 admin ─────────────────────────────────
@pytest.mark.asyncio
@pytest.mark.parametrize("path", sorted(RUNTIME_ENDPOINTS))
async def test_runtime_endpoint_allows_logged_in_non_admin(path):
    """非 admin 的登录会话必须 200。

    这条与上一条**成对**才有意义：只测 401 的话，把依赖换成 `require_admin` 也能全绿，
    而那是把「读」权限收紧了（兄弟读端点仍是 `get_current_user`），属越界改动。
    """
    async with _client() as c:
        r = await c.get(path, headers=_user_headers())
    assert r.status_code == 200, f"{path} 登录用户应 200，实测 {r.status_code}"


# ── ③ 数据契约：加鉴权不得改变返回形状 ───────────────────────────────
@pytest.mark.asyncio
@pytest.mark.parametrize("path,keys", sorted(RUNTIME_ENDPOINTS.items()))
async def test_runtime_response_shape_preserved(path, keys):
    """返回体的形状键必须保持（防「加鉴权顺手改坏了下发数据」）。"""
    async with _client() as c:
        r = await c.get(path, headers=_user_headers())
    assert r.status_code == 200
    body = r.json()
    for k in keys:
        assert k in body, f"{path} 缺少形状键 {k}，实测键 {sorted(body)}"


@pytest.mark.asyncio
async def test_ai_taste_runtime_still_includes_disabled_entries():
    """runtime 的存在理由：含 `enabled=0` 条目（桌面端要知道哪些内置词被禁用）。

    这是它与兄弟列表端点的**语义差异**，加鉴权不得把它抹掉。
    """
    from urllib.parse import quote

    async with _client() as c:
        r = await c.get("/api/v1/rewrite-ai-taste", headers=_admin_headers())
        assert r.status_code == 200
        first = r.json()["items"][0]["word"]
        r = await c.post(f"/api/v1/rewrite-ai-taste/{quote(first)}/toggle", headers=_admin_headers())
        assert r.status_code == 200
        r = await c.get("/api/v1/rewrite-ai-taste/runtime", headers=_user_headers())
    assert r.status_code == 200
    items = r.json()["items"]
    assert any(x["word"] == first and x["enabled"] == 0 for x in items), "runtime 应含 enabled=0 条目"


# ── ④ 结构性：白名单必须已摘除这三条 ─────────────────────────────────
def test_runtime_endpoints_are_no_longer_public_allowlisted():
    """这三个路径不得再出现在 `PUBLIC_ALLOWLIST`。

    与 `test_auth_surface.py` 的公开端点白名单锁**互为反向**：那边挡「公开端点没登记」，
    这条挡「已收紧的端点仍挂在豁免名单上」。两者同时成立才算真正收口。

    ⚠️ 键形态：`PUBLIC_ALLOWLIST` 的键是 **`"<METHOD> <path>"`**（如
    `"GET /api/v1/rewrite-ai-taste/runtime"`），**不是裸路径**。首版本条用裸路径做
    `in` 判断 ⇒ 恒为 False ⇒ 测试**空转通过**（实测：RED 阶段它本该红却没红，
    靠"数预期失败数对不上"才发现）。故此处 ① 用正确键形态；② 加非空转守卫。
    """
    from scripts.auth_surface import PUBLIC_ALLOWLIST

    # 非空转守卫：名单里必须仍能看见「自证合理」的公共端点。
    # 若键形态再变（或名单被清空/改名），本断言先红，而不是让下面的检查静默恒真。
    for legit in ("POST /api/auth/login", "POST /api/auth/logout", "GET /health"):
        assert legit in PUBLIC_ALLOWLIST, (
            f"白名单键形态疑似变化：找不到自证合理的公共端点 {legit!r}；"
            f"实际键={sorted(PUBLIC_ALLOWLIST)}"
        )

    stale = [f"GET {p}" for p in RUNTIME_ENDPOINTS if f"GET {p}" in PUBLIC_ALLOWLIST]
    assert stale == [], f"以下端点已加鉴权却仍挂在公开白名单：{stale}"


def test_runtime_endpoints_declare_session_auth_in_surface():
    """反射清单里这三条的鉴权必须是 `get_current_user`（真源判定，不靠读代码猜）。"""
    from main import app
    from scripts.auth_surface import build_surface

    # build_surface 返回 {"total": int, "routes": [...]} 这一**字典**（不是列表）
    surface = {r["path"]: r for r in build_surface(app)["routes"]}
    assert len(surface) > 100, f"反射清单疑似退化（仅 {len(surface)} 条），判定不可信"
    for path in RUNTIME_ENDPOINTS:
        assert path in surface, f"{path} 不在反射清单里"
        assert surface[path]["auth"] == ["get_current_user"], (
            f"{path} 的鉴权应为 ['get_current_user']，实测 {surface[path]['auth']}"
        )
