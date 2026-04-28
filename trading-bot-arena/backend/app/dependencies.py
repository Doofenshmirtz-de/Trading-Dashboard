from fastapi import Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from app.services.auth import verify_supabase_token
from app.core.exceptions import UnauthorizedError

_bearer = HTTPBearer(auto_error=False)


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> dict:
    if credentials is None:
        raise UnauthorizedError("Missing Authorization header")

    token = credentials.credentials
    payload = await verify_supabase_token(token)

    user_id: str | None = payload.get("sub")
    email: str | None = payload.get("email")

    if not user_id:
        raise UnauthorizedError("Token missing 'sub' claim")

    return {"user_id": user_id, "email": email}
