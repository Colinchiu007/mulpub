"""P2 技术债（audit-batch-4）：ops-center 事务与查询收敛回归。

覆盖四处缺陷：
1. ``batch_upsert_configs`` 必须整批单事务（1 次 SELECT 预取 + 1 次 COMMIT），
   中途异常整体回滚——旧实现逐条 upsert + 逐条 commit，失败会留「半更新」状态。
2. 审计日志掩码不得逐行回查配置项（limit=500 时最多 1000 次 SELECT）。
3. ``GET /sync/status`` 不得逐项目查配置（只需要条数，一次 GROUP BY 足够）。
4. SSRF 守卫的 DNS 解析不得阻塞事件循环（async 路由内必须走 asyncio.to_thread）。
"""
import asyncio
import io
import os
import socket
import sys
import tempfile
import threading

import pytest
import pytest_asyncio
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

os.environ.setdefault("OPS_DB_PATH", os.path.join(tempfile.gettempdir(), "ops_test.db"))
os.environ.setdefault("OPS_CONFIG_OUTPUT_DIR", os.path.join(tempfile.gettempdir(), "ops_test_configs"))
os.environ.setdefault("OPS_SECRET_KEY", "test-secret")
os.environ.setdefault("OPS_JWT_SECRET", "test-secret")

import models  # noqa: F401  registers models with Base


@pytest_asyncio.fixture(autouse=True)
async def setup_db():
    from database import engine, Base, async_session
    from models import Project

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with async_session() as db:
        for code, name in [("platform-orchestrator", "PO"), ("a", "Proj A"), ("b", "Proj B")]:
            db.add(Project(code=code, name=name))
        await db.commit()
    yield
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


def _payload(idx, project="a", key=None, value="v"):
    key = key or f"k{idx}"
    return {
        "config_id": f"{project}.feature_flag.{key}",
        "project_code": project,
        "category": "feature_flag",
        "key": key,
        "value": value,
    }


def _counting_session(db):
    """给 session 挂上 SELECT / COMMIT 计数（不改变行为）。"""
    stats = {"select": 0, "commit": 0}
    orig_execute = db.execute
    orig_commit = db.commit

    async def execute(statement, *args, **kwargs):
        if str(statement).lstrip().upper().startswith("SELECT"):
            stats["select"] += 1
        return await orig_execute(statement, *args, **kwargs)

    async def commit():
        stats["commit"] += 1
        return await orig_commit()

    db.execute = execute
    db.commit = commit
    return stats


@pytest.mark.asyncio
async def test_batch_upsert_uses_single_transaction_and_prefetch():
    from database import async_session
    from services import config_service

    async with async_session() as db:
        stats = _counting_session(db)
        items = await config_service.batch_upsert_configs(
            db, [_payload(i) for i in range(5)], updated_by="tester",
        )
        assert len(items) == 5
        # 1 次批量预取（旧实现是 5 次逐条 SELECT）+ 整批 1 次 COMMIT（旧实现 5 次）
        assert stats["select"] == 1, f"预取应合并为 1 条 SELECT，实际 {stats['select']} 条"
        assert stats["commit"] == 1, f"整批必须单事务，实际 COMMIT {stats['commit']} 次"

    async with async_session() as check:
        got = await config_service.get_configs_by_project(check, "a", "feature_flag")
        assert len(got) == 5
        logs = await config_service.get_audit_logs(check)
        assert len(logs) == 5


@pytest.mark.asyncio
async def test_batch_upsert_rolls_back_whole_batch_on_failure(monkeypatch):
    """中途失败不得留下「前半已生效」的半更新状态。"""
    from database import async_session
    from services import config_service

    real = config_service._apply_upsert

    def explode_on_second(session, existing, config_id, *args, **kwargs):
        if config_id.endswith("k1"):
            raise RuntimeError("模拟第二条写入失败")
        return real(session, existing, config_id, *args, **kwargs)

    monkeypatch.setattr(config_service, "_apply_upsert", explode_on_second)

    async with async_session() as db:
        with pytest.raises(RuntimeError, match="模拟第二条写入失败"):
            await config_service.batch_upsert_configs(
                db, [_payload(0), _payload(1), _payload(2)], updated_by="tester",
            )

    monkeypatch.undo()
    async with async_session() as check:
        got = await config_service.get_configs_by_project(check, "a", "feature_flag")
        assert got == [], f"整批回滚失败，残留 {len(got)} 条：{[i.id for i in got]}"
        logs = await config_service.get_audit_logs(check)
        assert logs == [], "配置未落库却留下了审计日志，掩码与真实变更不成套"


@pytest.mark.asyncio
async def test_audit_log_masks_secret_without_per_row_lookup(monkeypatch):
    from database import async_session
    from services import config_service
    from routers import config as config_router

    secret = "sk-longsecret-value"
    async with async_session() as db:
        await config_service.upsert_config(
            db, "a.api_key.s1", "a", "api_key", "s1", secret, is_secret=1, updated_by="tester",
        )
        await config_service.upsert_config(
            db, "a.api_key.s2", "a", "api_key", "s2", "plain-value", is_secret=0, updated_by="tester",
        )

        async def boom(*args, **kwargs):
            raise AssertionError("审计日志掩码不得逐行回查配置项（N+1）")

        monkeypatch.setattr(config_service, "get_config", boom)

        resp = await config_router.get_audit_log(
            config_id=None, limit=100, offset=0, db=db, _user={"username": "tester"},
        )
    kinds = {row["config_id"]: row for row in resp["logs"]}
    masked = kinds["a.api_key.s1"]
    assert secret not in masked["new_value"]
    assert masked["new_value"] == "sk-l***alue"
    plain = kinds["a.api_key.s2"]
    assert plain["new_value"] == "plain-value"


@pytest.mark.asyncio
async def test_sync_status_counts_with_group_by(monkeypatch):
    from database import async_session
    from services import config_service
    from routers import sync as sync_router

    async with async_session() as db:
        for i in range(3):
            await config_service.upsert_config(
                db, f"a.feature_flag.f{i}", "a", "feature_flag", f"f{i}", "true", updated_by="t",
            )
        await config_service.upsert_config(db, "b.feature_flag.g0", "b", "feature_flag", "g0", "1", updated_by="t")

        async def boom(*args, **kwargs):
            raise AssertionError("sync/status 不得逐项目查询配置明细")

        monkeypatch.setattr(config_service, "get_configs_by_project", boom)

        resp = await sync_router.sync_status(db=db, user={"username": "t"})

    counts = {row["project"]: row["items_in_db"] for row in resp["projects"]}
    assert counts["a"] == 3
    assert counts["b"] == 1
    assert counts["platform-orchestrator"] == 0


@pytest.mark.asyncio
async def test_ssrf_dns_resolution_runs_off_event_loop(monkeypatch):
    """async 路由里的 DNS 解析必须丢线程池：阻塞 getaddrinfo 会卡死整个服务。"""
    from services.model_preset_service import _validate_target_url_async

    seen = {}

    def fake_getaddrinfo(host, port, *args, **kwargs):
        seen["thread"] = threading.current_thread().name
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", 443))]

    monkeypatch.setattr(socket, "getaddrinfo", fake_getaddrinfo)
    out = await _validate_target_url_async("https://example.com/v1/models")

    assert out == "https://example.com/v1/models"
    assert seen.get("thread"), "没有走 DNS 解析分支，用例失效"
    assert seen["thread"] != threading.main_thread().name, "DNS 解析仍在事件循环线程内执行"


def test_fetch_models_source_has_no_blocking_getaddrinfo():
    path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "services", "model_preset_service.py")
    src = io.open(path, encoding="utf-8").read()
    start = src.index("async def fetch_models_from_url")
    end = src.index("_validate_target_url_async")
    block = src[start:end]
    assert "await asyncio.to_thread(" in block
    assert "resolved = socket.getaddrinfo" not in block, "async 路由内仍有同步 DNS 解析"


@pytest.mark.asyncio
async def test_batch_upsert_keeps_p1_5_secret_semantics():
    """批量路径必须与单条路径同语义：加密入库 + 审计表不留明文凭据。

    审计行的构造从 upsert_config 搬进了 batch_upsert_configs（为了整批单事务），
    不把这条锁住，P1-5「写库时掩码」就会在 PUT /config/batch 入口静默回退成
    「明文凭据进 config_audit_log」—— 而审计日志的读取权限比配置表宽得多。
    """
    from sqlalchemy import select
    from database import async_session
    from models import ConfigAuditLog
    from services import config_service

    cid = "a.platform_credential.bilibili_cookie"
    first = "sk-batch-first-1234567890"
    second = "sk-batch-second-9876543210"

    async with async_session() as db:
        await config_service.upsert_config(
            db, cid, "a", "platform_credential", "bilibili_cookie", first,
            is_secret=1, updated_by="tester",
        )
    async with async_session() as db:
        # 批量入口刻意不传 is_secret（前端表单就不带这个字段）
        await config_service.batch_upsert_configs(db, [{
            "config_id": cid, "project_code": "a", "category": "platform_credential",
            "key": "bilibili_cookie", "value": second,
        }], updated_by="tester")

    async with async_session() as check:
        item = await config_service.get_config(check, cid)
        assert item.is_secret == 1, "批量更新把敏感项降级为非敏感"
        assert item.value.startswith("enc:v1:"), "批量路径漏了写库前加密"
        assert config_service.plaintext_value(item) == second
        rows = (await check.execute(
            select(ConfigAuditLog).where(ConfigAuditLog.config_id == cid)
        )).scalars().all()
        assert len(rows) == 2
        for row in rows:
            joined = (row.old_value or "") + "|" + (row.new_value or "")
            assert first not in joined and second not in joined, f"明文凭据进审计表：{joined}"
        latest = rows[-1]
        assert "***" in latest.old_value and "***" in latest.new_value


@pytest.mark.asyncio
async def test_batch_upsert_masked_echo_preserves_credential():
    """批量提交掩码回显值 = 未修改，不得用 "***" 串覆盖真实凭据。"""
    from database import async_session
    from services import config_service

    cid = "a.platform_credential.wb_cookie"
    plain = "sk-real-cookie-value-4321"
    async with async_session() as db:
        await config_service.upsert_config(
            db, cid, "a", "platform_credential", "wb_cookie", plain,
            is_secret=1, updated_by="tester",
        )
    masked_echo = config_service.audit_display_value(1, plain)
    assert "***" in masked_echo

    async with async_session() as db:
        await config_service.batch_upsert_configs(db, [{
            "config_id": cid, "project_code": "a", "category": "platform_credential",
            "key": "wb_cookie", "value": masked_echo,
        }], updated_by="tester")

    async with async_session() as check:
        item = await config_service.get_config(check, cid)
        assert config_service.plaintext_value(item) == plain, "掩码回显覆盖了真实凭据"
