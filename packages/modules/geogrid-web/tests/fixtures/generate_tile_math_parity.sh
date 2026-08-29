#!/usr/bin/env bash
# Regenerate tests/fixtures/tile-math-parity-v1.json from GeoGridKit itself.
#
# The tile geometry in src/tile/mercator.ts is a port of GeoGridKit
# Sources/GeoGridRender/GridTileMath.swift. A port asserted against numbers the
# port itself produced proves nothing, so this script builds a throwaway
# SwiftPM executable that depends on a real GeoGridKit checkout, calls
# `GridTileMath.lonLatForTilePixel` / `.bounds(for:)` directly, and writes what
# Swift answered. The TypeScript test then asserts the port reproduces those
# doubles.
#
# Like generate_ramp_parity.py this is a deliberate local act, not a CI step:
# it needs a GeoGridKit checkout and a Swift toolchain. CI asserts the
# checked-in bytes.
#
#   ./tests/fixtures/generate_tile_math_parity.sh            # regenerate
#   ./tests/fixtures/generate_tile_math_parity.sh --check    # fail if stale
#
# GeoGridKit is located via --geogridkit <path>, $GEOGRIDKIT_ROOT, or the
# conventional sibling checkout.
set -euo pipefail

FIXTURE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUTPUT="${FIXTURE_DIR}/tile-math-parity-v1.json"
CHECK=0
GEOGRIDKIT="${GEOGRIDKIT_ROOT:-}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --check) CHECK=1; shift ;;
    --geogridkit) GEOGRIDKIT="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

if [[ -z "${GEOGRIDKIT}" ]]; then
  for candidate in \
    "${FIXTURE_DIR}/../../../GeoGridKit" \
    "${HOME}/code/narduk-enterprises/GeoGridKit"; do
    if [[ -f "${candidate}/Package.swift" ]]; then
      GEOGRIDKIT="$(cd "${candidate}" && pwd)"
      break
    fi
  done
fi

if [[ -z "${GEOGRIDKIT}" || ! -f "${GEOGRIDKIT}/Package.swift" ]]; then
  echo "GeoGridKit checkout not found; pass --geogridkit <path> or set GEOGRIDKIT_ROOT" >&2
  exit 1
fi

command -v swift >/dev/null 2>&1 || { echo "swift toolchain not found" >&2; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT
mkdir -p "${WORK}/Sources/tilemathgen"

cat > "${WORK}/Package.swift" <<EOF
// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "tilemathgen",
    platforms: [.macOS(.v14)],
    dependencies: [.package(path: "${GEOGRIDKIT}")],
    targets: [
        .executableTarget(
            name: "tilemathgen",
            dependencies: [
                .product(name: "GeoGridCore", package: "GeoGridKit"),
                .product(name: "GeoGridRender", package: "GeoGridKit"),
            ]
        )
    ]
)
EOF

cat > "${WORK}/Sources/tilemathgen/main.swift" <<'SWIFT'
import Foundation
import GeoGridCore
import GeoGridRender

struct PixelRow: Encodable {
    let z: Int, x: Int, y: Int, side: Int
    let pixelX: Double, pixelY: Double
    let longitude: Double, latitude: Double
}

struct CenterRow: Encodable {
    let z: Int, x: Int, y: Int, side: Int
    let column: Int, row: Int
    let longitude: Double, latitude: Double
}

struct BoundsRow: Encodable {
    let z: Int, x: Int, y: Int, side: Int
    let west: Double, south: Double, east: Double, north: Double
}

struct Table: Encodable {
    let generator: String
    let source: String
    let swiftVersion: String
    let geoGridKitCommit: String
    let pixels: [PixelRow]
    let centers: [CenterRow]
    let bounds: [BoundsRow]
}

let tiles: [(z: Int, x: Int, y: Int, side: Int)] = [
    (0, 0, 0, 256),
    (1, 0, 0, 256),
    (1, 1, 1, 256),
    (2, 1, 1, 256),
    (5, 7, 12, 256),
    (8, 59, 108, 256),
    (10, 239, 434, 256),
    (12, 958, 1739, 512),
    (14, 3834, 6957, 256),
    (3, 2, 3, 64),
    (6, 15, 24, 128),
]

let pixelProbes: [(Double, Double)] = [
    (0, 0), (0.5, 0.5), (1, 1), (17.25, 3.75), (128, 128), (255.5, 255.5),
]

var pixels: [PixelRow] = []
var centers: [CenterRow] = []
var bounds: [BoundsRow] = []

for tile in tiles {
    let key = GridTileKey(z: tile.z, x: tile.x, y: tile.y, side: tile.side)
    for probe in pixelProbes {
        guard probe.0 <= Double(tile.side), probe.1 <= Double(tile.side) else { continue }
        guard let coordinate = GridTileMath.lonLatForTilePixel(
            tile: key, pixelX: probe.0, pixelY: probe.1
        ) else { continue }
        pixels.append(PixelRow(
            z: tile.z, x: tile.x, y: tile.y, side: tile.side,
            pixelX: probe.0, pixelY: probe.1,
            longitude: coordinate.longitude, latitude: coordinate.latitude
        ))
    }
    for probe in [(0, 0), (7, 3), (tile.side - 1, tile.side - 1)] {
        guard let coordinate = GridTileMath.lonLatForTilePixel(
            tile: key, column: probe.0, row: probe.1
        ) else { continue }
        centers.append(CenterRow(
            z: tile.z, x: tile.x, y: tile.y, side: tile.side,
            column: probe.0, row: probe.1,
            longitude: coordinate.longitude, latitude: coordinate.latitude
        ))
    }
    if let box = GridTileMath.bounds(for: key) {
        bounds.append(BoundsRow(
            z: tile.z, x: tile.x, y: tile.y, side: tile.side,
            west: box.minLongitude, south: box.minLatitude,
            east: box.maxLongitude, north: box.maxLatitude
        ))
    }
}

let table = Table(
    generator: "tests/fixtures/generate_tile_math_parity.sh",
    source: "GeoGridKit Sources/GeoGridRender/GridTileMath.swift",
    swiftVersion: ProcessInfo.processInfo.environment["SWIFT_VERSION"] ?? "unknown",
    geoGridKitCommit: ProcessInfo.processInfo.environment["GEOGRIDKIT_COMMIT"] ?? "unknown",
    pixels: pixels,
    centers: centers,
    bounds: bounds
)

let encoder = JSONEncoder()
encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
var bytes = try encoder.encode(table)
bytes.append(0x0A)
FileHandle.standardOutput.write(bytes)
SWIFT

SWIFT_VERSION="$(swift --version 2>&1 | head -1)"
GEOGRIDKIT_COMMIT="$(git -C "${GEOGRIDKIT}" rev-parse HEAD 2>/dev/null || echo unknown)"
export SWIFT_VERSION GEOGRIDKIT_COMMIT

GENERATED="${WORK}/tile-math-parity.json"
(cd "${WORK}" && swift run -c release tilemathgen) > "${GENERATED}"

if [[ "${CHECK}" -eq 1 ]]; then
  # swiftVersion and geoGridKitCommit are provenance, not contract: a newer
  # toolchain must not fail the staleness check, only different geometry may.
  strip() { python3 -c 'import json,sys;d=json.load(open(sys.argv[1]));[d.pop(k,None) for k in ("swiftVersion","geoGridKitCommit")];print(json.dumps(d,sort_keys=True,indent=2))' "$1"; }
  if diff -u <(strip "${OUTPUT}") <(strip "${GENERATED}"); then
    echo "tile-math-parity-v1.json is current."
  else
    echo "tile-math-parity-v1.json is stale; rerun without --check." >&2
    exit 1
  fi
else
  cp "${GENERATED}" "${OUTPUT}"
  echo "wrote ${OUTPUT}"
fi
