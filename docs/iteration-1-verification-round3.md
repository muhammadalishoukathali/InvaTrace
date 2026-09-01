# Iteration 1 — Round 3 (final) check

After implementing every E2 anti-abuse control for real and fixing the 2.1.4 lockout. Only the deterministic rule engine (2.2.1) is still mock — that's the E2 pipeline itself.

## What changed

- **2.1.1** — verified: each recovery code is 128-bit CSPRNG via `randomGroupedSecret(16)`. Earlier "~80-bit" claim was wrong. No code change needed.
- **2.1.4** — replaced per-profile exponential backoff with the AC-literal rule: 5 failed restores per (profileId, IP) inside a 15-min sliding window → HTTP 429 + `Retry-After`.
- **2.3.1** — client computes `imageSha256` via `crypto.subtle.digest`; server dedups same-owner + same-species + same-hash → `status:'merged'`.
- **2.3.2** — server computes Haversine + checks 10-min window; 25 m match → `status:'merged'`.
- **2.3.3** — sliding-window rate limiter (10/token, 30/IP per 10 min) → 429 + `Retry-After`.

## Result

- E1 — 6/6
- E2 — 9/10 (only 2.2.1 rule engine deferred)
- E3 — 7/7
- E4 — 9/9

Total: 29 done, 1 mock-only.

## Regression suite

- Vitest unit + schema: 23/23
- Playwright happy-path (chromium, mocked): 8/8
- `tsc -b --noEmit`: clean
