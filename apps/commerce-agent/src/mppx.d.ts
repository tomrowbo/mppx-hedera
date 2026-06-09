declare module 'mppx/server' {
  export class Mppx {
    static create(options: { methods: any[]; realm: string; secretKey: string }): any;
  }
}

declare module 'mppx-hedera/server' {
  export const hedera: {
    charge(options: {
      serverId: string;
      recipient: string;
      testnet?: boolean;
      maxRetries?: number;
      retryDelay?: number;
    }): any;
  };
}
