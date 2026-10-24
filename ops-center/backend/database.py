"""Database connection — aiosqlite with WAL mode."""
import os
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase

from config import settings

os.makedirs(os.path.dirname(settings.db_path) or ".", exist_ok=True)

engine = create_async_engine(
    f"sqlite+aiosqlite:///{settings.db_path}",
    echo=False,
    connect_args={"check_same_thread": False},
)

async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def init_db():
    """Create all tables and enable WAL mode."""
    import sqlalchemy
    # 价格卡 / 事件级用量 / 积分单价配置三张表的 ORM 注册。
    # 必须在 create_all 之前 import —— 否则 Base.metadata 里没有它们，
    # 存量库不会建出这三张表（延迟 import 是为了避开 models → database 的循环依赖）。
    import models_credit  # noqa: F401
    async with engine.begin() as conn:
        # Enable WAL mode first
        await conn.execute(sqlalchemy.text("PRAGMA journal_mode=WAL"))
        await conn.execute(sqlalchemy.text("PRAGMA foreign_keys=ON"))
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def get_db():
    """FastAPI dependency: yields an async DB session."""
    async with async_session() as session:
        try:
            yield session
        finally:
            await session.close()
