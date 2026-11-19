import { baseSepolia } from 'viem/chains';

// Deployment details: see deployments/base-sepolia.json at the repo root.
export const CHAIN = baseSepolia;
export const POOL_ADDRESS = '0xCB690ec336F47CEeb9d7dDFca7D6ca07cf6edC77' as const;
export const USDC_ADDRESS = '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as const;
export const USDC_DECIMALS = 6;
export const RPC_URL = import.meta.env.VITE_RPC_URL ?? 'https://sepolia.base.org';
export const EXPLORER = 'https://sepolia.basescan.org';
