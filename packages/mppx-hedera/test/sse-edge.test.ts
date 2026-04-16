import { describe, it, expect } from 'vitest';
import { Credential, Store } from 'mppx';

// Import from source (vitest .ts tests resolve TS directly)
import * as Sse from '../src/server/sse.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CHANNEL_ID =
  '0x0000000000000000000000000000000000000000000000000000000000000001' as const;

/**
 * Build a minimal valid Authorization header carrying a Payment credential.
 * The credential embeds channelId, challengeId, and amount inside the
 * challenge.request so that Sse.fromRequest can extract them.
 */
function buildPaymentHeader(opts: {
  channelId?: string;
  challengeId?: string;
  amount?: string;
} = {}): string {
  const credential = {
    challenge: {
      id: opts.challengeId ?? 'test-challenge-1',
      realm: 'test.example.com',
      method: 'hedera',
      intent: 'session',
      request: {
        amount: opts.amount ?? '1000',
        currency: '0x0000000000000000000000000000000000001549',
        unitType: 'request',
      },
    },
    payload: {
      action: 'voucher',
      channelId:
        opts.channelId ??
        '0x0000000000000000000000000000000000000000000000000000000000000001',
      cumulativeAmount: '2000',
      signature: '0xdeadbeef',
    },
  };
  return Credential.serialize(credential);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SSE fromRequest()', () => {
  it('throws on missing Authorization header', () => {
    const request = new Request('http://localhost/test');
    expect(() => Sse.fromRequest(request)).toThrow(/Authorization/i);
  });

  it('throws on missing Payment scheme', () => {
    const request = new Request('http://localhost/test', {
      headers: { Authorization: 'Bearer some-token' },
    });
    expect(() => Sse.fromRequest(request)).toThrow(/Payment/i);
  });

  it('correctly parses valid Authorization header', () => {
    const header = buildPaymentHeader({
      channelId:
        '0x00000000000000000000000000000000000000000000000000000000000000ab',
      challengeId: 'my-challenge',
      amount: '5000',
    });
    const request = new Request('http://localhost/test', {
      headers: { Authorization: header },
    });

    const ctx = Sse.fromRequest(request);
    expect(ctx.channelId).toBe(
      '0x00000000000000000000000000000000000000000000000000000000000000ab',
    );
    expect(ctx.challengeId).toBe('my-challenge');
    expect(ctx.tickCost).toBe(5000n);
  });
});

describe('SSE isEventStream()', () => {
  it('returns true for text/event-stream', () => {
    const response = new Response(null, {
      headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
    });
    expect(Sse.isEventStream(response)).toBe(true);
  });

  it('returns false for application/json', () => {
    const response = new Response(null, {
      headers: { 'Content-Type': 'application/json' },
    });
    expect(Sse.isEventStream(response)).toBe(false);
  });
});

describe('SSE iterateEvents()', () => {
  it('yields events from a ReadableStream response', async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode('event: message\ndata: hello\n\n'),
        );
        controller.enqueue(
          encoder.encode('event: message\ndata: world\n\n'),
        );
        controller.close();
      },
    });

    const response = new Response(body, {
      headers: { 'Content-Type': 'text/event-stream' },
    });

    const events: Sse.SseEvent[] = [];
    for await (const event of Sse.iterateEvents(response)) {
      events.push(event);
    }

    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ type: 'message', data: 'hello' });
    expect(events[1]).toEqual({ type: 'message', data: 'world' });
  });

  it('handles empty body (returns without yielding)', async () => {
    // Response with null body
    const response = new Response(null);

    const events: Sse.SseEvent[] = [];
    for await (const event of Sse.iterateEvents(response)) {
      events.push(event);
    }

    expect(events).toHaveLength(0);
  });
});

describe('SSE deductFromChannel (via serve)', () => {
  it('throws when channel not found in store', async () => {
    const store = Store.memory();
    // Do NOT seed the channel -- store is empty

    const source = (async function* () {
      yield 'chunk';
    })();

    const stream = Sse.serve(source, {
      store,
      tickCost: 1000n,
      channelId: CHANNEL_ID,
      challengeId: 'test-challenge',
    });

    // Reading the stream should surface the "not found" error
    const reader = stream.getReader();
    await expect(async () => {
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }
    }).rejects.toThrow(/not found/);
  });
});
