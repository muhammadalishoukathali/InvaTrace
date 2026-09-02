"""Tests for app/core/rate_limit.py.

Covers the configured limits, the AC 2.3.3 env-backed sliding-window
submission limits, the AC 2.1.4 "count failures only + clear on success"
restoration flow, and the fail-closed behaviour when Redis is down.
Fail-closed is the important one from a security standpoint — if Redis is
unreachable we'd rather reject requests than let rate limiting silently
stop working.
"""

from __future__ import annotations

import pytest
from redis.exceptions import RedisError

from app.core.errors import ApiProblem
from app.core.rate_limit import RateLimiter, _limit_for, reload_limits


class BrokenRedis:
    """Redis client stand-in that always blows up so we can exercise the
    "Redis is unreachable" path without actually taking Redis down."""

    def pipeline(self, *, transaction: bool):
        assert transaction is True
        raise RedisError("unavailable")

    def delete(self, *args, **kwargs):
        raise RedisError("unavailable")


def test_report_limits_use_env_backed_defaults() -> None:
    # AC 2.3.3 defaults: 10/profile, 30/IP, 600 s window.
    reload_limits()
    assert _limit_for("report_create_burst").requests == 10
    assert _limit_for("report_create_burst").window_seconds == 600
    assert _limit_for("report_create_burst").algorithm == "sliding"
    assert _limit_for("report_create_ip_burst").requests == 30
    assert _limit_for("report_create_ip_burst").window_seconds == 600
    assert _limit_for("report_create_ip_burst").algorithm == "sliding"
    # AC 2.1.4 — restoration failures use a sliding window too.
    assert _limit_for("profile_restore").algorithm == "sliding"
    assert _limit_for("profile_restore").requests == 5
    assert _limit_for("profile_restore").window_seconds == 15 * 60
    assert _limit_for("profile_restore_ip").algorithm == "sliding"


def test_production_rate_limit_dependency_fails_closed() -> None:
    limiter = RateLimiter.__new__(RateLimiter)
    limiter.enabled = True
    limiter.fail_closed = True
    limiter.redis = BrokenRedis()

    with pytest.raises(ApiProblem) as raised:
        limiter.check("report_create_burst", "profile-id")

    assert raised.value.status_code == 503
    assert raised.value.code == "rate_limit_unavailable"


def test_sliding_window_boundary_at_configured_limit() -> None:
    # Redis stand-in that speaks just enough of the sorted-set commands the
    # sliding-window implementation uses. Tracks (score, member) pairs per key.
    class InMemoryRedis:
        def __init__(self):
            self.store: dict[str, list[tuple[float, str]]] = {}

        def pipeline(self, *, transaction: bool):
            outer = self
            calls: list[tuple[str, tuple, dict]] = []

            class Pipe:
                def zadd(self, key, mapping):
                    calls.append(("zadd", (key, mapping), {}))
                    return self

                def expire(self, key, ttl):
                    calls.append(("expire", (key, ttl), {}))
                    return self

                def zremrangebyscore(self, key, minimum, maximum):
                    calls.append(("zremrangebyscore", (key, minimum, maximum), {}))
                    return self

                def zrange(self, key, start, stop, withscores):
                    calls.append(("zrange", (key, start, stop), {"withscores": withscores}))
                    return self

                def zcard(self, key):
                    calls.append(("zcard", (key,), {}))
                    return self

                def execute(self):
                    results = []
                    for name, args, kwargs in calls:
                        key = args[0]
                        entries = outer.store.setdefault(key, [])
                        if name == "zadd":
                            mapping = args[1]
                            for member, score in mapping.items():
                                entries.append((float(score), member))
                            entries.sort(key=lambda pair: pair[0])
                            results.append(1)
                        elif name == "expire":
                            results.append(True)
                        elif name == "zremrangebyscore":
                            cutoff = args[2]
                            outer.store[key] = [pair for pair in entries if pair[0] > cutoff]
                            results.append(0)
                        elif name == "zrange":
                            outer.store[key].sort(key=lambda pair: pair[0])
                            entries = outer.store[key]
                            results.append(
                                [(member, score) for score, member in entries[: args[2] + 1]]
                                if kwargs.get("withscores")
                                else [member for _, member in entries[: args[2] + 1]]
                            )
                        elif name == "zcard":
                            results.append(len(outer.store[key]))
                    return results

            return Pipe()

        def delete(self, key):
            self.store.pop(key, None)

    limiter = RateLimiter.__new__(RateLimiter)
    limiter.enabled = True
    limiter.fail_closed = False
    limiter.redis = InMemoryRedis()
    reload_limits()

    # AC 2.3.3 — 10 submissions per profile per 600 s. Requests 1..10 are
    # accepted; request 11 crosses the threshold.
    for _ in range(10):
        limiter.check("report_create_burst", "profile-a")
    with pytest.raises(ApiProblem) as raised:
        limiter.check("report_create_burst", "profile-a")
    assert raised.value.status_code == 429
    assert raised.value.code == "rate_limited"
    # A different profile has its own bucket.
    limiter.check("report_create_burst", "profile-b")


def test_restore_success_clears_failure_counter() -> None:
    class InMemoryRedis:
        def __init__(self):
            self.store: dict[str, list[tuple[float, str]]] = {}

        def pipeline(self, *, transaction: bool):
            outer = self
            calls: list[tuple[str, tuple, dict]] = []

            class Pipe:
                def zadd(self, key, mapping):
                    calls.append(("zadd", (key, mapping), {}))
                    return self

                def expire(self, key, ttl):
                    calls.append(("expire", (key, ttl), {}))
                    return self

                def zremrangebyscore(self, key, minimum, maximum):
                    calls.append(("zremrangebyscore", (key, minimum, maximum), {}))
                    return self

                def zrange(self, key, start, stop, withscores):
                    calls.append(("zrange", (key, start, stop), {"withscores": withscores}))
                    return self

                def zcard(self, key):
                    calls.append(("zcard", (key,), {}))
                    return self

                def execute(self):
                    results = []
                    for name, args, kwargs in calls:
                        key = args[0]
                        entries = outer.store.setdefault(key, [])
                        if name == "zadd":
                            mapping = args[1]
                            for member, score in mapping.items():
                                entries.append((float(score), member))
                            entries.sort(key=lambda pair: pair[0])
                            results.append(1)
                        elif name == "expire":
                            results.append(True)
                        elif name == "zremrangebyscore":
                            cutoff = args[2]
                            outer.store[key] = [pair for pair in entries if pair[0] > cutoff]
                            results.append(0)
                        elif name == "zrange":
                            outer.store[key].sort(key=lambda pair: pair[0])
                            entries = outer.store[key]
                            results.append(
                                [(member, score) for score, member in entries[: args[2] + 1]]
                                if kwargs.get("withscores")
                                else [member for _, member in entries[: args[2] + 1]]
                            )
                        elif name == "zcard":
                            results.append(len(outer.store[key]))
                    return results

            return Pipe()

        def delete(self, key):
            self.store.pop(key, None)

    limiter = RateLimiter.__new__(RateLimiter)
    limiter.enabled = True
    limiter.fail_closed = False
    limiter.redis = InMemoryRedis()
    reload_limits()

    # AC 2.1.4 — 4 failed restores stay under the 5 threshold; a success
    # clears the counter so the next failure is treated as attempt 1 again.
    for _ in range(4):
        limiter.record_failure("profile_restore", "PROFILE-1")
    limiter.check_pre_failure("profile_restore", "PROFILE-1")  # still under
    limiter.record_success("profile_restore", "PROFILE-1")
    for _ in range(4):
        limiter.record_failure("profile_restore", "PROFILE-1")
    limiter.check_pre_failure("profile_restore", "PROFILE-1")  # under again
    limiter.record_failure("profile_restore", "PROFILE-1")
    with pytest.raises(ApiProblem) as raised:
        limiter.check_pre_failure("profile_restore", "PROFILE-1")
    assert raised.value.status_code == 429
