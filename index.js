/**
 * dsh-fold-turns: browser-only plugin. The host half is an empty `apply` so Loader has an
 * entry to mount; the behaviour lives in `lib/client.js` (exports["./client"]).
 * @module dsh-fold-turns
 */
export const name = 'fold-turns'

/** Host plugin body: nothing to do on the server. */
export function apply() {}
