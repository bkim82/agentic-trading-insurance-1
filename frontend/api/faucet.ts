// Vercel function: POST /api/faucet { address }. See server/cdp.ts.
import { requestFaucet } from '../server/cdp.js';

export async function POST(request: Request): Promise<Response> {
  const input = (await request.json().catch(() => ({}))) as { address?: unknown };
  const { status, body } = await requestFaucet(process.env, input.address);
  return Response.json(body, { status });
}
