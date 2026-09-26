"""账号显示名来源（name_source）后端契约测试。

背景（openspec change: add-account-name-source）：展示层此前对「机器抓来的名字」与
「用户手改的名字」套用同一层噪声过滤，导致用户显式命名可能被当成抓取错误而藏掉。
根因是系统没有任何字段能表达这个名字的来源，只能靠文本形态反推。本文件钉住
`name_source` 的取值域、缺席语义、非法值归一与投影穿透 —— 它是渲染层
「manual 原样显示 / auto 过噪声守卫」分流的对端依据。
"""

from fastapi.testclient import TestClient

import server


class StubVerifier:
    def __init__(self, subject: str):
        self.subject = subject

    async def verify(self, _token: str):
        return {"subject": self.subject, "scopes": ["account:manage"]}


def _client(monkeypatch, tmp_path) -> TestClient:
    monkeypatch.setattr(server, "IDENTITY_AUTH_ENABLED", True)
    monkeypatch.setattr(server, "IDENTITY_AUTH_REQUIRED", True)
    monkeypatch.setattr(server, "IDENTITY_VERIFIER", StubVerifier("sub-a"))
    monkeypatch.setattr(server, "DATA_DIR", tmp_path)
    monkeypatch.setattr(server, "ACCOUNTS_FILE", tmp_path / "accounts.json")
    return TestClient(server.app)


def _headers() -> dict[str, str]:
    return {"Authorization": "Bearer token-a"}


def _seed_one(monkeypatch, tmp_path, **extra):
    """建号并返回 (client, account_id, 首次响应体)。"""
    client = _client(monkeypatch, tmp_path)
    body = {
        "platform": "toutiao",
        "name": "今日头条",
        "account_name": "真昵称",
    }
    body.update(extra)
    created = client.post("/api/accounts", headers=_headers(), json=body)
    assert created.status_code == 200, created.text
    return client, created.json()["data"]["id"], created.json()["data"]


def test_create_without_name_source_defaults_to_auto(monkeypatch, tmp_path):
    """旧客户端不发送该字段 —— 必须归一为 auto，而不是缺席或 500。"""
    client, account_id, data = _seed_one(monkeypatch, tmp_path)
    assert data["name_source"] == "auto"

    fetched = client.get(f"/api/accounts/{account_id}", headers=_headers())
    assert fetched.status_code == 200
    assert fetched.json()["data"]["name_source"] == "auto"


def test_patch_manual_survives_read_back(monkeypatch, tmp_path):
    """用户改名的落盘意图必须能穿过投影回到渲染层，否则 manual 状态根本无法产生。"""
    client, account_id, _ = _seed_one(monkeypatch, tmp_path)

    patched = client.patch(
        f"/api/accounts/{account_id}",
        headers=_headers(),
        json={"name": "阿飞 - 自由职业", "name_source": "manual"},
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["data"]["name"] == "阿飞 - 自由职业"
    assert patched.json()["data"]["name_source"] == "manual"

    fetched = client.get(f"/api/accounts/{account_id}", headers=_headers())
    assert fetched.json()["data"]["name_source"] == "manual"
    assert fetched.json()["data"]["name"] == "阿飞 - 自由职业"


def test_name_source_absent_must_not_overwrite(monkeypatch, tmp_path):
    """缺席 = 不修改，与资料字段同一套语义（主进程靠这条避免反向清空）。"""
    client, account_id, _ = _seed_one(monkeypatch, tmp_path)
    client.patch(
        f"/api/accounts/{account_id}",
        headers=_headers(),
        json={"name": "小美…的厨房", "name_source": "manual"},
    )

    patched = client.patch(
        f"/api/accounts/{account_id}",
        headers=_headers(),
        json={"followers": 42},
    )
    assert patched.status_code == 200
    data = patched.json()["data"]
    assert data["name_source"] == "manual"
    assert data["name"] == "小美…的厨房"
    assert data["followers"] == 42


def test_illegal_name_source_normalizes_to_auto(monkeypatch, tmp_path):
    """非法取值不得 500、不得原样入库；一律归一为 auto（展示层据此继续过噪声守卫）。"""
    client, account_id, _ = _seed_one(monkeypatch, tmp_path)

    for bad in ("foo", "", "auto ", "unknown", "0"):
        patched = client.patch(
            f"/api/accounts/{account_id}",
            headers=_headers(),
            json={"name_source": bad},
        )
        assert patched.status_code == 200, f"{bad!r} -> {patched.status_code} {patched.text}"
        assert patched.json()["data"]["name_source"] == "auto", f"{bad!r} 未被归一"

    # 大小写不敏感是本模块既有约定（对齐 _normalize_account_status 的 strip().lower()），
    # 不是严格枚举 —— 显式钉住，避免后来者「顺手收紧」把手改名判成非法而退回过滤显示。
    upper = client.patch(
        f"/api/accounts/{account_id}",
        headers=_headers(),
        json={"name_source": "MANUAL"},
    )
    assert upper.status_code == 200
    assert upper.json()["data"]["name_source"] == "manual"

    non_string = client.patch(
        f"/api/accounts/{account_id}",
        headers=_headers(),
        json={"name_source": 123},
    )
    assert non_string.status_code in (200, 422)
    if non_string.status_code == 200:
        assert non_string.json()["data"]["name_source"] == "auto"


def test_unknown_field_still_rejected(monkeypatch, tmp_path):
    """加字段不能顺手放弃 extra="forbid" —— 否则拼错的键会被静默吞掉。"""
    client, account_id, _ = _seed_one(monkeypatch, tmp_path)

    rejected = client.patch(
        f"/api/accounts/{account_id}",
        headers=_headers(),
        json={"name_sourse": "manual"},
    )
    assert rejected.status_code == 422, rejected.text


def test_preexisting_row_without_name_source_reads_as_auto(monkeypatch, tmp_path):
    """升级前写入的存量行没有该键 —— 读取必须按 auto 处理，且不得改写存储内容。"""
    client = _client(monkeypatch, tmp_path)
    created = client.post(
        "/api/accounts",
        headers=_headers(),
        json={"platform": "toutiao", "name": "今日头条", "account_name": "真昵称"},
    )
    account_id = created.json()["data"]["id"]

    raw = server._load_accounts()
    assert "name_source" in raw[account_id]  # 新写入会带该键
    del raw[account_id]["name_source"]
    server._save_accounts(raw)

    fetched = client.get(f"/api/accounts/{account_id}", headers=_headers())
    assert fetched.status_code == 200
    assert fetched.json()["data"]["name_source"] == "auto"

    # 读操作不得把归一结果反向写进真源（只读归一，不是数据迁移）
    assert "name_source" not in server._load_accounts()[account_id]
