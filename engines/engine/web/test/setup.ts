// Every suite's engines start from the module `pnpm build:wasm` wrote.
import { Engine } from '../src/index.ts';
import { wasmBytes } from './wasm.ts';

await Engine.load({ wasm: wasmBytes() });
