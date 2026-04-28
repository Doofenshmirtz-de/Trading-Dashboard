"""
JWT verification for Supabase access tokens — three-layer strategy:

  1. HS256 with SUPABASE_JWT_SECRET  (legacy projects + tests, no network call)
  2. JWKS local verification         (new projects, RS256/ES256, keys cached 1h)
  3. Supabase /auth/v1/user API      (guaranteed fallback, always works)

Layers are tried in order; first success wins.
"""

import time
import logging
import httpx
from jose import jwk, jwt
from jose.exceptions import JWTError

from app.config import settings
from app.core.exceptions import UnauthorizedError

logger = logging.getLogger("trading_bot_arena")

_jwks_cache: dict = {"keys": [], "cached_at": 0.0}
_JWKS_TTL = 3600  # seconds


# ── Layer 2 helper: fetch + cache JWKS ────────────────────────────────────────

async def _fetch_jwks() -> list[dict]:
    now = time.time()
    if _jwks_cache["keys"] and (now - float(_jwks_cache["cached_at"])) < _JWKS_TTL:
        return _jwks_cache["keys"]  # type: ignore[return-value]

    url = f"{settings.SUPABASE_URL}/auth/v1/.well-known/jwks.json"
    async with httpx.AsyncClient(timeout=8) as client:
        resp = await client.get(url)
        resp.raise_for_status()
        data = resp.json()

    keys: list[dict] = data.get("keys", [])
    _jwks_cache["keys"] = keys
    _jwks_cache["cached_at"] = now
    logger.info("JWKS refreshed", extra={"key_count": len(keys)})
    return keys


def _try_jwks_verify(token: str, keys: list[dict]) -> dict | None:
    """Try to verify token against JWKS keys. Returns payload or None."""
    try:
        header = jwt.get_unverified_header(token)
    except JWTError:
        return None

    token_kid: str | None = header.get("kid")
    token_alg: str = header.get("alg", "RS256")

    candidates = (
        [k for k in keys if k.get("kid") == token_kid]
        if token_kid
        else keys
    )
    if not candidates:
        candidates = keys  # kid mismatch — try all keys anyway

    for key_data in candidates:
        alg = key_data.get("alg") or token_alg
        try:
            # jwk.construct builds the proper Key object for RSA/EC/HS dicts
            constructed = jwk.construct(key_data, algorithm=alg)
            payload = jwt.decode(
                token,
                constructed.to_dict(),
                algorithms=[alg, "RS256", "ES256", "HS256"],
                options={"verify_aud": False},
            )
            return payload
        except (JWTError, Exception):
            continue
    return None


# ── Layer 3 helper: delegate to Supabase auth server ─────────────────────────

async def _verify_via_supabase_api(token: str) -> dict:
    """Call GET /auth/v1/user — works for all signing methods."""
    url = f"{settings.SUPABASE_URL}/auth/v1/user"
    async with httpx.AsyncClient(timeout=8) as client:
        resp = await client.get(
            url,
            headers={
                "Authorization": f"Bearer {token}",
                "apikey": settings.SUPABASE_SERVICE_ROLE_KEY,
            },
        )

    if resp.status_code == 401:
        raise UnauthorizedError("Invalid or expired token")
    if not resp.is_success:
        raise UnauthorizedError(
            f"Supabase auth check failed with status {resp.status_code}"
        )

    data = resp.json()
    logger.debug("Token verified via Supabase API", extra={"user_id": data.get("id")})
    return {"sub": data["id"], "email": data.get("email")}


# ── Public entry point ────────────────────────────────────────────────────────

async def verify_supabase_token(token: str) -> dict:
    """
    Verify a Supabase access token.
    Returns the decoded payload dict with at least 'sub' (user UUID) and 'email'.
    Raises UnauthorizedError on failure.
    """
    # Layer 1 — HS256 legacy secret (also used by tests)
    if settings.SUPABASE_JWT_SECRET:
        try:
            return jwt.decode(
                token,
                settings.SUPABASE_JWT_SECRET,
                algorithms=["HS256"],
                options={"verify_aud": False},
            )
        except JWTError:
            pass  # fall through to JWKS

    # Layer 2 — local JWKS verification (RS256 / ES256)
    try:
        keys = await _fetch_jwks()
        if keys:
            result = _try_jwks_verify(token, keys)
            if result is not None:
                return result
    except Exception as e:
        logger.warning("JWKS verification skipped", extra={"reason": str(e)})

    # Layer 3 — Supabase API (guaranteed fallback)
    logger.debug("Falling back to Supabase API verification")
    return await _verify_via_supabase_api(token)
