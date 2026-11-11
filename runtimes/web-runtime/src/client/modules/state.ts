import { hostContext } from '../context';
const store = hostContext().state.store;
export const state = Object.freeze({
  ...store.fields,
  onRestored: store.onRestored,
});
