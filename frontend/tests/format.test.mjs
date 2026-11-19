import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createServer } from 'vite';

const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom' });
after(() => server.close());
const { usd } = await server.ssrLoadModule('/src/lib/format.ts');

test('shows small realized loss and payout instead of rounding them to zero', () => {
  assert.equal(usd(0), '$0.00');
  assert.equal(usd(0.0002), '$0.0002');
  assert.equal(usd(0.999623), '$0.999623');
  assert.equal(usd(0.999423), '$0.999423');
  assert.equal(usd(0.999423, 6), '$0.999423');
  assert.equal(usd(0.0000002), '<$0.000001');
});
