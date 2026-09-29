"""回归锁：ops-center 后端测试套件不得把「共享开发库」当作清库目标。

根因（2026-09-29 实测复现）：`config.settings` 是导入期单例，`db_path` 默认值是
**相对 cwd** 的 `data/config.db`。各 API 测试模块靠「在 import config 之前设
`OPS_DB_PATH`」把自己隔离到临时库，而这件事只对**第一个被收集**的模块有效。
于是 `tests/conftest.py` 的 autouse 清库夹具（每个模块第一个用例前 DELETE 全部表）
在「单跑一个没设 OPS_DB_PATH 的模块」时会指向仓库内的真实开发库：

    cd ops-center/backend && pytest tests/test_security_config.py

实测把靶库 `data/config.db` 里的一行 `admins` 从 1 删成 0 —— 症状即「admin 登录不上」
（admins 为空时登录返回 503「未配置管理员账号」）。本文件锁两件事：
① 全新 shell（环境里没有 OPS_DB_PATH）单跑任一「不设库路径」的模块，绑定结果必须在仓库外；
② 清库动作的目标路径谓词必须拒绝仓库内路径。
"""
import os
import subprocess
import sys
import tempfile
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_ROOT.parents[1]  # <repo>/ops-center/backend -> <repo>

# 这些模块在模块级**不**设 OPS_DB_PATH，是历史上会把绑定权留给「第一个 import config 的人」的那批。
PROBE_MODULES = ["test_security_config.py", "test_p0_security.py"]

_PROBE_PLUGIN = """
def pytest_collection_finish(session):
    from config import settings
    print("PROBE_DB_PATH=" + str(settings.db_path))
"""


def _run_collection_probe(module_name: str) -> Path:
    """在**全新环境**（弹掉 OPS_DB_PATH）里真跑一次 pytest 收集，返回 settings.db_path。"""
    with tempfile.TemporaryDirectory(prefix="ops_dbprobe_") as tmpdir:
        plugin_dir = Path(tmpdir)
        (plugin_dir / "mp_db_probe.py").write_text(_PROBE_PLUGIN, encoding="utf-8")

        env = os.environ.copy()
        env.pop("OPS_DB_PATH", None)          # 模拟开发者新开 shell：没有任何库路径注入
        env.pop("OPS_CONFIG_OUTPUT_DIR", None)
        env["PYTHONPATH"] = str(plugin_dir) + os.pathsep + env.get("PYTHONPATH", "")

        proc = subprocess.run(
            [sys.executable, "-m", "pytest", f"tests/{module_name}",
             "--collect-only", "-q", "-p", "mp_db_probe", "--no-header"],
            cwd=str(BACKEND_ROOT), env=env, capture_output=True, text=True, timeout=180,
        )
    out = proc.stdout + proc.stderr
    hits = [ln.split("=", 1)[1].strip() for ln in out.splitlines() if ln.startswith("PROBE_DB_PATH=")]
    assert hits, f"探针未输出 PROBE_DB_PATH（rc={proc.returncode}）：\n{out[-2000:]}"
    return Path(hits[-1]).resolve()


def test_fresh_shell_single_module_run_must_not_bind_repo_db():
    """单跑一个不设 OPS_DB_PATH 的模块时，库路径必须落在**仓库外**。

    反证：摘掉 conftest 的会话级库路径兜底 → 这里得到 <repo>/ops-center/backend/data/config.db，本用例变红。
    """
    for module_name in PROBE_MODULES:
        bound = _run_collection_probe(module_name)
        assert REPO_ROOT not in bound.parents and bound != REPO_ROOT, (
            f"pytest {module_name} 把库绑到了仓库内路径 {bound}；"
            f"autouse 清库夹具会因此 DELETE 共享开发库的全部行（含 admins）"
        )


def test_reset_target_predicate_rejects_repo_paths():
    """清库目标谓词必须拒绝仓库内路径、放行系统临时目录下的路径。"""
    sys.path.insert(0, str(BACKEND_ROOT / "tests"))
    from conftest import is_safe_reset_target

    assert is_safe_reset_target(Path(tempfile.gettempdir()) / "ops_x" / "config.db") is True
    assert is_safe_reset_target(BACKEND_ROOT / "data" / "config.db") is False
    assert is_safe_reset_target(REPO_ROOT / "ops-center" / "backend" / "data" / "config.db") is False


def test_reset_shared_database_refuses_repo_target():
    """守门必须在**动手之前**抛错，而不是清完再报。"""
    sys.path.insert(0, str(BACKEND_ROOT / "tests"))
    import conftest

    target = BACKEND_ROOT / "data" / "config.db"
    try:
        conftest._reset_shared_database(str(target))
    except RuntimeError as exc:
        assert "仓库内" in str(exc), f"错误信息未点明拒绝原因：{exc}"
    else:
        raise AssertionError("清库动作对仓库内路径未 fail closed")
