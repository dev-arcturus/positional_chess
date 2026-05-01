#!/usr/bin/env bash
# Build engine-rs to WASM and copy artifacts into client/src/engine/wasm-rs/.
#
# Requirements (one-time):
#   rustup target add wasm32-unknown-unknown
#   brew install wasm-pack binaryen
#
# Outputs:
#   client/src/engine/wasm-rs/engine_rs.js
#   client/src/engine/wasm-rs/engine_rs.d.ts
#   client/src/engine/wasm-rs/engine_rs_bg.wasm
#   client/src/engine/wasm-rs/engine_rs_bg.wasm.d.ts
#
# wasm-opt is invoked separately (not via wasm-pack) so we can pass
# --enable-bulk-memory-opt — the version bundled with wasm-pack is too
# old for our wasm32 output.

set -euo pipefail

CRATE_DIR="$(cd "$(dirname "$0")" && pwd)"
CLIENT_DIR="$(cd "$CRATE_DIR/../client" && pwd)"
OUT_DIR="$CLIENT_DIR/src/engine/wasm-rs"

cd "$CRATE_DIR"
wasm-pack build --target web --release --out-dir pkg

# Optional secondary optimisation pass. Skipped if wasm-opt isn't installed.
if command -v wasm-opt >/dev/null 2>&1; then
  # Newer rustc emits bulk-memory + nontrapping-float-to-int by default;
  # we have to opt-in for wasm-opt to validate them.
  wasm-opt \
    --enable-bulk-memory-opt \
    --enable-nontrapping-float-to-int \
    -O3 \
    -o pkg/engine_rs_bg.opt.wasm pkg/engine_rs_bg.wasm
  mv pkg/engine_rs_bg.opt.wasm pkg/engine_rs_bg.wasm
fi

mkdir -p "$OUT_DIR"
cp pkg/engine_rs.js pkg/engine_rs.d.ts \
   pkg/engine_rs_bg.wasm pkg/engine_rs_bg.wasm.d.ts \
   "$OUT_DIR/"

echo
echo "  wrote: $OUT_DIR"
ls -la "$OUT_DIR"
