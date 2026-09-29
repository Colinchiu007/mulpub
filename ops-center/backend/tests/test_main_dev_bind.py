"""回归锁：`python main.py` 这条开发入口不得把管理员登录面绑到所有网卡。

事实来源：
- 登录由 ops-center 后端自己承载（`routers/auth.py` 签发带 `role=admin` 的 HS256 JWT
  并只落 HttpOnly 会话 Cookie），所以 8010 一旦监听 `0.0.0.0`，同局域网任意机器都能
  直接打 `/api/auth/login` 爆破口令。
- 生产**不经过**这里：`ops-center/deploy/ops-center.service` 的 ExecStart 显式
  `--host 127.0.0.1`，`deploy/nginx-ops.conf` 反代的也是 `127.0.0.1:8010`。
  因此把开发入口收紧到回环，不影响线上可达性。

手法：用 `runpy` 以 `run_name="__main__"` 真跑一次入口代码，只把 `uvicorn.run` 换成探针，
断言它**实际收到的** host 实参 —— 不是读源码里出现了什么字符串。
"""
import runpy
import sys
from pathlib import Path

import uvicorn

BACKEND_ROOT = Path(__file__).resolve().parents[1]
MAIN_PY = BACKEND_ROOT / "main.py"

# 回环取值白名单：IPv4 回环、IPv6 回环、以及解析到回环的主机名
LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "::1"}
# 任何「全部接口」写法都必须被拒（0.0.0.0 是本案的真实缺陷形态）
WILDCARD_HOSTS = {"0.0.0.0", "::"}


def _capture_dev_entry_kwargs(monkeypatch) -> dict:
    captured: dict = {}

    def fake_run(app, **kwargs):
        captured["app"] = app
        captured.update(kwargs)

    monkeypatch.setattr(uvicorn, "run", fake_run)
    runpy.run_path(str(MAIN_PY), run_name="__main__")
    return captured


def test_dev_entry_binds_loopback_only(monkeypatch):
    kwargs = _capture_dev_entry_kwargs(monkeypatch)

    assert "host" in kwargs, "开发入口必须显式写出 host，不允许依赖 uvicorn 默认值"
    host = kwargs["host"]
    assert host not in WILDCARD_HOSTS, (
        f"`python main.py` 绑到了 {host}（全部接口）：运营中心自签发管理员会话，"
        f"这会把 /api/auth/login 暴露到局域网"
    )
    assert host in LOOPBACK_HOSTS, f"开发入口 host 必须是回环，实际为 {host!r}"


def test_dev_entry_still_targets_ops_center_port(monkeypatch):
    """收紧 host 不得顺手改掉端口——nginx 反代与 vite 代理都写死 8010。"""
    kwargs = _capture_dev_entry_kwargs(monkeypatch)
    assert kwargs.get("port") == 8010


def test_production_unit_file_binds_loopback_too():
    """本 PR 的安全前提：线上 systemd 早就是 127.0.0.1，所以改开发默认值不会打断部署。"""
    svc = (BACKEND_ROOT.parent / "deploy" / "ops-center.service").read_text(encoding="utf-8")
    exec_lines = [ln for ln in svc.splitlines() if ln.strip().startswith("ExecStart")]
    assert exec_lines, "ops-center.service 必须有 ExecStart"
    assert "--host 127.0.0.1" in exec_lines[0], f"生产单元不再绑回环，需要同步重评本改动：{exec_lines[0]}"

    nginx = (BACKEND_ROOT.parent / "deploy" / "nginx-ops.conf").read_text(encoding="utf-8")
    assert "127.0.0.1:8010" in nginx, "nginx 反代目标必须是回环 8010，否则回环绑定会切断线上流量"
