import os

from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker

_BASE_URL: str = os.environ["DATABASE_URL"]
DATABASE_URL = _BASE_URL.replace("postgresql://", "postgresql+asyncpg://", 1)

engine = create_async_engine(DATABASE_URL, pool_size=5, max_overflow=10, echo=False)

AsyncSessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def get_db():
    async with AsyncSessionLocal() as session:
        yield session
