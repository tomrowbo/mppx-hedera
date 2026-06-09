import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  serverExternalPackages: [
    '@hiero-ledger/sdk',
    'mppx',
    'mppx-hedera',
    'hak-mppx-hedera-plugin',
  ],
};

export default nextConfig;
