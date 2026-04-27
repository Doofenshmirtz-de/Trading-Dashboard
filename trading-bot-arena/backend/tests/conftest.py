import os
import time
import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from jose import jwt

TEST_JWT_SECRET = "test-secret-for-trading-bot-arena"
TEST_USER_ID = "00000000-0000-0000-0000-000000000001"
TEST_USER_EMAIL = "test@example.com"

os.environ.setdefault("SUPABASE_URL", "https://test.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-key")
os.environ.setdefault("SUPABASE_JWT_SECRET", TEST_JWT_SECRET)
os.environ.setdefault("ENVIRONMENT", "test")


def make_jwt(user_id: str = TEST_USER_ID, email: str = TEST_USER_EMAIL) -> str:
    payload = {
        "sub": user_id,
        "email": email,
        "iat": int(time.time()),
        "exp": int(time.time()) + 3600,
        "role": "authenticated",
    }
    return jwt.encode(payload, TEST_JWT_SECRET, algorithm="HS256")


@pytest.fixture(scope="session")
def valid_token() -> str:
    return make_jwt()


@pytest_asyncio.fixture
async def authenticated_client(valid_token: str):
    from app.main import app

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        client.headers["Authorization"] = f"Bearer {valid_token}"
        yield client


@pytest_asyncio.fixture
async def unauthenticated_client():
    from app.main import app

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        yield client
