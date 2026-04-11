/**
 * mppx-hedera demo — chat client
 *
 * Sends user messages to /api/chat, renders agent responses + payment activity.
 * Phoebe can style index.html and adjust rendering; this file handles the logic.
 */

const form = document.getElementById('chat-form') as HTMLFormElement
const input = document.getElementById('chat-input') as HTMLInputElement
const messages = document.getElementById('messages')!
const payments = document.getElementById('payments')!

form.addEventListener('submit', async (e) => {
  e.preventDefault()
  const message = input.value.trim()
  if (!message) return

  // Show user message
  addMessage('user', message)
  input.value = ''
  input.disabled = true

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message }),
    })
    const { events } = await res.json()
    await renderEvents(events)
  } catch (err) {
    addMessage('error', `Error: ${err}`)
  } finally {
    input.disabled = false
    input.focus()
  }
})

function addMessage(role: string, text: string) {
  const div = document.createElement('div')
  div.className = `message ${role}`
  div.textContent = role === 'user' ? `You: ${text}` : text
  messages.appendChild(div)
  messages.scrollTop = messages.scrollHeight
}

function addPaymentCard(html: string) {
  const div = document.createElement('div')
  div.className = 'payment-card'
  div.innerHTML = html
  payments.appendChild(div)
  payments.scrollTop = payments.scrollHeight
}

async function renderEvents(events: any[]) {
  for (const event of events) {
    switch (event.type) {
      case 'thinking':
        addMessage('agent', `🤖 ${event.text}`)
        break

      case 'payment':
        addMessage('agent', `💰 Paid ${event.amount} ${event.currency} via mppx-hedera`)
        addPaymentCard(`
          <div class="card-status confirmed">✅ Confirmed</div>
          <div class="card-amount">${event.amount} ${event.currency}</div>
          <div class="card-method">Method: hedera (charge)</div>
        `)
        break

      case 'session_open':
        addMessage('agent', `📡 Session opened — deposit: ${event.deposit} ${event.currency}`)
        addPaymentCard(`
          <div class="card-status open">📡 Channel Opened</div>
          <div class="card-amount">Deposit: ${event.deposit} ${event.currency}</div>
          ${event.hashscanUrl ? `<a href="${event.hashscanUrl}" target="_blank" class="card-link">Hashscan ↗</a>` : ''}
        `)
        break

      case 'voucher':
        // Stagger voucher rendering for visual effect (50ms per city)
        await new Promise(r => setTimeout(r, 50))
        addMessage('agent', `📊 ${event.city}: ${event.temp} ✓ voucher #${event.voucher} (${event.cumulative} cum.) ${event.latency}`)
        addPaymentCard(`
          <div class="card-voucher">
            <span class="voucher-city">${event.city}</span>
            <span class="voucher-num">#${event.voucher}</span>
            <span class="voucher-time">${event.latency}</span>
          </div>
        `)
        break

      case 'session_close':
        addMessage('agent', `🔒 Session settled — ${event.totalQueries} queries, ${event.onChainTxs} on-chain txs`)
        addPaymentCard(`
          <div class="card-status settled">🔒 Settled</div>
          <div class="card-stats">
            ${event.totalQueries} queries · ${event.onChainTxs} on-chain txs · ${event.offChainVouchers} vouchers
          </div>
          <div class="card-amount">Total: ${event.totalPaid} ${event.currency}</div>
          ${event.hashscanUrl ? `<a href="${event.hashscanUrl}" target="_blank" class="card-link">Hashscan ↗</a>` : ''}
        `)
        break

      case 'data':
        addMessage('agent', `📊 ${event.text}`)
        break

      case 'answer':
        addMessage('agent', `🤖 ${event.text}`)
        break
    }
  }
}
