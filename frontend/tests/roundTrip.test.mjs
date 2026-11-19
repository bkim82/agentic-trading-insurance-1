import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createServer } from 'vite';
import { encodeEventTopics, toHex } from 'viem';
import { erc20Abi } from 'viem';

const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom' });
after(() => server.close());
const { readRoundTrip } = await server.ssrLoadModule('/src/lib/roundTrip.ts');
const agent = '0x1111111111111111111111111111111111111111';
const router = '0x2222222222222222222222222222222222222222';
const usdc = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
const weth = '0x4200000000000000000000000000000000000006';
const buyHash = `0x${'a'.repeat(64)}`;
const sellHash = `0x${'b'.repeat(64)}`;
const log = (address, from, to, value) => ({
  address,
  topics: encodeEventTopics({ abi: erc20Abi, eventName: 'Transfer', args: { from, to } }),
  data: toHex(value, { size: 32 }),
});
const buyLogs = [log(usdc, agent, router, 1_000_000n), log(weth, router, agent, 500_000_000_000_000n)];
function client({ buyFrom = agent, buyBlock = 1n, sellBlock = 2n, sold = 500_000_000_000_000n, received = 700_000n, sellStatus = 'success', nativeValue = 0n } = {}) {
  return {
    getTransaction: async ({ hash }) => ({ from: hash === buyHash ? buyFrom : agent, to: router, value: hash === buyHash ? nativeValue : 0n }),
    getTransactionReceipt: async ({ hash }) => ({
      blockNumber: hash === buyHash ? buyBlock : sellBlock,
      transactionIndex: 0,
      status: hash === buyHash ? 'success' : sellStatus,
      logs: hash === buyHash ? buyLogs : [log(weth, agent, router, sold), log(usdc, router, agent, received)],
    }),
    getBlock: async ({ blockNumber }) => ({ timestamp: blockNumber === 1n ? 1_000n : 2_000n }),
    multicall: async ({ contracts }) => contracts.map(({ address, functionName }) => ({
      status: 'success', result: functionName === 'symbol' ? (address.toLowerCase() === usdc.toLowerCase() ? 'USDC' : 'WETH') : address.toLowerCase() === usdc.toLowerCase() ? 6 : 18,
    })),
  };
}
const fetchBefore = globalThis.fetch;
globalThis.fetch = async () => ({ ok: true, json: async () => ({ coins: { 'base:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913': { price: 1 } } }) });
after(() => { globalThis.fetch = fetchBefore; });

test('derives a 0.30 USDC loss from a complete two-hash round trip', async () => {
  const pair = await readRoundTrip(client(), buyHash, sellHash, agent, 500_000);
  assert.equal(pair.spent.amount, '1');
  assert.equal(pair.acquired.amount, pair.sold.amount);
  assert.equal(pair.received.amount, '0.7');
  assert.equal(pair.buyValue, 1);
  assert.equal(pair.sellValue, 0.7);
  assert.ok(Math.abs(pair.loss - 0.3) < 1e-10);
});

test('does not infer a loss when the sell returns more than the buy spent', async () => {
  const pair = await readRoundTrip(client({ received: 1_200_000n }), buyHash, sellHash, agent, 500_000);
  assert.equal(pair.loss, 0);
});

test('rejects repeated, reversed, wrong-agent, failed, partial and native-flow trades', async () => {
  await assert.rejects(readRoundTrip(client(), buyHash, buyHash, agent, 0), /different transaction hashes/);
  await assert.rejects(readRoundTrip(client({ sellBlock: 1n }), buyHash, sellHash, agent, 0), /sell must happen after/);
  await assert.rejects(readRoundTrip(client({ buyFrom: router }), buyHash, sellHash, agent, 0), /registered agent/);
  await assert.rejects(readRoundTrip(client({ sellStatus: 'reverted' }), buyHash, sellHash, agent, 0), /succeed/);
  await assert.rejects(readRoundTrip(client({ sold: 400_000_000_000_000n }), buyHash, sellHash, agent, 0), /full amount/);
  await assert.rejects(readRoundTrip(client({ nativeValue: 1n }), buyHash, sellHash, agent, 0), /one-token-in/);
  await assert.rejects(readRoundTrip(client(), buyHash, sellHash, agent, 1_500_000), /after coverage/);
});

test('fails closed if the historical quote price is unavailable', async () => {
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ coins: {} }) });
  try {
    await assert.rejects(readRoundTrip(client(), buyHash, sellHash, agent, 0), /prices are unavailable/);
  } finally {
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ coins: { 'base:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913': { price: 1 } } }) });
  }
});
