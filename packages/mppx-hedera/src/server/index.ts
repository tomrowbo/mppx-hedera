export type { HederaChargeServerOptions } from './charge.js';
export { charge } from './charge.js';
export type { HederaSessionServerOptions } from './session.js';
export { session } from './session.js';

import { charge } from './charge.js';
import { session } from './session.js';

/**
 * Convenience namespace — mirrors the `tempo` export pattern from mppx.
 *
 * @example
 * ```ts
 * import { Mppx } from 'mppx/server'
 * import { hedera } from 'mppx-hedera/server'
 *
 * const mppx = Mppx.create({
 *   methods: [hedera.charge({ ... }), hedera.session({ ... })],
 *   secretKey: process.env.MPP_SECRET_KEY!,
 * })
 * ```
 */
export const hedera = { charge, session };
