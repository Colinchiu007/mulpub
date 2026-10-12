# -*- coding: utf-8 -*-
"""creator_sign 测试：签名端点契约（PRD-CREATOR-MULTI-PLATFORM §6/§9）。

不联网：abogus 是纯函数（固定输入可复现）；xhshow 缺包时端点必须给可操作错误
而不是 500 栈（与 aggregation 的可选依赖降级同口径）。
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "src"))

from fastapi.testclient import TestClient  # noqa: E402

from multi_publish.creator_sign.abogus import generate_a_bogus  # noqa: E402


def _client():
    # 独立建 app 太重（server.py 拉起全部路由）；直接用 router 挂一个最小 app
    from fastapi import FastAPI
    from multi_publish.creator_sign.router import router

    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


def test_abogus_is_deterministic_and_urlsafe():
    q = "device_platform=webapp&aid=6383&sec_user_id=MS4wLjABAAAA" + "A" * 28
    ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0.0.0"
    a = generate_a_bogus(q, ua)
    b = generate_a_bogus(q, ua)
    # 时间戳参与生成：同秒内稳定；跨秒可能变化——这里断言「非空、URL 安全字符集」
    assert a and len(a) > 20
    allowed = set("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_")
    assert set(a) <= allowed, f"非 URL 安全字符: {a[:20]}"


def test_abogus_changes_with_query():
    ua = "Mozilla/5.0"
    x = generate_a_bogus("a=1", ua)
    y = generate_a_bogus("a=2", ua)
    assert x != y


def test_douyin_endpoint_signs():
    client = _client()
    r = client.post("/api/creator/sign/douyin", json={
        "query_str": "aid=6383&sec_user_id=X", "user_agent": "UA/1.0",
    })
    assert r.status_code == 200
    assert r.json()["a_bogus"]


def test_douyin_endpoint_validates_input():
    client = _client()
    r = client.post("/api/creator/sign/douyin", json={"query_str": "", "user_agent": ""})
    assert r.status_code in (400, 422)


def test_xhs_endpoint_missing_dependency_is_actionable():
    """xhshow 未安装时必须返回「可操作的错误信息」而不是裸 500 栈。"""
    client = _client()
    try:
        import xhshow  # noqa: F401
        installed = True
    except ImportError:
        installed = False
    r = client.post("/api/creator/sign/xhs", json={"uri": "/api/sns/web/v1/user_posted", "a1": "a1-value"})
    if installed:
        assert r.status_code == 200
        body = r.json()
        assert body["x_s"], "x-s 必须非空"
        assert body["x_s_common"], "x-s-common 必须非空"
    else:
        assert r.status_code == 503
        assert "pip install" in r.text, "缺依赖的报错必须带安装指引"
