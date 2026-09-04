#!/usr/bin/env python3
"""Generate the cross-language dynamic-range parity fixture.

`core/stretch.ts` claims two things that a hand-written table could get wrong in
the same direction as the code it checks:

1. its percentiles are Hyndman-Fan **type 7**, which is numpy's default; and
2. its padding is applied in the normalized space of the layer's own scale.

This writes down what numpy and CPython actually answer, so the TypeScript side
is pinned to the reference implementations rather than to its own arithmetic.

    python3 tests/fixtures/generate_stretch_parity.py \\
        --output tests/fixtures/grid-stretch-parity-v1.json

## Provenance, and why the first eight cases look familiar

`base_cases()` is a verbatim copy of `build()` from GeoGridKit
`Scripts/generate_percentile_fixture.py` at `b13d61d` — the same case list, the
same `np.random.default_rng(20260828)` seed, and the same *draw order*, which is
what makes the seeded `kd490-like` and `sst-like` samples reproduce. Run against
the same numpy, those eight cases are byte-identical to the Swift side's
`Tests/GeoGridCoreTests/Fixtures/percentile_hf7_numpy.json`, so the two languages
are pinned to literally the same numbers rather than to two independent samples
of the same idea. `extra_cases()` is appended *after* the seeded draws precisely
so it cannot perturb them.

## On exactness

numpy's own interpolation is not the closed form it documents: `_lerp` computes
`a + (b - a) * t` for `t < 0.5` and `b - (b - a) * (1 - t)` for `t >= 0.5`. The
two are algebraically equal and differ by an ULP in float64, so byte-exact
agreement with numpy is not available to *any* implementation of the documented
formula, Swift's included. Both sides therefore assert the same 1e-9 tolerance
GeoGridKit's `StretchTests` uses. The pad table has no such split and is
asserted far tighter.
"""

from __future__ import annotations

import argparse
import json
import math
import pathlib
import sys

import numpy as np

FORMAT = "narduk-grid-stretch-parity-v1"
PERCENTILE_FORMAT = "narduk-percentile-hf7-v1"
PERCENTS = [0.0, 1.0, 2.0, 25.0, 50.0, 75.0, 98.0, 99.0, 100.0]


def case(name: str, values: list[float]) -> dict:
    array = np.asarray(values, dtype="float64")
    return {
        "name": name,
        "values": [float(value) for value in values],
        "percentiles": [
            {
                "percent": percent,
                # method="linear" is numpy's default and is Hyndman-Fan type 7.
                "value": float(np.percentile(array, percent, method="linear")),
            }
            for percent in PERCENTS
        ],
    }


def gap_case(name: str, raw: list[float]) -> dict:
    """A case whose input carries gaps, pinning the filter as well as the math.

    `rawValues` is what a grid plane holds; `values` is what the sampler keeps.
    The TypeScript test filters `rawValues` itself and asserts it arrives at
    `values`, so the "drop non-finite samples" rule is pinned rather than
    assumed — a filter that also dropped, say, zeros would still produce a
    plausible-looking percentile table.

    The gaps are written as the strings `"NaN"` / `"Infinity"` / `"-Infinity"`
    rather than as bare tokens. JSON has no non-finite literal, and Python's
    `json` emits those tokens anyway by default — producing a file every strict
    parser, `JSON.parse` included, rejects. `allow_nan=False` in `main()` keeps
    that from creeping back.
    """
    finite = [value for value in raw if math.isfinite(value)]
    built = case(name, finite)
    built["rawValues"] = [
        value if math.isfinite(value) else _gap_token(value) for value in raw
    ]
    return built


def _gap_token(value: float) -> str:
    if math.isnan(value):
        return "NaN"
    return "Infinity" if value > 0 else "-Infinity"


def base_cases(rng: np.random.Generator) -> list[dict]:
    """GeoGridKit's own eight cases, in its own order. Do not reorder or extend."""
    return [
        case("single", [4.25]),
        case("pair", [1.0, 2.0]),
        case("ten-ascending", [float(value) for value in range(10)]),
        case("eleven-ascending", [float(value) for value in range(11)]),
        case("duplicates", [1.0, 1.0, 1.0, 4.0, 4.0, 9.0, 9.0, 9.0]),
        case("negatives", [-8.5, -3.25, -0.5, 0.0, 2.75, 11.0]),
        case(
            "kd490-like",
            [round(float(value), 6) for value in rng.lognormal(mean=-1.8, sigma=0.9, size=257)],
        ),
        case(
            "sst-like",
            [round(float(value), 6) for value in rng.normal(loc=24.0, scale=3.5, size=1000)],
        ),
    ]


def extra_cases() -> list[dict]:
    """Web-side additions. Appended after the seeded draws so those are unmoved."""
    return [
        # Every value identical: the range is degenerate and the tier must come
        # back `insufficient` rather than as a usable-looking zero-width range.
        case("all-equal", [7.0, 7.0, 7.0, 7.0]),
        # Ties on both ends and in the middle, so an off-by-one in the rank walks
        # straight into a repeated value and hides.
        case("ties-heavy", [0.0, 0.0, 0.0, 0.0, 1.0, 1.0, 1.0, 5.0, 5.0, 9.0]),
        # Even and odd n adjacent, at the smallest sizes where the r = p/100*(n-1)
        # interpolation actually interpolates.
        case("three-ascending", [1.0, 2.0, 4.0]),
        case("four-ascending", [1.0, 2.0, 4.0, 8.0]),
        # A log layer's own value population: decades apart, so a percentile
        # computed in the wrong space is visible rather than subtle.
        case("log-decades", [0.001, 0.01, 0.1, 1.0, 10.0]),
        case(
            "kd490-log-layer",
            [0.012, 0.019, 0.024, 0.031, 0.048, 0.06, 0.11, 0.24, 0.51, 1.2, 3.4, 6.6],
        ),
        # Gaps. A gulf grid is mostly gap over land, so this is the common shape,
        # not the exotic one.
        gap_case(
            "nan-laden",
            [float("nan"), 3.0, 1.0, float("nan"), 9.0, 4.0, float("nan"), 2.0, 8.0],
        ),
        gap_case(
            "nan-laden-infinities",
            [float("inf"), 0.5, float("-inf"), 2.5, float("nan"), 1.5, 3.5],
        ),
    ]


def pad_case(name: str, lo: float, hi: float, pad: float, scale: str) -> dict:
    """The padding reference, in the space the layer's own scale defines.

    Written as the closed form GeoGridKit's `padded(_:by:scale:)` uses, in the
    same operand order and the same base (natural log), because the pinned
    reference for padding is Swift rather than the server's log10 color engine.
    """
    if pad > 0 and math.isfinite(lo) and math.isfinite(hi):
        if scale == "log":
            if lo > 0 and hi > 0:
                lower_log = math.log(lo)
                upper_log = math.log(hi)
                span = upper_log - lower_log
                if span > 0:
                    lo_out = math.exp(lower_log - span * pad)
                    hi_out = math.exp(upper_log + span * pad)
                else:
                    lo_out, hi_out = lo, hi
            else:
                lo_out, hi_out = lo, hi
        else:
            span = hi - lo
            if span > 0:
                lo_out = lo - span * pad
                hi_out = hi + span * pad
            else:
                lo_out, hi_out = lo, hi
    else:
        lo_out, hi_out = lo, hi
    return {
        "name": name,
        "range": [lo, hi],
        "pad": pad,
        "scale": scale,
        "expected": [lo_out, hi_out],
    }


def pad_cases() -> list[dict]:
    return [
        # The two vectors GeoGridKit's StretchTests pins by hand.
        pad_case("linear-10-30-pad-10pct", 10.0, 30.0, 0.1, "linear"),
        pad_case("log-two-decades-pad-50pct", 0.01, 1.0, 0.5, "log"),
        # The same range padded linearly: the point of the log path is that these
        # two disagree, and by a lot.
        pad_case("linear-same-range-pad-50pct", 0.01, 1.0, 0.5, "linear"),
        # Declines: a log pad cannot touch a range that reaches zero or below,
        # and a zero pad touches nothing at all.
        pad_case("log-nonpositive-declines", -1.0, 5.0, 0.2, "log"),
        pad_case("linear-zero-pad-declines", -1.0, 5.0, 0.0, "linear"),
        pad_case("log-zero-floor-declines", 0.0, 5.0, 0.3, "log"),
        pad_case("degenerate-span-declines", 7.0, 7.0, 0.25, "linear"),
        # Real layer shapes.
        pad_case("kd490-log-pad-5pct", 0.02, 2.0, 0.05, "log"),
        pad_case("sst-linear-pad-2pct", 15.0, 32.0, 0.02, "linear"),
        pad_case("chl-log-pad-1pct", 0.01, 0.5, 0.01, "log"),
    ]


def build() -> dict:
    rng = np.random.default_rng(20260828)
    return {
        "format": FORMAT,
        "percentileFormat": PERCENTILE_FORMAT,
        "generatedFrom": "numpy.percentile(method='linear') + math.log/exp",
        "numpyVersion": np.__version__,
        "pythonVersion": sys.version.split()[0],
        "geoGridKitGeneratorCommit": "b13d61d",
        "sharedCaseCount": 8,
        "cases": base_cases(rng) + extra_cases(),
        "padCases": pad_cases(),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=pathlib.Path, required=True)
    args = parser.parse_args()

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(build(), indent=2, allow_nan=False) + "\n")
    print(f"wrote {args.output}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
