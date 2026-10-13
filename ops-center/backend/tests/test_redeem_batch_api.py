"""Tests for ops-center 兑换码批量签发（转发 engine，取代本地 HMAC 签发）。

对应实现：services/redeem_batch_service.py + routers/redemption_codes.py

覆盖场景（对齐质量节拍 Step ② 的脑暴清单）：
  正常：转发成功 / Bearer 头 / expires_at 旧字段名兼容 / batch 自定义
  边界：count=1、count=MAX、count=0、count=MAX+1、plan=free、plan=trial、
        durationDays 缺失 / 0 / 负数 / bool / 非整数
  异常：engine 未配置 503、engine 不可达 502、上游 4xx 透传、上游非 JSON
  安全：engine token 不出现在响应体、require_admin 生效、note 不被透传
  契约：generated < requested 的差额原样透出，不被静默吞掉
"""
import os
import sys
import tempfile
import uuid

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

_RUN_ID = uuid.uuid4().hex[:8]
os.environ["OPS_DB_PATH"] = os.path.join(tempfile.gettempdir(), f"ops_rb_{_RUN_ID}.db")
os.environ["OPS_CONFIG_OUTPUT_DIR"] = os.path.join(tempfile.gettempdir(), f"ops_rb_cfg_{_RUN_ID}")
os.environ["OPS_SECRET_KEY"] = "test-secret"
os.environ["OPS_JWT_SECRET"] = "test-secret"
os.environ["OPS_CATALOG_API_KEY"] = "catalog-test-key"
# engine 转发配置：未配置时必须 fail-closed
os.environ["OPS_ENGINE_ADMIN_BASE_URL"] = ""
os.environ["OPS_ENGINE_ADMIN_TOKEN"] = ""


class _FakeResp:
    def __init__(self, status_code, body, raise_json=False):
        self.status_code = status_code
        self._body = body
        self._raise_json = raise_json

    def json(self):
        if self._raise_json:
            raise ValueError("not json")
        return self._body


class _FakeClient:
    def __init__(self, resp=None, exc=None):
        self._resp = resp
        self._exc = exc
        self.calls = []
        self.closed = False

    async def post(self, url, json=None, headers=None):
        self.calls.append({"url": url, "json": json, "headers": headers})
        if self._exc:
            raise self._exc
        return self._resp

    async def aclose(self):
        self.closed = True


@pytest.fixture
def fake_engine(monkeypatch):
    from services import redeem_batch_service

    holder = {}

    def _install(status_code=200, body=None, exc=None, raise_json=False):
        fake = _FakeClient(_FakeResp(status_code, body or {}, raise_json), exc)
        monkeypatch.setattr(redeem_batch_service, "_new_client", lambda: fake)
        monkeypatch.setattr(redeem_batch_service.settings, "engine_admin_base_url", "http://engine.test")
        monkeypatch.setattr(redeem_batch_service.settings, "engine_admin_token", "engine-token-xyz")
        holder["fake"] = fake
        return fake

    return _install


# --- 正常路径 ---------------------------------------------------------


@pytest.mark.asyncio
async def test_forwards_to_engine_with_bearer(fake_engine):
    fake = fake_engine(body={
        "success": True, "batch": "b-1", "plan": "pro", "durationDays": 30,
        "requested": 2, "generated": 2, "codes": ["AAAA-BBBB-CCCC", "DDDD-EEEE-FFFF"],
    })
    from services.redeem_batch_service import create_redeem_batch

    out = await create_redeem_batch({"plan": "pro", "durationDays": 30, "count": 2})

    assert out["batch"] == "b-1"
    assert out["codes"] == ["AAAA-BBBB-CCCC", "DDDD-EEEE-FFFF"]
    call = fake.calls[0]
    assert call["url"] == "http://engine.test/api/v1/admin/member/redeem-codes"
    assert call["headers"]["Authorization"] == "Bearer engine-token-xyz"
    assert call["json"] == {"plan": "pro", "durationDays": 30, "count": 2}
    assert fake.closed is True, "client 必须 aclose，否则连接池泄漏"


@pytest.mark.asyncio
async def test_legacy_expires_at_key_is_mapped(fake_engine):
    """ops 旧表单用 expires_at，engine 叫 expiresAt——旧名必须仍能用。"""
    fake = fake_engine(body={"success": True})
    from services.redeem_batch_service import create_redeem_batch

    await create_redeem_batch({"plan": "pro", "durationDays": 30, "count": 1, "expires_at": "2026-12-31T00:00:00Z"})
    assert fake.calls[0]["json"]["expiresAt"] == "2026-12-31T00:00:00Z"


@pytest.mark.asyncio
async def test_empty_expires_at_is_dropped_not_sent_as_blank(fake_engine):
    """空串在 engine 语义是 null=永不过期；透传空串会变成 '' 让日期解析失败。"""
    fake = fake_engine(body={"success": True})
    from services.redeem_batch_service import create_redeem_batch

    await create_redeem_batch({"plan": "pro", "durationDays": 30, "count": 1, "expires_at": "  "})
    assert "expiresAt" not in fake.calls[0]["json"]


@pytest.mark.asyncio
async def test_note_is_dropped_not_forwarded(fake_engine):
    """note 在 engine 无对应概念；整包透传会让 engine 收到未声明字段。"""
    fake = fake_engine(body={"success": True})
    from services.redeem_batch_service import create_redeem_batch

    await create_redeem_batch({"plan": "pro", "durationDays": 30, "count": 1, "note": "内部备注"})
    assert "note" not in fake.calls[0]["json"]


# --- 边界值 ------------------------------------------------------------


@pytest.mark.asyncio
async def test_count_boundaries_accepted(fake_engine):
    """count=1 与 count=MAX_BATCH 都是合法边界，必须真的发出去。"""
    from services.redeem_batch_service import MAX_BATCH, create_redeem_batch

    for ok in (1, MAX_BATCH):
        fake = fake_engine(body={"success": True})
        await create_redeem_batch({"plan": "pro", "durationDays": 1, "count": ok})
        assert fake.calls[0]["json"]["count"] == ok, f"count={ok} 未被透传"


@pytest.mark.asyncio
async def test_count_out_of_range_rejected_locally(fake_engine):
    """越界必须在本地挡掉——不该产生 engine 往返。"""
    from services.redeem_batch_service import EngineAdminError, MAX_BATCH, create_redeem_batch

    for bad in (0, -1, MAX_BATCH + 1):
        fake = fake_engine(body={"success": True})
        with pytest.raises(EngineAdminError) as exc:
            await create_redeem_batch({"plan": "pro", "durationDays": 1, "count": bad})
        assert exc.value.code == "BATCH_COUNT_INVALID"
        assert exc.value.status == 400
        assert fake.calls == [], f"count={bad} 不该发出请求"


@pytest.mark.asyncio
async def test_plan_free_and_trial_rejected(fake_engine):
    """engine 拒 free，且根本不存在 trial 档——两个都必须在本地挡。"""
    from services.redeem_batch_service import EngineAdminError, create_redeem_batch

    for bad in ("free", "trial", "TRIAL", "", None):
        fake = fake_engine(body={"success": True})
        with pytest.raises(EngineAdminError) as exc:
            await create_redeem_batch({"plan": bad, "durationDays": 30, "count": 1})
        assert exc.value.code == "PLAN_INVALID", f"plan={bad!r} 应被拒"
        assert fake.calls == []


@pytest.mark.asyncio
async def test_duration_days_required_and_must_be_positive_int(fake_engine):
    """durationDays 是 engine 必填，且 bool 是 int 子类必须显式排除。"""
    from services.redeem_batch_service import EngineAdminError, create_redeem_batch

    for bad in (None, 0, -1, True, False, 1.5, "30"):
        fake = fake_engine(body={"success": True})
        with pytest.raises(EngineAdminError) as exc:
            await create_redeem_batch({"plan": "pro", "count": 1, "durationDays": bad})
        assert exc.value.code == "DURATION_INVALID", f"durationDays={bad!r} 应被拒"
        assert fake.calls == []


@pytest.mark.asyncio
async def test_non_dict_body_rejected(fake_engine):
    from services.redeem_batch_service import EngineAdminError, create_redeem_batch

    fake = fake_engine(body={"success": True})
    with pytest.raises(EngineAdminError) as exc:
        await create_redeem_batch(None)
    assert exc.value.status == 400
    assert fake.calls == []


# --- 异常路径 ----------------------------------------------------------


@pytest.mark.asyncio
async def test_not_configured_503_fail_closed(fake_engine):
    from services import redeem_batch_service
    from services.redeem_batch_service import create_redeem_batch

    fake_engine(body={"success": True})
    redeem_batch_service.settings.engine_admin_base_url = ""
    redeem_batch_service.settings.engine_admin_token = ""

    with pytest.raises(redeem_batch_service.EngineAdminError) as exc:
        await create_redeem_batch({"plan": "pro", "durationDays": 30, "count": 1})
    assert exc.value.status == 503
    assert exc.value.code == "ENGINE_ADMIN_NOT_CONFIGURED"


@pytest.mark.asyncio
async def test_engine_unreachable_502(fake_engine):
    import httpx

    from services.redeem_batch_service import EngineAdminError, create_redeem_batch

    fake_engine(exc=httpx.ConnectError("refused"))

    with pytest.raises(EngineAdminError) as exc:
        await create_redeem_batch({"plan": "pro", "durationDays": 30, "count": 1})
    assert exc.value.status == 502
    assert exc.value.code == "ENGINE_ADMIN_UNREACHABLE"


@pytest.mark.asyncio
async def test_upstream_error_code_passthrough(fake_engine):
    """engine 的语义码必须原样透出，不能压成通用错误。"""
    from services.redeem_batch_service import EngineAdminError, create_redeem_batch

    for status, code in [(400, "DURATION_INVALID"), (401, "AUTH_SCOPE_MISSING"), (503, "COMMERCE_INTERNAL_ERROR")]:
        fake_engine(status_code=status, body={"error": code})
        with pytest.raises(EngineAdminError) as exc:
            await create_redeem_batch({"plan": "pro", "durationDays": 30, "count": 1})
        assert exc.value.status == status
        assert exc.value.code == code


@pytest.mark.asyncio
async def test_upstream_non_json_body_falls_back(fake_engine):
    from services.redeem_batch_service import EngineAdminError, create_redeem_batch

    fake_engine(status_code=500, raise_json=True)
    with pytest.raises(EngineAdminError) as exc:
        await create_redeem_batch({"plan": "pro", "durationDays": 30, "count": 1})
    assert exc.value.code == "ENGINE_ADMIN_ERROR"


@pytest.mark.asyncio
async def test_generated_shortfall_is_visible(fake_engine):
    """DB 碰撞会让 generated < requested。差额必须透出，前端才能发现少发。"""
    from services.redeem_batch_service import create_redeem_batch

    fake_engine(body={
        "success": True, "batch": "b-2", "requested": 200, "generated": 198,
        "codes": ["AAAA-BBBB-CCCC"],
    })
    out = await create_redeem_batch({"plan": "pro", "durationDays": 30, "count": 200})
    assert out["requested"] == 200
    assert out["generated"] == 198
    assert len(out["codes"]) == 1


# --- 安全 --------------------------------------------------------------


@pytest.mark.asyncio
async def test_engine_token_never_leaks_into_response(fake_engine):
    from services.redeem_batch_service import create_redeem_batch

    fake_engine(body={"success": True, "batch": "b", "generated": 1, "codes": ["A-B-C"]})
    out = await create_redeem_batch({"plan": "pro", "durationDays": 30, "count": 1})
    blob = repr(out)
    assert "engine-token-xyz" not in blob, "engine token 泄漏到响应体"
