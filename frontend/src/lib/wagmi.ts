import { createConfig, http } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { CHAIN, RPC_URL } from './chain';

// Browser wallet only (Coinbase Wallet extension, MetaMask, etc.).
export const wagmiConfig = createConfig({
  chains: [CHAIN],
  connectors: [injected()],
  transports: { [CHAIN.id]: http(RPC_URL) },
});

declare module 'wagmi' {
  interface Register {
    config: typeof wagmiConfig;
  }
}
