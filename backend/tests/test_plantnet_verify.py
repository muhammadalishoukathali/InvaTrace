"""PlantNet second-opinion proxy. Every HTTP request uses MockTransport."""

import asyncio
from types import SimpleNamespace

import httpx
import pytest

from app.services import plantnet

API_KEY = "plantnet-test-secret"
JPEG = b"\xff\xd8\xff" + b"0" * 64
MATCH = {
    "results": [
        {
            "score": 0.83,
            "species": {
                "scientificNameWithoutAuthor": "Hibiscus rosa-sinensis",
                "commonNames": ["Chinese hibiscus"],
                "family": {"scientificNameWithoutAuthor": "Malvaceae"},
            },
        }
    ]
}


@pytest.fixture(autouse=True)
def fresh_counter(monkeypatch):
    monkeypatch.setattr(plantnet, "_counter", plantnet._DailyCounter())


def settings(**overrides):
    values = {
        "plantnet_api_key": API_KEY,
        "plantnet_project": "all",
        "plantnet_endpoint": "https://my-api.plantnet.org/v2/identify",
        "plantnet_timeout_seconds": 8.0,
        "plantnet_daily_limit": 400,
        **overrides,
    }
    return SimpleNamespace(**values)


def verify(handler, s=None, **kw):
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await plantnet.verify_image(
                JPEG, "scan.jpg", "image/jpeg", s or settings(), http_client=client, **kw
            )

    return asyncio.run(run())


def test_request_reaches_plantnet_with_key_and_multipart_form():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = request.url
        seen["content_type"] = request.headers["content-type"]
        seen["body"] = request.content
        return httpx.Response(200, json=MATCH)

    result = verify(handler)

    assert result.status == "native"
    assert result.species.scientific_name == "Hibiscus rosa-sinensis"
    assert result.species.common_names == ("Chinese hibiscus",)
    assert result.species.family == "Malvaceae"
    assert result.species.score == pytest.approx(0.83)
    # PlantNet only reads the key from the `api-key` query parameter.
    assert seen["url"].path == "/v2/identify/all"
    assert seen["url"].params["api-key"] == API_KEY
    assert seen["content_type"].startswith("multipart/form-data")
    assert b'name="organs"' in seen["body"]
    assert b"auto" in seen["body"]
    assert b'name="images"; filename="scan.jpg"' in seen["body"]
    assert JPEG in seen["body"]


def test_each_organ_is_sent_as_its_own_form_field():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["body"] = request.content
        return httpx.Response(200, json=MATCH)

    verify(handler, organs=("leaf", "flower"))

    assert seen["body"].count(b'name="organs"') == 2
    assert b"leaf" in seen["body"]
    assert b"flower" in seen["body"]


def test_missing_key_is_disabled_without_calling_plantnet():
    def handler(request: httpx.Request) -> httpx.Response:
        raise AssertionError("PlantNet must not be called without a key")

    assert verify(handler, settings(plantnet_api_key=None)).status == "disabled"


def test_no_match_is_not_sure():
    assert verify(lambda request: httpx.Response(404)).status == "not_sure"


def test_rejected_key_is_error_and_never_echoes_the_key():
    result = verify(lambda request: httpx.Response(401, json={"message": "Bad token"}))

    assert result.status == "error"
    assert result.reason == "HTTP 401"
    assert API_KEY not in repr(result)


def test_unexpected_failure_degrades_to_error_instead_of_raising():
    def handler(request: httpx.Request) -> httpx.Response:
        raise RuntimeError(f"boom while calling {request.url}")

    result = verify(handler)

    assert result.status == "error"
    assert API_KEY not in repr(result)


def test_daily_limit_stops_outbound_calls():
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return httpx.Response(200, json=MATCH)

    s = settings(plantnet_daily_limit=1)

    assert verify(handler, s).status == "native"
    assert verify(handler, s).status == "not_sure"
    assert len(calls) == 1
