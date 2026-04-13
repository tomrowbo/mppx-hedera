import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    'index': 'src/index.ts',
    'client/index': 'src/client/index.ts',
    'server/index': 'src/server/index.ts',
  },
  format: ['esm'],
  dts: false,  // skip type declarations for hackathon speed
  clean: true,
  sourcemap: true,
  external: ['mppx', 'viem', 'zod', '@hashgraph/sdk'],
})
