"""pytest conftest — shared fixtures."""
import os
import sys
import tempfile
from pathlib import Path

import pytest

# Add the src directory to the Python path
SRC_DIR = Path(__file__).parent.parent / "src"
sys.path.insert(0, str(SRC_DIR.resolve()))
TEST_LOG_DIR = Path(tempfile.gettempdir()) / "multi-publish-pytest-logs"
os.environ.setdefault("MULTI_PUBLISH_LOG_DIR", str(TEST_LOG_DIR))

"""
PROJECT-003 测试套件
"""



@pytest.fixture
def sample_article():
    return {
        "title": "测试文章标题",
        "content": "# 测试内容\n\n这是一篇测试文章。",
        "cover_image": None,
        "tags": ["测试", "AI"],
    }


@pytest.fixture
def sample_wechat_config():
    return {
        "app_id": "test_app_id",
        "app_secret": "test_app_secret",
    }


@pytest.fixture(autouse=True)
def isolate_account_store_per_test(tmp_path, monkeypatch):
    """把 server 模块级的账号真源固定到本用例专属的临时文件。

    存在理由（AGENTS.md「测试库/配置状态必须按模块确定化，不得依赖导入顺序」MUST）：
    `server.DATA_DIR` / `server.ACCOUNTS_FILE` 是**导入期单例**。此前只有那些自己
    `monkeypatch.setattr(server, "ACCOUNTS_FILE", ...)` 的用例是安全的；任何没打的用例
    都会直接读写模块默认路径，于是「单跑绿、全量红」——一个用例写脏，后面所有用例读到
    同一份状态，而收集顺序一变就换一批失败。这里统一兜底，让「忘记隔离」不再等于「污染别人」。

    用例内自己的 monkeypatch 仍然生效：它在本 fixture 之后设置、teardown 时先还原成本
    fixture 的值，再交还给模块原值。

    反证对见 tests/test_zz_conftest_isolation_a_wrecker.py / ..._b_consumer.py：
    把本 fixture 改成 no-op，那一对必须立刻变红。
    """
    import server

    isolated = tmp_path / "accounts.json"
    monkeypatch.setattr(server, "DATA_DIR", tmp_path, raising=False)
    monkeypatch.setattr(server, "ACCOUNTS_FILE", isolated, raising=False)
    yield isolated


@pytest.fixture(scope="session", autouse=True)
def close_async_loguru_sinks():
    """测试期间关闭异步日志线程，避免 pytest 退出时等待文件 sink。"""
    from loguru import logger

    logger.remove()
    yield
    logger.complete()
    logger.remove()
