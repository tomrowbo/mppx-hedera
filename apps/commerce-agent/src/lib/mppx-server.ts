import { Mppx } from 'mppx/server';
import { hedera } from 'mppx-hedera/server';

const OPERATOR_ID = process.env.HEDERA_ACCOUNT_ID!;
const SECRET_KEY = process.env.HEDERA_PRIVATE_KEY!;
const NETWORK = process.env.HEDERA_NETWORK ?? 'testnet';

const chargeHandler = hedera.charge({
  serverId: 'commerce-agent.hedera.demo',
  recipient: OPERATOR_ID,
  testnet: NETWORK === 'testnet',
  maxRetries: 15,
  retryDelay: 2000,
});

const mppx = Mppx.create({
  methods: [chargeHandler],
  realm: 'commerce-agent.hedera.demo',
  secretKey: SECRET_KEY,
});

export const chargeRoute = mppx.charge({
  amount: '1',
  currency: NETWORK === 'testnet' ? '0.0.5449' : '0.0.456858',
  decimals: 6,
  recipient: OPERATOR_ID,
});
