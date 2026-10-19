"""update_policy 表迁移：强制升级阻断列（enforce_min_version/enforce_enabled），幂等补列。

forced-update-gate（2026-10-19）：老库的 update_policy 表没有 enforce 两列，
create_all 不会给已存在的表加列，照 usage_migration.py / prompt_eval_migration.py
的幂等补列先例在启动时执行一次。
"""
import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession


async def ensure_update_policy_columns(db: AsyncSession):
    cols = {row[1] for row in (await db.execute(sa.text("PRAGMA table_info(update_policy)"))).fetchall()}
    additions = [
        ("enforce_min_version", "TEXT DEFAULT ''"),
        ("enforce_enabled", "INTEGER DEFAULT 0"),
    ]
    for name, ddl in additions:
        if name not in cols:
            await db.execute(sa.text(f"ALTER TABLE update_policy ADD COLUMN {name} {ddl}"))
    await db.commit()
