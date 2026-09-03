# InvaTrace - Security Practices Sheet

A plain-English map of every security control shipped in this repo, grouped
the way an FYP write-up (or an audit checklist) usually wants them. Each
row names the control, why it exists, and where in the codebase it lives
so a reader can verify it themselves.

---

## 1. Transport Security (data in motion)

| Control | What it does | Where |
|---|---|---|
| HTTPS everywhere | API served over TLS by Render; PWA served over TLS by Cloudflare Pages. No plaintext HTTP path in production. | `render.yaml`, `docs/deployment.md` |
| HSTS (Strict-Transport-Security) | Tells browsers to only ever talk to the API over HTTPS for a year, including subdomains. Only emitted when `APP_ENV=production`. | `backend/app/main.py:150` |
| TLS to database | Neon Postgres connection uses the pooled TLS URL, not a plaintext port. | `docs/deployment.md:7` |
| TLS to object storage | S3-compatible bucket (Cloudflare R2 / MinIO in prod) accessed only over HTTPS via presigned URLs. | `backend/app/services/storage.py` |

---

## 2. Authentication & Session

InvaTrace has no email/password - a "profile" is created on first launch and
identified by an opaque public ID (`IVT-XXXX-...`). The app holds a
long-lived installation token; short JWTs are minted from it.

| Control | What it does | Where |
|---|---|---|
| Pseudonymous identity | No PII collected at signup. Public ID is random base32 (unambiguous alphabet - no 0/O/1/I/L). | `backend/app/core/security.py:33`, `:76` |
| Cryptographically random secrets | Installation tokens and recovery codes use `secrets.token_bytes` (CSPRNG). | `backend/app/core/security.py:55` |
| Keyed HMAC-SHA256 at rest | Tokens/recovery codes are HMAC-hashed with `CREDENTIAL_HASH_KEY` before touching the DB. A DB leak alone cannot brute-force them. | `backend/app/core/security.py:41` |
| Short-lived JWT | Access tokens are HS256 JWTs with `iat`/`exp`/`iss`/`aud`/`jti`, TTL controlled by `ACCESS_TOKEN_TTL_MINUTES`. | `backend/app/core/security.py:80` |
| Installation-bound tokens | JWT carries both profile ID (`sub`) and installation ID (`ins`); revoking one device invalidates just that device. | `backend/app/core/security.py:89`, `:136` |
| DB re-check on every request | `require_auth` re-queries the installation and profile - a token issued before device revocation stops working immediately. | `backend/app/core/security.py:107` |
| Generic 401 (no enumeration) | All auth failures collapse to the same 401 message - no "wrong password" vs "unknown user" leak. | `backend/app/core/security.py:118` |
| Role-based admin gate | `require_admin` stacks on `require_auth` for the handful of admin routes. | `backend/app/core/security.py:150` |
| Rotatable recovery codes | Recovery codes can be re-rotated to re-link a lost device. | `backend/app/api/routers/identity.py` |

---

## 3. Authorization & Data Visibility

| Control | What it does | Where |
|---|---|---|
| Non-enumerating 404s | Missing private resources return 404 without revealing whether the ID exists but belongs to someone else. | `docs/backend-architecture.md:225` |
| Public vs private sighting split | Public map only exposes rule-screened + removed sightings. In-flight / rejected / dependency-missing reports stay private. | `docs/backend-architecture.md:205` |
| Coarse coordinates for new profiles | Coordinates from `New`-tier profiles are deterministically displaced ~100 m and rounded to 4 decimal places using `LOCATION_PRIVACY_KEY`. | `backend/app/domain/place_association.py`, `docs/backend-architecture.md:207` |
| Cache-Control: private, no-store | Auth'd responses and `/api/v1/profiles/*` never enter shared caches. | `backend/app/main.py:154` |

---

## 4. Rate Limiting & Abuse Control

Redis-backed limiter in `backend/app/core/rate_limit.py`. Two algorithms:
`fixed` (cheap INCR counter) and `sliding` (per-timestamp sorted set)
for scopes where window-edge bursts are unacceptable.

| Scope | Limit | Purpose |
|---|---|---|
| `profile_start` | 10 / 60 s | Profile creation from a single identity |
| `profile_bootstrap` | 30 / 60 s | Initial app data load |
| `profile_restore` (sliding) | 5 / 15 min | Brute-force protection on recovery codes - **failed attempts only** (AC 2.1.4) |
| `profile_restore_ip` (sliding) | 5 / 15 min | Per-IP tarpit for recovery |
| `recovery_rotate` | 5 / hr | Prevents log flooding via rotation |
| `installation_revoke` | 20 / hr | Bounds mass-revoke abuse |
| `upload_presign` | 30 / 60 s | Bounds S3 presign cost |
| `report_create_burst` (sliding, env-tunable) | AC 2.3.3 | Per-identity report spam |
| `report_create_ip_burst` (sliding, env-tunable) | AC 2.3.3 | Per-IP report spam |
| `report_create_daily` | 50 / 24 h | Long-window quota |
| `sightings_read` | 120 / 60 s | Public read endpoint |

Behaviour: 429 with `Retry-After` header. In production, Redis outage
**fails closed** (503) rather than silently disabling limits.

---

## 5. Input Validation & Injection

| Control | What it does | Where |
|---|---|---|
| Pydantic request schemas | Every request body / query param validated by typed Pydantic models - 400 on shape mismatch. | `backend/app/api/schemas.py` |
| SQLAlchemy parameterised queries | ORM + `select()` construction throughout - no string-concatenated SQL. | `backend/app/db/*`, all routers |
| UUID coercion at boundary | JWT claims and path params are cast through `uuid.UUID` before use - malformed IDs bounce as 401/400. | `backend/app/core/security.py:131` |
| Request ID regex | Client-supplied `X-Request-ID` only echoed back if it matches `^[A-Za-z0-9._:-]{8,100}$`; otherwise a fresh uuid4 is minted. Prevents header injection. | `backend/app/main.py:47` |
| Idempotency-Key header | Report submissions carry an idempotency key so retries don't duplicate. | `backend/app/api/routers/reports.py` |

---

## 6. Upload / Media Pipeline

| Control | What it does | Where |
|---|---|---|
| Presigned upload URLs | Client uploads directly to S3 via short-lived presigned URLs; API never proxies the bytes. | `backend/app/api/routers/uploads.py`, `backend/app/services/storage.py` |
| Bucket CORS locked | Only the exact Cloudflare Pages production origin is allowed. | `backend/minio-cors.json`, `docs/deployment.md:29` |
| Upload cleanup worker | Orphaned uploads are pruned periodically to bound storage. | `backend/app/services/upload_cleanup.py` |
| Replay defence | Rejects exact byte / capture-ID replays; perceptual dhash catches resized / 80 %-cropped copies across species. | `backend/app/domain/`, `docs/backend-architecture.md:214` |
| Screening gates | Reports must pass image size, exposure, contrast, edge-detail, GPS, supported E1 version, and duplicate rules before going public. | `docs/backend-architecture.md:214` |

---

## 7. HTTP Response Hardening

### 7.1 API responses (FastAPI middleware - `backend/app/main.py:141`)

| Header | Value | Purpose |
|---|---|---|
| `X-Content-Type-Options` | `nosniff` | Blocks MIME-sniffing attacks |
| `Referrer-Policy` | `no-referrer` | Never leaks URL to third parties |
| `Content-Security-Policy` | `default-src 'none'; frame-ancestors 'none'; base-uri 'none'` | API is JSON-only; blocks all sub-resource loading if a response is ever rendered in a browser |
| `X-Frame-Options` | `DENY` | Clickjacking protection |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` (prod only) | Forces HTTPS |
| `Cache-Control` / `Pragma` | `private, no-store` / `no-cache` (auth'd or profile paths) | No shared-cache leaks |
| `X-Request-ID` | Echoed / minted | Correlates client + server logs |

### 7.2 PWA responses (Cloudflare Pages - `public/_headers`)

| Header | Value |
|---|---|
| `Content-Security-Policy` | `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' https: http://localhost:*; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'` |
| `X-Frame-Options` | `DENY` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `no-referrer` |
| `Permissions-Policy` | `camera=(self), geolocation=(self), microphone=()` - camera + geo only from own origin, mic disabled |

Model + WASM assets get `Cache-Control: public, max-age=31536000, immutable`
plus `nosniff`, keeping the ONNX model integrity-cached at the edge.

### 7.3 CORS (`backend/app/main.py:107`)

- Explicit origin list (env-driven `CORS_ORIGINS`); **wildcard rejected at startup**.
- `allow_credentials=False` - bearer tokens travel in the `Authorization` header, not cookies.
- Methods: `GET, POST, PATCH, DELETE, OPTIONS`.
- Headers preflight-allowed: `Authorization, Content-Type, Idempotency-Key, X-InvaTrace-Queued, X-InvaTrace-Catalogue-Version, X-InvaTrace-Catalogue-Sha256, X-Request-ID`.
- Exposed: `Retry-After, X-Request-ID`.

---

## 8. Secrets Management

| Control | What it does | Where |
|---|---|---|
| No secrets in git | `JWT_SECRET`, `CREDENTIAL_HASH_KEY`, `LOCATION_PRIVACY_KEY`, `S3_*` all `sync: false` in `render.yaml` - set in Render dashboard only. | `render.yaml` |
| Per-service generated secrets | `JWT_SECRET`, `CREDENTIAL_HASH_KEY`, `LOCATION_PRIVACY_KEY` use Render's `generateValue: true` for fresh entropy on first deploy. | `render.yaml` |
| Separated concerns | Different keys for JWT signing vs credential hashing vs location displacement - one key leak doesn't compromise all three. | `backend/app/config.py` |
| `.env` never committed | `.env*` in `.gitignore`; `.env.example` shipped as reference. | root |

---

## 9. Error Handling & Logging

| Control | Where |
|---|---|
| Uniform error envelope `{code, detail, requestId}` | `backend/app/core/errors.py` |
| Codes: 400 validation, 401 session, 403 role, 404 non-enumerating, 409 conflict, 429 rate-limit + `Retry-After`, 503 dependency | `docs/backend-architecture.md:221` |
| Structured JSON logs (`structlog`) with request ID context var | `backend/app/main.py:36` |
| No secrets / tokens in logs | Only request ID, method, path, status logged per request | `backend/app/main.py:160` |

---

## 10. Frontend / Client-Side

| Control | Where |
|---|---|
| React auto-escaping | JSX default - no user text rendered raw |
| Only one `innerHTML` in codebase, static SVG template with values from a constant enum, no user data - safe | `src/features/map/ThreatMapPage.tsx:654` |
| Bearer token in `Authorization` header, not `document.cookie` - immune to CSRF | `src/services/*` |
| IndexedDB / OPFS scoped to origin; CSP forbids cross-origin `connect-src` beyond HTTPS | `public/_headers` |
| Camera + geolocation gated by `Permissions-Policy` and browser prompt | `public/_headers`, `src/features/*` |

---

## 11. Operational Security

| Control | Where |
|---|---|
| `/health/live` + `/health/ready` for uptime probes | `backend/app/api/routers/health.py` |
| Migrations + reference data on every container start via `docker-entrypoint.sh` - no drift between code and schema | `backend/docker-entrypoint.sh` |
| Region-pinned to `singapore` (data residency for FYP scope) | `render.yaml` |
| API and PWA are separate services - blast-radius reduction | `render.yaml` |

---

## 12. Known Gaps / Future Work

Things the codebase does **not** currently do - worth listing so the write-up
is honest and the plan has explicit next steps.

1. **No WAF / bot mitigation layer** beyond Cloudflare Pages defaults on the frontend. API on Render is directly reachable.
2. **No CSRF token** - mitigated by bearer-in-header + `allow_credentials=False`, but any future cookie-session route would need one.
3. **No dependency scanning** in CI (Dependabot / Renovate / `pip-audit` / `npm audit --production` gate not configured).
4. **No SAST** (Semgrep / Bandit / CodeQL) wired into CI.
5. **No SBOM** produced at build time.
6. **No key rotation runbook** - `JWT_SECRET` / `CREDENTIAL_HASH_KEY` rotation would invalidate all sessions / credentials; a staged rotation plan is not documented.
7. **No audit log table** - request logs are ephemeral. Admin actions (role change, revoke) are not persisted in a tamper-evident log.
8. **No MFA / step-up auth** for admin role - Admin only requires the same install-token flow as any profile.
9. **No penetration test** on record for this FYP build.
10. **PWA CSP allows `'unsafe-inline'` styles** (needed by current CSS-in-JS bits) - could be tightened to nonce/hash-based.
11. **`connect-src` includes `http://localhost:*`** for dev - production build should strip this or scope it via env.

---

## 13. Standards / Frameworks Mapping (for the write-up)

| Standard | How InvaTrace addresses it |
|---|---|
| **OWASP Top 10 2021 A01 Broken Access Control** | JWT + installation binding, DB re-check, non-enumerating 404, role gate |
| **A02 Cryptographic Failures** | TLS end-to-end, HMAC-SHA256 with keyed secret at rest, `secrets` CSPRNG, no plaintext credentials stored |
| **A03 Injection** | Pydantic validation, SQLAlchemy parameterised queries, header regex whitelist |
| **A04 Insecure Design** | Rate-limit-by-design on abuse-prone flows, fail-closed on Redis, pseudonymous identity |
| **A05 Security Misconfiguration** | CORS wildcard rejected at startup, security headers on every response, HSTS in prod |
| **A06 Vulnerable Components** | *Gap - see §12 (no automated scanning)* |
| **A07 Identification / Authentication Failures** | Sliding-window brute-force limit on recovery, generic 401, short JWT TTL, revocable installations |
| **A08 Software / Data Integrity Failures** | Immutable model asset cache with `nosniff`, catalogue version + SHA256 verified server-side per report |
| **A09 Security Logging / Monitoring Failures** | Structured logs with request ID; *gap - no audit table (§12)* |
| **A10 Server-Side Request Forgery** | No user-controlled URL fetching in server code paths |

| Standard | Coverage |
|---|---|
| **GDPR / PDPA (Malaysia)** | Pseudonymous identity, no PII at signup, coarse coordinates for new profiles, `private, no-store` on identity responses |
| **NIST SP 800-63B (auth)** | CSPRNG-generated secrets, keyed hashing at rest, throttling on failed authentication |

---

## 14. Verification Checklist (what to actually test)

Copy this into the security-testing section of the report.

- [ ] `curl -I https://<api>/health/ready` → expect HSTS, CSP, nosniff, Referrer-Policy, Frame-Options in prod
- [ ] `curl -I https://<pwa>/` → expect PWA CSP + Permissions-Policy
- [ ] Preflight `OPTIONS` from disallowed origin → expect no `Access-Control-Allow-Origin` echo
- [ ] Wildcard `CORS_ORIGINS=*` on boot → expect startup failure
- [ ] 6 failed restore attempts in 15 min from same identity → expect 429 with `Retry-After`
- [ ] Redis down in prod → expect 503, not 200
- [ ] Expired JWT → expect 401 `session_expired`
- [ ] Revoked installation JWT (still within `exp`) → expect 401 `installation_revoked`
- [ ] Non-admin hitting `/admin/*` → expect 403 `forbidden`
- [ ] Someone else's private report ID → expect 404 (not 403 - no enumeration)
- [ ] Malformed `X-Request-ID: <script>` → response echoes a fresh uuid4, not the input
- [ ] Report submission with tampered `X-InvaTrace-Catalogue-Sha256` → expect rejection
- [ ] Duplicate report byte-identical to prior → expect duplicate rule rejection
- [ ] Perceptually similar (resized / cropped) photo → expect replay rejection
