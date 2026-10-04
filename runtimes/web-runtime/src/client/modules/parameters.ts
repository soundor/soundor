// `soundor:parameters` in the browser: the page's parameter store, the same
// objects the host UI and the user's Web Audio code use.

import { hostContext } from '../context';

/** Every parameter declared in soundor.config, by id. */
export const parameters = hostContext().parameters.byId;
