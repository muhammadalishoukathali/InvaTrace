"""Build and use a conservative directed OSM waterway graph for AC 5.1.4."""

from __future__ import annotations

import heapq
import json
import math
import uuid
from collections import Counter, defaultdict
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import osmium
from geoalchemy2 import Geometry, WKTElement
from shapely import GEOSException
from shapely.geometry import LineString, shape
from shapely.prepared import PreparedGeometry, prep
from sqlalchemy import cast, delete, func, insert, select, update
from sqlalchemy.orm import Session

from app.api.routers.location import _classify_area
from app.data_release import DataRelease, validate_data_release
from app.db.models import (
    MonitoredArea,
    OccurrenceRecord,
    PlaceOccurrenceWaterwayEvidence,
    Trail,
    WaterwayDataset,
    WaterwayEdge,
)
from app.domain.catalogue import load_approved_species
from app.geojson_validation import CountrySpatialIndex, country_polygons
from app.waterway_import import OSM_DIRECTION_SOURCE, import_waterway_evidence_json

SUPPORTED_WATERWAYS = frozenset({"river", "stream", "canal", "drain"})
MAX_SNAP_DISTANCE_M = 50.0
MAX_COMBINED_OCCURRENCE_UNCERTAINTY_M = 250.0
MAX_UPSTREAM_DISTANCE_M = 5000.0
EARTH_RADIUS_M = 6_371_008.8


@dataclass(frozen=True)
class WaterwayRun:
    osm_way_id: int
    waterway_type: str
    nodes: tuple[tuple[int, float, float], ...]


@dataclass(frozen=True)
class DirectedEdge:
    osm_way_id: int
    sequence: int
    start_node_id: int
    end_node_id: int
    waterway_type: str
    coordinates: tuple[tuple[float, float], ...]
    length_m: float

    @property
    def key(self) -> tuple[int, int]:
        return self.osm_way_id, self.sequence


@dataclass(frozen=True)
class GraphQa:
    candidate_ways: int
    waterway_ways_loaded: int
    directed_edges: int
    graph_nodes: int
    connected_components: int
    dangling_edges: int
    invalid_geometries: int
    duplicate_ways: int
    total_network_length_m: float
    malaysia_outside_ways: int
    exclusions: dict[str, int]


@dataclass(frozen=True)
class WaterwayPreprocessResult:
    dataset_id: str
    data_version: str
    graph_qa: GraphQa
    evidence_accepted: int
    evidence_excluded: int
    evidence_path: Path
    already_present: bool


def direction_exclusion(tags: Any) -> str | None:
    """Return a fail-closed exclusion reason for ambiguous flow direction."""
    if str(tags.get("tidal") or "").strip().lower() in {"yes", "true", "1"}:
        return "tidal_flow"
    if str(tags.get("reversible") or "").strip().lower() in {"yes", "true", "1"}:
        return "reversible_flow"
    flow_direction = str(tags.get("flow_direction") or "").strip().lower()
    if flow_direction and flow_direction not in {"forward", "with_way"}:
        return "non_forward_or_uncertain_flow_direction"
    direction = str(tags.get("direction") or "").strip().lower()
    if direction in {"both", "backward", "reverse", "reversible"}:
        return "non_forward_or_uncertain_direction"
    return None


class _WaterwayHandler(osmium.SimpleHandler):
    def __init__(
        self, country_index: CountrySpatialIndex, country_geometry: PreparedGeometry
    ) -> None:
        super().__init__()
        self.country_index = country_index
        self.country_geometry = country_geometry
        self.runs: list[WaterwayRun] = []
        self.reasons: Counter[str] = Counter()
        self.candidate_ways = 0
        self.loaded_way_ids: set[int] = set()
        self.seen_way_ids: set[int] = set()

    def way(self, way) -> None:
        waterway_type = way.tags.get("waterway")
        if waterway_type not in SUPPORTED_WATERWAYS:
            return
        self.candidate_ways += 1
        if way.id in self.seen_way_ids:
            self.reasons["duplicate_way"] += 1
            return
        self.seen_way_ids.add(way.id)
        exclusion = direction_exclusion(way.tags)
        if exclusion:
            self.reasons[exclusion] += 1
            return
        if len(way.nodes) < 2:
            self.reasons["fewer_than_two_nodes"] += 1
            return
        retained_runs: list[list[tuple[int, float, float]]] = []
        current: list[tuple[int, float, float]] = []
        invalid = False
        for node in way.nodes:
            try:
                longitude = float(node.lon)
                latitude = float(node.lat)
            except osmium.InvalidLocationError:
                invalid = True
                current = []
                break
            if self.country_index.contains(longitude, latitude):
                current.append((int(node.ref), longitude, latitude))
            else:
                if len(current) >= 2:
                    retained_runs.append(current)
                current = []
        if invalid:
            self.reasons["invalid_or_incomplete_geometry"] += 1
            return
        if len(current) >= 2:
            retained_runs.append(current)
        if not retained_runs:
            self.reasons["outside_malaysia"] += 1
            return
        covered_runs = []
        for run in retained_runs:
            try:
                covered = self.country_geometry.covers(
                    LineString((longitude, latitude) for _node, longitude, latitude in run)
                )
            except GEOSException:
                covered = False
            if covered:
                covered_runs.append(run)
            else:
                self.reasons["outside_or_cross_border_segment"] += 1
        if not covered_runs:
            return
        self.loaded_way_ids.add(int(way.id))
        self.runs.extend(
            WaterwayRun(int(way.id), waterway_type, tuple(run)) for run in covered_runs
        )


def _distance_m(left: tuple[float, float], right: tuple[float, float]) -> float:
    lon1, lat1 = map(math.radians, left)
    lon2, lat2 = map(math.radians, right)
    dlon = lon2 - lon1
    dlat = lat2 - lat1
    value = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(min(1.0, math.sqrt(value)))


class _UnionFind:
    def __init__(self) -> None:
        self.parent: dict[int, int] = {}

    def find(self, value: int) -> int:
        self.parent.setdefault(value, value)
        root = value
        while self.parent[root] != root:
            root = self.parent[root]
        while self.parent[value] != value:
            parent = self.parent[value]
            self.parent[value] = root
            value = parent
        return root

    def union(self, left: int, right: int) -> None:
        left_root, right_root = self.find(left), self.find(right)
        if left_root != right_root:
            self.parent[right_root] = left_root


def build_topology(runs: Iterable[WaterwayRun]) -> tuple[list[DirectedEdge], GraphQa]:
    runs = list(runs)
    node_use: Counter[int] = Counter()
    for run in runs:
        node_use.update(node_id for node_id, _lon, _lat in run.nodes)
    edges: list[DirectedEdge] = []
    invalid_geometries = 0
    next_sequence: Counter[int] = Counter()
    for run in runs:
        start = 0
        for index in range(1, len(run.nodes)):
            node_id = run.nodes[index][0]
            is_topology_node = index == len(run.nodes) - 1 or node_use[node_id] > 1
            if not is_topology_node:
                continue
            section = run.nodes[start : index + 1]
            coordinates = tuple((longitude, latitude) for _node, longitude, latitude in section)
            length_m = sum(
                _distance_m(coordinates[position], coordinates[position + 1])
                for position in range(len(coordinates) - 1)
            )
            if length_m <= 0:
                invalid_geometries += 1
            else:
                edges.append(
                    DirectedEdge(
                        osm_way_id=run.osm_way_id,
                        sequence=next_sequence[run.osm_way_id],
                        start_node_id=section[0][0],
                        end_node_id=section[-1][0],
                        waterway_type=run.waterway_type,
                        coordinates=coordinates,
                        length_m=length_m,
                    )
                )
                next_sequence[run.osm_way_id] += 1
            start = index
    indegree: Counter[int] = Counter()
    outdegree: Counter[int] = Counter()
    union_find = _UnionFind()
    for edge in edges:
        outdegree[edge.start_node_id] += 1
        indegree[edge.end_node_id] += 1
        union_find.union(edge.start_node_id, edge.end_node_id)
    nodes = set(indegree) | set(outdegree)
    components = len({union_find.find(node) for node in nodes})
    dangling = sum(
        indegree[edge.start_node_id] == 0 or outdegree[edge.end_node_id] == 0 for edge in edges
    )
    qa = GraphQa(
        candidate_ways=0,
        waterway_ways_loaded=len({edge.osm_way_id for edge in edges}),
        directed_edges=len(edges),
        graph_nodes=len(nodes),
        connected_components=components,
        dangling_edges=dangling,
        invalid_geometries=invalid_geometries,
        duplicate_ways=0,
        total_network_length_m=sum(edge.length_m for edge in edges),
        malaysia_outside_ways=0,
        exclusions={},
    )
    return edges, qa


def _line_wkt(coordinates: tuple[tuple[float, float], ...]) -> str:
    return "LINESTRING(" + ",".join(f"{lon:.7f} {lat:.7f}" for lon, lat in coordinates) + ")"


def _insert_edges(session: Session, dataset_id: uuid.UUID, edges: list[DirectedEdge]) -> None:
    table = WaterwayEdge.__table__
    for offset in range(0, len(edges), 2_000):
        rows = [
            {
                "dataset_id": dataset_id,
                "osm_way_id": edge.osm_way_id,
                "sequence": edge.sequence,
                "start_osm_node_id": edge.start_node_id,
                "end_osm_node_id": edge.end_node_id,
                "waterway_type": edge.waterway_type,
                "geometry": WKTElement(_line_wkt(edge.coordinates), srid=4326),
                "length_m": round(edge.length_m, 2),
                "direction": "osm_way_order",
            }
            for edge in edges[offset : offset + 2_000]
        ]
        session.execute(insert(table), rows)
        session.flush()


def _nearest_edge(
    session: Session, dataset_id: uuid.UUID, geography
) -> tuple[WaterwayEdge, float, float] | None:
    # Keep the spatial predicate as an explicit optimization barrier. Immediately
    # after a new release is bulk-inserted PostgreSQL has no fresh per-dataset
    # statistics, and otherwise it can choose a BitmapAnd with the dataset index.
    # That plan scans every edge in the new release once for every place. The
    # materialized candidate set is still exact ST_DWithin geography semantics,
    # but makes the GiST search happen first and applies the release ID only to
    # the small set of nearby edges.
    spatial_candidates = (
        select(WaterwayEdge.id)
        .where(func.ST_DWithin(WaterwayEdge.geometry, geography, MAX_SNAP_DISTANCE_M))
        .cte("spatial_waterway_candidates")
        .prefix_with("MATERIALIZED")
    )
    edge_geometry = cast(WaterwayEdge.geometry, Geometry("LINESTRING", srid=4326))
    target_geometry = cast(geography, Geometry(srid=4326))
    closest = func.ST_ClosestPoint(edge_geometry, target_geometry)
    fraction = func.ST_LineLocatePoint(edge_geometry, closest)
    distance = func.ST_Distance(WaterwayEdge.geometry, geography)
    row = session.execute(
        select(WaterwayEdge, distance, fraction)
        .join(spatial_candidates, spatial_candidates.c.id == WaterwayEdge.id)
        .where(
            WaterwayEdge.dataset_id == dataset_id,
        )
        .order_by(distance, WaterwayEdge.osm_way_id, WaterwayEdge.sequence)
        .limit(1)
    ).first()
    if row is None:
        return None
    return row[0], float(row[1]), float(row[2])


def _downstream_distances(
    occurrence_edge: DirectedEdge,
    occurrence_fraction: float,
    adjacency: dict[int, list[DirectedEdge]],
) -> dict[int, float]:
    initial = max(0.0, (1.0 - occurrence_fraction) * occurrence_edge.length_m)
    distances = {occurrence_edge.end_node_id: initial}
    queue = [(initial, occurrence_edge.end_node_id)]
    while queue:
        distance, node = heapq.heappop(queue)
        if distance != distances.get(node) or distance > MAX_UPSTREAM_DISTANCE_M:
            continue
        for edge in adjacency.get(node, []):
            candidate = distance + edge.length_m
            if candidate <= MAX_UPSTREAM_DISTANCE_M and candidate < distances.get(
                edge.end_node_id, math.inf
            ):
                distances[edge.end_node_id] = candidate
                heapq.heappush(queue, (candidate, edge.end_node_id))
    return distances


def _network_distance(
    occurrence_edge: DirectedEdge,
    occurrence_fraction: float,
    place_edge: DirectedEdge,
    place_fraction: float,
    downstream: dict[int, float],
) -> float | None:
    candidates: list[float] = []
    if occurrence_edge.key == place_edge.key and occurrence_fraction <= place_fraction:
        candidates.append((place_fraction - occurrence_fraction) * occurrence_edge.length_m)
    to_target_start = downstream.get(place_edge.start_node_id)
    if to_target_start is not None:
        candidates.append(to_target_start + place_fraction * place_edge.length_m)
    if not candidates:
        return None
    distance = min(candidates)
    return distance if distance <= MAX_UPSTREAM_DISTANCE_M else None


def _build_evidence(
    session: Session,
    *,
    dataset_id: uuid.UUID,
    edges: list[DirectedEdge],
    source_release: DataRelease,
) -> tuple[list[dict[str, Any]], dict[str, int]]:
    edge_by_key = {edge.key: edge for edge in edges}
    adjacency: dict[int, list[DirectedEdge]] = defaultdict(list)
    union_find = _UnionFind()
    for edge in edges:
        adjacency[edge.start_node_id].append(edge)
        union_find.union(edge.start_node_id, edge.end_node_id)
    for outgoing in adjacency.values():
        outgoing.sort(key=lambda edge: edge.key)
    component_minimum: dict[int, int] = {}
    for node in union_find.parent:
        root = union_find.find(node)
        component_minimum[root] = min(node, component_minimum.get(root, node))
    component_id = {node: component_minimum[union_find.find(node)] for node in union_find.parent}

    water_species = {
        record.species_id for record in load_approved_species() if record.water_dispersed
    }
    occurrences = session.scalars(
        select(OccurrenceRecord)
        .where(OccurrenceRecord.species_id.in_(water_species))
        .order_by(OccurrenceRecord.source, OccurrenceRecord.source_occurrence_id)
    ).all()
    places: list[tuple[str, uuid.UUID, Any]] = []
    for place in session.scalars(select(MonitoredArea).order_by(MonitoredArea.id)).all():
        places.append(
            (_classify_area(place.name, place.metadata_json or {}), place.id, place.geometry)
        )
    for trail in session.scalars(select(Trail).order_by(Trail.id)).all():
        places.append(("trail", trail.id, trail.geometry))

    reasons: Counter[str] = Counter()
    place_snaps: list[tuple[str, uuid.UUID, DirectedEdge, float, float]] = []
    for place_type, place_id, geometry in places:
        snap = _nearest_edge(session, dataset_id, geometry)
        if snap is None:
            reasons["place_snap_outside_tolerance"] += 1
            continue
        row, snap_distance, fraction = snap
        edge = edge_by_key.get((row.osm_way_id, row.sequence))
        if edge is None:
            reasons["place_edge_missing_from_graph"] += 1
            continue
        place_snaps.append((place_type, place_id, edge, snap_distance, fraction))

    records: list[dict[str, Any]] = []
    for occurrence in occurrences:
        snap = _nearest_edge(session, dataset_id, occurrence.location)
        if snap is None:
            reasons["occurrence_snap_outside_tolerance"] += 1
            continue
        row, occurrence_snap_distance, occurrence_fraction = snap
        if (
            occurrence_snap_distance + occurrence.coordinate_uncertainty_m
            > MAX_COMBINED_OCCURRENCE_UNCERTAINTY_M
        ):
            reasons["occurrence_snap_plus_uncertainty_exceeds_250m"] += 1
            continue
        occurrence_edge = edge_by_key.get((row.osm_way_id, row.sequence))
        if occurrence_edge is None:
            reasons["occurrence_edge_missing_from_graph"] += 1
            continue
        downstream = _downstream_distances(occurrence_edge, occurrence_fraction, adjacency)
        for place_type, place_id, place_edge, place_snap_distance, place_fraction in place_snaps:
            network_distance = _network_distance(
                occurrence_edge,
                occurrence_fraction,
                place_edge,
                place_fraction,
                downstream,
            )
            if network_distance is None:
                reasons["no_directed_path_within_5km"] += 1
                continue
            records.append(
                {
                    "occurrenceSource": occurrence.source,
                    "sourceOccurrenceId": occurrence.source_occurrence_id,
                    "placeId": str(place_id),
                    "placeType": place_type,
                    "waterwayNetworkId": (
                        f"osm:{source_release.sha256[:12]}:"
                        f"component:{component_id[occurrence_edge.start_node_id]}"
                    ),
                    "upstreamDistanceM": round(network_distance, 2),
                    "occurrenceSnapDistanceM": round(occurrence_snap_distance, 2),
                    "placeSnapDistanceM": round(place_snap_distance, 2),
                    "occurrenceOsmWayId": occurrence_edge.osm_way_id,
                    "placeOsmWayId": place_edge.osm_way_id,
                    "directionSource": OSM_DIRECTION_SOURCE,
                }
            )
    records.sort(
        key=lambda record: (
            record["placeType"],
            record["placeId"],
            record["occurrenceSource"],
            record["sourceOccurrenceId"],
        )
    )
    return records, dict(sorted(reasons.items()))


def preprocess_osm_waterways(
    session: Session,
    *,
    source_path: Path,
    release_manifest_path: Path,
    country_boundary_path: Path,
    country_boundary_manifest_path: Path,
    evidence_output_path: Path,
) -> WaterwayPreprocessResult:
    source_release = validate_data_release(
        release_manifest_path, source_path, expected_dataset_id="osm-malaysia-places"
    )
    boundary_release = validate_data_release(
        country_boundary_manifest_path,
        country_boundary_path,
        expected_dataset_id="malaysia-national-boundary",
    )
    if source_release.metadata.get("country_boundary_sha256") != boundary_release.sha256:
        raise ValueError("OSM and country-boundary releases are not cryptographically linked")
    source_timestamp_value = source_release.metadata.get("source_timestamp")
    if not isinstance(source_timestamp_value, str):
        raise ValueError("OSM release metadata must include source_timestamp")
    source_timestamp = datetime.fromisoformat(source_timestamp_value.replace("Z", "+00:00"))
    data_version = f"osm-waterways-{source_timestamp.date()}-{source_release.sha256[:12]}"
    existing = session.scalar(
        select(WaterwayDataset).where(
            WaterwayDataset.source == source_release.source,
            WaterwayDataset.version == data_version,
        )
    )
    already_present = existing is not None
    boundary_payload = json.loads(country_boundary_path.read_text(encoding="utf-8"))
    boundary_features = boundary_payload.get("features")
    if not isinstance(boundary_features, list) or len(boundary_features) != 1:
        raise ValueError("country boundary release must contain exactly one feature")
    boundary_feature = boundary_features[0]
    if not isinstance(boundary_feature, dict) or not isinstance(
        boundary_feature.get("geometry"), dict
    ):
        raise ValueError("country boundary feature must contain a geometry")
    handler = _WaterwayHandler(
        CountrySpatialIndex(country_polygons(boundary_payload)),
        prep(shape(boundary_feature["geometry"])),
    )
    handler.apply_file(str(source_path), locations=True, idx="flex_mem")
    edges, topology_qa = build_topology(handler.runs)
    qa = GraphQa(
        candidate_ways=handler.candidate_ways,
        waterway_ways_loaded=len(handler.loaded_way_ids),
        directed_edges=topology_qa.directed_edges,
        graph_nodes=topology_qa.graph_nodes,
        connected_components=topology_qa.connected_components,
        dangling_edges=topology_qa.dangling_edges,
        invalid_geometries=topology_qa.invalid_geometries
        + handler.reasons.get("invalid_or_incomplete_geometry", 0),
        duplicate_ways=handler.reasons.get("duplicate_way", 0),
        total_network_length_m=topology_qa.total_network_length_m,
        malaysia_outside_ways=handler.reasons.get("outside_malaysia", 0),
        exclusions=dict(sorted(handler.reasons.items())),
    )
    session.execute(update(WaterwayDataset).values(active=False))
    if existing is None:
        dataset = WaterwayDataset(
            source=source_release.source,
            version=data_version,
            source_timestamp=source_timestamp.astimezone(UTC),
            sha256=bytes.fromhex(source_release.sha256),
            metadata_json={},
            active=True,
        )
        session.add(dataset)
        session.flush()
        _insert_edges(session, dataset.id, edges)
    else:
        dataset = existing
        if dataset.sha256 != bytes.fromhex(source_release.sha256):
            raise ValueError("existing waterway version has different source bytes")
        dataset.active = True
        session.execute(delete(WaterwayEdge).where(WaterwayEdge.dataset_id == dataset.id))
        _insert_edges(session, dataset.id, edges)
    dataset.metadata_json = {
        "source_url": source_release.source_url,
        "source_timestamp": source_timestamp_value,
        "source_sha256": source_release.sha256,
        "source_byte_length": source_release.byte_length,
        "licence": source_release.licence,
        "licence_url": source_release.licence_url,
        "country_boundary_sha256": boundary_release.sha256,
        "included_waterways": sorted(SUPPORTED_WATERWAYS),
        "direction_policy": "OSM way order; ambiguous, tidal and reversible flow excluded",
        "snap_tolerance_m": MAX_SNAP_DISTANCE_M,
        "occurrence_snap_plus_uncertainty_limit_m": MAX_COMBINED_OCCURRENCE_UNCERTAINTY_M,
        "graph_qa": qa.__dict__,
    }
    records, evidence_exclusions = _build_evidence(
        session, dataset_id=dataset.id, edges=edges, source_release=source_release
    )
    evidence_payload = {
        "schemaVersion": "invatrace.osm-waterway-evidence.v1",
        "dataVersion": data_version,
        "source": source_release.source,
        "sourceUrl": source_release.source_url,
        "sourceTimestamp": source_timestamp_value,
        "sourceSha256": source_release.sha256,
        "licence": source_release.licence,
        "licenceUrl": source_release.licence_url,
        "countryBoundarySha256": boundary_release.sha256,
        "includedWaterways": sorted(SUPPORTED_WATERWAYS),
        "directionPolicy": "OSM way order; ambiguous, tidal and reversible flow excluded",
        "graphQa": qa.__dict__,
        "snapPolicy": {
            "maxSnapDistanceM": MAX_SNAP_DISTANCE_M,
            "maxOccurrenceSnapPlusUncertaintyM": MAX_COMBINED_OCCURRENCE_UNCERTAINTY_M,
        },
        "evidenceExclusions": evidence_exclusions,
        "records": records,
    }
    evidence_output_path.parent.mkdir(parents=True, exist_ok=True)
    evidence_output_path.write_text(
        json.dumps(evidence_payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        + "\n",
        encoding="utf-8",
        newline="\n",
    )
    session.execute(
        delete(PlaceOccurrenceWaterwayEvidence).where(
            PlaceOccurrenceWaterwayEvidence.data_version == data_version
        )
    )
    imported = import_waterway_evidence_json(
        session, source_path=evidence_output_path, data_version=data_version
    )
    return WaterwayPreprocessResult(
        dataset_id=str(dataset.id),
        data_version=data_version,
        graph_qa=qa,
        evidence_accepted=imported.accepted,
        evidence_excluded=imported.excluded,
        evidence_path=evidence_output_path,
        already_present=already_present,
    )
