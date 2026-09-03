FROM python:3.12.11-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /service

# libexpat1 is a pyosmium runtime dependency; curl is used by the container
# HEALTHCHECK so the image does not need a Python-only probe hop.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libexpat1 curl \
    && rm -rf /var/lib/apt/lists/* \
    && addgroup --system invatrace \
    && adduser --system --ingroup invatrace invatrace

COPY requirements.lock ./
RUN python -m pip install --no-cache-dir -r requirements.lock

COPY pyproject.toml ./
COPY app ./app
COPY alembic ./alembic
COPY alembic.ini ./alembic.ini

USER invatrace
EXPOSE 8000

# AC Iteration 1 P11 — container-level readiness probe. Render's own
# healthCheckPath handles restart-on-failure at the platform level; this
# HEALTHCHECK gives docker/compose users the same signal locally.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD curl --fail --silent --show-error --max-time 4 \
        http://127.0.0.1:8000/health/live || exit 1

# AC Iteration 1 P11 — --proxy-headers + --forwarded-allow-ips="*" so
# Render's reverse proxy X-Forwarded-For reaches client_address() in
# app/core/rate_limit.py. Without this every request looks like it comes
# from Render's edge and the per-IP burst limit collapses to a single
# bucket for the whole platform.
CMD ["uvicorn", "app.main:app", \
     "--host", "0.0.0.0", \
     "--port", "8000", \
     "--proxy-headers", \
     "--forwarded-allow-ips", "*"]
