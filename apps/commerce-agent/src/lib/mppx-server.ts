import { Mppx } from 'mppx/server';
import { hedera } from 'mppx-hedera/server';

let _chargeRoute: any = null;

export function getChargeRoute() {
  if (_chargeRoute) return _chargeRoute;

  const OPERATOR_ID = process.env.HEDERA_ACCOUNT_ID!;
  const SECRET_KEY = process.env.HEDERA_PRIVATE_KEY!;
  const NETWORK = process.env.HEDERA_NETWORK ?? 'testnet';

  const chargeHandler = hedera.charge({
    serverId: 'commerce-agent.hedera.demo',
    recipient: '0.0.8600318',
    testnet: NETWORK === 'testnet',
    maxRetries: 15,
    retryDelay: 2000,
  });

  const mppx = Mppx.create({
    methods: [chargeHandler],
    realm: 'commerce-agent.hedera.demo',
    secretKey: SECRET_KEY,
  });

  _chargeRoute = mppx.charge({
    amount: '0.000001',
    currency: NETWORK === 'testnet' ? '0.0.5449' : '0.0.456858',
    decimals: 6,
    recipient: '0.0.8600318',
  });

  return _chargeRoute;
}
