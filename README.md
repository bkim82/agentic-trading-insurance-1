# Agent Insurance DAO

A mutual insurance pool for losses caused by AI trading agents that break the strategy their
owner committed to. Members stake, register their agent and strategy, and vote on each other's claims.

Contract: `src/AgentInsurancePool.sol`

## How it works

1. **Join.** Call `join(agent, strategyHash, strategyURI, amount)`. `strategyHash` is the keccak256 of your
   full strategy text; `strategyURI` points to it (an IPFS link, or the plain text if you don't mind it
   being public). Your stake is held in the pool token (e.g. USDC).
2. **Wait.** Coverage starts 7 days after joining. Changing your strategy with `updateStrategy` restarts
   the 7 days, so a strategy can't be rewritten after a loss.
3. **File a claim.** Call `fileClaim(txHashes, requestedAmount, evidenceURI)` with 1 to 5 transaction hashes.
   You post a bond of 10% of the requested amount.
   - `requestedAmount` is the loss: the value of what left the wallet minus the value of what came back,
     both priced at the block of the trade. Later price moves don't count. Tokens with no market price
     count as zero.
   - `evidenceURI` should show the strategy text (matching `strategyHash`), why the trade breaks it,
     that the transaction came from your registered agent, and the loss math with price sources.
4. **Vote (3 days).** Members who joined before the claim vote `Approve`, `Reject`, or `Fraud`, weighted by
   stake. Each vote escrows 1% of the voter's stake as a bond. The claimant can't vote.
5. **Resolve.** Anyone calls `resolve(claimId)` after voting ends.
   - Less than 20% of total stake voted: **NoQuorum**. Bond refunded; the claim can be refiled.
   - Approve > 50% of votes cast: **Approved**. Bond refunded plus payout.
   - Fraud > 50% of votes cast: **Fraud**. Claimant's whole stake and bond go to the pool; they're banned.
   - Otherwise: **Rejected**. Bond goes to the pool; the claim can be refiled once (`refileClaim`).
6. **Settle votes.** Anyone calls `settleVote(claimId, voter)`. Voters on the winning side (pay vs. don't
   pay; Reject and Fraud count as the same side) get their bond back plus a share of the losing side's
   bonds. Losers forfeit their bond.

**Payout** = the smallest of 80% of the requested loss, the claimant's stake value, and 10% of the pool.

**Leaving.** `leave()` withdraws your full stake value. It's blocked while any claim is open (so nobody can
exit to dodge a payout) and until you've settled all your votes.

Stakes are tracked as pool shares, so payouts, forfeited bonds, and fraud slashes are shared by all
members in proportion to their stake.

## Parameters

| Setting | Value |
|---|---|
| Waiting period | 7 days |
| Voting period | 3 days |
| Claim bond | 10% of requested amount |
| Voter bond | 1% of voter's stake |
| Quorum | 20% of total stake |
| Coverage | 80% of loss (20% deductible) |
| Max single payout | 10% of pool, and no more than the claimant's stake |
| Tx hashes per claim | up to 5 |
| Minimum stake | set at deploy |

## Known limits (fine for a demo, worth fixing before real money)

- The contract can't check a transaction hash itself. Voters verify off-chain that the transaction exists,
  came from the registered agent, happened after coverage started, and that the loss math is right.
- Vote weight is the voter's stake at the time they vote, and stake added after a claim was filed still
  counts. A stricter version would snapshot balances when the claim is filed.
- Any open claim blocks everyone from leaving. Claim bonds make spamming this costly, and each claim ends
  within 3 days, but a determined attacker could keep the exit closed for a while.
- No restriction on which venues are covered, and no cap on total payouts per period.
- Unaudited. Pooled loss coverage can count as regulated insurance; get legal review before real use.

## Develop

```shell
forge build
forge test
TOKEN=<erc20> MIN_STAKE=100000000 forge script script/Deploy.s.sol --rpc-url <rpc> --broadcast --account <keystore>
```
