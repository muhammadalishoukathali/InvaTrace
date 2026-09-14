"""Fail-closed structural validation for polygon GeoJSON inputs."""

from __future__ import annotations

import hashlib
import json
import math
from collections import defaultdict
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class PolygonValidationSummary:
    geometry_count: int
    polygon_count: int
    ring_count: int
    coordinate_count: int
    bounds: tuple[float, float, float, float]


@dataclass(frozen=True)
class CountryPolygon:
    rings: list[list[list[float]]]
    bounds: tuple[float, float, float, float]


class CountrySpatialIndex:
    """Small grid index for repeated exact point-in-country checks.

    The reviewed Malaysia boundary has thousands of island polygons. Walking
    every ring for every OSM node is prohibitively expensive; this index first
    limits each point to polygons whose bounding boxes overlap its grid cell,
    then applies the same boundary-inclusive ring test used by point_in_country.
    """

    def __init__(self, polygons: list[CountryPolygon], *, cell_size: float = 0.25) -> None:
        if not polygons or cell_size <= 0:
            raise ValueError("country polygons and a positive cell size are required")
        self.polygons = polygons
        self.cell_size = cell_size
        self.latitude_cell_size = 0.02
        cells: dict[tuple[int, int], list[int]] = defaultdict(list)
        ring_edges: dict[tuple[int, int], dict[int, list[tuple[list[float], list[float]]]]] = {}
        for index, polygon in enumerate(polygons):
            west, south, east, north = polygon.bounds
            for x in range(math.floor(west / cell_size), math.floor(east / cell_size) + 1):
                for y in range(
                    math.floor(south / cell_size), math.floor(north / cell_size) + 1
                ):
                    cells[(x, y)].append(index)
            for ring_index, ring in enumerate(polygon.rings):
                latitude_cells: dict[int, list[tuple[list[float], list[float]]]] = defaultdict(list)
                for position_index, left in enumerate(ring):
                    right = ring[(position_index + 1) % len(ring)]
                    south_edge = min(left[1], right[1])
                    north_edge = max(left[1], right[1])
                    for y in range(
                        math.floor(south_edge / self.latitude_cell_size),
                        math.floor(north_edge / self.latitude_cell_size) + 1,
                    ):
                        latitude_cells[y].append((left, right))
                ring_edges[(index, ring_index)] = dict(latitude_cells)
        self.cells = dict(cells)
        self.ring_edges = ring_edges

    def _point_in_indexed_ring(
        self, longitude: float, latitude: float, polygon_index: int, ring_index: int
    ) -> bool:
        cell = math.floor(latitude / self.latitude_cell_size)
        inside = False
        for left, right in self.ring_edges[(polygon_index, ring_index)].get(cell, []):
            if _point_on_segment(longitude, latitude, left, right):
                return True
            if (left[1] > latitude) != (right[1] > latitude):
                intersection = (right[0] - left[0]) * (latitude - left[1]) / (
                    right[1] - left[1]
                ) + left[0]
                if longitude < intersection:
                    inside = not inside
        return inside

    def contains(self, longitude: float, latitude: float) -> bool:
        key = (math.floor(longitude / self.cell_size), math.floor(latitude / self.cell_size))
        for index in self.cells.get(key, []):
            polygon = self.polygons[index]
            west, south, east, north = polygon.bounds
            if not (west <= longitude <= east and south <= latitude <= north):
                continue
            if not self._point_in_indexed_ring(longitude, latitude, index, 0):
                continue
            if any(
                self._point_in_indexed_ring(longitude, latitude, index, ring_index)
                for ring_index in range(1, len(polygon.rings))
            ):
                continue
            return True
        return False

    def geometry_within(self, geometry: dict[str, Any]) -> bool:
        coordinates = geometry.get("coordinates")
        if not isinstance(coordinates, list):
            return False

        def positions(value: list[Any]):
            if len(value) >= 2 and all(isinstance(item, int | float) for item in value[:2]):
                yield float(value[0]), float(value[1])
                return
            for item in value:
                if isinstance(item, list):
                    yield from positions(item)

        checked = 0
        for longitude, latitude in positions(coordinates):
            checked += 1
            if not self.contains(longitude, latitude):
                return False
        return checked > 0


def _point_on_segment(
    longitude: float, latitude: float, left: list[float], right: list[float]
) -> bool:
    cross = (longitude - left[0]) * (right[1] - left[1]) - (latitude - left[1]) * (
        right[0] - left[0]
    )
    if abs(cross) > 1e-12:
        return False
    return (
        min(left[0], right[0]) - 1e-12 <= longitude <= max(left[0], right[0]) + 1e-12
        and min(left[1], right[1]) - 1e-12 <= latitude <= max(left[1], right[1]) + 1e-12
    )


def _point_in_ring(longitude: float, latitude: float, ring: list[list[float]]) -> bool:
    inside = False
    for index, left in enumerate(ring):
        right = ring[(index + 1) % len(ring)]
        if _point_on_segment(longitude, latitude, left, right):
            return True
        if (left[1] > latitude) != (right[1] > latitude):
            intersection = (right[0] - left[0]) * (latitude - left[1]) / (
                right[1] - left[1]
            ) + left[0]
            if longitude < intersection:
                inside = not inside
    return inside


def country_polygons(payload: dict[str, Any]) -> list[CountryPolygon]:
    validate_polygon_geojson(payload)
    polygons: list[list[list[list[float]]]] = []
    for geometry in polygon_geometries(payload):
        coordinates = geometry["coordinates"]
        polygons.extend([coordinates] if geometry["type"] == "Polygon" else coordinates)
    result: list[CountryPolygon] = []
    for rings in polygons:
        exterior = rings[0]
        longitudes = [position[0] for position in exterior]
        latitudes = [position[1] for position in exterior]
        result.append(
            CountryPolygon(
                rings=rings,
                bounds=(min(longitudes), min(latitudes), max(longitudes), max(latitudes)),
            )
        )
    return result


def point_in_country(longitude: float, latitude: float, polygons: list[CountryPolygon]) -> bool:
    for polygon in polygons:
        west, south, east, north = polygon.bounds
        if not (west <= longitude <= east and south <= latitude <= north):
            continue
        if not _point_in_ring(longitude, latitude, polygon.rings[0]):
            continue
        if any(_point_in_ring(longitude, latitude, hole) for hole in polygon.rings[1:]):
            continue
        return True
    return False


def geometry_within_country(geometry: dict[str, Any], polygons: list[CountryPolygon]) -> bool:
    """Require every source vertex to fall within the reviewed country boundary."""
    coordinates = geometry.get("coordinates")
    if not isinstance(coordinates, list):
        return False

    def positions(value: list[Any]):
        if len(value) >= 2 and all(isinstance(item, int | float) for item in value[:2]):
            yield float(value[0]), float(value[1])
            return
        for item in value:
            if isinstance(item, list):
                yield from positions(item)

    checked = 0
    for longitude, latitude in positions(coordinates):
        checked += 1
        if not point_in_country(longitude, latitude, polygons):
            return False
    return checked > 0


def polygon_geometries(payload: dict[str, Any]) -> list[dict[str, Any]]:
    if payload.get("type") == "FeatureCollection":
        features = payload.get("features")
        if not isinstance(features, list) or not features:
            raise ValueError("GeoJSON FeatureCollection must contain features")
        geometries = [
            feature.get("geometry") if isinstance(feature, dict) else None for feature in features
        ]
    elif payload.get("type") == "Feature":
        geometries = [payload.get("geometry")]
    else:
        geometries = [payload]
    if any(not isinstance(geometry, dict) for geometry in geometries):
        raise ValueError("GeoJSON contains a missing or invalid geometry")
    return geometries  # type: ignore[return-value]


def _rings(geometry: dict[str, Any]) -> list[list[list[float]]]:
    geometry_type = geometry.get("type")
    coordinates = geometry.get("coordinates")
    if not isinstance(coordinates, list):
        raise ValueError("GeoJSON polygon coordinates must be an array")
    if geometry_type == "Polygon":
        polygons = [coordinates]
    elif geometry_type == "MultiPolygon":
        polygons = coordinates
    else:
        raise ValueError("GeoJSON geometry must be Polygon or MultiPolygon")
    rings: list[list[list[float]]] = []
    for polygon in polygons:
        if not isinstance(polygon, list) or not polygon:
            raise ValueError("GeoJSON polygon must contain an exterior ring")
        for ring in polygon:
            if not isinstance(ring, list) or len(ring) < 4:
                raise ValueError("GeoJSON ring must contain at least four positions")
            rings.append(ring)
    return rings


def validate_polygon_geojson(payload: dict[str, Any]) -> PolygonValidationSummary:
    geometries = polygon_geometries(payload)
    geometry_hashes: set[str] = set()
    polygon_count = 0
    ring_count = 0
    coordinate_count = 0
    west, south, east, north = 180.0, 90.0, -180.0, -90.0
    for geometry in geometries:
        canonical = json.dumps(geometry, sort_keys=True, separators=(",", ":")).encode()
        digest = hashlib.sha256(canonical).hexdigest()
        if digest in geometry_hashes:
            raise ValueError("GeoJSON contains duplicate geometry")
        geometry_hashes.add(digest)
        polygon_count += 1 if geometry["type"] == "Polygon" else len(geometry["coordinates"])
        for ring in _rings(geometry):
            ring_count += 1
            if ring[0] != ring[-1]:
                raise ValueError("GeoJSON polygon ring is not closed")
            distinct_positions: set[tuple[float, float]] = set()
            for position in ring:
                if not isinstance(position, list) or len(position) < 2:
                    raise ValueError("GeoJSON position must contain longitude and latitude")
                longitude, latitude = position[0], position[1]
                if (
                    isinstance(longitude, bool)
                    or isinstance(latitude, bool)
                    or not isinstance(longitude, int | float)
                    or not isinstance(latitude, int | float)
                    or not math.isfinite(longitude)
                    or not math.isfinite(latitude)
                    or not -180 <= longitude <= 180
                    or not -90 <= latitude <= 90
                ):
                    raise ValueError("GeoJSON position is outside valid longitude/latitude bounds")
                distinct_positions.add((float(longitude), float(latitude)))
                west, south = min(west, longitude), min(south, latitude)
                east, north = max(east, longitude), max(north, latitude)
                coordinate_count += 1
            if len(distinct_positions) < 3:
                raise ValueError("GeoJSON polygon ring has fewer than three distinct positions")
    return PolygonValidationSummary(
        geometry_count=len(geometries),
        polygon_count=polygon_count,
        ring_count=ring_count,
        coordinate_count=coordinate_count,
        bounds=(west, south, east, north),
    )
