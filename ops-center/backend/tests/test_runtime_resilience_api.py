"""运营中心远程化韧性：配置版本号 / 生效回执 / 断连降级遥测（契约锁定测试）

契约单一真源：`openspec/changes/ops-center-resilience/design.md`
桌面端由 `ops-center-sync.test.js` / `ops-resilience-*.test.js` 对同一批向量断言，
**任一端改算法或改字段名，本文件的固定向量断言即红**。
"""
import datetime
import os
import sys
import tempfile

import pytest
import pytest_asyncio

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

os.environ["OPS_DB_PATH"] = os.path.join(tempfile.gettempdir(), "ops_runtime_resilience_test.db")
os.environ["OPS_CONFIG_OUTPUT_DIR"] = os.path.join(tempfile.gettempdir(), "ops_runtime_resilience_cfgs")
os.environ["OPS_SECRET_KEY"] = "test-secret"
os.environ["OPS_JWT_SECRET"] = "test-secret"
os.environ["OPS_CATALOG_API_KEY"] = "catalog-test-key"

import models  # noqa: F401
from config import settings

CATALOG_HEADERS = {"X-Catalog-Key": "catalog-test-key"}


@pytest_asyncio.fixture(autouse=True)
async def setup_db():
    from database import engine, Base

    settings.catalog_api_key = os.environ["OPS_CATALOG_API_KEY"]
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


def _client():
    from httpx import AsyncClient, ASGITransport
    from main import app

    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


def _admin_headers():
    from jose import jwt

    payload = {
        "sub": "admin",
        "username": "admin",
        "role": "admin",
        "exp": datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=1),
    }
    token = jwt.encode(payload, settings.get_jwt_secret(), algorithm=settings.jwt_algorithm)
    return {"Authorization": f"Bearer {token}"}


def _ack(**over):
    base = {
        "client_id": "client-a",
        "client_version": "2.1.0",
        "config_version": 1,
        "config_hash": "0123456789abcdef",
        "applied_blocks": {"appMenu": 7, "featureFlags": 12},
        "skipped_blocks": [],
        "degraded": False,
        "degradation_tier": None,
        "ack_type": "applied",
        "degraded_since": None,
    }
    base.update(over)
    return base


def _degradation(**over):
    base = {
        "client_id": "client-a",
        "client_version": "2.1.0",
        "channel": "runtime",
        "endpoint": "/api/v1/runtime/bootstrap",
        "failure_kind": "timeout",
        "consecutive_failures": 5,
        "degraded_since": "2026-10-08T10:00:00Z",
        "recovered_at": "2026-10-08T11:30:00Z",
        "offline_seconds": 5400,
        "serving_tier": "L2",
    }
    base.update(over)
    return base


# ─── §1 config_hash：算法固定向量（跨端契约锁）────────────────────────
# 这三个常量与桌面端 ops-resilience-contract.test.js 逐字相同，改任一端即红。

def test_config_hash_pinned_vectors():
    from services.runtime_service import RUNTIME_BLOCKS, compute_config_hash

    # 2026-10-18 story-text-limit-control：新增 storyTextLimit 块，13 → 14。
    # 这份断言与桌面端 ops-runtime-snapshot.test.js 的同名向量**必须成对改**：
    # 只改一端 ⇒ 两端 canonical 输入不同 ⇒ config_hash 不同 ⇒ 客户端 ACK 永不被认可。
    assert len(RUNTIME_BLOCKS) == 14
    assert "storyTextLimit" in RUNTIME_BLOCKS
    # 全部块缺失 → 以 null 参与计算
    assert compute_config_hash({}) == "f559cffbd7fc2bcf"
    assert compute_config_hash({"announcements": []}) == "301dd86b76646d9f"
    # 中文内容：验证 canonical JSON 的 ensure_ascii=False 与键字典序
    assert compute_config_hash({"announcements": [{"title": "公告"}]}) == "b0d4bb463f2b9776"


def test_config_hash_excludes_volatile_fields():
    """synced_at / config_version / config_hash / signature 变化不得改变 hash。

    纳入 synced_at 会导致每次请求 hash 都变 → 客户端每次都发 ACK → 推送地狱。
    """
    from services.runtime_service import compute_config_hash

    base = {"announcements": [{"title": "公告"}]}
    with_volatile = {
        **base,
        "synced_at": "2099-01-01T00:00:00",
        "config_version": 999,
        "config_hash": "ffffffffffffffff",
        "signature": "Zm9v",
    }
    assert compute_config_hash(with_volatile) == compute_config_hash(base)


def test_config_hash_missing_key_equals_explicit_null():
    from services.runtime_service import compute_config_hash

    assert compute_config_hash({}) == compute_config_hash({"announcements": None})


# ─── 非整数数字：两端序列化不一致，必须 fail-closed（QM-6 外部评审触发）──────
# 实测两端对同一数值的输出全部不同：1.0→"1.0" vs "1"、1e16→"1e+16" vs "10000000000000000"、
# 1.5e-7→"1.5e-07" vs "1.5e-7"、-0.0→"-0.0" vs "0"、>2^53 还会丢精度。
# 不拦住 ⇒ 服务端与客户端永远算不出同一个 hash ⇒ ACK 反复判「hash 变了」⇒ 每天空烧流量。

@pytest.mark.asyncio
@pytest.mark.parametrize("value", [1.5, 0.1, 1e16, 1.5e-7, -0.0, float("nan"), float("inf")])
async def test_config_hash_rejects_non_integer_numbers(value):
    from services.runtime_service import compute_config_hash

    with pytest.raises(ValueError):
        compute_config_hash({"feature_flags": {"limit": value}})


@pytest.mark.asyncio
async def test_config_hash_accepts_booleans_and_integers():
    """bool 是 int 的子类，判据必须先摘出 bool —— 否则 feature flag 全被误拒。"""
    from services.runtime_service import compute_config_hash

    h = compute_config_hash({
        "feature_flags": {"enabled": True, "disabled": False, "max": 100},
    })
    assert len(h) == 16


@pytest.mark.asyncio
async def test_bootstrap_still_serves_when_payload_has_fractional_number():
    """浮点被拒时**策略仍要正常下发** —— 版本号降级为 0，绝不能让整个 bootstrap 500。

    bootstrap 一挂，全部客户端的运行时策略同时失效，代价远大于看板少个版本号。

    走真实路径：`feature_flags` 的 value_type='number' 时 `typed_value` 会把 "0.5"
    原样返回成 Python float（`int(f) if f.is_integer() else f`），这才是浮点进入
    payload 的真实来源 —— 直接 UPDATE 字符串列塞 "0.5" 根本不会产生浮点（SQLite 存文本）。
    """
    from database import async_session
    from models import FeatureFlag

    async with _client() as client:
        async with async_session() as db:
            row = FeatureFlag(key="zz_test_fraction", value="0.5", value_type="number", enabled=1)
            db.add(row)
            await db.commit()
        r = await client.get("/api/v1/runtime/bootstrap", headers=CATALOG_HEADERS)
        body = r.json() if r.status_code == 200 else {}

    assert r.status_code == 200, r.text
    # 浮点确实进了 payload（否则这条测试是恒真的）
    assert body.get("feature_flags", {}).get("zz_test_fraction") == 0.5
    # 但版本号降级为 0 + hash 空串，策略本体照常下发
    assert body["config_version"] == 0
    assert body["config_hash"] == ""
    assert "announcements" in body


# ─── §1.3 config_version 自愈式分配 ──────────────────────────────────

@pytest.mark.asyncio
async def test_config_version_stable_when_content_unchanged():
    """内容未变 → 版本号不动（运营点保存但没改数据，不应消耗版本号）。"""
    from database import async_session
    from models import RuntimeConfigVersion
    from services.runtime_service import resolve_config_version

    async with async_session() as db:
        v1 = await resolve_config_version(db, "aaaaaaaaaaaaaaaa")
        v2 = await resolve_config_version(db, "aaaaaaaaaaaaaaaa")
    assert v1 == v2
    async with async_session() as db:
        rows = (await db.execute(__import__("sqlalchemy").select(RuntimeConfigVersion))).scalars().all()
    assert len(rows) == 1


@pytest.mark.asyncio
async def test_config_version_increments_when_hash_changes():
    from database import async_session
    from services.runtime_service import resolve_config_version

    async with async_session() as db:
        v1 = await resolve_config_version(db, "aaaaaaaaaaaaaaaa")
        v2 = await resolve_config_version(db, "bbbbbbbbbbbbbbbb")
        v3 = await resolve_config_version(db, "aaaaaaaaaaaaaaaa")  # 回到旧内容
    assert v2 == v1 + 1
    assert v3 == v1, "回到已见过的内容指纹必须复用既有版本号，不得再占新号"


@pytest.mark.asyncio
async def test_resolve_config_version_never_raises():
    """版本解析失败绝不能让整个 bootstrap 失败——否则下发策略全废。"""
    from database import async_session
    from services.runtime_service import resolve_config_version

    class _Boom:
        async def execute(self, *a, **k):
            raise RuntimeError("db down")

        def add(self, *a, **k):
            raise RuntimeError("db down")

    async with async_session() as db:
        assert await resolve_config_version(_Boom(), "cccccccccccccccc") == 0


# ─── bootstrap 带版本号且落在签名内 ────────────────────────────────────

@pytest.mark.asyncio
async def test_bootstrap_includes_version_and_hash():
    async with _client() as client:
        r = await client.get("/api/v1/runtime/bootstrap", headers=CATALOG_HEADERS)
    assert r.status_code == 200, r.text
    body = r.json()
    assert isinstance(body["config_version"], int) and body["config_version"] >= 1
    assert len(body["config_hash"]) == 16
    # 版本号必须在签名覆盖范围内，否则客户端无法证明版本号非伪造
    from services.runtime_service import compute_config_hash, canonical_json
    import base64

    sig_b64 = body.pop("signature")
    assert base64.b64decode(sig_b64)
    assert compute_config_hash(body) == body["config_hash"]
    assert body["synced_at"], "synced_at 必须保留"


@pytest.mark.asyncio
async def test_bootstrap_requires_auth():
    async with _client() as client:
        assert (await client.get("/api/v1/runtime/bootstrap")).status_code == 401
        r = await client.get("/api/v1/runtime/bootstrap", headers={"X-Catalog-Key": "wrong"})
        assert r.status_code == 401


# ─── §2 ACK 回执 ─────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_ack_requires_auth():
    async with _client() as client:
        assert (await client.post("/api/v1/runtime/ack", json=_ack())).status_code == 401
        r = await client.post("/api/v1/runtime/ack", json=_ack(), headers={"X-Catalog-Key": "bad"})
        assert r.status_code == 401


@pytest.mark.asyncio
async def test_ack_upserts_latest_snapshot_per_client():
    """同一 client_id 只保留最新一条快照。

    验证方式是**反向查询**：若两条快照并存，按旧版本查询会命中 acked=1。
    """
    async with _client() as client:
        assert (await client.post("/api/v1/runtime/ack", json=_ack(), headers=CATALOG_HEADERS)).status_code == 200
        r = await client.post(
            "/api/v1/runtime/ack",
            json=_ack(config_version=7, config_hash="aaaaaaaaaaaaaaaa", ack_type="heartbeat"),
            headers=CATALOG_HEADERS,
        )
        assert r.status_code == 200
        latest = (await client.get("/api/v1/runtime/rollout?version=7", headers=_admin_headers())).json()
        older = (await client.get("/api/v1/runtime/rollout?version=1", headers=_admin_headers())).json()

    assert latest["total"] == 1, "旧快照应被覆盖而非追加，否则客户端总数会虚增"
    assert latest["acked"] == 1 and latest["stale"] == 0
    # 按版本 1 查询时该客户端已不被算作 confirmed —— 证明版本 1 的旧快照已被覆盖。
    # 注意 stale 的语义是「低于所查询版本」，按旧版本查询时恒为 0（客户端在更高的版本上）。
    assert older["acked"] == 0 and older["stale"] == 0
    assert older["clients"][0]["client_id"] == "client-a"
    assert older["clients"][0]["config_version"] == 7


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "over",
    [
        {"client_id": ""},
        {"client_id": "x" * 65},
        {"config_version": -1},
        {"config_version": "42"},
        {"config_hash": "NOT_A_HASH"},
        {"config_hash": "0123456789ABCDEF"},
        {"config_hash": "0123456789abcde"},
        {"ack_type": "whatever"},
        {"applied_blocks": {"a": -1}},
        {"applied_blocks": ["a"]},
        {"applied_blocks": {f"b{i}": 1 for i in range(33)}},
        {"skipped_blocks": "appMenu"},
        {"skipped_blocks": ["x" * 65]},
        {"degraded": "yes"},
        {"degraded": True, "degradation_tier": "L9"},
        {"degraded": True, "degradation_tier": None},
        {"degraded": True, "ack_type": "applied"},
    ],
)
async def test_ack_rejects_invalid_payload(over):
    """非法载荷一律 400 —— 这是唯一能证明配置生效的数据源，脏数据会污染看板。"""
    async with _client() as client:
        r = await client.post("/api/v1/runtime/ack", json=_ack(**over), headers=CATALOG_HEADERS)
        assert r.status_code == 400, f"应拒绝 {over}，实际 {r.status_code} {r.text}"


@pytest.mark.asyncio
async def test_ack_requires_degraded_since_when_degraded():
    async with _client() as client:
        r = await client.post(
            "/api/v1/runtime/ack",
            json=_ack(degraded=True, degradation_tier="L2", degraded_since=None),
            headers=CATALOG_HEADERS,
        )
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_ack_degraded_accepts_tier_and_since():
    async with _client() as client:
        r = await client.post(
            "/api/v1/runtime/ack",
            json=_ack(degraded=True, degradation_tier="L3", degraded_since="2026-10-08T10:00:00Z", ack_type="recovered"),
            headers=CATALOG_HEADERS,
        )
    assert r.status_code == 200


# ─── §2.6 生效聚合 ───────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_rollout_requires_admin():
    async with _client() as client:
        assert (await client.get("/api/v1/runtime/rollout")).status_code in (401, 403)
        r = await client.get("/api/v1/runtime/rollout", headers=CATALOG_HEADERS)
        assert r.status_code in (401, 403), "目录 Key 不得读取生效看板（内部运营数据）"


@pytest.mark.asyncio
async def test_rollout_aggregates_ack_stale_degraded():
    async with _client() as client:
        for i in range(5):
            await client.post(
                "/api/v1/runtime/ack",
                json=_ack(client_id=f"c{i}", config_version=5, config_hash="0" * 16),
                headers=CATALOG_HEADERS,
            )
        for i in range(5, 8):
            await client.post(
                "/api/v1/runtime/ack",
                json=_ack(client_id=f"c{i}", config_version=4, config_hash="1" * 16),
                headers=CATALOG_HEADERS,
            )
        await client.post(
            "/api/v1/runtime/ack",
            json=_ack(client_id="c8", config_version=5, config_hash="0" * 16,
                      degraded=True, degradation_tier="L2", degraded_since="2026-10-08T10:00:00Z"),
            headers=CATALOG_HEADERS,
        )
        rows = (await client.get("/api/v1/runtime/rollout?version=5", headers=_admin_headers())).json()

    assert rows["total"] == 9
    assert rows["acked"] == 6   # config_version == 5 的（含降级中的 c8）
    assert rows["stale"] == 3   # config_version < 5
    assert rows["degraded"] == 1
    assert rows["ack_rate"] == pytest.approx(6 / 9)
    # 分块确认率：appMenu 被 6 台确认
    assert rows["block_rates"]["appMenu"] == pytest.approx(6 / 9)


@pytest.mark.asyncio
async def test_rollout_unconfirmed_details_capped():
    async with _client() as client:
        for i in range(10):
            await client.post(
                "/api/v1/runtime/ack",
                json=_ack(client_id=f"x{i}", config_version=1, config_hash="0" * 16),
                headers=CATALOG_HEADERS,
            )
        rows = (await client.get("/api/v1/runtime/rollout?version=99&limit=3", headers=_admin_headers())).json()
    assert len(rows["clients"]) <= 3
    assert all(c["config_version"] != 99 for c in rows["clients"])


# ─── §3 断连降级遥测 ─────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_degradation_requires_auth():
    async with _client() as client:
        assert (await client.post("/api/v1/telemetry/degradation", json=_degradation())).status_code == 401
        r = await client.post("/api/v1/telemetry/degradation", json=_degradation(), headers={"X-Catalog-Key": "bad"})
        assert r.status_code == 401


@pytest.mark.asyncio
async def test_degradation_appends_history_row_per_event():
    """降级事件是流水表：同一 client 多轮断连各自一行，支撑「上周影响面」统计。"""
    async with _client() as client:
        for day in range(3):
            r = await client.post(
                "/api/v1/telemetry/degradation",
                json=_degradation(degraded_since=f"2026-10-0{day + 1}T10:00:00Z"),
                headers=CATALOG_HEADERS,
            )
            assert r.status_code == 200
        summary = (await client.get("/api/v1/telemetry/degradation/summary", headers=_admin_headers())).json()
    assert summary["total_events"] == 3
    assert summary["unique_clients"] == 1
    assert summary["total_offline_seconds"] == 5400 * 3


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "over",
    [
        {"client_id": ""},
        {"client_version": "v" * 33},
        {"channel": "smtp"},
        {"endpoint": "e" * 201},
        {"failure_kind": "WHATEVER"},
        {"consecutive_failures": 0},
        {"consecutive_failures": "3"},
        {"degraded_since": ""},
        {"degraded_since": "not-a-date"},
        {"offline_seconds": -1},
        {"serving_tier": "L9"},
    ],
)
async def test_degradation_rejects_invalid_payload(over):
    async with _client() as client:
        r = await client.post("/api/v1/telemetry/degradation", json=_degradation(**over), headers=CATALOG_HEADERS)
        assert r.status_code == 400, f"应拒绝 {over}，实际 {r.status_code} {r.text}"


@pytest.mark.asyncio
async def test_degradation_accepts_unrecovered_event():
    async with _client() as client:
        r = await client.post(
            "/api/v1/telemetry/degradation",
            json=_degradation(recovered_at=None, offline_seconds=0),
            headers=CATALOG_HEADERS,
        )
    assert r.status_code == 200


@pytest.mark.asyncio
async def test_degradation_summary_requires_admin():
    async with _client() as client:
        assert (await client.get("/api/v1/telemetry/degradation/summary")).status_code in (401, 403)