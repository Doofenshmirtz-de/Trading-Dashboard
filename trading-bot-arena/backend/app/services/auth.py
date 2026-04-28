"""
JWT verification that supports both Supabase token formats:

  Legacy projects:  HS256 signed with SUPABASE_JWT_SECRET
  New projects:     RS256 / ES256 signed with a rotating key from JWKS

Strategy (in order):
  1. If SUPABASE_JWT_SECRET is set → try HS256 first (fast, no network call)
  2. Fetch JWKS from Supabase's well-known endpoint (cached for 1 hour)
  3. Verify with matching key from JWKS
"""

import time
import httpx
from jose import jwt
from jose.exceptions import JWTError

from app.config import settings
from app.core.exceptions import UnauthorizedError
from app.core.logging import get_logger

logger = get_logger()

_jwks_cache: dict = {"keys": [], "cached_at": 0.0}
_JWKS_TTL = 3600  # seconds


async def _fetch_jwks() -> list[dict]:
    now = time.time()
    if _jwks_cache["keys"] and (now - float(_jwks_cache["cached_at"])) < _JWKS_TTL:
        return _jwks_cache["keys"]  # type: ignore[return-value]

    url = f"{settings.SUPABASE_URL}/auth/v1/.well-known/jwks.json"
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            data = resp.json()

        keys: list[dict] = data.get("keys", [])
        _jwks_cache["keys"] = keys
        _jwks_cache["cached_at"] = now
        logger.info("JWKS fetched", extra={"key_count": len(keys), "url": url})
        return keys
    except Exception as e:
        logger.error("Failed to fetch JWKS", extra={"error": str(e), "url": url})
        # Return stale cache if available rather than failing
        if _jwks_cache["keys"]:
            logger.warning("Using stale JWKS cache")
            return _jwks_cache["keys"]  # type: ignore[return-value]
        raise


async def verify_supabase_token(token: str) -> dict:
    """
    Verify a Supabase access token.
    Tries HS256 (legacy) first, then falls back to JWKS (new projects).
    Returns the decoded JWT payload on success, raises UnauthorizedError on failure.
    """
    # ── Approach 1: HS256 with legacy secret ──────────────────────────────────
    if settings.SUPABASE_JWT_SECRET:
        try:
            return jwt.decode(
                token,
                settings.SUPABASE_JWT_SECRET,
                algorithms=["HS256"],
                options={"verify_aud": False},
            )
        except JWTError:
            # Secret is set but verification failed — fall through to JWKS
            pass

    # ── Approach 2: JWKS (RS256 / ES256) ──────────────────────────────────────
    try:
        keys = await _fetch_jwks()
    except Exception as e:
        raise UnauthorizedError(f"Unable to fetch JWKS for token verification: {e}") from e

    if not keys:
        raise UnauthorizedError("JWKS returned no keys")

    # Match by key ID (kid) in the token header for efficiency
    try:
        header = jwt.get_unverified_header(token)
        token_kid: str | None = header.get("kid")
        token_alg: str = header.get("alg", "RS256")
    except JWTError as e:
        raise UnauthorizedError(f"Invalid token header: {e}") from e

    candidates = (
        [k for k in keys if k.get("kid") == token_kid]
        if token_kid
        else keys
    )

    for key_data in candidates:
        alg = key_data.get("alg") or token_alg
        try:
            payload = jwt.decode(
                token,
                key_data,
                algorithms=[alg, "RS256", "ES256"],
                options={"verify_aud": False},
            )
            return payload
        except JWTError:
            continue

    raise UnauthorizedError(
        "Token signature verification failed against all available JWKS keys"
    )
