"""跨模块库隔离回归对 · 消费方（`b_` 保证它后于 `a_wrecker` 被收集）。

本模块**故意不建表、不清库**：它只依赖 `tests/conftest.py` 的按模块重置。
它复现的就是 2026-09-25 在 main 上全量跑炸掉的那条契约 —— 往
`prompt_eval_cases` 写第一条记录并期望自增 id 为 1，再用该 id 写子表
`prompt_eval_runs`（外键指向父行）。

没有 conftest 的按模块重置时，`a_wrecker` 会把行号推到 3 并 `drop_all` 拆掉整库，
本模块随即报 `no such table` 或 `FOREIGN KEY constraint failed`；有重置则恒为 id=1。
"""
import os
import sys
import tempfile
import uuid

import pytest
import pytest_asyncio

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

_RUN_ID = uuid.uuid4().hex[:8]
os.environ["OPS_DB_PATH"] = os.path.join(tempfile.gettempdir(), f"ops_iso_b_{_RUN_ID}.db")
os.environ["OPS_SECRET_KEY"] = "test-secret"
os.environ["OPS_JWT_SECRET"] = "test-secret"
os.environ["OPS_CATALOG_API_KEY"] = "catalog-test-key"

import models  # noqa: E402, F401
from sqlalchemy import func, select  # noqa: E402
from database import async_session  # noqa: E402


def _case(title: str):
    from models import PromptEvalCase

    return PromptEvalCase(
        title=title,
        source_text="src",
        prompt_zh="p",
        provider="prov",
        model="model",
    )


@pytest.mark.asyncio
async def test_module_starts_from_empty_schema_with_rowid_one():
    """共用库在进入本模块时必须是「表齐全、行号从 1 起」的确定状态。"""
    from models import PromptEvalCase

    async with async_session() as db:
        leftover = (
            await db.execute(select(func.count()).select_from(PromptEvalCase.__table__))
        ).scalar()
        assert leftover == 0, f"上一模块的行未被清干净：{leftover}"

        case = _case("consumer-1")
        db.add(case)
        await db.flush()
        # 关键断言：自增 id 回到 1。跨模块累计行号时这里是 4，后续按 id=1 建外键就会炸。
        assert case.id == 1

        # 复现原故障点：以父行 id 写子表并提交
        from models import PromptEvalRun

        db.add(PromptEvalRun(case_id=case.id, provider="prov", model="model"))
        await db.commit()

        runs = (
            await db.execute(
                select(func.count()).where(PromptEvalRun.case_id == case.id)
            )
        ).scalar()
        assert runs == 1
