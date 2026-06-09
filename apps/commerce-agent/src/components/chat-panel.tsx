import type { ChatEvent } from '@/lib/types';

export function ChatPanel({ events }: { events: ChatEvent[] }) {
  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-4">
      {events.map((event, i) => {
        if (event.type === 'thinking') {
          return (
            <div key={i} className="text-sm text-gray-500 italic">
              {event.text}
            </div>
          );
        }
        if (event.type === 'data') {
          return (
            <div key={i} className="bg-gray-50 rounded-lg p-3 font-mono text-sm">
              {event.text}
            </div>
          );
        }
        if (event.type === 'answer') {
          return (
            <div key={i} className="bg-hedera/5 rounded-lg p-4 border border-hedera/10">
              <div className="text-xs text-hedera font-semibold mb-1">Agent</div>
              <div className="text-sm leading-relaxed whitespace-pre-wrap">{event.text}</div>
            </div>
          );
        }
        if (event.type === 'payment') {
          return (
            <div key={i} className="text-xs text-hedera">
              Paid {event.amount} {event.currency} via MPP
            </div>
          );
        }
        return null;
      })}
    </div>
  );
}
