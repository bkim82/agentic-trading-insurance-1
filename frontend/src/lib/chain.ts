import { baseSepolia } from 'viem/chains';

export { POOL_ADDRESS, USDC_ADDRESS } from './addresses';

export const CHAIN = baseSepolia;
export const USDC_DECIMALS = 6;
export const RPC_URL = import.meta.env.VITE_RPC_URL ?? 'https://sepolia.base.org';
export const EXPLORER = 'https://sepolia.basescan.org';
