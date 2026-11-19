/**
 * Server-only CDP calls behind /api/members and /api/faucet. Used by the Vite dev/preview
 * server (vite.config.ts) and by the Vercel functions in /api, so the CDP API key never
 * reaches the browser.
 */
import { isAddress } from 'viem';
import { POOL_ADDRESS } from '../src/lib/addresses.js';

export interface CdpEnv {
  CDP_API_KEY_ID?: string;
  CDP_API_KEY_SECRET?: string;
}

export interface ApiResult {
  status: number;
  body: unknown;
}

const MISSING_KEY: ApiResult = {
  status: 500,
  body: { error: 'CDP API key is not configured. Set CDP_API_KEY_ID and CDP_API_KEY_SECRET.' },
};

const hasKey = (env: CdpEnv): env is Required<CdpEnv> => !!env.CDP_API_KEY_ID && !!env.CDP_API_KEY_SECRET;
const message = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback).slice(0, 300);

/**
 * Every Joined event of the pool, via the CDP SQL API (base_sepolia.events). The public RPC
 * caps eth_getLogs at 200 blocks, which is too small to scan the pool's history from the browser.
 */
export async function listMembers(env: CdpEnv): Promise<ApiResult> {
  if (!hasKey(env)) return MISSING_KEY;
  const sql =
    `SELECT block_number, parameters FROM base_sepolia.events ` +
    `WHERE address = '${POOL_ADDRESS.toLowerCase()}' AND event_name = 'Joined' ORDER BY block_number ASC LIMIT 10000`;
  try {
    const { generateJwt } = await import('@coinbase/cdp-sdk/auth');
    const host = 'api.cdp.coinbase.com';
    const path = '/platform/v2/data/query/run';
    const jwt = await generateJwt({
      apiKeyId: env.CDP_API_KEY_ID,
      apiKeySecret: env.CDP_API_KEY_SECRET,
      requestMethod: 'POST',
      requestHost: host,
      requestPath: path,
      expiresIn: 120,
    });
    const r = await fetch(`https://${host}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql, cache: { maxAgeMs: 1000 } }),
    });
    const body = (await r.json()) as {
      result?: { block_number: string; parameters: { member: string; agent: string; strategyURI: string } }[];
      errorMessage?: string;
    };
    if (!r.ok || !body.result) throw new Error(body.errorMessage ?? `CDP SQL API returned ${r.status}`);
    const joins = body.result.map((row) => ({
      member: row.parameters.member,
      agent: row.parameters.agent,
      strategyURI: row.parameters.strategyURI,
    }));
    return { status: 200, body: { joins } };
  } catch (e) {
    return { status: 502, body: { error: message(e, 'Member lookup failed') } };
  }
}

// Best-effort per-address cooldown. On serverless each instance has its own memory, so the
// CDP faucet's own per-address limits remain the real backstop.
const lastRequest = new Map<string, number>();
const COOLDOWN_MS = 60_000;

/** Sends Base Sepolia test USDC and ETH to `address` from the CDP faucet. */
export async function requestFaucet(env: CdpEnv, address: unknown): Promise<ApiResult> {
  if (!hasKey(env)) return MISSING_KEY;
  if (typeof address !== 'string' || !isAddress(address)) return { status: 400, body: { error: 'Invalid address' } };
  const key = address.toLowerCase();
  if (Date.now() - (lastRequest.get(key) ?? 0) < COOLDOWN_MS) {
    return { status: 429, body: { error: 'Please wait a minute between faucet requests.' } };
  }
  lastRequest.set(key, Date.now());
  try {
    const { CdpClient } = await import('@coinbase/cdp-sdk');
    const cdp = new CdpClient({ apiKeyId: env.CDP_API_KEY_ID, apiKeySecret: env.CDP_API_KEY_SECRET });
    const usdc = await cdp.evm.requestFaucet({ address, network: 'base-sepolia', token: 'usdc' });
    const eth = await cdp.evm.requestFaucet({ address, network: 'base-sepolia', token: 'eth' });
    return { status: 200, body: { usdcTx: usdc.transactionHash, ethTx: eth.transactionHash } };
  } catch (e) {
    return { status: 502, body: { error: message(e, 'Faucet request failed') } };
  }
}
