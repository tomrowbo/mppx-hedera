import type { ChatEvent } from '@/lib/types';

export function PaymentCard({ event }: { event: ChatEvent }) {
  if (event.type === 'payment') {
    return (
      <div className="rounded-lg border border-hedera/20 bg-hedera/5 p-3 mb-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-hedera">
          <span>402 Paid</span>
        </div>
        <div className="mt-1 font-mono text-sm">
          {event.amount} {event.currency}
        </div>
        {event.hashscanUrl && (
          <a href={event.hashscanUrl} target="_blank" rel="noopener noreferrer"
             className="text-xs text-hedera hover:underline mt-1 inline-block">
            View on Hashscan
          </a>
        )}
      </div>
    );
  }

  if (event.type === 'session_open') {
    return (
      <div className="rounded-lg border border-yellow-300 bg-yellow-50 p-3 mb-2">
        <div className="text-sm font-semibold text-yellow-700">Channel Opened</div>
        <div className="mt-1 font-mono text-sm">Deposit: {event.deposit} USDC</div>
        {event.hashscanUrl && (
          <a href={event.hashscanUrl} target="_blank" rel="noopener noreferrer"
             className="text-xs text-yellow-700 hover:underline mt-1 inline-block">
            View on Hashscan
          </a>
        )}
      </div>
    );
  }

  if (event.type === 'session_close') {
    return (
      <div className="rounded-lg border border-green-300 bg-green-50 p-3 mb-2">
        <div className="text-sm font-semibold text-green-700">Channel Settled</div>
        <div className="mt-1 font-mono text-xs space-y-0.5">
          <div>Queries: {event.totalQueries}</div>
          <div>On-chain txs: {event.onChainTxs}</div>
          <div>Total paid: {event.totalPaid} USDC</div>
        </div>
      </div>
    );
  }

  return null;
}
