'use client';

import { useState } from 'react';

export function MessageInput({ onSend, disabled }: { onSend: (message: string) => void; disabled: boolean }) {
  const [input, setInput] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || disabled) return;
    onSend(input.trim());
    setInput('');
  };

  return (
    <form onSubmit={handleSubmit} className="border-t border-gray-200 p-4 flex gap-3">
      <input
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Ask something..."
        disabled={disabled}
        className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm focus:outline-none focus:border-hedera disabled:opacity-50"
      />
      <button
        type="submit"
        disabled={disabled || !input.trim()}
        className="rounded-lg bg-hedera px-6 py-2 text-sm font-semibold text-white hover:bg-hedera-dark disabled:opacity-50 transition-colors"
      >
        Send
      </button>
    </form>
  );
}
