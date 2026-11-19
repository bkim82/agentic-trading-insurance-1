import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { isAddress } from 'viem';
import { defineConfig, loadEnv, type Connect, type Plugin } from 'vite';

const deployment = JSON.parse(readFileSync(new URL('../deployments/base-sepolia.json', import.meta.url), 'utf8')) as {
  AgentInsurancePool: string;
};

/**
 * GET /api/members lists every Joined event of the pool using the CDP SQL API
 * (base_sepolia.events). The public RPC caps eth_getLogs at 200 blocks, which is
 * too small to scan the pool's history from the browser.
 */
function cdpMembers(env: Record<string, string>): Connect.NextHandleFunction {
  const pool = deployment.AgentInsurancePool.toLowerCase();
  const sql =
    `SELECT block_number, parameters FROM base_sepolia.events ` +
    `WHERE address = '${pool}' AND event_name = 'Joined' ORDER BY block_number ASC LIMIT 10000`;

  return async (_req: IncomingMessage, res: ServerResponse) => {
    res.setHeader('Content-Type', 'application/json');
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
      res.end(JSON.stringify({ joins }));
    } catch (e) {
      res.statusCode = 502;
      res.end(JSON.stringify({ error: e instanceof Error ? e.message.slice(0, 300) : 'Member lookup failed' }));
    }
  };
}

/**
 * POST /api/faucet { address } sends Base Sepolia test USDC and ETH to `address`
 * using the CDP SDK. Runs only inside the Vite dev/preview server, so the CDP API
 * key (CDP_API_KEY_ID / CDP_API_KEY_SECRET in .env.local) never reaches the browser.
 */
function cdpFaucet(env: Record<string, string>): Plugin {
  const lastRequest = new Map<string, number>();
  const COOLDOWN_MS = 60_000;

  const handler: Connect.NextHandleFunction = (req: IncomingMessage, res: ServerResponse) => {
    const reply = (status: number, body: unknown) => {
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(body));
    };
    if (req.method !== 'POST') return reply(405, { error: 'Use POST' });
    if (!env.CDP_API_KEY_ID || !env.CDP_API_KEY_SECRET) {
      return reply(500, { error: 'CDP API key is not configured. Add CDP_API_KEY_ID and CDP_API_KEY_SECRET to .env.local.' });
    }

    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', async () => {
      try {
        const { address } = JSON.parse(raw || '{}') as { address?: string };
        if (!address || !isAddress(address)) return reply(400, { error: 'Invalid address' });
        const key = address.toLowerCase();
        const last = lastRequest.get(key) ?? 0;
        if (Date.now() - last < COOLDOWN_MS) return reply(429, { error: 'Please wait a minute between faucet requests.' });
        lastRequest.set(key, Date.now());

        const { CdpClient } = await import('@coinbase/cdp-sdk');
        const cdp = new CdpClient({ apiKeyId: env.CDP_API_KEY_ID, apiKeySecret: env.CDP_API_KEY_SECRET });
        const usdc = await cdp.evm.requestFaucet({ address, network: 'base-sepolia', token: 'usdc' });
        const eth = await cdp.evm.requestFaucet({ address, network: 'base-sepolia', token: 'eth' });
        reply(200, { usdcTx: usdc.transactionHash, ethTx: eth.transactionHash });
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Faucet request failed';
        reply(502, { error: message.slice(0, 300) });
      }
    });
  };

  return {
    name: 'cdp-faucet',
    configureServer(server) {
      server.middlewares.use('/api/faucet', handler);
      server.middlewares.use('/api/members', cdpMembers(env));
    },
    configurePreviewServer(server) {
      server.middlewares.use('/api/faucet', handler);
      server.middlewares.use('/api/members', cdpMembers(env));
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react(), cdpFaucet(env)],
  };
});
