import { hostContext } from '../context';
const service = hostContext().state.presets;
export const presets = Object.freeze({
  factory: service.factory,
  getSnapshot: service.getSnapshot,
  subscribe: service.subscribe,
});
