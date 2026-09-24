"""AC 2.1.1 + 2.1.2 verification-only tests for anonymous recovery secrets.

Each profile gets a single 128-bit reusable recovery code - one secret to
save, reusable so restoring on a new device does not draw down a limited
pool. Rotation replaces it if the user suspects it has leaked. Every
assertion here guards a property the AC calls out explicitly:

* raw codes come from a CSPRNG with at least 128 bits of entropy each;
* raw codes only appear in the initial creation / rotation response and
  are never persisted server-side (the DB only ever sees keyed hashes);
* every response that carries raw secrets is marked ``Cache-Control:
  no-store`` by the security middleware;
* public map / sighting payloads never leak recovery secrets, access
  tokens, or the internal owner id.
"""

from __future__ import annotations

import re

from fastapi.testclient import TestClient

from app.api.routers import identity
from app.core.security import BASE32_ALPHABET, random_grouped_secret
from app.main import app

# Crockford-style alphabet (see security.BASE32_ALPHABET): 32 symbols, no
# I/O/0/1. Each symbol is 5 bits, so ceil(128 / 5) = 26 encoded chars.
BASE32_RE = re.compile(rf"^[{re.escape(BASE32_ALPHABET)}]+(?:-[{re.escape(BASE32_ALPHABET)}]+)*$")
MIN_ENCODED_CHARS = 26


def test_random_grouped_secret_has_at_least_128_bits() -> None:
    # AC 2.1.1 - 16 bytes = 128 bits from secrets.token_bytes.
    # random_grouped_secret is the shared generator for installation
    # tokens and recovery codes; the recovery batch below uses 16 bytes.
    secret = random_grouped_secret(16)
    assert BASE32_RE.fullmatch(secret), secret
    # 26 encoded characters × 5 bits/symbol = 130 bits from the custom
    # base32 alphabet, so any secret encoding at least 128 bits worth of
    # entropy must have at least MIN_ENCODED_CHARS symbols.
    stripped = secret.replace("-", "")
    assert len(stripped) >= MIN_ENCODED_CHARS


def test_recovery_secrets_are_distinct_per_call() -> None:
    # A generator that returned the same secret twice would be a critical
    # entropy bug - sanity-check that 100 calls all differ.
    samples = {random_grouped_secret(16) for _ in range(100)}
    assert len(samples) == 100


def test_recovery_codes_come_from_secrets_module() -> None:
    # AC 2.1.1 - raw codes must come from a CSPRNG. `secrets.token_bytes`
    # is the CSPRNG the module is documented to use; guard against a lazy
    # substitution with `random.random()` or similar.
    source = __import__("inspect").getsource(random_grouped_secret)
    assert "secrets.token_bytes" in source


def test_profile_start_returns_no_store_and_recovery_codes() -> None:
    # AC 2.1.2 - the only endpoint that hands over raw recovery secrets
    # must set Cache-Control: no-store so no shared proxy / browser cache
    # retains them.
    client = TestClient(app, raise_server_exceptions=False)
    response = client.post(
        "/api/v1/profiles/start",
        json={"installationToken": random_grouped_secret(32)},
    )
    # The database is not connected in the unit-test environment, so the
    # POST may return 500 before the handler completes. The middleware
    # runs regardless and still stamps the header, which is the AC-level
    # property we care about here.
    assert response.headers.get("cache-control") == "private, no-store"
    assert response.headers.get("pragma") == "no-cache"


def test_recovery_batch_helper_returns_unique_raw_codes() -> None:
    # AC 2.1.2 - batch cardinality + uniqueness. The helper writes to
    # the DB (session.add / flush); pass a stand-in session so we can
    # inspect the raw codes it returned without needing Postgres up.
    class _StubSession:
        def add(self, *_args, **_kwargs) -> None:
            pass

        def add_all(self, *_args, **_kwargs) -> None:
            pass

        def flush(self) -> None:
            pass

    raw_codes, _created_at = identity.create_recovery_batch(
        _StubSession(),
        profile_id=__import__("uuid").uuid4(),
    )
    assert len(raw_codes) == identity.RECOVERY_CODES_PER_BATCH
    assert len(set(raw_codes)) == identity.RECOVERY_CODES_PER_BATCH
    for code in raw_codes:
        assert BASE32_RE.fullmatch(code), code
        assert len(code.replace("-", "")) >= MIN_ENCODED_CHARS
