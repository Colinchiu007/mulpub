"""pytest 全局配置：在所有测试模块收集前注入 DEV Ed25519 签名私钥。

背景：pytest 按字母序导入测试模块，`config.settings` 是导入期实例化的单例。
test_auth_login.py 等模块先导入时 `OPS_RUNTIME_SIGNING_PRIVATE_KEY` 尚未被
test_runtime_policy_api.py 等后续模块设置，导致 bootstrap 相关测试拿不到签名密钥
而 404。此处用 setdefault 在收集阶段统一注入，保证任何测试模块首次 import config
时 settings 已携带 DEV 私钥（与 .env.example / ops-center-sync.js 内置公钥配对）。
"""
import os

import pytest

# DEV 签名密钥对（2026-09-02 生成）：与 apps/desktop/electron/services/ops-center-sync.js
# 内置默认公钥 / ops-center-sync.test.js DEV 密钥对 / backend/.env.example DEV 私钥完全一致，
# 用于双端交叉验证 canonical JSON + Ed25519 签名。
DEV_RUNTIME_PRIVATE_KEY = (
    "-----BEGIN PRIVATE KEY-----\n"
    "MC4CAQAwBQYDK2VwBCIEIMEaqZBFhrl/hpieWHhYoaG6Dn+Juchfx4/2s0dXok0S\n"
    "-----END PRIVATE KEY-----"
)

os.environ.setdefault("OPS_RUNTIME_SIGNING_PRIVATE_KEY", DEV_RUNTIME_PRIVATE_KEY)
# Catalog API Key 默认值：与各 API 测试模块一致（test_scheduler_api.py 等模块在导入期设 env，
# 但 config.settings 是导入期单例，先导入的模块会让其为 ""。此处 setdefault 统一兜底。）
os.environ.setdefault("OPS_CATALOG_API_KEY", "catalog-test-key")
# Stage -1.8：JWT 密钥独立于 OPS_SECRET_KEY，测试环境默认注入
os.environ.setdefault("OPS_JWT_SECRET", "test-jwt-secret")


@pytest.fixture(autouse=True)
def _inject_runtime_signing_key():
    """每个测试前将签名私钥同步到 settings 单例（与其他模块 catalog_api_key 同模式）。

    测试内对 settings.runtime_signing_private_key 的临时修改（如 404/500 fail-closed
    用例）在其自身 try/finally 中恢复，不受本 fixture 干扰。
    """
    try:
        from config import settings

        settings.runtime_signing_private_key = DEV_RUNTIME_PRIVATE_KEY
    except ImportError:  # conftest 在无 config 的场景（如仅运行非 API 测试）安全降级
        pass
    yield


_RESET_MODULES: set = set()


def _reset_shared_database() -> None:
    """把当前库补回完整 schema 并清空所有行，使 rowid 从 1 重新计。

    用**同步**引擎做：不碰 async engine 的连接池，因此不受「事件循环已切换」限制。
    删除顺序取 `sorted_tables` 逆序，天然满足外键依赖，故无需（也不应依赖）
    `PRAGMA foreign_keys` —— 该 pragma 在事务内是 no-op。
    """
    from sqlalchemy import create_engine, text

    import models  # noqa: F401  触发全部表的元数据注册
    from config import settings
    from database import Base

    engine = create_engine(f"sqlite:///{settings.db_path}")
    try:
        Base.metadata.create_all(engine)  # 幂等：补回被上一模块 drop_all 拆掉的表
        with engine.begin() as conn:
            for table in reversed(Base.metadata.sorted_tables):
                conn.execute(text(f"DELETE FROM {table.name}"))
            has_seq = conn.execute(
                text("SELECT 1 FROM sqlite_master WHERE name = 'sqlite_sequence'")
            ).fetchone()
            if has_seq:
                conn.execute(text("DELETE FROM sqlite_sequence"))
    finally:
        engine.dispose()


@pytest.fixture(autouse=True)
def _isolate_database_per_test_module(request):
    """每个测试模块的第一个用例开始前，把共享库恢复到确定的空表状态。

    根因：各 API 测试模块都在**模块级**先设 `os.environ["OPS_DB_PATH"] = <自己的临时库>`，
    再 `from config import settings`；而 `settings` 是导入期实例化的单例（见本文件开头注释），
    pytest 按字母序收集模块，**第一个** import config 的模块就永久绑定了 db_path，后面所有模块
    自设的临时库全部失效 → 整个 session 共用一个 SQLite 文件。再叠加各模块 teardown 里的
    `Base.metadata.drop_all`（拆的是共用的全部表）与用例普遍隐含的「我建的第一条记录 id 就是 1」
    假设，跨模块累计的行号会让后续模块报 `FOREIGN KEY constraint failed`。

    2026-09-25 在**未改动的 main** 上全量跑即可复现（`tests/test_prompt_eval_engine_dual.py::
    test_dual_summary_zero_denominator_null` 失败，单独跑该文件或该用例均通过），与本仓库
    业务代码无关；此前该组合长期未被执行，因为 `ops-center CI` 只在 PR 改动 ops-center 路径时触发，
    main 自身不跑全量后端套件。

    这里集中兜住，不要求 30 来个测试文件各自改写。
    """
    module = getattr(request.node, "module", None)
    if module is not None:
        key = module.__name__
        if key not in _RESET_MODULES:
            _RESET_MODULES.add(key)
            try:
                _reset_shared_database()
            except ImportError:  # 纯单测模块无 config/database，跳过
                pass
    yield
