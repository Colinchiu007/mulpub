"""跨模块库隔离回归对 · 制造方（`a_` 令它先于消费方被收集，`zz` 令它排在既有模块之后）。

它故意做两件历史上会击穿后续模块的事：
1. 插入若干 `prompt_eval_cases` 行，把自增 rowid 往前推；
2. teardown 里 `Base.metadata.drop_all` —— 拆的是**整个共用库**的全部表。

只要 `tests/conftest.py` 的按模块重置在位，后收集的消费方就能拿到「表齐全 + 行号从 1 起」
的确定状态；删掉那段 fixture，消费方立刻红（`no such table` 或 `FOREIGN KEY constraint failed`）。
"""
import os
import sys
import tempfile
import uuid

import pytest
import pytest_asyncio

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

_RUN_ID = uuid.uuid4().hex[:8]
os.environ["OPS_DB_PATH"] = os.path.join(tempfile.gettempdir(), f"ops_iso_a_{_RUN_ID}.db")
os.environ["OPS_SECRET_KEY"] = "test-secret"
os.environ["OPS_JWT_SECRET"] = "test-secret"
os.environ["OPS_CATALOG_API_KEY"] = "catalog-test-key"

import models  # noqa: E402, F401  触发全部表注册
from sqlalchemy import select  # noqa: E402
from database import Base, async_session, engine  # noqa: E402


def _case(title: str):
    from models import PromptEvalCase

    return PromptEvalCase(
        title=title,
        source_text="src",
        prompt_zh="p",
        provider="prov",
        model="model",
    )


@pytest_asyncio.fixture(autouse=True)
async def _advance_rowid_then_wreck():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with async_session() as db:
        db.add_all([_case(f"wrecker-{i}") for i in range(1, 4)])
        await db.commit()
    yield
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


@pytest.mark.asyncio
async def test_wrecker_actually_inserted_rows():
    """前置条件：本模块确实推进了共用库的行号（否则这对用例什么也没锁住）。"""
    from models import PromptEvalCase

    async with async_session() as db:
        ids = (
            await db.execute(select(PromptEvalCase.id).where(PromptEvalCase.title.like("wrecker-%")))
        ).scalars().all()
    assert sorted(ids) == [1, 2, 3]
