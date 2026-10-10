import pytest

from app.domain.place_names import PlaceCandidate, dedupe_places, public_place_name


def _place(name, *, kind="area", curated=False, suffixed=False, at=(3.15, 101.63), key=None, demo_seed=False):
    return PlaceCandidate(
        item=name if key is None else key,
        name=name,
        kind=kind,
        curated=curated,
        demo_seed=demo_seed,
        suffixed=suffixed,
        latitude=at[0],
        longitude=at[1],
    )


def test_public_name_drops_the_osm_disambiguator() -> None:
    assert public_place_name("Ah Meng Trail · OSM way/1323410857") == "Ah Meng Trail"
    assert public_place_name("Bukit Kiara Federal Park · OSM relation/19352491") == (
        "Bukit Kiara Federal Park"
    )
    assert public_place_name("Taman Tugu") == "Taman Tugu"


def test_split_trail_segments_merge_into_the_unsuffixed_trail() -> None:
    # A 6 km trail in 2 km segments: no single pair spans it, but they chain.
    segments = [
        _place(
            "Ridge Trail",
            kind="trail",
            suffixed=index > 0,
            at=(3.10 + index * 0.018, 101.6),
            key=index,
        )
        for index in range(4)
    ]
    kept = dedupe_places(list(reversed(segments)))
    assert [c.item for c in kept] == [0]
    assert kept[0].location_hint is None


def test_curated_place_hides_its_osm_copy() -> None:
    kept = dedupe_places(
        [
            _place("Taman Botani Negara Shah Alam", suffixed=True, at=(3.10, 101.52), key="osm"),
            _place("Taman Botani Negara Shah Alam", curated=True, at=(3.13, 101.52), key="curated"),
        ]
    )
    assert [c.item for c in kept] == ["curated"]


def test_different_places_sharing_a_name_stay_apart_with_a_hint() -> None:
    kept = dedupe_places(
        [
            _place("Taman Merdeka", at=(1.49, 103.74), key="johor"),
            _place("Taman Merdeka", suffixed=True, at=(5.41, 100.33), key="penang"),
        ]
    )
    assert sorted(c.item for c in kept) == ["johor", "penang"]
    assert {c.location_hint for c in kept} == {"Near 1.49° N, 103.74° E", "Near 5.41° N, 100.33° E"}


def test_a_trail_never_merges_with_a_park_of_the_same_name() -> None:
    kept = dedupe_places([_place("Kiara", kind="trail"), _place("Kiara", kind="area")])
    assert len(kept) == 2
    assert all(c.location_hint is None for c in kept)


@pytest.mark.parametrize("reverse", [False, True])
@pytest.mark.parametrize("name", ["Taman Botani Negara Shah Alam", "Example forest", "Example park"])
def test_osm_record_supersedes_demo_seed(name, reverse):
    candidates = [
        _place(name, curated=True, demo_seed=True, at=(3.1017, 101.535), key="demo"),
        _place(name, suffixed=True, at=(3.112, 101.5085), key="osm"),
    ]
    kept = dedupe_places(candidates[::-1] if reverse else candidates)
    assert [c.item for c in kept] == ["osm"]


def test_demo_without_imported_duplicate_remains_available():
    assert dedupe_places([_place("Seed only", curated=True, demo_seed=True, key="demo")])[0].item == "demo"
