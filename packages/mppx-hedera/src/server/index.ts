export type { HederaChargeServerOptions } from './charge.ts';
export { charge } from './charge.ts';
export type { HederaSessionServerOptions } from './session.ts';
export { session } from './session.ts';

import { charge } from './charge.ts';
import { session } from './session.ts';

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
