"""Tests for ops-center 应用菜单配置（显示/隐藏 + 组内排序 + 强制项保护 + 运行时下发）。

覆盖 PRD「应用菜单」章节的校验规则、强制项双重保护与 bootstrap 契约。
"""
import os
import sys
import tempfile
import uuid

import pytest
import pytest_asyncio

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

_RUN_ID = uuid.uuid4().hex[:8]
os.environ["OPS_DB_PATH"] = os.path.join(tempfile.gettempdir(), f"ops_am_{_RUN_ID}.db")
os.environ["OPS_CONFIG_OUTPUT_DIR"] = os.path.join(tempfile.gettempdir(), f"ops_am_cfg_{_RUN_ID}")
os.environ["OPS_SECRET_KEY"] = "test-secret"
os.environ["OPS_JWT_SECRET"] = "test-secret"
os.environ["OPS_CATALOG_API_KEY"] = "catalog-test-key"

import models  # noqa: F401
from config import settings

# 2026-09-15：rewrite（文案改写）提级到一级导航，与 apps/desktop/src/config/sidebar-menu.js 保持同步
# 2026-09-19：copy-library（文案库）新增一级导航，与 apps/desktop/src/config/route-registry.js 保持同步
DEFAULT_PRIMARY = ["home", "publish", "accounts", "dashboard", "create", "collection", "copy-library", "rewrite"]
FORCED_KEYS = {"publish", "accounts", "create", "collection"}
# 2026-09-15：#1840 移除「分屏监控」后 CATALOG 20 → 19；2026-09-19 文案库 +1 → 20（与 app_menu_service.CATALOG 同步）
CATALOG_SIZE = 20


@pytest_asyncio.fixture(autouse=True)
async def setup_db():
    from database import Base, async_session, engine
    from services.app_menu_service import _provision_from_catalog

    settings.catalog_api_key = os.environ.get("OPS_CATALOG_API_KEY", "catalog-test-key")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with async_session() as db:
        await _provision_from_catalog(db)
        # 补齐只 flush、不自行提交（事务由调用方收口），夹具必须自己 commit 才留下种子行
        await db.commit()
    yield
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


def _client():
    from httpx import ASGITransport, AsyncClient

    from main import app

    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


def _token(role: str, sub: str, username: str):
    from datetime import datetime, timedelta, timezone

    from jose import jwt

    payload = {
        "sub": sub,
        "username": username,
        "role": role,
        "exp": datetime.now(timezone.utc) + timedelta(hours=1),
    }
    return {"Authorization": f"Bearer {jwt.encode(payload, settings.get_jwt_secret(), algorithm=settings.jwt_algorithm)}"}


def _admin_headers():
    return _token("admin", "admin", "admin")


def _normal_headers():
    return _token("user", "u1", "u1")


def _catalog_headers():
    return {"X-Catalog-Key": os.environ["OPS_CATALOG_API_KEY"]}


# ─── 种子与列表 ────────────────────────────────────────────


@pytest.mark.asyncio
async def test_seed_catalog_and_forced_flags():
    async with _client() as client:
        data = (await client.get("/api/v1/app-menu", headers=_admin_headers())).json()

        keys = [i["item_key"] for i in data["items"]]
        assert len(keys) == CATALOG_SIZE
        # 分组顺序：primary 组在前且按目录顺序
        primary = [i["item_key"] for i in data["items"] if i["group"] == "primary"]
        assert primary == DEFAULT_PRIMARY
        # 强制项标记
        assert set(data["forced_visible_keys"]) == FORCED_KEYS
        assert {i["item_key"] for i in data["items"] if i["forced_visible"]} == FORCED_KEYS
        # 默认全部可见
        assert all(i["visible"] for i in data["items"])


# ─── 权限 ─────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_permissions_read_allowed_write_admin_only():
    async with _client() as client:
        assert (await client.get("/api/v1/app-menu", headers=_normal_headers())).status_code == 200
        assert (await client.put("/api/v1/app-menu", json={"items": []}, headers=_normal_headers())).status_code == 403
        assert (await client.post("/api/v1/app-menu/reset", headers=_normal_headers())).status_code == 403


# ─── 数据校验 ──────────────────────────────────────────────


@pytest.mark.asyncio
async def test_validation_rejects_bad_input():
    async with _client() as client:
        h = _admin_headers()
        bad_bodies = [
            {"items": "not-a-list"},
            {"items": [{"item_key": "", "visible": False}]},
            {"items": [{"item_key": "not-exist", "visible": True}]},
            {"items": [{"item_key": "home"}, {"item_key": "home"}]},
            {"items": [123]},
        ]
        for body in bad_bodies:
            resp = await client.put("/api/v1/app-menu", json=body, headers=h)
            assert resp.status_code == 400, body

        over = {"items": [{"item_key": "home"}] * 201}
        assert (await client.put("/api/v1/app-menu", json=over, headers=h)).status_code == 400


@pytest.mark.asyncio
async def test_invalid_sort_order_keeps_previous_value():
    """非法 sort_order（负数 / 非数字）不得把已有顺序归零。"""
    async with _client() as client:
        h = _admin_headers()
        before = {i["item_key"]: i["sort_order"] for i in (await client.get("/api/v1/app-menu", headers=h)).json()["items"]}

        await client.put(
            "/api/v1/app-menu",
            json={"items": [
                {"item_key": "library", "visible": True, "sort_order": -3},
                {"item_key": "keywords", "visible": True, "sort_order": "abc"},
            ]},
            headers=h,
        )
        after = {i["item_key"]: i["sort_order"] for i in (await client.get("/api/v1/app-menu", headers=h)).json()["items"]}
        assert after["library"] == before["library"]
        assert after["keywords"] == before["keywords"]


# ─── 强制项保护 ────────────────────────────────────────────


@pytest.mark.asyncio
async def test_forced_visible_items_cannot_be_hidden_via_api():
    async with _client() as client:
        h = _admin_headers()
        resp = await client.put(
            "/api/v1/app-menu",
            json={"items": [
                {"item_key": "publish", "visible": False, "sort_order": 1},
                {"item_key": "home", "visible": False, "sort_order": 0},
            ]},
            headers=h,
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        # 被纠正并留痕
        assert "publish" in body["corrections"]
        by_key = {i["item_key"]: i for i in body["items"]}
        assert by_key["publish"]["visible"] is True
        # 非强制项正常生效
        assert by_key["home"]["visible"] is False


@pytest.mark.asyncio
async def test_bootstrap_forces_visible_even_if_db_tampered():
    """防御纵深第二层：绕过 API 直接改库，下发前仍会被纠正为可见。"""
    import sqlalchemy as sa

    from database import async_session
    from models import AppMenuItem

    async with _client() as client:
        async with async_session() as db:
            row = (
                await db.execute(sa.select(AppMenuItem).where(AppMenuItem.item_key == "create"))
            ).scalar_one()
            row.visible = 0
            await db.commit()

        data = (await client.get("/api/v1/runtime/bootstrap", headers=_catalog_headers())).json()
        by_key = {i["key"]: i for i in data["appMenu"]["items"]}
        assert by_key["create"]["visible"] is True


# ─── 排序 ─────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_sort_order_persists_and_is_returned_in_order():
    async with _client() as client:
        h = _admin_headers()
        await client.put(
            "/api/v1/app-menu",
            json={"items": [
                {"item_key": "collection", "visible": True, "sort_order": 0},
                {"item_key": "create", "visible": True, "sort_order": 1},
                {"item_key": "accounts", "visible": True, "sort_order": 2},
                {"item_key": "publish", "visible": True, "sort_order": 3},
                {"item_key": "dashboard", "visible": True, "sort_order": 4},
                {"item_key": "home", "visible": True, "sort_order": 5},
            ]},
            headers=h,
        )
        data = (await client.get("/api/v1/app-menu", headers=h)).json()
        primary = [i["item_key"] for i in data["items"] if i["group"] == "primary"]
        # rewrite / copy-library 未配置 sort_order → 排在已配置项之后（copy-library 先于 rewrite，同 CATALOG 顺序）
        assert primary == ["collection", "create", "accounts", "publish", "dashboard", "home", "copy-library", "rewrite"]


# ─── 跨组移动（一级 ↔ 更多）──────────────────────────────


@pytest.mark.asyncio
async def test_cross_group_move_persists_and_propagates_to_bootstrap():
    """将「更多」组的 calendar 移到一级导航，应持久化并在下发载荷中体现。"""
    async with _client() as client:
        h = _admin_headers()
        # calendar 默认在 more
        before = {i["item_key"]: i for i in (await client.get("/api/v1/app-menu", headers=h)).json()["items"]}
        assert before["calendar"]["group"] == "more"

        await client.put(
            "/api/v1/app-menu",
            json={"items": [{"item_key": "calendar", "visible": True, "sort_order": 0, "group": "primary"}]},
            headers=h,
        )
        after = {i["item_key"]: i for i in (await client.get("/api/v1/app-menu", headers=h)).json()["items"]}
        assert after["calendar"]["group"] == "primary"

        # 下发载荷应反映 group=primary
        data = (await client.get("/api/v1/runtime/bootstrap", headers=_catalog_headers())).json()
        by_key = {i["key"]: i for i in data["appMenu"]["items"]}
        assert by_key["calendar"]["group"] == "primary"


@pytest.mark.asyncio
async def test_unknown_group_rejected():
    """group 取值非法应被拒绝（fail-closed，与未知 key 同口径）。"""
    async with _client() as client:
        h = _admin_headers()
        resp = await client.put(
            "/api/v1/app-menu",
            json={"items": [{"item_key": "home", "visible": True, "sort_order": 0, "group": "bogus"}]},
            headers=h,
        )
        assert resp.status_code == 400, resp.text


@pytest.mark.asyncio
async def test_forced_visible_pinned_to_primary_on_cross_group():
    """强制显示项即便被请求移到 more，服务端也纠正回 primary 并留痕。"""
    async with _client() as client:
        h = _admin_headers()
        resp = await client.put(
            "/api/v1/app-menu",
            json={"items": [{"item_key": "publish", "visible": True, "sort_order": 0, "group": "more"}]},
            headers=h,
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert "publish" in body["corrections"]
        by_key = {i["item_key"]: i for i in body["items"]}
        assert by_key["publish"]["group"] == "primary"


# ─── bootstrap 契约 ────────────────────────────────────────


@pytest.mark.asyncio
async def test_bootstrap_app_menu_payload_is_signed_and_complete():
    async with _client() as client:
        h = _admin_headers()
        await client.put(
            "/api/v1/app-menu",
            json={"items": [{"item_key": "home", "visible": False, "sort_order": 0}]},
            headers=h,
        )

        resp = await client.get("/api/v1/runtime/bootstrap", headers=_catalog_headers())
        assert resp.status_code == 200
        data = resp.json()

        # appMenu 必须处于签名覆盖范围内（签名是对整个 payload 的 canonical JSON）
        assert isinstance(data.get("signature"), str) and data["signature"]
        assert "appMenu" in data

        app_menu = data["appMenu"]
        assert isinstance(app_menu.get("synced_at"), str)
        by_key = {i["key"]: i for i in app_menu["items"]}
        assert len(app_menu["items"]) == CATALOG_SIZE
        assert by_key["home"]["visible"] is False
        for key in FORCED_KEYS:
            assert by_key[key]["visible"] is True
        # 每项至少含 key / visible / sort_order / group（应用端契约字段）
        for item in app_menu["items"]:
            assert {"key", "visible", "sort_order", "group"} <= set(item.keys())


@pytest.mark.asyncio
async def test_bootstrap_app_menu_items_include_group():
    """跨组管理契约（2026-09-16 撤销 D-GRP）：下发载荷必须含 group 字段，
    且取值只能是 primary / more，不得出现「被签名但被忽略」之外的杂字段。"""
    async with _client() as client:
        resp = await client.get("/api/v1/runtime/bootstrap", headers=_catalog_headers())
        data = resp.json()
        for item in data["appMenu"]["items"]:
            assert set(item.keys()) == {"key", "visible", "sort_order", "group"}, item
            assert item["group"] in ("primary", "more"), item


@pytest.mark.asyncio
async def test_bootstrap_requires_catalog_key():
    async with _client() as client:
        resp = await client.get("/api/v1/runtime/bootstrap", headers={"X-Catalog-Key": "wrong"})
        assert resp.status_code == 401


# ─── 目录演进回填（跨端同步契约）───────────────────────────
# 回归 2026-09-25 事故：copy-library 由 #bcd1b663 加入 CATALOG，但已在该提交前播种过的
# 生产库不会补齐该行 —— 运营端页面（读 DB）看不到该项、无法配置，桌面端（读下发）却照样
# 显示，两侧菜单项目与顺序就此漂移。以下三例锁住「DB 必须跟随 CATALOG 演进」这条契约。


async def _drop_row(item_key: str) -> None:
    """模拟「库里没有这一项」的历史状态（老库 + 目录新增项）。"""
    import sqlalchemy as sa

    from database import async_session
    from models import AppMenuItem

    async with async_session() as db:
        row = (
            await db.execute(sa.select(AppMenuItem).where(AppMenuItem.item_key == item_key))
        ).scalar_one()
        await db.delete(row)
        await db.commit()


@pytest.mark.asyncio
async def test_concurrent_provisioning_never_raises_integrity_error():
    """补齐现在每个请求都跑：页面 GET 与客户端 bootstrap 可能同瞬判定同一 key 缺失并双插，
    item_key 的 UNIQUE 约束会把落败方打成 IntegrityError → 500。必须冲突静默。

    竞态窗口取决于调度顺序，本用例用多个并发 session 放大窗口；即便某次运行未触发双插，
    它也锁住了「补齐幂等 + 冲突不报错 + 不产生重复行」这条契约不因改回 db.add 而回归。
    """
    import asyncio

    from database import async_session
    from services.app_menu_service import _provision_from_catalog

    await _drop_row("copy-library")

    async def worker():
        async with async_session() as db:
            await _provision_from_catalog(db)
            await db.commit()

    results = await asyncio.gather(*[worker() for _ in range(5)], return_exceptions=True)
    assert [r for r in results if isinstance(r, Exception)] == []

    async with _client() as client:
        keys = [i["item_key"] for i in (await client.get("/api/v1/app-menu", headers=_admin_headers())).json()["items"]]
        assert keys.count("copy-library") == 1


@pytest.mark.asyncio
async def test_rejected_batch_does_not_persist_provisioning():
    """upsert_items 声明「任一条校验失败整批不写入」。

    补齐若在自己的事务里 commit，就会出现「请求返回 400、库里却已被写入」的部分写入；
    补齐必须只 flush，由调用方统一收口。故被拒批次之后，直接从库读该行必须不存在。
    """
    import sqlalchemy as sa

    from database import async_session
    from models import AppMenuItem

    async with _client() as client:
        await _drop_row("copy-library")
        resp = await client.put(
            "/api/v1/app-menu",
            json={"items": [
                {"item_key": "copy-library", "visible": False, "sort_order": 6},
                {"item_key": "not-exist", "visible": True},
            ]},
            headers=_admin_headers(),
        )
        assert resp.status_code == 400

        async with async_session() as db:
            row = (
                await db.execute(sa.select(AppMenuItem).where(AppMenuItem.item_key == "copy-library"))
            ).scalar_one_or_none()
        assert row is None, "被拒绝的批次不得落任何盘（含补齐行）"


@pytest.mark.asyncio
async def test_legacy_row_outside_catalog_hidden_from_page_and_bootstrap():
    """已从目录移除的历史行（如 monitor）不得出现在页面上。

    下发本就按 CATALOG 过滤；页面若多显示一项，运营者会看到一个应用端不存在、也配置
    不了的项，再次得到「两侧不同步」的错觉 —— 「页面 ⊇ 下发」不是可接受的契约。
    """
    import sqlalchemy as sa

    from database import async_session
    from models import AppMenuItem
    from services.app_menu_service import CATALOG_KEYS

    async with async_session() as db:
        db.add(AppMenuItem(
            item_key="monitor", label="监控", group="more", visible=1,
            forced_visible=0, sort_order=3, description="历史遗留", updated_at="", updated_by="",
        ))
        await db.commit()

    async with _client() as client:
        page_keys = [i["item_key"] for i in (await client.get("/api/v1/app-menu", headers=_admin_headers())).json()["items"]]
        assert "monitor" not in page_keys
        assert set(page_keys) == set(CATALOG_KEYS)

        delivered = (await client.get("/api/v1/runtime/bootstrap", headers=_catalog_headers())).json()["appMenu"]["items"]
        assert {i["key"] for i in delivered} == set(CATALOG_KEYS)


@pytest.mark.asyncio
async def test_catalog_evolution_backfills_missing_row_in_list():
    """库里缺失目录新增项时，列表读取必须补齐该行（不得只在全空时播种）。"""
    async with _client() as client:
        await _drop_row("copy-library")

        h = _admin_headers()
        data = (await client.get("/api/v1/app-menu", headers=h)).json()
        keys = [i["item_key"] for i in data["items"]]

        assert len(keys) == CATALOG_SIZE, keys
        assert "copy-library" in keys
        primary = [i["item_key"] for i in data["items"] if i["group"] == "primary"]
        assert primary == DEFAULT_PRIMARY


@pytest.mark.asyncio
async def test_backfill_does_not_clobber_operator_config():
    """回填只补欠账，不得覆盖运营者已有的显隐与排序。"""
    async with _client() as client:
        h = _admin_headers()
        await client.put(
            "/api/v1/app-menu",
            json={"items": [{"item_key": "library", "visible": False, "sort_order": 42}]},
            headers=h,
        )
        await _drop_row("copy-library")

        by_key = {i["item_key"]: i for i in (await client.get("/api/v1/app-menu", headers=h)).json()["items"]}
        assert by_key["library"]["visible"] is False
        assert by_key["library"]["sort_order"] == 42
        # 补进来的新项按目录默认：可见 + 目录序号 + 目录分组
        assert by_key["copy-library"]["visible"] is True
        assert by_key["copy-library"]["sort_order"] == DEFAULT_PRIMARY.index("copy-library")
        assert by_key["copy-library"]["group"] == "primary"


@pytest.mark.asyncio
async def test_list_and_bootstrap_never_diverge_on_item_set_and_order():
    """页面与下发必须同一份项目集合、同一套顺序 —— 这是「不同步」的直接断言。"""
    from services.app_menu_service import CATALOG, CATALOG_KEYS

    async with _client() as client:
        h = _admin_headers()
        await _drop_row("copy-library")

        page = (await client.get("/api/v1/app-menu", headers=h)).json()["items"]
        delivered = (await client.get("/api/v1/runtime/bootstrap", headers=_catalog_headers())).json()["appMenu"]["items"]

        assert {i["item_key"] for i in page} == set(CATALOG_KEYS)
        assert {i["key"] for i in delivered} == set(CATALOG_KEYS)

        # 缺行项的下发 sort_order 必须是目录序号，而不是 0（0 会把它顶到分组最前）
        delivered_by_key = {i["key"]: i for i in delivered}
        assert delivered_by_key["copy-library"]["sort_order"] == CATALOG_KEYS.index("copy-library")

        expected_primary_order = [k for k, _l, g, _d in CATALOG if g == "primary"]
        primary_sorted = sorted(
            (i for i in delivered if i["group"] == "primary"),
            key=lambda i: i["sort_order"],
        )
        assert [i["key"] for i in primary_sorted] == expected_primary_order


# ─── 恢复默认 ──────────────────────────────────────────────


@pytest.mark.asyncio
async def test_reset_restores_defaults():
    async with _client() as client:
        h = _admin_headers()
        await client.put(
            "/api/v1/app-menu",
            json={"items": [
                {"item_key": "home", "visible": False, "sort_order": 99},
                {"item_key": "keywords", "visible": False, "sort_order": 98},
            ]},
            headers=h,
        )
        data = (await client.post("/api/v1/app-menu/reset", headers=h)).json()

        by_key = {i["item_key"]: i for i in data["items"]}
        assert by_key["home"]["visible"] is True
        assert by_key["keywords"]["visible"] is True
        primary = [i["item_key"] for i in data["items"] if i["group"] == "primary"]
        assert primary == DEFAULT_PRIMARY


# ─── 幂等性 ────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_upsert_is_idempotent():
    async with _client() as client:
        h = _admin_headers()
        body = {"items": [{"item_key": "library", "visible": False, "sort_order": 3}]}
        first = await client.put("/api/v1/app-menu", json=body, headers=h)
        second = await client.put("/api/v1/app-menu", json=body, headers=h)
        assert first.status_code == 200 and second.status_code == 200

        snap = lambda r: {i["item_key"]: (i["visible"], i["sort_order"]) for i in r.json()["items"]}
        assert snap(first) == snap(second)
        assert snap(second)["library"] == (False, 3)
