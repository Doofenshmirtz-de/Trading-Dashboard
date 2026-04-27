from fastapi import Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import jwt, JWTError
from app.config import settings
from app.core.exceptions import UnauthorizedError

_bearer = HTTPBearer(auto_error=False)


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> dict:
    if credentials is None:
        raise UnauthorizedError("Missing Authorization header")

    token = credentials.credentials
    try:
        payload = jwt.decode(
            token,
            settings.SUPABASE_JWT_SECRET,
            algorithms=["HS256"],
            options={"verify_aud": False},
        )
    except JWTError as e:
        raise UnauthorizedError(f"Invalid or expired token: {e}") from e

    user_id: str | None = payload.get("sub")
    email: str | None = payload.get("email")

    if not user_id:
        raise UnauthorizedError("Token missing 'sub' claim")

    return {"user_id": user_id, "email": email}
