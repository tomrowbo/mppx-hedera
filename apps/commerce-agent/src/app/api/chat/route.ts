import { anthropic } from '@ai-sdk/anthropic';
import { generateText, tool, jsonSchema } from 'ai';
import { getAgent } from '@/lib/agent';
import type { ChatEvent, ChatResponse } from '@/lib/types';

export async function POST(request: Request) {
  const { message } = await request.json();
  const agent = getAgent();
  const events: ChatEvent[] = [];
  const serviceUrl = new URL('/api/service', request.url).toString();

  const systemPrompt = `You are a Hedera commerce agent. You help users get data from paid APIs.

When a user asks for weather data, crypto prices, or any information that requires a paid API:
1. Use the mppx_hedera_charge_fetch tool to pay for and fetch the data
2. The paid service URL is: ${serviceUrl}
3. Always use maxAmount "100000" (0.10 USDC) as the budget

Respond naturally with the data you receive. Mention that you paid for it using USDC on Hedera.`;

  const { text } = await generateText({
    model: anthropic('claude-sonnet-4-20250514'),
    system: systemPrompt,
    prompt: message,
    tools: {
      mppx_hedera_charge_fetch: tool({
        description: 'Call a 402-protected API and auto-pay with USDC on Hedera',
        parameters: jsonSchema<{ url: string; method?: string; maxAmount?: string }>({
          type: 'object',
          properties: {
            url: { type: 'string', description: 'The URL of the 402-protected API' },
            method: { type: 'string', enum: ['GET', 'POST'], description: 'HTTP method' },
            maxAmount: { type: 'string', description: 'Max USDC in base units' },
          },
          required: ['url'],
        }),
        execute: async (params) => {
          events.push({ type: 'thinking', text: 'Paying for API access via MPP on Hedera...' });

          const result = await agent.run('mppx_hedera_charge_fetch_tool', {
            url: params.url || serviceUrl,
            method: params.method || 'GET',
            maxAmount: params.maxAmount || '100000',
          });

          const parsed = JSON.parse(result);

          if (parsed.raw?.payment) {
            const network = process.env.HEDERA_NETWORK ?? 'testnet';
            events.push({
              type: 'payment',
              method: 'hedera',
              amount: parsed.raw.payment.amount,
              currency: 'USDC',
              txHash: parsed.raw.payment.txHash,
              hashscanUrl: parsed.raw.payment.txHash
                ? `https://hashscan.io/${network}/transaction/${parsed.raw.payment.txHash}`
                : undefined,
            });
          }

          if (parsed.raw?.data) {
            events.push({ type: 'data', text: typeof parsed.raw.data === 'string' ? parsed.raw.data : JSON.stringify(parsed.raw.data) });
          }

          return parsed.raw?.data ?? parsed.humanMessage;
        },
      }),
    },
    maxSteps: 3,
  });

  events.push({ type: 'answer', text });

  return Response.json({ events } satisfies ChatResponse);
}
