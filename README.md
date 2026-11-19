# Agent Insurance DAO

A mutual insurance pool for losses caused by AI trading agents that break the strategy their
owner committed to. Members stake, register their agent and strategy, and vote on each other's claims.

Contract: `src/AgentInsurancePool.sol`

## How it works

1. **Join.** Call `join(agent, strategyHash, strategyURI, amount)`. `strategyHash` is the keccak256 of your
   full strategy text; `strategyURI` points to it (an IPFS link, or the plain text if you don't mind it
   being public). Your stake is held in the pool token (e.g. USDC). To change your strategy, leave and rejoin.
2. **Wait.** Coverage starts after a waiting period (7 days in production).
3. **File a claim in the demo UI.** Enter a buy and later sell transaction sent by the registered agent. The sell must close the full amount of the ERC-20 asset bought; ETH/native transfers and partial closes aren't supported by the automatic calculation.
   The app reads the transfers and historical quote-token prices, calculates the realized USD loss (buy spend minus sell proceeds), and shows both transactions to voters. Later price moves **do** count if realized by the sell. Loss figures cannot be edited in the form; the explanation of the strategy violation is claimant-written.
   The deployed contract still accepts `fileClaim(txHash, requestedAmount, evidenceURI)`: it records the buy hash and an amount supplied by the browser, with the sell hash in `evidenceURI`. It does **not** verify either trade, loss, or strategy compliance. Direct contract calls can supply arbitrary values, so voters must independently check both explorer transactions, the strategy, counterparties, and the loss. Earlier one-hash claims remain visible as legacy claims.
4. **Vote (3 days in production).** Members who joined before the claim vote `Approve`, `Reject`, or `Fraud`, weighted by
   stake. The claimant can't vote.
5. **Resolve.** Anyone calls `resolve(claimId)` after voting ends.
   - Less than 20% of total stake voted: **NoQuorum**. Nothing happens; the claim can be filed again.
   - Approve > 50% of votes cast: **Approved**, and the claimant is paid.
   - Fraud > 50% of votes cast: **Fraud**. The claimant's whole stake goes to the pool and they're removed.
   - Otherwise: **Rejected**. The claim can be filed again with better evidence.
   - Unless there was no quorum, voters on the losing side (pay vs. don't pay; Reject and Fraud count as the
     same side) lose 1% of their stake, split among the winning voters by vote weight.

**Payout** = the smallest of 80% of the requested loss, the claimant's stake value, and 10% of the pool.

**Leaving.** `leave()` withdraws your full stake value. It's blocked while any claim is open, so nobody can
exit to dodge a payout.

Stakes are tracked as pool shares, so payouts and fraud slashes are shared by all members in proportion
to their stake.

## Parameters

| Setting | Value |
|---|---|
| Waiting period | set at deploy (7 days in production, 2 minutes in the demo) |
| Voting period | set at deploy (3 days in production, 5 minutes in the demo) |
| Quorum | 20% of total stake |
| Losing-voter penalty | 1% of stake, paid to winning voters |
| Coverage | 80% of loss (20% deductible) |
| Max single payout | 10% of pool, and no more than the claimant's stake |
| Minimum stake | set at deploy |

## Known limits (fine for a demo, worth fixing before real money)

- The deployed contract does not validate transaction hashes, prices, the second hash in evidence, or losses. The UI only prevents editing in its own form; it is **not** fraud-proof. Voters verify the two transactions and the requested amount independently before approving.
- Resolving loops over every voter, so gas grows with the number of voters. Fine for a small pool.
- Vote weight is the voter's stake when they vote.
- Any open claim blocks everyone from leaving. Each claim ends after one voting period, but someone could keep
  filing claims to hold the exit closed.
- No restriction on which venues are covered, and no cap on total payouts per period.
- Unaudited. Pooled loss coverage can count as regulated insurance; get legal review before real use.

## Develop

```shell
forge build
forge test
TOKEN=<erc20> MIN_STAKE=100000000 WAITING_PERIOD=604800 VOTING_PERIOD=259200 \
  forge script script/Deploy.s.sol --rpc-url <rpc> --broadcast --account <keystore>
```

`WAITING_PERIOD` and `VOTING_PERIOD` are in seconds and default to 7 days and 3 days.

## Live demo deployment (Base Sepolia)

| | |
|---|---|
| Contract | [`0xCB690ec336F47CEeb9d7dDFca7D6ca07cf6edC77`](https://sepolia.basescan.org/address/0xCB690ec336F47CEeb9d7dDFca7D6ca07cf6edC77) (source verified) |
| Token | Base Sepolia USDC `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |
| Minimum stake | 0.10 USDC |
| Waiting / voting period | 2 minutes / 5 minutes |
| Deployed by | CDP server wallet `neo-agent` (`0x7e0c…E683`) via the CREATE2 deployer |

Full details are in `deployments/base-sepolia.json`. The deployment was sent with the CDP CLI: the init code
was wrapped in an unsigned EIP-1559 transaction to the CREATE2 deployer
(`0x4e59b44847b379578588920cA78FbF26c0B4956C`, salt `keccak256("agent-insurance-pool-demo-v1")`) and submitted with
`cdp evm accounts send transaction`, which signs, sets gas and nonce, and broadcasts.

## Frontend

`frontend/` (React + Vite + wagmi/viem) talks to the live contract above. Members connect a browser wallet
(Coinbase Wallet extension, MetaMask, or any injected wallet) and every action is a real Base Sepolia
transaction: joining (USDC approve, then `join`), filing a claim, voting, resolving, and leaving. The page
refreshes from the chain every 15 seconds.

The Vite dev server also runs two small endpoints that use the CDP API, so the API key stays on the server:

- `POST /api/faucet` sends test USDC and ETH to the connected wallet via the CDP SDK (`requestFaucet`).
  It's the "Get test funds" button in the header.
- `GET /api/members` lists every `Joined` event through the CDP SQL API (`base_sepolia.events`). The public
  RPC only allows 200-block log queries, which is too small to scan the pool's history from the browser.

Setup:

```shell
cd frontend
npm install
cat > .env.local <<'ENV'
CDP_API_KEY_ID=<your CDP API key id>
CDP_API_KEY_SECRET="<your CDP API key secret>"
ENV
npm run dev
```

`.env.local` is git-ignored. Optional: set `VITE_RPC_URL` to use a different Base Sepolia RPC.

New claim evidence stores the strategy explanation and sell hash as JSON in `evidenceURI`; legacy claims may contain claimant-supplied loss lines. The
committed strategy text is stored as the member's `strategyURI`, and its keccak256 hash is the commitment.
