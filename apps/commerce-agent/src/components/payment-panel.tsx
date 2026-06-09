import type { ChatEvent } from '@/lib/types';
import { PaymentCard } from './payment-card';

export function PaymentPanel({ events }: { events: ChatEvent[] }) {
  const paymentEvents = events.filter(
    (e) => e.type === 'payment' || e.type === 'session_open' || e.type === 'session_close',
  );

  const totalPaid = paymentEvents
    .filter((e) => e.type === 'payment')
    .reduce((sum, e) => sum + (e.type === 'payment' ? Number(e.amount) : 0), 0);

  return (
    <div className="w-80 border-l border-gray-200 bg-gray-50/50 p-4 flex flex-col">
      <h2 className="text-sm font-semibold text-gray-700 mb-3">Payment Activity</h2>
      <div className="flex-1 overflow-y-auto space-y-2">
        {paymentEvents.length === 0 && (
          <div className="text-xs text-gray-400 italic">No payments yet</div>
        )}
        {paymentEvents.map((event, i) => (
          <PaymentCard key={i} event={event} />
        ))}
      </div>
      {paymentEvents.length > 0 && (
        <div className="mt-3 pt-3 border-t border-gray-200 text-xs text-gray-500">
          Total: {totalPaid} base units USDC | Txs: {paymentEvents.filter((e) => e.type === 'payment').length}
        </div>
      )}
    </div>
  );
}
