export type ChatEvent =
  | { type: 'thinking'; text: string }
  | { type: 'payment'; method: string; amount: string; currency: string; txHash?: string; hashscanUrl?: string }
  | { type: 'session_open'; deposit: string; txHash?: string; hashscanUrl?: string }
  | { type: 'session_close'; txHash?: string; totalQueries: number; onChainTxs: number; totalPaid: string }
  | { type: 'data'; text: string }
  | { type: 'answer'; text: string };

export type ChatRequest = {
  message: string;
};

export type ChatResponse = {
  events: ChatEvent[];
};
