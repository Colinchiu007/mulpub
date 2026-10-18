"""Tests for ops-center「字数控制」（storyTextLimit 下发块）。

契约单一真源：`01-docs/PRD-STORY-TEXT-LIMIT-CONTROL-2026-10-18.md` §4.3 / §5 / §11。
桌面端由 `apps/desktop/src/story2video/story-text-limit.test.js` 与
`electron/services/ops-runtime-snapshot.test.js` 对同一批约束断言；
**任一端改块名 / 形状 / 整数口径 / 白名单数量，本文件即红**。
"""
import os
import sys
import tempfile
import uuid

import pytest
import pytest_asyncio

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

_RUN_ID = uuid.uuid4().hex[:8]
os.environ["OPS_DB_PATH"] = os.path.join(tempfile.gettempdir(), f"ops_stl_{_RUN_ID}.db")
os.environ["OPS_CONFIG_OUTPUT_DIR"] = os.path.join(tempfile.gettempdir(), f"ops_stl_cfg_{_RUN_ID}")
os.environ["OPS_SECRET_KEY"] = "test-secret"
os.environ["OPS_JWT_SECRET"] = "test-secret"
os.environ["OPS_CATALOG_API_KEY"] = "catalog-test-key"

import models  # noqa: F401
from config import settings

API = "/api/v1/story-text-limits"
CATALOG_HEADERS = {"X-Catalog-Key": "catalog-test-key"}


@pytest_asyncio.fixture(autouse=True)
async def setup_db():
    from database import engine, Base

    settings.catalog_api_key = os.environ.get("OPS_CATALOG_API_KEY", "catalog-test-key")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


def _client():
    from httpx import AsyncClient, ASGITransport
    from main import app

    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


def _token(role: str = "admin", username: str | None = None) -> str:
    from datetime import datetime, timedelta, timezone
    from jose import jwt

    payload = {
        "sub": "admin" if role == "admin" else "u1",
        "username": username or ("admin" if role == "admin" else "u1"),
        "role": role,
        "exp": datetime.now(timezone.utc) + timedelta(hours=1),
    }
    return jwt.encode(payload, settings.get_jwt_secret(), algorithm=settings.jwt_algorithm)


def _admin_headers():
    return {"Authorization": f"Bearer {_token('admin')}"}


def _normal_headers():
    return {"Authorization": f"Bearer {_token('user')}"}


async def _bootstrap_payload():
    """直接取 bootstrap payload（不经 HTTP，避免签名/路由噪声干扰形状断言）。"""
    from database import async_session
    from services.runtime_service import get_runtime_bootstrap

    async with async_session() as db:
        return await get_runtime_bootstrap(db)


def _default_item(**over):
    item = {"scope": "story2video", "max_chars": 10000, "warn_percent": 90}
    item.update(over)
    return item


# ─── 目录供给 / 页面读取 ───────────────────────────────────────────────

@pytest.mark.asyncio
async def test_list_provisions_catalog_defaults():
    """空库首次打开页面 → 自动 provision 出 story2video 默认行（10000 / 90 / 启用）。"""
    async with _client() as client:
        r = await client.get(API, headers=_admin_headers())
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["count"] == 1
    item = body["items"][0]
    assert item["scope"] == "story2video"
    assert item["label"] == "故事讲述"
    assert item["max_chars"] == 10000
    assert item["warn_percent"] == 90
    assert item["enabled"] is True
    assert item["note"] == ""
    # 默认值与合法区间由服务端常量下发，前端不得再抄一份（抄的必然先漂移）
    assert body["defaults"] == {"max_chars": 10000, "warn_percent": 90}
    assert body["ranges"]["max_chars"] == {"min": 1000, "max": 50000}
    assert body["ranges"]["warn_percent"] == {"min": 50, "max": 99}
    assert body["ranges"]["note_max_len"] == 200


@pytest.mark.asyncio
async def test_list_requires_auth():
    async with _client() as client:
        assert (await client.get(API)).status_code == 401


# ─── 写入：正常路径 ───────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_put_updates_values_and_bootstrap_reflects():
    async with _client() as client:
        h = _admin_headers()
        r = await client.put(
            API,
            json={"items": [_default_item(max_chars=12000, warn_percent=95, note="大促长脚本")]},
            headers=h,
        )
        assert r.status_code == 200, r.text
        saved = {i["scope"]: i for i in r.json()["items"]}["story2video"]
        assert saved["max_chars"] == 12000
        assert saved["warn_percent"] == 95
        assert saved["note"] == "大促长脚本"

        lst = (await client.get(API, headers=h)).json()
    assert {i["scope"]: i for i in lst["items"]}["story2video"]["max_chars"] == 12000

    payload = await _bootstrap_payload()
    assert payload["storyTextLimit"] == {"story2video": {"maxChars": 12000, "warnPercent": 95}}


@pytest.mark.asyncio
@pytest.mark.parametrize("max_chars,warn_percent", [(1000, 50), (50000, 99)])
async def test_put_accepts_closed_interval_boundaries(max_chars, warn_percent):
    """区间是**闭区间**：端点值必须合法（PRD §11 E13）。"""
    async with _client() as client:
        r = await client.put(
            API,
            json={"items": [_default_item(max_chars=max_chars, warn_percent=warn_percent)]},
            headers=_admin_headers(),
        )
    assert r.status_code == 200, r.text
    item = r.json()["items"][0]
    assert (item["max_chars"], item["warn_percent"]) == (max_chars, warn_percent)


@pytest.mark.asyncio
async def test_put_enabled_false_disables_delivery():
    async with _client() as client:
        r = await client.put(API, json={"items": [_default_item(enabled=False)]}, headers=_admin_headers())
    assert r.status_code == 200, r.text
    assert r.json()["items"][0]["enabled"] is False
    # 关闭后整块为 null（不是出现并带 false）：桌面端据此回落内置默认
    assert (await _bootstrap_payload())["storyTextLimit"] is None


# ─── 写入：校验（fail-closed，中文原因）───────────────────────────────

@pytest.mark.asyncio
@pytest.mark.parametrize(
    "item,expected_word",
    [
        # 字数上限：越界 / 非整数（含 float、字符串、bool）/ 缺字段
        (_default_item(max_chars=999), "字数上限"),
        (_default_item(max_chars=50001), "字数上限"),
        (_default_item(max_chars=10000.0), "字数上限"),
        (_default_item(max_chars="12000"), "字数上限"),
        (_default_item(max_chars=True), "字数上限"),
        ({"scope": "story2video", "warn_percent": 90}, "字数上限"),
        # 预警阈值：越界 / 非整数
        (_default_item(warn_percent=49), "预警阈值"),
        (_default_item(warn_percent=100), "预警阈值"),
        (_default_item(warn_percent=90.5), "预警阈值"),
        (_default_item(warn_percent="90"), "预警阈值"),
        ({"scope": "story2video", "max_chars": 10000}, "预警阈值"),
        # 作用域：未知 / 空
        (_default_item(scope="rewrite"), "未知的作用域：rewrite"),
        (_default_item(scope=""), "作用域不能为空"),
        ({"max_chars": 10000, "warn_percent": 90}, "作用域不能为空"),
        # 启用标记：非布尔（None 也拒绝，静默当 true 会让「关闭」变「照常下发」）
        (_default_item(enabled="yes"), "启用标记"),
        (_default_item(enabled=None), "启用标记"),
        (_default_item(enabled=2), "启用标记"),
        # 备注超长
        (_default_item(note="备" * 201), "备注最多 200 字"),
    ],
)
async def test_put_rejects_invalid_items(item, expected_word):
    async with _client() as client:
        r = await client.put(API, json={"items": [item]}, headers=_admin_headers())
    assert r.status_code == 400, f"应拒绝 {item}，实际 {r.status_code} {r.text}"
    assert expected_word in r.json()["detail"], r.json()["detail"]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "body",
    [
        {"items": "story2video"},
        {"items": []},
        {"items": [_default_item(), _default_item(max_chars=12000)]},  # 重复 scope
        {"items": ["story2video"]},
    ],
)
async def test_put_rejects_invalid_batch_shape(body):
    async with _client() as client:
        r = await client.put(API, json=body, headers=_admin_headers())
    assert r.status_code == 400, f"应拒绝 {body}，实际 {r.status_code} {r.text}"


@pytest.mark.asyncio
async def test_put_is_atomic_no_partial_write():
    """批量保存是一个整体：第二条非法时第一条也不得落库（杜绝「保存成功但没生效」）。"""
    async with _client() as client:
        h = _admin_headers()
        r = await client.put(
            API,
            json={"items": [_default_item(max_chars=12000), _default_item(scope="unknown")]},
            headers=h,
        )
        assert r.status_code == 400, r.text
        lst = (await client.get(API, headers=h)).json()
    assert lst["items"][0]["max_chars"] == 10000, "非法批次不得留下部分写入"


@pytest.mark.asyncio
async def test_write_requires_admin():
    async with _client() as client:
        assert (await client.put(API, json={"items": [_default_item()]})).status_code == 401
        assert (
            await client.put(API, json={"items": [_default_item()]}, headers=_normal_headers())
        ).status_code == 403
        assert (await client.post(f"{API}/reset", headers=_normal_headers())).status_code == 403


# ─── 恢复默认 ─────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_reset_restores_defaults():
    async with _client() as client:
        h = _admin_headers()
        await client.put(API, json={"items": [_default_item(max_chars=3000, warn_percent=60, enabled=False)]}, headers=h)
        r = await client.post(f"{API}/reset", headers=h)
        assert r.status_code == 200, r.text
        item = r.json()["items"][0]
    assert (item["max_chars"], item["warn_percent"], item["enabled"]) == (10000, 90, True)
    assert (await _bootstrap_payload())["storyTextLimit"] == {
        "story2video": {"maxChars": 10000, "warnPercent": 90}
    }


@pytest.mark.asyncio
async def test_reset_unknown_scope_404():
    async with _client() as client:
        r = await client.post(f"{API}/reset", json={"scope": "rewrite"}, headers=_admin_headers())
    assert r.status_code == 404


# ─── 下发：形状 / 降级 / 指纹 ─────────────────────────────────────────

@pytest.mark.asyncio
async def test_bootstrap_block_shape_and_canonical_serializable():
    """未配置任何行时也 provision 出默认行 → 块形状固定且可被 canonical_json 序列化。"""
    payload = await _bootstrap_payload()
    block = payload["storyTextLimit"]
    assert block == {"story2video": {"maxChars": 10000, "warnPercent": 90}}
    # 只能是整数：任何浮点都会让 compute_config_hash fail-closed（见 config_fingerprint）
    assert set(block) == {"story2video"}
    assert set(block["story2video"]) == {"maxChars", "warnPercent"}
    for value in block["story2video"].values():
        assert isinstance(value, int) and not isinstance(value, bool)

    from services.runtime_service import canonical_json

    text = canonical_json(payload)
    assert '"storyTextLimit"' in text
    assert '"maxChars":10000' in text and '"warnPercent":90' in text


@pytest.mark.asyncio
async def test_bootstrap_signed_endpoint_delivers_block():
    """端到端：签名 bootstrap 里带 storyTextLimit，且它是签名覆盖范围的一部分。"""
    async with _client() as client:
        r = await client.get("/api/v1/runtime/bootstrap", headers=CATALOG_HEADERS)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["storyTextLimit"] == {"story2video": {"maxChars": 10000, "warnPercent": 90}}
    assert body.get("signature"), "storyTextLimit 必须在签名覆盖范围内"


@pytest.mark.asyncio
async def test_bootstrap_skips_invalid_stored_row():
    """库内非法值（越界 / 浮点）不得下发，也**不得 clamp**（clamp 会让「配错了」看着像生效）。"""
    import sqlalchemy as sa

    from database import async_session
    from models import StoryTextLimit
    from services.story_text_limit_service import get_bootstrap_story_text_limit

    async with async_session() as db:
        await db.execute(sa.insert(StoryTextLimit).values(
            scope="story2video", max_chars=5, warn_percent=90, enabled=1, note="",
        ))
        await db.commit()
        assert await get_bootstrap_story_text_limit(db) is None

    async with async_session() as db:
        await db.execute(
            sa.update(StoryTextLimit).where(StoryTextLimit.scope == "story2video").values(max_chars=12000.5)
        )
        await db.commit()
        # SQLite 的 INTEGER 亲和列会把 12000.0 归一成整数，所以这里用**真浮点** 12000.5：
        # 它读回来仍是 float，必须被拒绝下发（两端 canonical 序列化会不一致）
        assert await get_bootstrap_story_text_limit(db) is None


@pytest.mark.asyncio
async def test_bootstrap_never_raises_on_db_failure():
    """下发侧 fail-open：读库故障只让本块为 null，绝不把整个 bootstrap 拖挂。"""
    from services.story_text_limit_service import get_bootstrap_story_text_limit

    class _Boom:
        async def execute(self, *a, **k):
            raise RuntimeError("db down")

        async def commit(self):
            raise RuntimeError("db down")

        async def rollback(self):
            pass

        def add(self, *a, **k):
            raise RuntimeError("db down")

    assert await get_bootstrap_story_text_limit(_Boom()) is None


@pytest.mark.asyncio
async def test_runtime_block_registered_in_fingerprint():
    """13 → 14 的跨端锁：漏了本块 → 客户端 ACK 永不被认可。"""
    from services.runtime_service import RUNTIME_BLOCKS, compute_config_hash

    assert "storyTextLimit" in RUNTIME_BLOCKS
    assert len(RUNTIME_BLOCKS) == 14
    # 值变化必须体现在 config_hash 上，否则「改完不生效、看板还显示已生效」
    base = {"storyTextLimit": {"story2video": {"maxChars": 10000, "warnPercent": 90}}}
    changed = {"storyTextLimit": {"story2video": {"maxChars": 12000, "warnPercent": 90}}}
    assert compute_config_hash(base) != compute_config_hash(changed)
    # 整块缺失（null）与「有值」也必须区分
    assert compute_config_hash({}) != compute_config_hash(base)


@pytest.mark.asyncio
async def test_provision_never_overwrites_operator_values():
    """只补欠账、不覆盖：运营改过的值不会被目录供给回退。"""
    async with _client() as client:
        h = _admin_headers()
        await client.put(API, json={"items": [_default_item(max_chars=15000, warn_percent=80)]}, headers=h)
        # 多次读取（每次都会跑 provision）不得回退运营值
        for _ in range(3):
            lst = (await client.get(API, headers=h)).json()
            assert lst["items"][0]["max_chars"] == 15000
            assert lst["items"][0]["warn_percent"] == 80
