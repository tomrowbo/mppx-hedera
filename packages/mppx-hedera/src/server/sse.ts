/**
 * SSE (Server-Sent Events) transport for Hedera session metered streaming.
 *
 * Enables pay-per-chunk streaming payments over a Hedera payment channel.
 * Each chunk yielded by an async iterable is metered against the channel
 * balance; when funds run low the stream pauses and signals the client
 * to submit a new voucher.
 *
 * Three public entry points:
 * - `serve()`       — wraps an AsyncIterable<string> with payment metering
 * - `toResponse()`  — wraps a ReadableStream into an HTTP Response with SSE headers
 * - `fromRequest()` — extracts channelId, challengeId, tickCost from Authorization header
 */

import type { Hex } from 'viem';
import { Credential, Store } from 'mppx';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Channel state as persisted in the store (mirrors session.ts ChannelState). */
interface ChannelState {
  channelId: Hex;
  deposit: bigint;
  highestVoucherAmount: bigint;
  spent: bigint;
  units: number;
  finalized: boolean;
  [key: string]: unknown;
}

/** Options for the `serve()` function. */
export interface SseOptions {
  /** mppx Store instance for channel state persistence. */
  store: Store.Store;
  /** Tick cost per chunk (in base units, e.g. 1000 = 0.001 USDC). */
  tickCost: bigint;
  /** Channel ID (bytes32 hex). */
  channelId: `0x${string}`;
  /** Challenge ID from the credential. */
  challengeId: string;
  /** Poll interval in ms when waiting for a new voucher. Default 1000. */
  pollInterval?: number;
  /** Abort signal for cancellation. */
  signal?: AbortSignal;
}

/** Need-voucher event payload. */
export interface NeedVoucherPayload {
  channelId: `0x${string}`;
  requiredCumulative: string;
  acceptedCumulative: string;
  deposit: string;
}

/** Payment receipt event payload. */
export interface ReceiptPayload {
  method: 'hedera';
  intent: 'session';
  status: 'success';
  timestamp: string;
  reference: string;
  channelId: `0x${string}`;
  acceptedCumulative: string;
  spent: string;
  units: number;
  challengeId: string;
}

/** Parsed context extracted from the Authorization header. */
export interface RequestContext {
  channelId: `0x${string}`;
  challengeId: string;
  tickCost: bigint;
}

// ---------------------------------------------------------------------------
// SSE formatting helpers
// ---------------------------------------------------------------------------

function formatMessage(data: string): string {
  return `event: message\ndata: ${data}\n\n`;
}

function formatNeedVoucher(payload: NeedVoucherPayload): string {
  return `event: payment-need-voucher\ndata: ${JSON.stringify(payload)}\n\n`;
}

function formatReceipt(payload: ReceiptPayload): string {
  return `event: payment-receipt\ndata: ${JSON.stringify(payload)}\n\n`;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function abortPromise(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    if (signal.aborted) return reject(new Error('Aborted'));
    signal.addEventListener('abort', () => reject(new Error('Aborted')), {
      once: true,
    });
  });
}

/**
 * Read the channel state from the store, casting the raw record to our
 * internal ChannelState shape.
 */
async function getChannel(
  store: Store.Store,
  channelId: `0x${string}`,
): Promise<ChannelState | null> {
  const raw = await store.get(channelId);
  return raw as ChannelState | null;
}

/**
 * Atomically deduct `amount` from the channel and increment units.
 *
 * Uses `store.put` (non-atomic) — the session.ts channelStoreFromStore
 * wrapper adds its own mutex, but for the SSE transport we keep it simple
 * since writes are serialised by the single `serve()` loop.
 */
async function deductFromChannel(
  store: Store.Store,
  channelId: `0x${string}`,
  amount: bigint,
  units: number,
): Promise<ChannelState> {
  const channel = await getChannel(store, channelId);
  if (!channel) throw new Error(`Channel ${channelId} not found in store`);

  const updated: ChannelState = {
    ...channel,
    spent: BigInt(channel.spent) + amount,
    units: Number(channel.units) + units,
  };

  await store.put(channelId, updated as never);
  return updated;
}

/**
 * Wait until the channel has sufficient voucher headroom, emitting a
 * need-voucher event and polling until the client tops up.
 */
async function waitForBalance(
  store: Store.Store,
  channelId: `0x${string}`,
  tickCost: bigint,
  emit: (chunk: string) => void,
  pollInterval: number,
  signal?: AbortSignal,
): Promise<ChannelState> {
  let channel = await getChannel(store, channelId);
  if (!channel) throw new Error(`Channel ${channelId} not found in store`);

  // Coerce bigints in case they were serialized as strings
  const available = BigInt(channel.highestVoucherAmount) - BigInt(channel.spent);
  if (available >= tickCost) return channel;

  // Emit a single need-voucher event
  const required = BigInt(channel.spent) + tickCost;
  emit(
    formatNeedVoucher({
      channelId,
      requiredCumulative: required.toString(),
      acceptedCumulative: BigInt(channel.highestVoucherAmount).toString(),
      deposit: BigInt(channel.deposit).toString(),
    }),
  );

  // Poll until balance is restored
  while (true) {
    if (signal?.aborted) throw new Error('Aborted while waiting for voucher');

    const wait = signal
      ? Promise.race([sleep(pollInterval), abortPromise(signal)])
      : sleep(pollInterval);

    // abortPromise rejects, sleep resolves — catch abort
    try {
      await wait;
    } catch {
      throw new Error('Aborted while waiting for voucher');
    }

    channel = await getChannel(store, channelId);
    if (!channel) throw new Error(`Channel ${channelId} not found in store`);

    const avail = BigInt(channel.highestVoucherAmount) - BigInt(channel.spent);
    if (avail >= tickCost) return channel;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Wrap an `AsyncIterable<string>` with payment metering, producing a
 * `ReadableStream<Uint8Array>` of SSE events.
 *
 * For each chunk yielded by the source iterable:
 * 1. Check if the channel has sufficient voucher headroom for one tick.
 * 2. If not, emit `event: payment-need-voucher` and poll until topped up.
 * 3. Deduct `tickCost` from the channel balance.
 * 4. Emit the chunk as `event: message`.
 * 5. When the source completes, emit `event: payment-receipt`.
 *
 * @example
 * ```ts
 * import * as Sse from 'mppx-hedera/server/sse'
 *
 * async function* generateTokens() {
 *   yield '{"content": "Hello"}'
 *   yield '{"content": " world"}'
 * }
 *
 * const stream = Sse.serve(generateTokens(), {
 *   store,
 *   channelId: '0x...',
 *   challengeId: 'challenge-123',
 *   tickCost: 1000n,
 * })
 *
 * return Sse.toResponse(stream)
 * ```
 */
export function serve(
  source: AsyncIterable<string>,
  options: SseOptions,
): ReadableStream<Uint8Array> {
  const {
    store,
    tickCost,
    channelId,
    challengeId,
    pollInterval = 1000,
    signal,
  } = options;

  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const aborted = () => signal?.aborted ?? false;
      const emit = (event: string) =>
        controller.enqueue(encoder.encode(event));

      try {
        for await (const chunk of source) {
          if (aborted()) break;

          // Ensure sufficient balance before emitting
          await waitForBalance(
            store,
            channelId,
            tickCost,
            emit,
            pollInterval,
            signal,
          );

          if (aborted()) break;

          // Deduct the tick cost
          await deductFromChannel(store, channelId, tickCost, 1);

          // Emit the data chunk
          emit(formatMessage(chunk));
        }

        // Stream complete — emit final receipt
        if (!aborted()) {
          const channel = await getChannel(store, channelId);
          if (channel) {
            const receipt: ReceiptPayload = {
              method: 'hedera',
              intent: 'session',
              status: 'success',
              timestamp: new Date().toISOString(),
              reference: channelId,
              channelId,
              acceptedCumulative: BigInt(
                channel.highestVoucherAmount,
              ).toString(),
              spent: BigInt(channel.spent).toString(),
              units: Number(channel.units),
              challengeId,
            };
            emit(formatReceipt(receipt));
          }
        }
      } catch (err) {
        if (!aborted()) controller.error(err);
      } finally {
        controller.close();
      }
    },
  });
}

/**
 * Wrap a `ReadableStream<Uint8Array>` (from {@link serve}) in an HTTP
 * `Response` with the correct SSE headers.
 *
 * Sets `Content-Type: text/event-stream`, disables caching, and requests
 * the connection be kept alive.
 */
export function toResponse(body: ReadableStream<Uint8Array>): Response {
  return new Response(body, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}

/**
 * Extract `channelId`, `challengeId`, and `tickCost` from a `Request`'s
 * `Authorization: Payment ...` header.
 *
 * This is a convenience for route handlers that receive a raw `Request`
 * and need the parameters required by {@link serve}.
 *
 * @example
 * ```ts
 * app.post('/api/stream', async (req) => {
 *   const ctx = Sse.fromRequest(req)
 *   const stream = Sse.serve(generateTokens(), {
 *     store,
 *     ...ctx,
 *   })
 *   return Sse.toResponse(stream)
 * })
 * ```
 */
export function fromRequest(request: Request): RequestContext {
  const header = request.headers.get('Authorization');
  if (!header) {
    throw new Error('Missing Authorization header');
  }

  const payment = Credential.extractPaymentScheme(header);
  if (!payment) {
    throw new Error('Missing Payment credential in Authorization header');
  }

  const credential = Credential.deserialize(payment);
  const payload = credential.payload as Record<string, unknown>;
  const challenge = credential.challenge as Record<string, unknown>;
  const challengeRequest = challenge.request as Record<string, unknown>;

  return {
    channelId: payload.channelId as `0x${string}`,
    challengeId: challenge.id as string,
    tickCost: BigInt(challengeRequest.amount as string),
  };
}

// ---------------------------------------------------------------------------
// Parsing utilities (for client-side consumption)
// ---------------------------------------------------------------------------

/** Discriminated union of parsed SSE events. */
export type SseEvent =
  | { type: 'message'; data: string }
  | { type: 'payment-need-voucher'; data: NeedVoucherPayload }
  | { type: 'payment-receipt'; data: ReceiptPayload };

/**
 * Parse a raw SSE event string into a typed event.
 *
 * Handles the three event types used by mppx-hedera streaming:
 * - `message` — application data chunk
 * - `payment-need-voucher` — balance exhausted, client should send voucher
 * - `payment-receipt` — final payment receipt
 */
export function parseEvent(raw: string): SseEvent | null {
  let eventType = 'message';
  const dataLines: string[] = [];

  for (const line of raw.split('\n')) {
    if (line.startsWith('event: ')) {
      eventType = line.slice(7).trim();
    } else if (line.startsWith('data: ')) {
      dataLines.push(line.slice(6));
    } else if (line === 'data:') {
      dataLines.push('');
    }
  }

  if (dataLines.length === 0) return null;
  const data = dataLines.join('\n');

  switch (eventType) {
    case 'message':
      return { type: 'message', data };
    case 'payment-need-voucher':
      return {
        type: 'payment-need-voucher',
        data: JSON.parse(data) as NeedVoucherPayload,
      };
    case 'payment-receipt':
      return {
        type: 'payment-receipt',
        data: JSON.parse(data) as ReceiptPayload,
      };
    default:
      return { type: 'message', data };
  }
}

/**
 * Check whether a `Response` carries an SSE event stream.
 */
export function isEventStream(response: Response): boolean {
  const ct = response.headers.get('content-type');
  return ct?.toLowerCase().startsWith('text/event-stream') ?? false;
}

/**
 * Parse an SSE `Response` body into an async iterable of typed events.
 *
 * Yields each SSE event as a parsed {@link SseEvent}. Useful on the client
 * side for consuming metered streams and reacting to payment events.
 */
export async function* iterateEvents(
  response: Response,
): AsyncGenerator<SseEvent> {
  const body = response.body;
  if (!body) return;

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Split on double-newline SSE event boundaries
      const events = buffer.split('\n\n');
      // Last element may be incomplete — keep in buffer
      buffer = events.pop() ?? '';

      for (const event of events) {
        if (!event.trim()) continue;
        const parsed = parseEvent(event);
        if (parsed) yield parsed;
      }
    }

    // Flush remaining buffer
    if (buffer.trim()) {
      const parsed = parseEvent(buffer);
      if (parsed) yield parsed;
    }
  } finally {
    reader.releaseLock();
  }
}
