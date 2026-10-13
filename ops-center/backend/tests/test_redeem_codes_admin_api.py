"""Tests for ops-center 兑换码**运营查询/吊销**转发（engine A2 能力）。

对应实现：services/redeem_batch_service.py + routers/redemption_codes.py

覆盖场景（对齐质量节拍 Step ② 的脑暴清单）：
  正常：列表转发 / 吊销转发 / Bearer 头
  边界：limit 上下界、offset 负数、默认分页
  异常：engine 未配置 503、不可达 502、上游 4xx 透传
  安全：**默认掩码不被本层解除**、reveal 必须严格 true、
        revoked→disabled 词表映射、engine token 不泄漏
  契约：REDEEM_BATCH_INCOMPLETE 的已签发码必须原样到达前端

⚠️ 本层是纯转发方：**任何在此新增的"帮助性"转换都会让 ops 成为第二套权威**。
测试的作用正是钉死「本层不改变 engine 的安全语义」。
"""
import os
import sys
import tempfile
import uuid

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

_RUN_ID = uuid.uuid4().hex[:8]
os.environ["OPS_DB_PATH"] = os.path.join(tempfile.gettempdir(), f"ops_rq_{_RUN_ID}.db")
os.environ["OPS_CONFIG_OUTPUT_DIR"] = os.path.join(tempfile.gettempdir(), f"ops_rq_cfg_{_RUN_ID}")
os.environ["OPS_SECRET_KEY"] = "test-secret"
os.environ["OPS_JWT_SECRET"] = "test-secret"
os.environ["OPS_CATALOG_API_KEY"] = "catalog-test-key"
# engine 转发配置：未配置时必须 fail-closed
os.environ["OPS_ENGINE_ADMIN_BASE_URL"] = ""
os.environ["OPS_ENGINE_ADMIN_TOKEN"] = ""


class _FakeResp:
    def __init__(self, status_code, body):
        self.status_code = status_code
        self._body = body

    def json(self):
        if self._body is None:
            raise ValueError("not json")
        return self._body


class _FakeClient:
    def __init__(self, resp=None, exc=None):
        self._resp = resp
        self._exc = exc
        self.calls = []
        self.closed = False

    async def request(self, method, url, json=None, params=None, headers=None):
        self.calls.append(
            {"method": method, "url": url, "json": json, "params": params, "headers": headers}
        )
        if self._exc:
            raise self._exc
        return self._resp

    async def aclose(self):
        self.closed = True


@pytest.fixture
def fake_engine(monkeypatch):
    from services import redeem_batch_service

    holder = {}

    def _install(status_code=200, body=None, exc=None):
        fake = _FakeClient(_FakeResp(status_code, body if body is not None else {}), exc)
        monkeypatch.setattr(redeem_batch_service, "_new_client", lambda: fake)
        monkeypatch.setattr(
            redeem_batch_service.settings, "engine_admin_base_url", "http://engine.test"
        )
        monkeypatch.setattr(redeem_batch_service.settings, "engine_admin_token", "engine-token-xyz")
        holder["fake"] = fake
        return fake

    return _install


# --- 正常路径 ---------------------------------------------------------


@pytest.mark.asyncio
async def test_list_defaults_to_masked_and_forwards(fake_engine):
    """默认 reveal=false：本层不得替调用方解除 engine 的掩码。"""
    from services import redeem_batch_service

    fake = fake_engine(body={"success": True, "codes": [], "total": 0, "revealed": False})
    out = await redeem_batch_service.list_redeem_codes({})

    call = fake.calls[0]
    assert call["method"] == "GET"
    assert call["url"].endswith("/api/v1/admin/member/redeem-codes")
    assert call["params"]["reveal"] == "false"
    assert call["params"]["limit"] == 20 and call["params"]["offset"] == 0
    assert out["revealed"] is False


@pytest.mark.asyncio
async def test_list_bearer_header_present(fake_engine):
    from services import redeem_batch_service

    fake = fake_engine(body={"codes": []})
    await redeem_batch_service.list_redeem_codes({})
    assert fake.calls[0]["headers"]["Authorization"] == "Bearer engine-token-xyz"


@pytest.mark.asyncio
async def test_reveal_only_when_explicitly_true(fake_engine):
    """只有严格 true 才放行；"1"/"yes"/1 都按 false 传给 engine。"""
    from services import redeem_batch_service

    for value, expected in [(True, "true"), ("true", "true"), (1, "false"), ("1", "false"),
                            ("yes", "false"), (False, "false"), (None, "false")]:
        fake = fake_engine(body={"codes": []})
        await redeem_batch_service.list_redeem_codes({"reveal": value})
        assert fake.calls[0]["params"]["reveal"] == expected, f"reveal={value!r}"


@pytest.mark.asyncio
async def test_list_maps_revoked_to_disabled(fake_engine):
    """ops 旧契约用 revoked；engine 只有 disabled。本层映射，不把 400 甩给前端。"""
    from services import redeem_batch_service

    fake = fake_engine(body={"codes": []})
    await redeem_batch_service.list_redeem_codes({"status": "revoked"})
    assert fake.calls[0]["params"]["status"] == "disabled"


@pytest.mark.asyncio
async def test_list_passes_through_engine_statuses(fake_engine):
    from services import redeem_batch_service

    for status in ("active", "used", "disabled"):
        fake = fake_engine(body={"codes": []})
        await redeem_batch_service.list_redeem_codes({"status": status})
        assert fake.calls[0]["params"]["status"] == status


@pytest.mark.asyncio
async def test_disable_forwards_code(fake_engine):
    from services import redeem_batch_service

    fake = fake_engine(body={"success": True, "code": "ABCD-EFGH-JKMN",
                             "status": "disabled", "idempotent": False})
    out = await redeem_batch_service.disable_redeem_code({"code": "ABCD-EFGH-JKMN"})

    call = fake.calls[0]
    assert call["method"] == "POST"
    assert call["url"].endswith("/api/v1/admin/member/redeem-codes/disable")
    assert call["json"] == {"code": "ABCD-EFGH-JKMN"}
    assert out["idempotent"] is False


@pytest.mark.asyncio
async def test_disable_trims_whitespace(fake_engine):
    from services import redeem_batch_service

    fake = fake_engine(body={"status": "disabled"})
    await redeem_batch_service.disable_redeem_code({"code": "  ABCD-EFGH-JKMN  "})
    assert fake.calls[0]["json"] == {"code": "ABCD-EFGH-JKMN"}


# --- 边界 -------------------------------------------------------------


@pytest.mark.asyncio
@pytest.mark.parametrize("limit", [1, 20, 200])
async def test_list_accepts_limit_bounds(fake_engine, limit):
    from services import redeem_batch_service

    fake = fake_engine(body={"codes": []})
    await redeem_batch_service.list_redeem_codes({"limit": limit})
    assert fake.calls[0]["params"]["limit"] == limit


@pytest.mark.asyncio
@pytest.mark.parametrize("limit", [0, -1, 201, "abc"])
async def test_list_rejects_out_of_range_limit(fake_engine, limit):
    from services import redeem_batch_service
    from services.redeem_batch_service import EngineAdminError

    fake_engine(body={"codes": []})
    with pytest.raises(EngineAdminError) as exc:
        await redeem_batch_service.list_redeem_codes({"limit": limit})
    assert exc.value.status == 400
    assert exc.value.code == "LIST_LIMIT_INVALID"


@pytest.mark.asyncio
@pytest.mark.parametrize("offset", [-1, "abc"])
async def test_list_rejects_bad_offset(fake_engine, offset):
    from services import redeem_batch_service
    from services.redeem_batch_service import EngineAdminError

    fake_engine(body={"codes": []})
    with pytest.raises(EngineAdminError) as exc:
        await redeem_batch_service.list_redeem_codes({"offset": offset})
    assert exc.value.code == "LIST_OFFSET_INVALID"


@pytest.mark.asyncio
async def test_list_rejects_unknown_status(fake_engine):
    from services import redeem_batch_service
    from services.redeem_batch_service import EngineAdminError

    fake_engine(body={"codes": []})
    with pytest.raises(EngineAdminError) as exc:
        await redeem_batch_service.list_redeem_codes({"status": "revoked_v2"})
    assert exc.value.code == "STATUS_INVALID"


@pytest.mark.asyncio
async def test_list_rejects_unknown_plan(fake_engine):
    from services import redeem_batch_service
    from services.redeem_batch_service import EngineAdminError

    fake_engine(body={"codes": []})
    with pytest.raises(EngineAdminError) as exc:
        await redeem_batch_service.list_redeem_codes({"plan": "trial"})
    assert exc.value.code == "PLAN_INVALID"


@pytest.mark.asyncio
@pytest.mark.parametrize("bad", ["", "ABCD-EFGH", "ABCD-EFGH-JKMN-EXTRA", "IIII-EFGH-JKMN",
                                 None, 123, "iiii-efgh-jkmn"])
async def test_disable_rejects_malformed_code_without_calling_engine(fake_engine, bad):
    from services import redeem_batch_service
    from services.redeem_batch_service import EngineAdminError

    fake = fake_engine(body={"status": "disabled"})
    with pytest.raises(EngineAdminError) as exc:
        await redeem_batch_service.disable_redeem_code({"code": bad})
    assert exc.value.status == 400
    assert exc.value.code == "REDEEM_CODE_FORMAT"
    # 本地拦下就不该产生任何上游调用（避免把必然失败的请求打出去）
    assert fake.calls == []


@pytest.mark.asyncio
async def test_disable_rejects_non_dict_body(fake_engine):
    from services import redeem_batch_service
    from services.redeem_batch_service import EngineAdminError

    fake = fake_engine(body={"status": "disabled"})
    with pytest.raises(EngineAdminError) as exc:
        await redeem_batch_service.disable_redeem_code(["ABCD-EFGH-JKMN"])
    assert exc.value.code == "REDEEM_CODE_FORMAT"
    assert fake.calls == []


# --- 异常 -------------------------------------------------------------


@pytest.mark.asyncio
async def test_missing_engine_config_fails_closed(monkeypatch):
    from services import redeem_batch_service
    from services.redeem_batch_service import EngineAdminError

    monkeypatch.setattr(redeem_batch_service.settings, "engine_admin_base_url", "")
    monkeypatch.setattr(redeem_batch_service.settings, "engine_admin_token", "")

    for coro in (
        redeem_batch_service.list_redeem_codes({}),
        redeem_batch_service.disable_redeem_code({"code": "ABCD-EFGH-JKMN"}),
    ):
        with pytest.raises(EngineAdminError) as exc:
            await coro
        assert exc.value.status == 503
        assert exc.value.code == "ENGINE_ADMIN_NOT_CONFIGURED"


@pytest.mark.asyncio
async def test_engine_unreachable_maps_502(fake_engine):
    import httpx
    from services import redeem_batch_service
    from services.redeem_batch_service import EngineAdminError

    fake_engine(exc=httpx.ConnectError("boom"))
    with pytest.raises(EngineAdminError) as exc:
        await redeem_batch_service.list_redeem_codes({})
    assert exc.value.status == 502
    assert exc.value.code == "ENGINE_ADMIN_UNREACHABLE"


@pytest.mark.asyncio
async def test_client_always_closed(fake_engine):
    from services import redeem_batch_service

    fake = fake_engine(body={"codes": []})
    await redeem_batch_service.list_redeem_codes({})
    assert fake.closed is True


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "status,code",
    [(404, "REDEEM_CODE_NOT_FOUND"), (409, "REDEEM_CODE_ALREADY_USED"),
     (400, "REDEEM_CODE_FORMAT"), (403, "AUTH_SCOPE_MISSING")],
)
async def test_disable_upstream_error_codes_passthrough(fake_engine, status, code):
    """上游语义码必须原样透出——前端据此区分 404 / 409 / 400。"""
    from services import redeem_batch_service
    from services.redeem_batch_service import EngineAdminError

    fake_engine(status_code=status, body={"error": code})
    with pytest.raises(EngineAdminError) as exc:
        await redeem_batch_service.disable_redeem_code({"code": "ABCD-EFGH-JKMN"})
    assert exc.value.status == status
    assert exc.value.code == code


@pytest.mark.asyncio
async def test_disable_upstream_non_json_body_falls_back(fake_engine):
    from services import redeem_batch_service
    from services.redeem_batch_service import EngineAdminError

    fake_engine(status_code=500, body=None)
    with pytest.raises(EngineAdminError) as exc:
        await redeem_batch_service.disable_redeem_code({"code": "ABCD-EFGH-JKMN"})
    assert exc.value.status == 500
    assert exc.value.code == "ENGINE_ADMIN_ERROR"


# --- 安全 -------------------------------------------------------------


@pytest.mark.asyncio
async def test_engine_token_never_leaks_into_error_payload(fake_engine):
    from services import redeem_batch_service
    from services.redeem_batch_service import EngineAdminError

    fake_engine(status_code=500, body={"error": "ENGINE_ADMIN_ERROR",
                                       "token": "engine-token-xyz"})
    with pytest.raises(EngineAdminError) as exc:
        await redeem_batch_service.list_redeem_codes({})
    assert exc.value.payload is None, "非 INCOMPLETE 错误不得携带上游响应体字段"
    assert "engine-token-xyz" not in str(exc.value.payload)


@pytest.mark.asyncio
async def test_list_does_not_upstream_extra_body_fields(fake_engine):
    """GET 列表只走 params；不得把筛选条件塞进 json 造成请求语义混乱。"""
    from services import redeem_batch_service

    fake = fake_engine(body={"codes": []})
    await redeem_batch_service.list_redeem_codes({"plan": "pro", "note": "injected"})
    assert fake.calls[0]["json"] is None


# --- 契约：补足失败的已签发码必须穿透两层代理 ---------------------------


@pytest.mark.asyncio
async def test_incomplete_batch_carries_issued_codes_through_proxy(fake_engine):
    """D3 承诺：报错但不丢弃。engine 已签发的码必须原样到达 ops 前端。

    这条穿过两跳（engine → ops service → HTTPException payload），
    任一层把 payload 丢掉，运营就拿不到可交付的那部分。
    """
    from services import redeem_batch_service
    from services.redeem_batch_service import EngineAdminError

    issued = ["ABCD-EFGH-JKMN", "WXYZ-2345-6789"]
    fake_engine(status_code=409, body={
        "error": "REDEEM_BATCH_INCOMPLETE",
        "message": "批量签发未补足",
        "requested": 10, "generated": 2, "rounds": 10, "codes": issued,
    })

    with pytest.raises(EngineAdminError) as exc:
        await redeem_batch_service.create_redeem_batch(
            {"plan": "pro", "durationDays": 30, "count": 10}
        )
    err = exc.value
    assert err.status == 409
    assert err.code == "REDEEM_BATCH_INCOMPLETE"
    assert err.payload["codes"] == issued
    assert err.payload["requested"] == 10
    assert err.payload["generated"] == 2


@pytest.mark.asyncio
async def test_other_errors_do_not_carry_codes(fake_engine):
    """只有 REDEEM_BATCH_INCOMPLETE 带 payload；其它错误码一律不带。"""
    from services import redeem_batch_service
    from services.redeem_batch_service import EngineAdminError

    fake_engine(status_code=400, body={
        "error": "PLAN_INVALID", "codes": ["ABCD-EFGH-JKMN"], "requested": 10,
    })
    with pytest.raises(EngineAdminError) as exc:
        await redeem_batch_service.create_redeem_batch(
            {"plan": "free", "durationDays": 30, "count": 1}
        )
    assert exc.value.payload is None
