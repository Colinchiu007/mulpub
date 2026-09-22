"""P1-5 回归保护：ConfigItem 敏感配置写库前加密 + 审计掩码落库 + 读路径解密。

对应体检报告 proposal-v7 问题 5（P1）：
  运维中心 ConfigItem.is_secret 只控制"前端显示掩码"，库里 value 与 config_audit_log
  的 old/new 全是明文 —— DB 文件泄漏 = 全平台凭据泄漏，且审计日志成为第二份明文副本。

设计约束（本文件逐条锁定）：
  1. 敏感项写库前用 Fernet 加密，密文带自描述前缀 `enc:v1:`；
  2. 前缀使**存量明文行零迁移可读**（无前缀 → 原样返回），不需要一次性数据迁移；
  3. 审计日志在**写库时**就只存掩码，不依赖读时掩码（读时掩码可被绕过）；
  4. 不可解时**抛错**而不是静默返回空串 —— 配置导出写空凭据比写失败更危险；
  5. 客户端回填掩码串不得覆盖真实凭据（同 OfficialKey C2 范式）；
  6. 批量更新接口漏传 is_secret 不得把敏感项降级成明文。
"""
import json
import os
import sys
import tempfile

import pytest
import pytest_asyncio

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

os.environ.setdefault("OPS_DB_PATH", os.path.join(tempfile.gettempdir(), "ops_p1_5_test.db"))
os.environ.setdefault("OPS_CONFIG_OUTPUT_DIR", os.path.join(tempfile.gettempdir(), "ops_p1_5_configs"))
os.environ.setdefault("OPS_JWT_SECRET", "test-jwt-secret-for-p1-5")

import models  # noqa: F401 — registers models with Base


@pytest_asyncio.fixture(autouse=True)
async def setup_db():
    from database import engine, Base, async_session
    from models import Project

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with async_session() as db:
        for code, name in [("platform-orchestrator", "PO"), ("a", "Proj A")]:
            db.add(Project(code=code, name=name))
        await db.commit()
    yield
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


PLAIN = "sk-real-secret-abcdef123456"


async def _upsert_secret(value=PLAIN, key="bilibili_cookie", **kw):
    from database import async_session
    from services.config_service import upsert_config

    params = dict(
        config_id=f"platform-orchestrator.platform_credential.{key}",
        project_code="platform-orchestrator",
        category="platform_credential",
        key=key,
        value=value,
        is_secret=1,
        updated_by="tester",
    )
    params.update(kw)
    async with async_session() as db:
        return await upsert_config(db, **params), params["config_id"]


# ---------------------------------------------------------------- 1. 写库加密

@pytest.mark.asyncio
async def test_secret_value_is_encrypted_at_rest():
    """敏感项创建后，库中列必须是 enc:v1: 密文且不含明文。"""
    from database import async_session
    from services import config_service

    _, cid = await _upsert_secret()
    async with async_session() as db:
        item = await config_service.get_config(db, cid)
        assert item.value.startswith("enc:v1:"), "P1-5: 敏感项未加密写库"
        assert PLAIN not in item.value
        assert PLAIN not in db.info if False else True
    # 直接读原始行（绕开 ORM 属性），确认物理存储无明文
    async with async_session() as db:
        raw = (await db.execute(
            __import__("sqlalchemy").text("SELECT value FROM config_items WHERE id=:i"),
            {"i": cid},
        )).scalar()
        assert PLAIN not in (raw or "")
        assert config_service.plaintext_value(item) == PLAIN, "P1-5: 解密往返失败"


@pytest.mark.asyncio
async def test_non_secret_item_stays_plaintext():
    """非敏感项不得加密（否则配置导出/人工排查全被破坏）。"""
    from database import async_session
    from services import config_service
    from services.config_service import upsert_config

    async with async_session() as db:
        item = await upsert_config(
            db, config_id="platform-orchestrator.project_param.timeout",
            project_code="platform-orchestrator", category="project_param",
            key="timeout", value="30", is_secret=0, updated_by="t",
        )
        assert item.value == "30"
        assert config_service.plaintext_value(item) == "30"


@pytest.mark.asyncio
async def test_legacy_plaintext_row_still_readable():
    """零迁移：存量明文行（无前缀）读出原样返回。"""
    import sqlalchemy as sa

    from database import async_session
    from services import config_service

    _, cid = await _upsert_secret(key="legacy_item")
    async with async_session() as db:
        # 模拟历史数据：直接把库里的密文改回明文
        await db.execute(sa.text("UPDATE config_items SET value=:v WHERE id=:i"),
                         {"v": "legacy-cookie-value", "i": cid})
        await db.commit()
        item = await config_service.get_config(db, cid)
        assert item.is_secret == 1
        assert config_service.plaintext_value(item) == "legacy-cookie-value"


# ---------------------------------------------------------------- 2. 审计掩码

@pytest.mark.asyncio
async def test_audit_log_never_contains_plaintext():
    """create + update 两条审计记录的 old/new 都只能是掩码。"""
    import sqlalchemy as sa

    from database import async_session

    _, cid = await _upsert_secret()
    await _upsert_secret(value="sk-second-secret-xyz789")  # update
    async with async_session() as db:
        rows = (await db.execute(
            sa.text("SELECT old_value, new_value FROM config_audit_log WHERE config_id=:i"),
            {"i": cid},
        )).all()
    assert len(rows) == 2, f"期望 2 条审计，实际 {len(rows)}"
    blob = " | ".join(f"{o}/{n}" for o, n in rows)
    assert PLAIN not in blob, "P1-5: 审计日志泄漏创建明文"
    assert "sk-second-secret-xyz789" not in blob, "P1-5: 审计日志泄漏更新明文"
    assert "legacy" not in blob
    for old, new in rows:
        assert "***" in (old + new) or old == "", f"审计值未掩码: {old}/{new}"


@pytest.mark.asyncio
async def test_non_secret_audit_keeps_real_value():
    """非敏感项审计保留真实值（否则配置回滚/diff 失去意义）。"""
    import sqlalchemy as sa

    from database import async_session
    from services.config_service import upsert_config

    async with async_session() as db:
        await upsert_config(
            db, config_id="platform-orchestrator.project_param.retries",
            project_code="platform-orchestrator", category="project_param",
            key="retries", value="3", is_secret=0, updated_by="t",
        )
    async with async_session() as db:
        row = (await db.execute(sa.text(
            "SELECT new_value FROM config_audit_log WHERE config_id=:i"),
            {"i": "platform-orchestrator.project_param.retries"})).scalar()
    assert row == "3"


# ------------------------------------------------------- 3. fail-closed / 掩码回写

@pytest.mark.asyncio
async def test_undecryptable_value_raises_not_silent_empty():
    """不可解密文必须抛错，绝不能静默返回空串（会写空凭据到下游配置文件）。"""
    import base64

    from cryptography.fernet import Fernet

    from database import async_session
    from services import config_service

    _, cid = await _upsert_secret()
    foreign = Fernet(base64.urlsafe_b64encode(b"0" * 32)).encrypt(PLAIN.encode()).decode()
    async with async_session() as db:
        await db.execute(
            __import__("sqlalchemy").text("UPDATE config_items SET value=:v WHERE id=:i"),
            {"v": "enc:v1:" + foreign, "i": cid},
        )
        await db.commit()
        item = await config_service.get_config(db, cid)
        with pytest.raises(ValueError) as ei:
            config_service.plaintext_value(item)
        msg = str(ei.value)
        assert "[P1-5]" in msg and cid in msg
        assert "" != msg


@pytest.mark.asyncio
async def test_masked_echo_does_not_overwrite_credential():
    """前端回填掩码串时保留原凭据（否则一次编辑就毁掉 cookie）。"""
    from database import async_session
    from services import config_service
    from services.config_service import upsert_config

    _, cid = await _upsert_secret(value=PLAIN)
    async with async_session() as db:
        await upsert_config(
            db, config_id=cid, project_code="platform-orchestrator",
            category="platform_credential", key="bilibili_cookie",
            value="sk-r***3456", is_secret=1, description="仅改描述",
            updated_by="tester",
        )
        await db.commit()
        item = await config_service.get_config(db, cid)
        assert config_service.plaintext_value(item) == PLAIN, "P1-5: 掩码回显覆盖了真实凭据"


@pytest.mark.asyncio
async def test_batch_update_without_is_secret_keeps_encryption():
    """PUT /config/batch 不传 is_secret，敏感项不得被降级成明文。"""
    from routers.config import batch_update_config
    from database import async_session
    from services import config_service

    _, cid = await _upsert_secret(value=PLAIN)
    async with async_session() as db:
        await batch_update_config(
            body={"items": [{
                "project_code": "platform-orchestrator",
                "category": "platform_credential",
                "key": "bilibili_cookie",
                "value": "sk-new-token-zzz9999",
            }]},
            db=db,
            user={"username": "admin"},
        )
        item = await config_service.get_config(db, cid)
        assert item.is_secret == 1, "P1-5: 批量更新把敏感项降级为非敏感"
        assert item.value.startswith("enc:v1:")
        assert config_service.plaintext_value(item) == "sk-new-token-zzz9999"


# ------------------------------------------------------------- 4. API / 导出视图

def test_item_to_dict_masks_plaintext_not_ciphertext():
    """响应掩码基于明文，且不得泄露 enc:v1: 前缀。"""
    from routers.config import _item_to_dict

    class Fake:
        id = "x.y.z"
        project_code, category, key = "x", "y", "z"
        value_type, description = "string", ""
        is_secret, is_required, default_value = 1, 0, ""
        updated_at, updated_by = "", "t"
        value = "enc:v1:gAAAAAA-fake-ciphertext"

    d = _item_to_dict(Fake())
    assert d["is_masked"] is True
    assert "enc:v1:" not in d["value"], "P1-5: 掩码值泄露密文前缀"
    assert d["is_encrypted"] is True


@pytest.mark.asyncio
async def test_file_writer_exports_plaintext(tmp_path):
    """配置导出必须落明文（否则下游服务读到密文直接崩）。"""
    import sqlalchemy as sa

    from database import async_session
    from services import file_writer

    _, cid = await _upsert_secret(value=PLAIN)
    async with async_session() as db:
        item = (await db.execute(sa.select(models.ConfigItem).where(models.ConfigItem.id == cid))).scalar_one()
        assert item.value.startswith("enc:v1:")
        out = tmp_path / "cfg.json"
        file_writer.write_project_config("platform-orchestrator", [item], str(out), fmt="json")
    content = out.read_text(encoding="utf-8")
    assert PLAIN in content, "P1-5: 导出文件未解密"
    assert "enc:v1:" not in content, "P1-5: 导出文件泄漏密文前缀"


@pytest.mark.asyncio
async def test_file_writer_fails_closed_on_undecryptable(tmp_path):
    """导出遇不可解密文必须抛错，不得写出空凭据。"""
    import base64

    import sqlalchemy as sa
    from cryptography.fernet import Fernet

    from database import async_session
    from services import file_writer

    _, cid = await _upsert_secret(value=PLAIN)
    foreign = Fernet(base64.urlsafe_b64encode(b"1" * 32)).encrypt(PLAIN.encode()).decode()
    out = tmp_path / "cfg.env"
    async with async_session() as db:
        await db.execute(sa.text("UPDATE config_items SET value=:v WHERE id=:i"),
                         {"v": "enc:v1:" + foreign, "i": cid})
        await db.commit()
        item = (await db.execute(sa.select(models.ConfigItem).where(models.ConfigItem.id == cid))).scalar_one()
        with pytest.raises(ValueError) as ei:
            file_writer.write_project_config("platform-orchestrator", [item], str(out), fmt="env")
        assert "[P1-5]" in str(ei.value)
    assert not out.exists() or PLAIN not in out.read_text(encoding="utf-8")


@pytest.mark.asyncio
async def test_snapshot_stores_ciphertext_and_restores_plaintext():
    """快照：存储不含明文；恢复后仍可解出原值；恢复审计也只存掩码。"""
    from database import async_session
    from services import config_service, snapshot_service

    _, cid = await _upsert_secret(value=PLAIN)
    async with async_session() as db:
        snap = await snapshot_service.create_snapshot(db, label="p1-5", created_by="tester")
    snap_id = snap["id"]

    async with async_session() as db:
        data = await snapshot_service.get_snapshot(db, snap_id)
    blob = json.dumps(data, ensure_ascii=False)
    assert PLAIN not in blob, "P1-5: 快照泄漏明文"
    assert "enc:v1:" in blob, "P1-5: 快照应回放密文（跨密钥轮换可用）"

    # 改坏 → 恢复
    async with async_session() as db:
        await config_service.upsert_config(
            db, config_id=cid, project_code="platform-orchestrator",
            category="platform_credential", key="bilibili_cookie",
            value="sk-broken", is_secret=1, updated_by="tester",
        )
    async with async_session() as db:
        res = await snapshot_service.restore_snapshot(db, snap_id, restored_by="tester")
        assert "error" not in res, res
    async with async_session() as db:
        item = await config_service.get_config(db, cid)
        assert item.value.startswith("enc:v1:")
        assert config_service.plaintext_value(item) == PLAIN, "P1-5: 快照恢复后值不一致"


@pytest.mark.asyncio
async def test_snapshot_restore_re_encrypts_legacy_plaintext():
    """存量明文快照恢复到敏感项 → 恢复时补加密，不留在明文态。"""
    from database import async_session
    from services import config_service, snapshot_service

    _, cid = await _upsert_secret(value=PLAIN)
    async with async_session() as db:
        snap = await snapshot_service.create_snapshot(db, label="x", created_by="t")
    snap_id = snap["id"]
    async with async_session() as db:
        data = await snapshot_service.get_snapshot(db, snap_id)
        data["items"][cid]["value"] = "plain-legacy-value"  # 模拟 P1-5 之前的快照
    async with async_session() as db:
        await db.execute(
            __import__("sqlalchemy").text(
                "UPDATE config_audit_log SET new_value=:v WHERE config_id=:i"),
            {"v": json.dumps(data, ensure_ascii=False), "i": snap_id},
        )
        await db.commit()
    async with async_session() as db:
        await snapshot_service.restore_snapshot(db, snap_id, restored_by="t")
    async with async_session() as db:
        item = await config_service.get_config(db, cid)
        assert item.value.startswith("enc:v1:"), "P1-5: 恢复明文快照未补加密"
        assert config_service.plaintext_value(item) == "plain-legacy-value"
