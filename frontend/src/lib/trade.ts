import { erc20Abi, formatUnits, parseEventLogs, type Address, type Hash, type PublicClient } from 'viem';
import { CHAIN } from './chain';

export interface TokenFlow {
  direction: 'out' | 'in';
  token: Address | 'native';
  symbol: string;
  amount: string;
}

export interface Trade {
  from: Address;
  to: Address | null;
  succeeded: boolean;
  timestamp: number; // ms
  blockNumber: bigint;
  transactionIndex: number;
  flows: TokenFlow[];
}

/**
 * Reads what moved in and out of the agent's wallet: ETH sent with the transaction plus ERC-20 Transfer events.
 * ETH paid back by a contract (an internal transfer) leaves no event, so it isn't included.
 */
export async function readTrade(client: PublicClient, hash: Hash, agent: Address): Promise<Trade> {
  const [tx, receipt] = await Promise.all([client.getTransaction({ hash }), client.getTransactionReceipt({ hash })]);
  const block = await client.getBlock({ blockNumber: receipt.blockNumber });
  const wallet = agent.toLowerCase();

  const totals = new Map<string, { direction: 'out' | 'in'; token: Address | 'native'; raw: bigint }>();
  const add = (direction: 'out' | 'in', token: Address | 'native', raw: bigint) => {
    const key = `${direction}:${token.toLowerCase()}`;
    const t = totals.get(key) ?? { direction, token, raw: 0n };
    t.raw += raw;
    totals.set(key, t);
  };

  if (tx.value > 0n && tx.from.toLowerCase() === wallet) add('out', 'native', tx.value);
  if (receipt.status === 'success') {
    for (const log of parseEventLogs({ abi: erc20Abi, eventName: 'Transfer', logs: receipt.logs })) {
      const from = log.args.from.toLowerCase();
      const to = log.args.to.toLowerCase();
      if (from === to) continue;
      if (from === wallet) add('out', log.address, log.args.value);
      if (to === wallet) add('in', log.address, log.args.value);
    }
  }

  const tokens = [...new Set([...totals.values()].flatMap((t) => (t.token === 'native' ? [] : [t.token])))];
  const meta = await client.multicall({
    allowFailure: true,
    contracts: tokens.flatMap((address) => [
      { address, abi: erc20Abi, functionName: 'symbol' } as const,
      { address, abi: erc20Abi, functionName: 'decimals' } as const,
    ]),
  });
  const info = new Map<string, { symbol: string; decimals: number }>();
  tokens.forEach((address, i) => {
    const symbol = meta[i * 2];
    const decimals = meta[i * 2 + 1];
    info.set(address.toLowerCase(), {
      symbol: symbol.status === 'success' ? String(symbol.result) : `${address.slice(0, 8)}…`,
      decimals: decimals.status === 'success' ? Number(decimals.result) : 18,
    });
  });

  const flows = [...totals.values()].map((t): TokenFlow => {
    const { symbol, decimals } =
      t.token === 'native' ? { symbol: CHAIN.nativeCurrency.symbol, decimals: CHAIN.nativeCurrency.decimals } : info.get(t.token.toLowerCase())!;
    return { direction: t.direction, token: t.token, symbol, amount: formatUnits(t.raw, decimals) };
  });

  return { from: tx.from, to: tx.to, succeeded: receipt.status === 'success', timestamp: Number(block.timestamp) * 1000, blockNumber: receipt.blockNumber, transactionIndex: receipt.transactionIndex, flows };
}

// Testnet tokens have no market, so price them as their Base mainnet counterparts.
const TESTNET_PRICE_IDS: Record<string, string> = {
  '0x036cbd53842c5426634e7929541ec2318f3dcf7e': 'base:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // USDC
  '0x4200000000000000000000000000000000000006': 'base:0x4200000000000000000000000000000000000006', // WETH
};

function priceId(token: Address | 'native'): string | undefined {
  if (token === 'native') return 'coingecko:ethereum';
  return CHAIN.testnet ? TESTNET_PRICE_IDS[token.toLowerCase()] : `base:${token}`;
}

export const PRICE_SOURCE = 'DefiLlama';

/** USD price of each token at the given time, from DefiLlama's free API. Tokens without a price are left out. */
export async function pricesAt(timestamp: number, tokens: (Address | 'native')[]): Promise<Map<Address | 'native', number>> {
  const ids = new Map<string, Address | 'native'>();
  for (const token of tokens) {
    const id = priceId(token);
    if (id) ids.set(id, token);
  }
  const prices = new Map<Address | 'native', number>();
  if (ids.size === 0) return prices;

  const seconds = Math.floor(timestamp / 1000);
  const res = await fetch(`https://coins.llama.fi/prices/historical/${seconds}/${[...ids.keys()].join(',')}?searchWidth=1h`);
  if (!res.ok) throw new Error(`Price lookup failed (${res.status}).`);
  const body = (await res.json()) as { coins?: Record<string, { price?: number }> };
  for (const [id, coin] of Object.entries(body.coins ?? {})) {
    const token = ids.get(id);
    if (token && typeof coin.price === 'number') prices.set(token, coin.price);
  }
  return prices;
}
