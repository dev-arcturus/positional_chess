// Node-side loader for the engine-rs WASM bundle.
//
// The bundle was built with `--target web`. Its `init()` accepts either a
// URL/Request OR raw bytes; we feed it raw bytes from the prebuilt .wasm
// so the loader doesn't try to fetch().

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = join(HERE, '..', '..', 'engine-rs', 'pkg');

let mod = null;

export async function loadWasm() {
  if (mod) return mod;
  const init = await import(join(PKG, 'engine_rs.js'));
  const bytes = await readFile(join(PKG, 'engine_rs_bg.wasm'));
  await init.default(bytes);
  mod = init;
  return mod;
}
