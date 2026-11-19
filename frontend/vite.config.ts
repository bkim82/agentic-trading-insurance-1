import react from '@vitejs/plugin-react';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import { listMembers, requestFaucet, type ApiResult, type CdpEnv } from './server/cdp.js';

/**
 * Serves /api/members and /api/faucet in `vite dev` and `vite preview`, using the same code as
 * the Vercel functions in /api. The CDP API key comes from .env.local and never reaches the browser.
 */
function cdpApi(env: CdpEnv): Plugin {
  const send = (res: ServerResponse, { status, body }: ApiResult) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(body));
  };
  const readJson = (req: IncomingMessage) =>
    new Promise<{ address?: unknown }>((resolve) => {
      let raw = '';
      req.on('data', (chunk) => (raw += chunk));
      req.on('end', () => {
        try {
          resolve(JSON.parse(raw || '{}'));
        } catch {
          resolve({});
        }
      });
    });

  const mount = (server: {
    middlewares: { use: (path: string, fn: (req: IncomingMessage, res: ServerResponse) => void) => void };
  }) => {
    server.middlewares.use('/api/members', (_req, res) => void listMembers(env).then((r) => send(res, r)));
    server.middlewares.use('/api/faucet', (req, res) => {
      if (req.method !== 'POST') return send(res, { status: 405, body: { error: 'Use POST' } });
      void readJson(req)
        .then((input) => requestFaucet(env, input.address))
        .then((r) => send(res, r));
    });
  };

  return { name: 'cdp-api', configureServer: mount, configurePreviewServer: mount };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react(), cdpApi(env)],
  };
});
