#!/usr/bin/env python3
"""Generate ``ramp-parity-v1.json`` by running the SERVER color-ramp engine.

This script is the *producer* half of the cross-language ramp contract. It
imports ``shared/colorramp.py`` from ``narduk-enterprises/narduk-data`` — the
canonical Python engine, untouched — and records exactly what it returns. The
TypeScript engine in ``src/color`` is then asserted byte-exact against the
recorded bytes by ``tests/color-parity.test.ts``.

Nothing here re-implements ramp math. Every number in the fixture comes out of
``ColorRamp.rgba`` / ``interpolate`` / ``normalize_value``. If the two engines
ever disagree, the Python side is right by construction and the TypeScript side
is the bug.

Usage
-----
    python3 tests/fixtures/generate_ramp_parity.py
    python3 tests/fixtures/generate_ramp_parity.py --colorramp /path/to/colorramp.py
    NARDUK_DATA_ROOT=/path/to/narduk-data python3 tests/fixtures/generate_ramp_parity.py

The default lookup is ``$NARDUK_DATA_ROOT/shared/colorramp.py``, falling back to
``~/code/narduk-enterprises/narduk-data/shared/colorramp.py``. Regenerating is a
deliberate act: it re-pins the contract, so review the JSON diff.

narduk-data is expected to adopt this same fixture later as
``fixtures/render-parity-v1`` so the pipeline, GeoGridKit (Swift), GeoGridWeb
(TypeScript), and the server all sample one set of pinned bytes. Keep the schema
name (``narduk-ramp-parity-v1``) stable when that happens.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import importlib.util
import json
import math
import os
import sys
from pathlib import Path
from types import ModuleType

DEFAULT_DATA_ROOT = Path.home() / "code" / "narduk-enterprises" / "narduk-data"
LUT_RAMPS = ("sst", "kd490")
LUT_COUNT = 256


def load_colorramp(path: Path) -> ModuleType:
    """Import ``colorramp.py`` from an explicit path without installing it."""
    if not path.is_file():
        raise SystemExit(
            f"colorramp.py not found at {path}\n"
            "Pass --colorramp /path/to/narduk-data/shared/colorramp.py "
            "or set NARDUK_DATA_ROOT."
        )
    spec = importlib.util.spec_from_file_location("narduk_shared_colorramp", path)
    if spec is None or spec.loader is None:
        raise SystemExit(f"cannot import a module from {path}")
    module = importlib.util.module_from_spec(spec)
    # `@dataclass` resolves string annotations through `sys.modules[cls.__module__]`,
    # so a module executed without being registered there raises during class
    # creation. Register before exec, drop it again on failure.
    sys.modules[spec.name] = module
    try:
        spec.loader.exec_module(module)
    except BaseException:
        sys.modules.pop(spec.name, None)
        raise
    return module


def ramp_stops(ramp) -> list[dict[str, object]]:
    return [{"position": stop.position, "rgba": list(stop.rgba)} for stop in ramp.stops]


def value_case(
    cr: ModuleType,
    *,
    name: str,
    ramp_name: str,
    value_range: tuple[float, float],
    scale: str,
    values: list[float],
    note: str,
) -> dict[str, object]:
    """Record ``ColorRamp.rgba`` for raw data values — the full server path."""
    ramp = cr.get_ramp(ramp_name)
    samples = []
    for value in values:
        normalized = cr.normalize_value(value, value_range, scale)
        samples.append(
            {
                "value": value,
                "normalized": normalized,
                "rgba": list(ramp.rgba(value, value_range, scale)),
            }
        )
    return {
        "name": name,
        "ramp": ramp_name,
        "valueRange": [value_range[0], value_range[1]],
        "scale": scale,
        "note": note,
        "samples": samples,
    }


def position_case(
    cr: ModuleType, *, name: str, ramp_name: str, positions: list[float], note: str
) -> dict[str, object]:
    """Record ``interpolate`` at already-normalized positions.

    These isolate the rounding rule from log10 precision: no transcendental
    function stands between the recorded position and the recorded bytes, so a
    mismatch here is a rounding bug and nothing else.
    """
    ramp = cr.get_ramp(ramp_name)
    return {
        "name": name,
        "ramp": ramp_name,
        "note": note,
        "samples": [
            {"position": position, "rgba": list(ramp.sample01(position))}
            for position in positions
        ],
    }


def wire_stop_case(cr: ModuleType, *, ramp_name: str, value_range, scale) -> dict:
    """Round-trip the catalog wire shape: normalized -> data value -> normalized.

    ``catalog.py::ramp_stop_value`` denormalizes each stop position into data
    space for the wire; ``normalizeWireStops`` in TypeScript must invert it back
    to the ramp's own positions. Recording both ends pins that inverse.
    """
    ramp = cr.get_ramp(ramp_name)
    lo, hi = value_range
    wire = []
    for stop in ramp.stops:
        if scale == "log" and lo > 0 and hi > 0:
            value = float(
                10 ** (math.log10(lo) + stop.position * (math.log10(hi) - math.log10(lo)))
            )
        else:
            value = float(lo + stop.position * (hi - lo))
        wire.append(
            {
                "value": value,
                "r": int(stop.rgba[0]),
                "g": int(stop.rgba[1]),
                "b": int(stop.rgba[2]),
                "a": int(stop.rgba[3]),
            }
        )
    return {
        "ramp": ramp_name,
        "valueRange": [lo, hi],
        "scale": scale,
        "wire": wire,
        "expectedPositions": [stop.position for stop in ramp.stops],
    }


def build_lut(cr: ModuleType, ramp_name: str, count: int) -> bytes:
    """``count`` RGBA entries sampled at ``i / (count - 1)``, GPU-upload order."""
    ramp = cr.get_ramp(ramp_name)
    out = bytearray()
    for index in range(count):
        position = 0.0 if count == 1 else index / (count - 1)
        out.extend(ramp.sample01(position))
    return bytes(out)


def build_fixture(cr: ModuleType) -> dict[str, object]:
    ramps = {name: ramp_stops(cr.get_ramp(name)) for name in cr.ramp_names()}

    cases = [
        value_case(
            cr,
            name="kd490-log-mid-segment",
            ramp_name="kd490",
            value_range=(0.01, 6.6),
            scale="log",
            # The live Gulf water-clarity layer's own range and scale.
            values=[0.01, 0.02, 0.05, 0.1, 0.257, 0.5, 1.0, 2.0, 6.6],
            note="mid-segment log sampling across the published KD490 domain",
        ),
        value_case(
            cr,
            name="kd490-log-clamped-and-undefined",
            ramp_name="kd490",
            value_range=(0.01, 6.6),
            scale="log",
            values=[0.001, 0.0, -1.0, 12.0, float("nan"), float("inf"), float("-inf")],
            note=(
                "below range clamps to stop 0; above range clamps to the last stop; "
                "zero/negative on a log scale and any non-finite value are transparent"
            ),
        ),
        value_case(
            cr,
            name="sst-linear-mid-segment",
            ramp_name="sst",
            value_range=(-2.0, 35.0),
            scale="linear",
            values=[-2.0, 0.0, 6.66, 12.5, 18.5, 25.0, 31.25, 35.0],
            note="mid-segment linear sampling",
        ),
        value_case(
            cr,
            name="sst-linear-clamped-and-undefined",
            ramp_name="sst",
            value_range=(-2.0, 35.0),
            scale="linear",
            values=[-40.0, 100.0, float("nan")],
            note="linear clamps both ends; NaN is transparent",
        ),
        value_case(
            cr,
            name="front-first-stop-alpha-zero",
            ramp_name="front",
            value_range=(0.0, 1.0),
            scale="linear",
            # FRONT_RAMP's first stop is (0, 0, 0, 0): a fully transparent ramp
            # color that is NOT an out-of-domain sentinel. A renderer that
            # collapses "transparent" into "no data" loses the weak-front end of
            # this ramp, so the two cases are pinned side by side.
            values=[-0.5, 0.0, 0.11, 0.22, 0.5, 0.76, 1.0, 1.5, float("nan")],
            note="ramp whose first stop is alpha 0 — in-domain transparent, not missing",
        ),
        value_case(
            cr,
            name="chlorophyll-log-narrow-subunit-range",
            ramp_name="chlorophyll",
            value_range=(0.01, 0.5),
            scale="log",
            # Every stop value on the wire for this layer is <= 1.0 while still
            # being a data value. A max<=1 "looks normalized" heuristic corrupts
            # exactly this shape, which is why normalizeWireStops uses the
            # value range instead.
            values=[0.01, 0.03, 0.0707, 0.15, 0.5],
            note="log layer whose entire value range sits inside 0..1",
        ),
        value_case(
            cr,
            name="identity-linear-positions",
            ramp_name="water_quality",
            value_range=(0.0, 1.0),
            scale="linear",
            # A linear 0..1 range makes normalize_value the identity, so these
            # values are positions exactly and the segment arithmetic is the
            # only thing under test.
            values=[0.0, 0.05, 0.15, 0.25, 0.35, 0.45, 0.55, 0.65, 0.75, 0.85, 0.95, 1.0],
            note="linear 0..1 range: normalization is the identity",
        ),
    ]

    position_cases = [
        position_case(
            cr,
            name="kd490-half-to-even",
            ramp_name="kd490",
            positions=[0.0, 0.05, 0.15, 0.25, 0.5, 0.55, 0.75, 0.85, 0.95, 1.0],
            note="mid-segment positions; several channels land on an exact .5",
        ),
        position_case(
            cr,
            name="front-half-to-even",
            ramp_name="front",
            positions=[0.11, 0.36, 0.63, 0.88],
            note="segment midpoints of a 5-stop ramp",
        ),
        position_case(
            cr,
            name="spm-clamped-outside-unit-interval",
            ramp_name="spm",
            positions=[-1.0, -0.0001, 1.0001, 2.0],
            note="positions outside 0..1 clamp to the terminal stop colors",
        ),
        position_case(
            cr,
            name="cdl-last-stop-below-one",
            ramp_name="cdl",
            # The CDL ramp's last stop sits at 254/255, so position 1.0 falls
            # past the final segment and must return the last stop verbatim.
            positions=[0.0, 0.5, 254 / 255, 0.999, 1.0],
            note="ramp whose last stop position is below 1.0",
        ),
        position_case(
            cr,
            name="truecolor-empty-ramp",
            ramp_name="truecolor",
            positions=[0.0, 0.5, 1.0],
            note="a ramp with no stops samples fully transparent",
        ),
    ]

    wire_stop_cases = [
        wire_stop_case(cr, ramp_name="kd490", value_range=(0.01, 6.6), scale="log"),
        wire_stop_case(cr, ramp_name="sst", value_range=(-2.0, 35.0), scale="linear"),
        wire_stop_case(cr, ramp_name="chlorophyll", value_range=(0.01, 0.5), scale="log"),
        wire_stop_case(cr, ramp_name="front", value_range=(0.0, 1.0), scale="linear"),
    ]

    luts: dict[str, str] = {}
    lut_digests: dict[str, str] = {}
    for ramp_name in LUT_RAMPS:
        raw = build_lut(cr, ramp_name, LUT_COUNT)
        key = f"{ramp_name}@{LUT_COUNT}"
        luts[key] = base64.b64encode(raw).decode("ascii")
        lut_digests[key] = hashlib.sha256(raw).hexdigest()

    return {
        "schema": "narduk-ramp-parity-v1",
        "rampSpecVersion": cr.RAMP_SPEC_VERSION,
        "rounding": "half-to-even",
        "source": "narduk-enterprises/narduk-data shared/colorramp.py",
        "generator": "tests/fixtures/generate_ramp_parity.py",
        "ramps": ramps,
        "cases": cases,
        "positionCases": position_cases,
        "wireStopCases": wire_stop_cases,
        "luts": luts,
        "lutDigests": lut_digests,
    }


def encode(value: object) -> str:
    """Serialize with NaN/Infinity spelled as strings so the JSON stays strict.

    ``JSON.parse`` rejects the bare ``NaN``/``Infinity`` tokens Python's json
    module emits by default, and a fixture the consumer cannot parse is not a
    fixture. Non-finite sample inputs are written as ``"NaN"`` / ``"Infinity"``
    / ``"-Infinity"`` and revived on the TypeScript side.
    """

    def sanitize(node: object) -> object:
        if isinstance(node, float):
            if math.isnan(node):
                return "NaN"
            if node == math.inf:
                return "Infinity"
            if node == -math.inf:
                return "-Infinity"
            return node
        if isinstance(node, dict):
            return {key: sanitize(item) for key, item in node.items()}
        if isinstance(node, list):
            return [sanitize(item) for item in node]
        return node

    return json.dumps(sanitize(value), indent=2, allow_nan=False) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--colorramp",
        type=Path,
        default=None,
        help="path to narduk-data shared/colorramp.py",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=Path(__file__).with_name("ramp-parity-v1.json"),
        help="fixture output path",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="regenerate in memory and fail if the on-disk fixture differs",
    )
    args = parser.parse_args()

    path = args.colorramp
    if path is None:
        root = Path(os.environ.get("NARDUK_DATA_ROOT", DEFAULT_DATA_ROOT))
        path = root / "shared" / "colorramp.py"

    fixture = encode(build_fixture(load_colorramp(path)))

    if args.check:
        current = args.out.read_text(encoding="utf-8") if args.out.is_file() else ""
        if current != fixture:
            print(f"{args.out} is stale; rerun without --check", file=sys.stderr)
            return 1
        print(f"{args.out} matches the server engine.")
        return 0

    args.out.write_text(fixture, encoding="utf-8")
    print(f"Wrote {args.out} from {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
