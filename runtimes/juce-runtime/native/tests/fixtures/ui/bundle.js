import { plugin } from 'soundor:host';

// A stand-in for a built plugin bundle, embedded by the native tests.
import { describe } from './lib.js';

globalThis.started = describe(plugin.name);
