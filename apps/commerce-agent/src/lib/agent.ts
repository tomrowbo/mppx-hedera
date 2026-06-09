import { Client, AccountId, PrivateKey } from '@hiero-ledger/sdk';
import { HederaAgentAPI, ToolDiscovery, type Context } from '@hashgraph/hedera-agent-kit';
import { mppxHederaPlugin } from 'hak-mppx-hedera-plugin';

const ACCOUNT_ID = process.env.HEDERA_ACCOUNT_ID!;
const PRIVATE_KEY = process.env.HEDERA_PRIVATE_KEY!;
const NETWORK = process.env.HEDERA_NETWORK ?? 'testnet';

let agent: HederaAgentAPI | null = null;

export function getAgent(): HederaAgentAPI {
  if (agent) return agent;

  const client = NETWORK === 'testnet' ? Client.forTestnet() : Client.forMainnet();
  client.setOperator(
    AccountId.fromString(ACCOUNT_ID),
    PrivateKey.fromStringECDSA(PRIVATE_KEY),
  );

  const context: Context & { network: string; privateKey: string } = {
    network: NETWORK,
    privateKey: PRIVATE_KEY.startsWith('0x') ? PRIVATE_KEY : `0x${PRIVATE_KEY}`,
  };

  const discovery = new ToolDiscovery([mppxHederaPlugin]);
  const tools = discovery.getAllTools(context as Context);

  agent = new HederaAgentAPI(client, context as Context, tools);
  return agent;
}
