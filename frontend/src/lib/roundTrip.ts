import type { Address, Hash, PublicClient } from 'viem';
import { pricesAt, readTrade, type TokenFlow, type Trade } from './trade';

export interface RoundTrip {
  buy: Trade;
  sell: Trade;
  spent: TokenFlow;
  acquired: TokenFlow;
  sold: TokenFlow;
  received: TokenFlow;
  buyValue: number;
  sellValue: number;
  loss: number;
}

/** A fully closed, two-token round trip. Reject ambiguous flows rather than guessing a payout. */
export async function readRoundTrip(
  client: PublicClient,
  buyHash: Hash,
  sellHash: Hash,
  agent: Address,
  coveredFrom: number,
): Promise<RoundTrip> {
  if (buyHash.toLowerCase() === sellHash.toLowerCase()) throw new Error('Buy and sell need different transaction hashes.');
  const [buy, sell] = await Promise.all([
    readTrade(client, buyHash, agent),
    readTrade(client, sellHash, agent),
  ]);
  if (!buy.succeeded || !sell.succeeded) throw new Error('Both transactions must succeed on-chain.');
  if (buy.from.toLowerCase() !== agent.toLowerCase() || sell.from.toLowerCase() !== agent.toLowerCase()) {
    throw new Error('Both transactions must be sent by the registered agent.');
  }
  if (sell.blockNumber < buy.blockNumber || (sell.blockNumber === buy.blockNumber && sell.transactionIndex <= buy.transactionIndex)) {
    throw new Error('The sell must happen after the buy.');
  }
  if (buy.timestamp < coveredFrom || sell.timestamp < coveredFrom) {
    throw new Error('Both transactions must happen after coverage starts.');
  }
  if (buy.flows.length !== 2 || sell.flows.length !== 2) {
    throw new Error('Only one-token-in, one-token-out swaps are supported.');
  }
  const spent = buy.flows.find((f) => f.direction === 'out');
  const acquired = buy.flows.find((f) => f.direction === 'in');
  const sold = sell.flows.find((f) => f.direction === 'out');
  const received = sell.flows.find((f) => f.direction === 'in');
  if (!spent || !acquired || !sold || !received || [spent, acquired, sold, received].some((f) => f.token === 'native')) {
    throw new Error('Both swaps must have ERC-20 tokens on each side; native ETH refunds cannot be verified here.');
  }
  if (spent.token.toLowerCase() !== received.token.toLowerCase() || acquired.token.toLowerCase() !== sold.token.toLowerCase() || spent.token.toLowerCase() === acquired.token.toLowerCase()) {
    throw new Error('The sell must return the token spent on the buy, using the same token contracts.');
  }
  if (acquired.amount !== sold.amount) throw new Error('The sell must close the full amount acquired in the buy.');
  if ([spent, acquired, sold, received].some((f) => !(Number(f.amount) > 0))) {
    throw new Error('Both swaps must transfer positive amounts.');
  }
  const [buyPrices, sellPrices] = await Promise.all([
    pricesAt(buy.timestamp, [spent.token]),
    pricesAt(sell.timestamp, [received.token]),
  ]);
  const buyPrice = buyPrices.get(spent.token);
  const sellPrice = sellPrices.get(received.token);
  if (!(buyPrice && buyPrice > 0) || !(sellPrice && sellPrice > 0) || !Number.isFinite(buyPrice) || !Number.isFinite(sellPrice)) {
    throw new Error('Historical prices are unavailable for the spent and received token; a payout cannot be calculated.');
  }
  const buyValue = Number(spent.amount) * buyPrice;
  const sellValue = Number(received.amount) * sellPrice;
  if (!Number.isFinite(buyValue) || !Number.isFinite(sellValue)) throw new Error('Transaction values cannot be calculated.');
  return { buy, sell, spent, acquired, sold, received, buyValue, sellValue, loss: Math.max(0, buyValue - sellValue) };
}
