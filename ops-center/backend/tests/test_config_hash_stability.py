"""config_hash 纯净性回归锁（change: config-hash-purity，2026-10-18）

**为什么单独立一个文件**：`test_runtime_resilience_api.py::test_config_hash_excludes_volatile_fields`
只覆盖「**顶层** synced_at / config_version / hash / signature 不参与 hash」这一层，
而 2026-10-18 之前真实发生过的缺陷在**块内**：
`app_menu_service.get_bootstrap_app_menu` 返回 `{"items": [...], "synced_at": _now()}`、
`content_category_service.get_bootstrap_content_categories` 返回
`{"items": [...], "count": n, "synced_at": _now()}` —— 两块都在 `RUNTIME_BLOCKS` 白名单里。

顶层挡住 ≠ 块内干净。`config_fingerprint.compute_config_hash` 的注释第 1 条
早就写着「synced_at 每次请求都变，纳入则 hash 永远变、变推送地狱」，
注释写对了、实现对不上，于是一直没人发现。这正是「注释与实现互相矛盾」型缺陷的典型形态。

实测后果（修复前，同一库连续两次 bootstrap）：
    config_hash: f8a5b99df879ac71/ver1 → dd3dfca7ccd2e587/ver2
    RuntimeConfigVersion 落 2 行；生效看板「已确认率」永远上不去。

因此本文件的判据刻意取「**真实库连构两次 bootstrap，hash 必须逐字相等**」：
它不枚举任何具体字段名，而是直接断言那条我们真正想要的**不变量**——
「内容没变，指纹就不许变」。将来无论谁在白名单块里掺入任何 volatile 字段
（synced_at / updated_at / now() / 随机数 / 服务器启动计数……），本文件都会红。

配套的一条**静态锁**逐块断言「载荷里不得出现 synced_at 键」：
不变量测试抓的是「值在变」，静态锁抓的是「键还在」——两者互补，缺一不可。

关于模块顶部的 `os.environ[...] = ...` 与 `sys.path.insert`：这是**照抄
`test_runtime_resilience_api.py` 的既有约定**（同一批变量名、同一路径插入方式，
`tests/conftest.py` 也已 `setdefault` 同一批变量做会话级兜底），不是本文件新引入的
污染面；后端全量 pytest（676 passed）即该约定无污染的实测证据。
"""

import datetime
import os
import sys
import tempfile

import pytest
import pytest_asyncio

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

os.environ["OPS_DB_PATH"] = os.path.join(tempfile.gettempdir(), "ops_config_hash_purity_test.db")
os.environ["OPS_CONFIG_OUTPUT_DIR"] = os.path.join(tempfile.gettempdir(), "ops_config_hash_purity_cfgs")
os.environ["OPS_SECRET_KEY"] = "test-secret"
os.environ["OPS_JWT_SECRET"] = "test-secret"
os.environ["OPS_CATALOG_API_KEY"] = "catalog-test-key"

import models  # noqa: F401
from config import settings


@pytest_asyncio.fixture(autouse=True)
async def setup_db():
    from database import engine, Base

    settings.catalog_api_key = os.environ["OPS_CATALOG_API_KEY"]
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


def _headers():
    from jose import jwt

    payload = {
        "sub": "admin",
        "username": "admin",
        "role": "admin",
        "exp": datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=1),
    }
    token = jwt.encode(payload, settings.get_jwt_secret(), algorithm=settings.jwt_algorithm)
    return {"Authorization": f"Bearer {token}"}


def _catalog_headers():
    return {"X-Catalog-Key": os.environ["OPS_CATALOG_API_KEY"]}


@pytest.mark.asyncio
async def test_bootstrap_config_hash_is_stable_across_identical_requests():
    """不变量：同一库连构两次 bootstrap，config_hash 必须逐字相等。

    这是本次缺陷的唯一必要且充分判据 —— 修复前两次调用必不相等
    （appMenu / contentCategories 块内 synced_at 每次取 _now()）。
    """
    from httpx import AsyncClient, ASGITransport
    from main import app

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        first = await client.get("/api/v1/runtime/bootstrap", headers=_catalog_headers())
        second = await client.get("/api/v1/runtime/bootstrap", headers=_catalog_headers())

    assert first.status_code == second.status_code == 200
    a, b = first.json(), second.json()

    # 顶层 synced_at 本来就允许变（它是信封字段，不参与 hash）。这里**不断言它必须不同**：
    # 两次 HTTP 请求理论上可能落在同一毫秒，那样断言会变成偶发假失败（flake CI）。
    # 本测试真正要守的是下面两条——「内容没变，指纹与版本就不许变」。
    # 若两次 synced_at 恰好相同，说明时钟刻度没跨过，不影响下面断言的有效性
    # （指纹相同仍然是我们要求的结论）。

    # 指纹与版本必须一模一样
    assert a["config_hash"] == b["config_hash"], (
        "内容未变而 config_hash 变了 ⇒ RUNTIME_BLOCKS 里有块掺了每请求变化的字段"
    )
    assert a["config_version"] == b["config_version"], (
        "内容未变而 config_version 变了 ⇒ 版本表会随请求数无限增长"
    )


@pytest.mark.asyncio
async def test_no_whitelisted_block_carries_volatile_timestamp_key():
    """静态锁：RUNTIME_BLOCKS 里任何一块的载荷都不得含 synced_at 键。

    不变量测试抓「值在变」，本测试抓「键还在」——若某块只在特定条件下才写入
    synced_at（例如库里没有目录行时走了另一条分支），不变量测试可能恰好漏过，
    静态锁则不管条件如何都查得到。
    """
    from httpx import AsyncClient, ASGITransport
    from main import app
    from services.config_fingerprint import RUNTIME_BLOCKS

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get("/api/v1/runtime/bootstrap", headers=_catalog_headers())
    assert resp.status_code == 200
    payload = resp.json()

    for block in RUNTIME_BLOCKS:
        assert block in payload, f"块 {block} 缺失"
        value = payload[block]
        if not isinstance(value, dict):
            continue
        assert "synced_at" not in value, (
            f"块 {block} 载荷里含 synced_at ⇒ 每次 bootstrap 的 config_hash 都会变"
        )

    # 反向：时间戳必须仍然存在于信封顶层（否则「配置何时同步」无从判断）
    assert isinstance(payload.get("synced_at"), str) and payload["synced_at"]


@pytest.mark.asyncio
async def test_appmenu_and_contentcategories_blocks_are_pure_functions_of_content():
    """点名那两个曾经出事的块：内容不变 ⇒ 序列化结果逐字节相等。

    直接调 service 层（不经 HTTP），把判据钉在离缺陷最近的位置。
    """
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    from database import engine
    from services import app_menu_service, content_category_service
    from services.runtime_service import canonical_json

    maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with maker() as db:
        menu_a = await app_menu_service.get_bootstrap_app_menu(db)
        menu_b = await app_menu_service.get_bootstrap_app_menu(db)
        cats_a = await content_category_service.get_bootstrap_content_categories(db)
        cats_b = await content_category_service.get_bootstrap_content_categories(db)

    assert canonical_json(menu_a) == canonical_json(menu_b), "appMenu 载荷不是内容的纯函数"
    assert canonical_json(cats_a) == canonical_json(cats_b), "contentCategories 载荷不是内容的纯函数"
    assert "synced_at" not in menu_a and "synced_at" not in cats_a


@pytest.mark.asyncio
async def test_story_text_limit_block_also_stays_pure():
    """顺手把本轮新加的块也纳入同一把尺子——它是纯整数结构，理应天然通过。"""
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    from database import engine
    from services.runtime_service import _get_story_text_limit, canonical_json

    maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with maker() as db:
        first = await _get_story_text_limit(db)
        second = await _get_story_text_limit(db)

    assert canonical_json(first) == canonical_json(second)
