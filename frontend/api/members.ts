// Vercel function: GET /api/members. See server/cdp.ts.
import { listMembers } from '../server/cdp.js';

export async function GET(): Promise<Response> {
  const { status, body } = await listMembers(process.env);
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}
