"""SQLAlchemy engine, session factory, and declarative base.

Everything in app/db/models.py inherits from Base defined here. The
naming convention matters more than it looks like it should — without it,
Alembic autogenerate produces constraint names like "reports_status_check1"
that drift between environments and make migrations a pain to diff.
"""

from __future__ import annotations

from collections.abc import Generator

from sqlalchemy import MetaData, create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import get_settings

# explicit naming convention so constraint/index names are deterministic and
# match across migrations instead of whatever autogenerate happens to pick
NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)


settings = get_settings()
# pool_pre_ping checks a connection is still alive before handing it out —
# without it we'd occasionally get "server closed the connection" errors on
# the first query after the DB has been idle for a while. pool_recycle keeps
# us under whatever idle-connection timeout the DB/proxy enforces.
# connect_args.prepare_threshold=None disables psycopg3's server-side prepared
# statements. When DATABASE_URL points at a pooler in transaction mode (e.g.
# PgBouncer, or the Render/Supabase shared pooler) the same backend connection
# is handed to different logical sessions, and psycopg3's auto-generated
# `_pg3_0` prepared-statement name collides with one left behind by a prior
# checkout — surfacing as `DuplicatePreparedStatement: prepared statement
# "_pg3_0" already exists` on the very first query after boot. Turning
# prepared statements off entirely is safe because our workload is dominated
# by short, non-hot-path queries where the plan-cache win is negligible.
engine = create_engine(
    settings.database_url,
    pool_pre_ping=True,
    pool_recycle=300,
    connect_args={"prepare_threshold": None},
)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False, autoflush=False)


def get_session() -> Generator[Session, None, None]:
    """FastAPI dependency — one session per request, closed after the response
    is built regardless of whether the request succeeded or blew up.
    expire_on_commit=False so response serialization can still read attributes
    off committed ORM objects without triggering a fresh query.
    """
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()
