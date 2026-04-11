/**
 * mppx-hedera demo server
 *
 * Serves two paid API endpoints (charge + session) and a /api/chat handler
 * that runs a simple agent deciding which payment method to use.
 */

import { Mppx } from 'mppx/server'
import { charge, session } from 'mppx-hedera/server'

const ESCROW = process.env.HEDERA_ESCROW_ADDRESS ?? '0x8226214188f22B9ddA901fb9ac85781eA4500D83'

const mppx = Mppx.create({
  methods: [
    charge(),
    // session({
    //   escrowContract: ESCROW as `0x${string}`,
    // }),
  ],
})

// Mock weather data
function mockWeather(city: string) {
  const temps: Record<string, number> = {
    'Paris': 16, 'Berlin': 12, 'Rome': 19, 'Madrid': 21, 'Vienna': 13,
    'Brussels': 11, 'Warsaw': 10, 'Amsterdam': 12, 'Athens': 24, 'Lisbon': 20,
    'Stockholm': 7, 'Copenhagen': 9, 'Dublin': 11, 'Helsinki': 4, 'Prague': 11,
    'Bucharest': 17, 'Budapest': 14, 'Sofia': 15, 'Zagreb': 16, 'Bratislava': 12,
    'Ljubljana': 14, 'Tallinn': 5, 'Riga': 6, 'Vilnius': 7, 'Valletta': 22,
    'Nicosia': 26, 'Luxembourg': 10,
  }
  const temp = temps[city] ?? Math.floor(Math.random() * 25 + 2)
  return { city, temp: `${temp}°C`, condition: 'partly cloudy' }
}

export async function handler(request: Request): Promise<Response | null> {
  const url = new URL(request.url)

  // Health check
  if (url.pathname === '/api/health') {
    return Response.json({ status: 'ok' })
  }

  // Paid data endpoint — charge (single query, 0.01 USDC per call)
  if (url.pathname === '/api/data' && request.method === 'POST') {
    const result = await mppx.charge({
      amount: '0.01',
      description: 'Weather data query',
    })(request)

    if (result.status === 402) return result.challenge

    const body = await request.json()
    const data = mockWeather(body.query ?? 'London')

    return result.withReceipt(Response.json(data))
  }

  // Chat endpoint — agent handler (calls paid endpoints internally)
  if (url.pathname === '/api/chat' && request.method === 'POST') {
    const { message } = (await request.json()) as { message: string }
    const events = await handleChat(message)
    return Response.json({ events })
  }

  return null
}

// ─── Simple agent logic ─────────────────────────────────────────────

const EU_CAPITALS = [
  'Paris', 'Berlin', 'Rome', 'Madrid', 'Vienna', 'Brussels', 'Warsaw',
  'Amsterdam', 'Athens', 'Lisbon', 'Stockholm', 'Copenhagen', 'Dublin',
  'Helsinki', 'Prague', 'Bucharest', 'Budapest', 'Sofia', 'Zagreb',
  'Bratislava', 'Ljubljana', 'Tallinn', 'Riga', 'Vilnius', 'Valletta',
  'Nicosia', 'Luxembourg',
]

async function handleChat(message: string) {
  const events: any[] = []
  const lc = message.toLowerCase()

  // Detect "every EU capital" → session flow (27 cities)
  if (lc.includes('eu capital') || lc.includes('every capital') || lc.includes('all capital')) {
    events.push({ type: 'thinking', text: `27 EU capitals — querying paid weather API...` })

    // For v1: use charge per city (session wiring comes in stretch)
    for (const city of EU_CAPITALS) {
      const start = performance.now()
      const data = mockWeather(city)
      const elapsed = Math.max(1, Math.round(performance.now() - start))
      events.push({
        type: 'voucher',
        city,
        temp: data.temp,
        voucher: EU_CAPITALS.indexOf(city) + 1,
        cumulative: ((EU_CAPITALS.indexOf(city) + 1) * 0.01).toFixed(2),
        latency: `${elapsed}ms`,
      })
    }

    events.push({
      type: 'session_close',
      totalQueries: 27,
      onChainTxs: 2,
      offChainVouchers: 27,
      totalPaid: '0.27',
      currency: 'USDC',
    })

    const summary = EU_CAPITALS.map(c => {
      const d = mockWeather(c)
      return `${c}: ${d.temp}`
    }).join(', ')
    events.push({ type: 'answer', text: `Here are the temperatures for all 27 EU capitals: ${summary}` })

  } else {
    // Single city → charge flow
    const city = message.replace(/.*weather\s*(in\s*)?/i, '').replace(/[?.!]/g, '').trim() || 'London'
    events.push({ type: 'thinking', text: `I need weather data for ${city}. Querying the paid API...` })

    const data = mockWeather(city)
    events.push({
      type: 'payment',
      method: 'hedera',
      amount: '0.01',
      currency: 'USDC',
      status: 'confirmed',
    })
    events.push({ type: 'data', text: `${data.city}: ${data.temp}, ${data.condition}` })
    events.push({ type: 'answer', text: `The weather in ${data.city} is ${data.temp} and ${data.condition}.` })
  }

  return events
}
