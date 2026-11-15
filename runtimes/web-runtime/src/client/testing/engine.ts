// Loads the engine's WebAssembly before a suite runs, as the Web host does
// before anything uses soundor:ui.
import { loadEngine } from '../context';

await loadEngine();
