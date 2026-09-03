"""Idempotent development/demo data seed.

Populates species records (merged with the PULIH classifier's 31-class
catalog), a handful of Kuala Lumpur monitored places, and a few sample
sightings so a fresh dev database isn't just empty. Run via `invatrace
seed` (see app/cli.py). Safe to run repeatedly - existing rows get
updated in place rather than duplicated, matched by id/name.
"""

from __future__ import annotations

import math
import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import MonitoredPlace, Report, Sighting, Species
from app.domain.catalogue import load_manifest, load_status_records

# Citation metadata attached to each species' guidance_metadata.sources - shown
# to the user so the "this plant is invasive" claim isn't just asserted, it's
# traceable back to GRIIS/MyBIS.
_MIKANIA_SOURCES = [
    {
        "id": "griis-malaysia-v1_3",
        "title": "GRIIS Malaysia v1.3",
        "publisher": "GBIF / IUCN SSC Invasive Species Specialist Group",
        "url": "https://cloud.gbif.org/griis/resource?r=griis-malaysia&v=1.3",
        "accessed": "2026-08-27",
    },
    {
        "id": "myias-2025",
        "title": "MyBIS Invasive Alien Species (MyIAS) 2025",
        "publisher": "Malaysia Biodiversity Information System",
        "url": "https://www.mybis.gov.my/ias/resources.php?menu=98",
        "accessed": "2026-08-27",
    },
]
_CHROMOLAENA_SOURCES = _MIKANIA_SOURCES
_EICHHORNIA_SOURCES = _MIKANIA_SOURCES

_REVIEW_DATE = datetime(2026, 8, 27, tzinfo=UTC)
_GUIDANCE_VERSION = "invatrace-plant-guidance-v1"

# Hand-written, fully fleshed-out entries for the four species we have proper
# field-guide content for (removal steps, look-alikes, etc). Everything else
# comes from the model catalog below and only gets bare-bones detail -
# _apply_model_catalog_to_species_seed() merges the two, keeping these entries
# where they already exist by id.
SPECIES = [
    {
        "id": "mikania-micrantha",
        "name": "Mikania micrantha",
        "latin_name": "Mikania micrantha",
        "common_names": ["Mile-a-minute weed", "Chinese creeper"],
        "is_invasive": True,
        "risk": "high",
        "malaysia_status": "invasive",
        "status_source": "GRIIS Malaysia v1.3",
        "status_reviewed_at": _REVIEW_DATE,
        "general_information": (
            "Fast-growing climbing vine that smothers native vegetation. Listed as invasive"
            " in Malaysia; small manual removal is safe when done with care."
        ),
        "action_eligible": True,
        "guidance_content_version": _GUIDANCE_VERSION,
        "guidance_last_reviewed": _REVIEW_DATE,
        "guidance_metadata": {
            "stop_conditions": [
                "You are on private, protected, or unfamiliar land without permission",
                "The vine has climbed above chest height or wraps mature trees",
                "Fragments would fall into flowing water",
            ],
            "spread_prevention": [
                "Bag every cut fragment before leaving the site",
                "Clean tools, gloves, and boots before moving to a new area",
                "Do not compost — even small pieces can re-root",
            ],
            "prohibited_actions": [
                "Do not burn plant material on-site",
                "Do not apply herbicide without a licensed operator",
            ],
            "sources": _MIKANIA_SOURCES,
        },
        "traits": [
            {"label": "Leaf shape", "value": "Heart-shaped, opposite, 5–13 cm"},
            {"label": "Flower", "value": "Small white heads in dense clusters"},
            {"label": "Growth", "value": "Climbing vine, up to 27 mm per day"},
            {"label": "Stem", "value": "Ridged, green to brown, hairy at nodes"},
        ],
        "native_twin": {
            "id": "dicranopteris-linearis",
            "name": "Resam fern",
            "latinName": "Dicranopteris linearis",
            "distinguishingTraits": [
                "Resam is a fern with forked fronds, not a vine",
                "No heart-shaped leaves",
                "Does not climb or smother other plants",
            ],
        },
        "removal_steps": [
            {"order": 1, "action": "Cut the vine at ground level", "safe": True},
            {"order": 2, "action": "Pull roots carefully if soil is moist", "safe": True},
            {"order": 3, "action": "Bag all cut material — fragments can re-root", "safe": True},
            {"order": 4, "action": "Check back in 2–3 weeks for regrowth", "safe": True},
        ],
        "do_not_do": [
            "Do not compost — viable fragments will re-establish",
            "Do not leave cut material on soil",
        ],
        "detail_available": True,
        "reportable": True,
        "action_guides": [
            {
                "actionMode": "remove",
                "title": "Cut, bag, and prevent re-rooting",
                "summary": "Cut at ground level, remove roots only when safe, and bag every fragment.",
                "validMonths": list(range(1, 13)),
                "steps": [
                    {"order": 1, "action": "Cut the vine at ground level", "safe": True},
                    {"order": 2, "action": "Pull roots carefully if soil is moist", "safe": True},
                    {
                        "order": 3,
                        "action": "Bag all cut material — fragments can re-root",
                        "safe": True,
                    },
                    {"order": 4, "action": "Check back in 2–3 weeks for regrowth", "safe": True},
                ],
                "doNotDo": [
                    "Do not compost or leave cut fragments on soil",
                    "Do not pull above unstable ground or steep edges",
                ],
                "ppe": ["Gloves", "Covered footwear", "Long sleeves"],
                "decontamination": ["Remove plant fragments from tools and boots before leaving"],
                "revision": "field-guide-2026-08-automated-v1",
            }
        ],
    },
    {
        "id": "chromolaena-odorata",
        "name": "Siam weed",
        "latin_name": "Chromolaena odorata",
        "common_names": ["Siam weed", "Devil weed"],
        "is_invasive": True,
        "risk": "high",
        "malaysia_status": "invasive",
        "status_source": "GRIIS Malaysia v1.3",
        "status_reviewed_at": _REVIEW_DATE,
        "general_information": (
            "Woody shrub or scrambler that spreads by wind-borne seeds. Do not disturb"
            " flowering or seed-bearing plants."
        ),
        "action_eligible": True,
        "guidance_content_version": _GUIDANCE_VERSION,
        "guidance_last_reviewed": _REVIEW_DATE,
        "guidance_metadata": {
            "stop_conditions": [
                "Flowers or seed heads are visible on the plant",
                "The site is a park or forest reserve without site-manager approval",
                "You cannot safely bag flowering parts before cutting",
            ],
            "spread_prevention": [
                "Bag flowering parts before you cut anything",
                "Brush seeds off clothing, gloves, and boots before leaving",
                "Do not drag cut plants across other vegetation",
            ],
            "prohibited_actions": [
                "Do not slash flowering or seed-bearing plants",
                "Do not burn on-site without a permit",
            ],
            "sources": _CHROMOLAENA_SOURCES,
        },
        "traits": [
            {"label": "Leaf shape", "value": "Opposite, ovate, 5–12 cm with serrated edges"},
            {"label": "Flower", "value": "Pale purple to white, in terminal clusters"},
            {"label": "Growth", "value": "Woody shrub or scrambler, 2–5 m"},
            {"label": "Stem", "value": "Soft-wooded, hairy, strong odour when crushed"},
        ],
        "native_twin": None,
        "removal_steps": [
            {"order": 1, "action": "Cut stems close to ground before flowering", "safe": True},
            {"order": 2, "action": "Remove root crown to prevent re-sprouting", "safe": True},
            {"order": 3, "action": "Bag and dispose of all flowering parts", "safe": True},
        ],
        "do_not_do": [
            "Do not slash during seed season — seeds spread by wind",
            "Do not burn on-site without permit",
        ],
        "detail_available": True,
        "reportable": False,
        "action_guides": [
            {
                "actionMode": "contain",
                "title": "Contain only when no seed can spread",
                "summary": "Do not slash flowering or seed-bearing plants. Bag flowering material and remove the root crown only when conditions are safe.",
                "validMonths": list(range(1, 13)),
                "steps": [
                    {
                        "order": 1,
                        "action": "Check carefully for flowers or seed heads",
                        "safe": True,
                    },
                    {"order": 2, "action": "Bag flowering parts before cutting", "safe": True},
                    {
                        "order": 3,
                        "action": "Remove the root crown to prevent re-sprouting",
                        "safe": True,
                    },
                ],
                "doNotDo": [
                    "Do not slash flowering or seed-bearing plants",
                    "Do not burn on-site without a permit",
                ],
                "ppe": ["Gloves", "Covered footwear", "Long sleeves"],
                "decontamination": [
                    "Clean seeds and plant fragments from tools, clothing, and boots"
                ],
                "revision": "field-guide-2026-08-automated-v1",
            }
        ],
    },
    {
        "id": "eichhornia-crassipes",
        "name": "Water hyacinth",
        "latin_name": "Eichhornia crassipes",
        "common_names": [],
        "is_invasive": True,
        "risk": "high",
        "malaysia_status": "invasive",
        "status_source": "GRIIS Malaysia v1.3",
        "status_reviewed_at": _REVIEW_DATE,
        "general_information": (
            "Free-floating aquatic plant that forms dense mats. Do not enter water"
            " to remove; report the sighting instead."
        ),
        "action_eligible": False,
        "guidance_content_version": _GUIDANCE_VERSION,
        "guidance_last_reviewed": _REVIEW_DATE,
        "guidance_metadata": {
            "stop_conditions": [
                "The plant is in flowing or standing water",
                "You would need to wade or use a boat to reach it",
            ],
            "spread_prevention": [
                "Do not disturb the mat — fragments float and re-establish downstream",
                "Report the location for coordinated removal by trained crews",
            ],
            "prohibited_actions": [
                "Do not enter water to remove the plant",
                "Do not drag mats onto banks where they may re-root",
            ],
            "sources": _EICHHORNIA_SOURCES,
        },
        "traits": [],
        "native_twin": None,
        "removal_steps": [],
        "do_not_do": [],
        "detail_available": False,
        "reportable": False,
        "action_guides": [],
    },
    {
        "id": "dicranopteris-linearis",
        "name": "Resam fern",
        "latin_name": "Dicranopteris linearis",
        "common_names": [],
        "is_invasive": False,
        "risk": None,
        "traits": [],
        "native_twin": None,
        "removal_steps": [],
        "do_not_do": [],
        "detail_available": False,
        "reportable": False,
        "action_guides": [],
    },
]


_GENERIC_SOURCES = [
    {
        "id": "griis-malaysia-v1_3",
        "title": "GRIIS Malaysia v1.3",
        "publisher": "GBIF / IUCN SSC Invasive Species Specialist Group",
        "url": "https://cloud.gbif.org/griis/resource?r=griis-malaysia&v=1.3",
        "accessed": "2026-08-27",
    },
    {
        "id": "myias-2025",
        "title": "MyBIS Invasive Alien Species (MyIAS) 2025",
        "publisher": "Malaysia Biodiversity Information System",
        "url": "https://www.mybis.gov.my/ias/resources.php?menu=98",
        "accessed": "2026-08-27",
    },
]

_GENERIC_INVASIVE_GUIDANCE = {
    "stop_conditions": [
        "You do not have permission to work on this land",
        "The plant has climbed above chest height or wraps mature trees",
        "You are near flowing or standing water",
    ],
    "spread_prevention": [
        "Do not disturb the plant; report the sighting first",
        "Clean tools, gloves, and boots before moving to a new area",
        "Do not compost — many invasive species re-establish from fragments",
    ],
    "prohibited_actions": [
        "Do not burn plant material on-site",
        "Do not apply herbicide without a licensed operator",
    ],
    "sources": _GENERIC_SOURCES,
}


def _apply_shared_catalogue_to_species_seed() -> None:
    """Rebuilds SPECIES from the shared/catalogue/plant-status.json records
    (the single source of truth for Malaysian status). Hand-written detail
    above is layered in wherever it exists by ``id``, and generic invasive
    guidance is added for reportable species without curated content."""
    records = load_status_records()
    manifest = load_manifest()
    detailed_by_id = {item["id"]: item for item in SPECIES}
    model_species: list[dict[str, object]] = []

    for record in records:
        species_id = record.species_id
        invasive = record.is_invasive
        # Convert to timezone-aware datetime for the Species.status_reviewed_at
        # column (existing rows are all UTC-anchored).
        reviewed_at = datetime(
            record.status_reviewed_at.year,
            record.status_reviewed_at.month,
            record.status_reviewed_at.day,
            tzinfo=UTC,
        )
        detail = detailed_by_id.get(species_id, {
            "common_names": [],
            "traits": [],
            "native_twin": None,
            "removal_steps": [],
            "do_not_do": [],
            "detail_available": False,
            "action_guides": [],
        })
        catalog_source = record.status_source_ids[0] if record.status_source_ids else None
        # AC Iteration 1 — status columns always come from the catalogue,
        # never from hand-written seed detail, so a catalogue change flows
        # through to a re-seed without editing the seed file.
        detail["malaysia_status"] = record.ui_state
        detail["status_source"] = catalog_source
        detail["status_reviewed_at"] = reviewed_at
        detail.setdefault("action_eligible", False)
        detail.setdefault("guidance_metadata", {})
        # AC 1.2.2 — every invasive result must carry a general_information
        # paragraph so the invasive-result pathway shows a short description
        # plus its source. Catalogue text is the fallback when hand-written
        # detail is missing.
        if not detail.get("general_information"):
            detail["general_information"] = record.general_information
        if invasive and not detail.get("guidance_metadata"):
            detail["guidance_metadata"] = dict(_GENERIC_INVASIVE_GUIDANCE)
        elif invasive:
            merged = dict(_GENERIC_INVASIVE_GUIDANCE)
            merged.update(detail.get("guidance_metadata") or {})
            detail["guidance_metadata"] = merged
        detail.update({
            "id": species_id,
            "name": record.common_name or record.scientific_name,
            "latin_name": record.scientific_name,
            "is_invasive": invasive,
            "risk": "high" if invasive else None,
            "reportable": record.report_eligible,
        })
        model_species.append(detail)

    if len(model_species) != len(records):
        # If this ever fires the shared catalogue and this loop drifted apart —
        # better to fail loudly here than silently seed a mismatched list.
        raise ValueError(
            "Development species seed does not match the shared plant-status catalogue "
            f"({len(records)} catalogue records, {len(model_species)} seeded)."
        )
    # Recorded so callers can log which catalogue version the last seed used.
    global _LAST_SEED_CATALOGUE_VERSION
    _LAST_SEED_CATALOGUE_VERSION = manifest.catalogue_version
    SPECIES[:] = model_species


_LAST_SEED_CATALOGUE_VERSION: str | None = None


def last_seed_catalogue_version() -> str | None:
    return _LAST_SEED_CATALOGUE_VERSION


_apply_shared_catalogue_to_species_seed()

# Real coordinates around KL parks/reserves, used as the "home base" for the
# sample sightings below and as MonitoredPlace rows in their own right.
PLACES = [
    ("Bukit Kiara · West Trail", 3.1497, 101.6412),
    ("Bukit Kiara · Look-out", 3.1523, 101.6440),
    ("Bukit Kiara · Picnic Area", 3.1489, 101.6398),
    ("Bukit Kiara · Ridge Path", 3.1516, 101.6371),
    ("Taman Tugu · Pond edge", 3.1502, 101.6688),
    ("Bukit Nanas · Reserve entrance", 3.1521, 101.7020),
    ("FRIM Kepong · Canopy walk", 3.2340, 101.6293),
    ("KLCC Park · East pond", 3.1570, 101.7145),
    ("Kota Damansara Community Forest", 3.1691, 101.5900),
    ("Bukit Gasing · North gate", 3.1044, 101.6538),
]

# (species, status, risk, radius-from-centre-in-degrees, angle-in-radians) -
# radius/angle just scatter the sample sightings around the Bukit Kiara centre
# point in seed_development_data() rather than stacking them on top of each other.
SIGHTING_SEED = [
    ("mikania-micrantha", "screened", "high", 0.0032, 0.2),
    ("mikania-micrantha", "screened", "high", 0.0025, 1.1),
    ("mikania-micrantha", "screened", "high", 0.0041, 2.4),
    ("chromolaena-odorata", "screened", "high", 0.0018, 3.6),
    ("chromolaena-odorata", "screened", "high", 0.0037, 4.7),
    ("eichhornia-crassipes", "screened", "high", 0.0028, 5.9),
    ("eichhornia-crassipes", "screened", "high", 0.0045, 0.9),
    ("lantana-camara", "screened", "high", 0.0022, 2.0),
    ("lantana-camara", "screened", "high", 0.0033, 3.1),
    ("mikania-micrantha", "removed", "high", 0.0016, 4.2),
]

LEGACY_SEED_SPECIES_IDS = {"clidemia-hirta"}


def load_reference_data(session: Session) -> None:
    """AC Phase 5 — production-safe reference data loader.

    Upserts the 31-class species catalogue (Malaysian status, guidance
    metadata, review dates) and hand-seeded MonitoredPlace anchors used by
    the place-association fallback. Idempotent: existing rows are updated
    in place rather than duplicated. Safe to run repeatedly in production
    pre-deploy; contains no demo reports/sightings.
    """
    for values in SPECIES:
        existing = session.get(Species, values["id"])
        if existing:
            for key, value in values.items():
                setattr(existing, key, value)
        else:
            session.add(Species(**values))
    session.flush()
    for name, latitude, longitude in PLACES:
        if not session.scalar(select(MonitoredPlace.id).where(MonitoredPlace.name == name)):
            session.add(
                MonitoredPlace(
                    name=name,
                    latitude=Decimal(str(latitude)),
                    longitude=Decimal(str(longitude)),
                )
            )
    session.flush()
    # Retire species ids that used to be in the catalogue. Only drop them if
    # no user data references them, so a production catalogue refresh never
    # deletes anything a real report or sighting depends on.
    for species_id in LEGACY_SEED_SPECIES_IDS:
        species = session.get(Species, species_id)
        has_sighting = session.scalar(
            select(Sighting.id).where(Sighting.species_id == species_id).limit(1)
        )
        has_report = session.scalar(
            select(Report.id).where(Report.species_id == species_id).limit(1)
        )
        if species and not has_sighting and not has_report:
            session.delete(species)
    session.commit()


def seed_demo_data(session: Session) -> None:
    """AC Phase 5 — development-only demo data.

    Inserts example sightings around Bukit Kiara so a fresh dev database
    has content on the map. Must never run in production; the CLI enforces
    that with an ``app_env == "production"`` refusal. Depends on
    ``load_reference_data`` having populated the species catalogue first.
    """
    centre_lat, centre_lng = 3.1497, 101.6412
    actions = {
        "screened": "Rule-screened report. Follow the reviewed guidance for this species.",
        "removed": "Removal recorded. Recheck for regrowth in 2–3 weeks.",
    }
    for index, (species_id, status, risk, radius, angle) in enumerate(SIGHTING_SEED):
        sighting_id = uuid.uuid5(uuid.NAMESPACE_URL, f"invatrace-seed-sighting-{index + 1}")
        values = {
            "species_id": species_id,
            "status": status,
            "risk": risk,
            "latitude": Decimal(str(round(centre_lat + math.sin(angle) * radius, 5))),
            "longitude": Decimal(str(round(centre_lng + math.cos(angle) * radius, 5))),
            "reporter_trust": "Trusted",
            "recommended_action": actions[status],
            "place_label": PLACES[index][0],
        }
        existing = session.get(Sighting, sighting_id)
        if existing:
            for key, value in values.items():
                setattr(existing, key, value)
        else:
            session.add(Sighting(
                id=sighting_id,
                created_at=datetime.now(UTC) - timedelta(hours=index + 1),
                **values,
            ))
    session.commit()


def seed_development_data(session: Session) -> None:
    """Back-compat convenience wrapper: reference data then demo data.

    Existing callers (tests, `invatrace seed`) keep working. Production
    deploys should call ``load_reference_data`` directly instead — the CLI
    refuses ``seed`` and ``seed-demo-data`` in production for that reason.
    """
    load_reference_data(session)
    seed_demo_data(session)
