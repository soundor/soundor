// `soundor:storage` in the browser: IndexedDB, private to this plugin's id.

import { hostContext } from '../context';
import { pluginDatabase } from '../persistence';
import { createStorage } from '../storage';

const { plugin } = hostContext();

/** Persistent key/value storage private to this plugin. Values are JSON data. */
export const storage = createStorage(() => pluginDatabase(plugin.id));
