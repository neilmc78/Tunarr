from pathlib import Path
from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from .config import settings


class Base(DeclarativeBase):
    pass


def get_engine():
    db_path = settings.db_path
    Path(db_path).parent.mkdir(parents=True, exist_ok=True)
    engine = create_engine(
        f"sqlite:///{db_path}",
        connect_args={"check_same_thread": False},
    )

    @event.listens_for(engine, "connect")
    def _set_pragmas(conn, _):
        cur = conn.cursor()
        cur.execute("PRAGMA journal_mode=WAL")
        cur.execute("PRAGMA synchronous=NORMAL")
        cur.close()

    return engine


engine = get_engine()
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine, expire_on_commit=False)


def get_db():
    db = SessionLocal()
    try:
        yield db
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def _run_migrations(engine):
    with engine.connect() as conn:
        try:
            conn.execute(text("ALTER TABLE quality_profiles ADD COLUMN extra_args TEXT DEFAULT ''"))
            conn.commit()
        except Exception:
            pass  # Column already exists


def init_db():
    from . import models  # noqa: F401
    Base.metadata.create_all(bind=engine)
    _run_migrations(engine)
