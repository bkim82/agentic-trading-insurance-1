# Agent Insurance DAO

A mutual insurance pool for losses caused by AI trading agents that break the strategy their
owner committed to. Members stake, register their agent and strategy, and vote on each other's claims.

Contract: `src/AgentInsurancePool.sol`

## How it works

1. **Join.** Call `join(agent, strategyHash, strategyURI, amount)`. `strategyHash` is the keccak256 of your
   full strategy text; `strategyURI` points to it (an IPFS link, or the plain text if you don't mind it
   being public). Your stake is held in the pool token (e.g. USDC). To change your strategy, leave and rejoin.
2. **Wait.** Coverage starts 7 days after joining.
3. **File a claim.** Call `fileClaim(txHash, requestedAmount, evidenceURI)`. Filing is free.
   - `requestedAmount` is the loss: the value of what left the wallet minus the value of what came back,
     both priced at the block of the trade. Later price moves don't count. Tokens with no market price
     count as zero.
   - `evidenceURI` should show the strategy text (matching `strategyHash`), why the trade breaks it,
     that the transaction came from your registered agent, and the loss math with price sources.
4. **Vote (3 days).** Members who joined before the claim vote `Approve`, `Reject`, or `Fraud`, weighted by
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
| Waiting period | 7 days |
| Voting period | 3 days |
| Quorum | 20% of total stake |
| Losing-voter penalty | 1% of stake, paid to winning voters |
| Coverage | 80% of loss (20% deductible) |
| Max single payout | 10% of pool, and no more than the claimant's stake |
| Minimum stake | set at deploy |

## Known limits (fine for a demo, worth fixing before real money)

- The contract can't check a transaction hash itself. Voters verify off-chain that the transaction exists,
  came from the registered agent, happened after coverage started, and that the loss math is right.
- Resolving loops over every voter, so gas grows with the number of voters. Fine for a small pool.
- Vote weight is the voter's stake when they vote.
- Any open claim blocks everyone from leaving. Each claim ends within 3 days, but someone could keep
  filing claims to hold the exit closed.
- No restriction on which venues are covered, and no cap on total payouts per period.
- Unaudited. Pooled loss coverage can count as regulated insurance; get legal review before real use.

## Develop

```shell
forge build
forge test
TOKEN=<erc20> MIN_STAKE=100000000 forge script script/Deploy.s.sol --rpc-url <rpc> --broadcast --account <keystore>
```

## Frontend

A clickable template lives in `frontend/` (React + Vite). It runs on sample data and isn't connected to the
contract yet. Every action goes through `frontend/src/state/PoolContext.tsx`, which mirrors the contract's
functions one to one, and the payout and voting math lives in `frontend/src/lib/rules.ts`. To wire it up,
replace those function bodies with contract calls (viem is already installed).

```shell
cd frontend
npm install
npm run dev
```

Use "Skip ahead 3 days" in the footer to end a vote and try resolving and settling claims.
