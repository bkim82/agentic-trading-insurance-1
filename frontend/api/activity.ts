// Vercel function: GET /api/activity. See server/cdp.ts.
import { listActivity } from '../server/cdp.js';

export async function GET(): Promise<Response> {
  const { status, body } = await listActivity(process.env);
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}
