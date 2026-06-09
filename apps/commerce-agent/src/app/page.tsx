'use client';

import { useState } from 'react';
import { ChatPanel } from '@/components/chat-panel';
import { PaymentPanel } from '@/components/payment-panel';
import { MessageInput } from '@/components/message-input';
import type { ChatEvent } from '@/lib/types';

export default function Home() {
  const [events, setEvents] = useState<ChatEvent[]>([]);
  const [loading, setLoading] = useState(false);

  const handleSend = async (message: string) => {
    setEvents((prev) => [...prev, { type: 'thinking', text: `You: ${message}` }]);
    setLoading(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      });
      const data = await res.json();
      setEvents((prev) => [...prev, ...data.events]);
    } catch (err) {
      setEvents((prev) => [...prev, { type: 'answer', text: 'Error: Failed to get response from agent.' }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-screen">
      <header className="border-b border-gray-200 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-hedera flex items-center justify-center text-white text-sm font-bold">H</div>
          <span className="font-semibold">Hedera Commerce Agent</span>
        </div>
        <span className="text-xs text-gray-400">MPP payments on Hedera</span>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <ChatPanel events={events} />
        <PaymentPanel events={events} />
      </div>

      <MessageInput onSend={handleSend} disabled={loading} />
    </div>
  );
}
