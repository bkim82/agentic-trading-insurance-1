// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {AgentInsurancePool} from "../src/AgentInsurancePool.sol";

contract MockUSDC is ERC20 {
    constructor() ERC20("Mock USDC", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract AgentInsurancePoolTest is Test {
    AgentInsurancePool pool;
    MockUSDC usdc;

    uint256 constant USD = 1e6;

    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");
    address dave = makeAddr("dave");
    address erin = makeAddr("erin");

    bytes32 constant TX1 = keccak256("tx1");
    bytes32 constant TX2 = keccak256("tx2");

    function setUp() public {
        usdc = new MockUSDC();
        pool = new AgentInsurancePool(usdc, 100 * USD);

        // Total pool: 200k. Alice 10k, Bob 30k, Carol 100k, Dave 60k.
        _join(alice, 10_000 * USD);
        _join(bob, 30_000 * USD);
        _join(carol, 100_000 * USD);
        _join(dave, 60_000 * USD);

        vm.warp(block.timestamp + pool.WAITING_PERIOD());
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    function _agent(address member) internal pure returns (address) {
        return address(uint160(uint256(keccak256(abi.encode("agent", member)))));
    }

    function _join(address member, uint256 amount) internal {
        usdc.mint(member, amount + 1_000_000 * USD); // extra balance for claim bonds
        vm.startPrank(member);
        usdc.approve(address(pool), type(uint256).max);
        pool.join(_agent(member), keccak256("Only trade ETH/USDC, max 5% of portfolio per trade"), "ipfs://strategy", amount);
        vm.stopPrank();
    }

    function _hashes(bytes32 h) internal pure returns (bytes32[] memory arr) {
        arr = new bytes32[](1);
        arr[0] = h;
    }

    function _file(address member, bytes32 h, uint256 amount) internal returns (uint256) {
        vm.prank(member);
        return pool.fileClaim(_hashes(h), amount, "ipfs://evidence");
    }

    function _vote(address voter, uint256 id, AgentInsurancePool.Vote v) internal {
        vm.prank(voter);
        pool.vote(id, v);
    }

    function _endVoting() internal {
        vm.warp(block.timestamp + pool.VOTING_PERIOD());
    }

    // ------------------------------------------------------------------
    // Membership
    // ------------------------------------------------------------------

    function test_join_recordsMember() public view {
        AgentInsurancePool.Member memory m = pool.getMember(alice);
        assertTrue(m.active);
        assertEq(m.agent, _agent(alice));
        assertEq(m.strategyVersion, 1);
        assertEq(pool.agentOwner(_agent(alice)), alice);
        assertEq(pool.totalAssets(), 200_000 * USD);
        assertApproxEqAbs(pool.stakeValue(alice), 10_000 * USD, 1);
    }

    function test_join_revertsForTakenAgent() public {
        usdc.mint(erin, 1_000 * USD);
        vm.startPrank(erin);
        usdc.approve(address(pool), type(uint256).max);
        vm.expectRevert(AgentInsurancePool.AgentTaken.selector);
        pool.join(_agent(alice), keccak256("x"), "", 1_000 * USD);
        vm.stopPrank();
    }

    function test_join_revertsBelowMinStake() public {
        usdc.mint(erin, 1_000 * USD);
        vm.startPrank(erin);
        usdc.approve(address(pool), type(uint256).max);
        vm.expectRevert(AgentInsurancePool.StakeTooSmall.selector);
        pool.join(_agent(erin), keccak256("x"), "", 99 * USD);
        vm.stopPrank();
    }

    function test_fileClaim_revertsDuringWaitingPeriod() public {
        _join(erin, 1_000 * USD);
        vm.prank(erin);
        vm.expectRevert(AgentInsurancePool.NotCovered.selector);
        pool.fileClaim(_hashes(TX1), 100 * USD, "");
    }

    function test_updateStrategy_restartsWaitingPeriod() public {
        vm.prank(alice);
        pool.updateStrategy(keccak256("new strategy"), "ipfs://v2");
        assertEq(pool.getMember(alice).strategyVersion, 2);

        vm.prank(alice);
        vm.expectRevert(AgentInsurancePool.NotCovered.selector);
        pool.fileClaim(_hashes(TX1), 100 * USD, "");

        vm.warp(block.timestamp + pool.WAITING_PERIOD());
        _file(alice, TX1, 100 * USD);
    }

    function test_leave_returnsStake() public {
        uint256 before = usdc.balanceOf(dave);
        vm.prank(dave);
        pool.leave();
        assertApproxEqAbs(usdc.balanceOf(dave) - before, 60_000 * USD, 1);
        assertFalse(pool.getMember(dave).active);
        assertEq(pool.agentOwner(_agent(dave)), address(0));
    }

    function test_leave_blockedWhileClaimOpen() public {
        _file(alice, TX1, 1_000 * USD);
        vm.prank(dave);
        vm.expectRevert(AgentInsurancePool.ClaimsOpen.selector);
        pool.leave();
    }

    // ------------------------------------------------------------------
    // Payouts
    // ------------------------------------------------------------------

    function test_approved_paysEightyPercentAndReturnsBond() public {
        uint256 before = usdc.balanceOf(alice);
        uint256 id = _file(alice, TX1, 1_000 * USD);
        assertEq(usdc.balanceOf(alice), before - 100 * USD); // 10% bond

        _vote(bob, id, AgentInsurancePool.Vote.Approve);
        _vote(carol, id, AgentInsurancePool.Vote.Approve);
        _endVoting();
        pool.resolve(id);

        AgentInsurancePool.Claim memory c = pool.getClaim(id);
        assertEq(uint256(c.status), uint256(AgentInsurancePool.Status.Approved));
        assertEq(c.payout, 800 * USD);
        assertEq(usdc.balanceOf(alice), before + 800 * USD);
        assertEq(pool.totalAssets(), 199_200 * USD);
    }

    function test_payout_cappedAtClaimantStake() public {
        // Alice (10k stake) claims a 20k loss: 80% = 16k, capped at her ~10k stake.
        uint256 id = _file(alice, TX1, 20_000 * USD);
        _vote(bob, id, AgentInsurancePool.Vote.Approve);
        _vote(dave, id, AgentInsurancePool.Vote.Approve);
        _endVoting();
        pool.resolve(id);
        assertApproxEqAbs(pool.getClaim(id).payout, 10_000 * USD, 1);
    }

    function test_payout_cappedAtTenPercentOfPool() public {
        // Carol (100k stake) claims a 50k loss: 80% = 40k, capped at 10% of a 200k pool = 20k.
        uint256 id = _file(carol, TX1, 50_000 * USD);
        _vote(bob, id, AgentInsurancePool.Vote.Approve);
        _vote(dave, id, AgentInsurancePool.Vote.Approve);
        _endVoting();
        pool.resolve(id);
        assertEq(pool.getClaim(id).payout, 20_000 * USD);
    }

    function test_approvedTx_cannotBeClaimedAgain() public {
        uint256 id = _file(alice, TX1, 1_000 * USD);
        _vote(carol, id, AgentInsurancePool.Vote.Approve);
        _endVoting();
        pool.resolve(id);

        assertTrue(pool.isTxLocked(_agent(alice), TX1));
        vm.prank(alice);
        vm.expectRevert(AgentInsurancePool.TxHashLocked.selector);
        pool.fileClaim(_hashes(TX1), 1_000 * USD, "");
    }

    // ------------------------------------------------------------------
    // Rejection, refiling, fraud, quorum
    // ------------------------------------------------------------------

    function test_rejected_forfeitsBondToPool() public {
        uint256 id = _file(alice, TX1, 1_000 * USD);
        _vote(carol, id, AgentInsurancePool.Vote.Reject);
        _endVoting();
        pool.resolve(id);

        assertEq(uint256(pool.getClaim(id).status), uint256(AgentInsurancePool.Status.Rejected));
        assertEq(pool.totalAssets(), 200_100 * USD); // bond added to the pool
        assertFalse(pool.isTxLocked(_agent(alice), TX1)); // freed for a refile
    }

    function test_refile_allowedOnce() public {
        uint256 id = _file(alice, TX1, 1_000 * USD);
        _vote(carol, id, AgentInsurancePool.Vote.Reject);
        _endVoting();
        pool.resolve(id);

        vm.prank(alice);
        uint256 id2 = pool.refileClaim(id, 600 * USD, "ipfs://corrected");
        assertEq(pool.getClaim(id2).refileOf, id);
        assertEq(pool.getClaim(id2).txHashes[0], TX1);

        vm.prank(alice);
        vm.expectRevert(AgentInsurancePool.CannotRefile.selector);
        pool.refileClaim(id, 600 * USD, "");

        _vote(carol, id2, AgentInsurancePool.Vote.Reject);
        _endVoting();
        pool.resolve(id2);

        vm.prank(alice);
        vm.expectRevert(AgentInsurancePool.CannotRefile.selector);
        pool.refileClaim(id2, 500 * USD, "");
    }

    function test_fraud_slashesClaimantStake() public {
        uint256 sharesBefore = pool.totalShares();
        uint256 aliceShares = pool.getMember(alice).shares;
        uint256 bobValueBefore = pool.stakeValue(bob);

        uint256 id = _file(alice, TX1, 5_000 * USD);
        _vote(carol, id, AgentInsurancePool.Vote.Fraud);
        _vote(dave, id, AgentInsurancePool.Vote.Fraud);
        _endVoting();
        pool.resolve(id);

        assertEq(uint256(pool.getClaim(id).status), uint256(AgentInsurancePool.Status.Fraud));
        assertFalse(pool.getMember(alice).active);
        assertTrue(pool.banned(alice));
        assertEq(pool.totalShares(), sharesBefore - aliceShares);
        assertEq(pool.totalAssets(), 200_500 * USD); // stake stays in pool, plus forfeited bond
        assertGt(pool.stakeValue(bob), bobValueBefore); // everyone else's stake is worth more

        vm.prank(alice);
        vm.expectRevert(AgentInsurancePool.Banned.selector);
        pool.join(_agent(erin), keccak256("x"), "", 1_000 * USD);
    }

    function test_rejectAndFraudSplit_isRejectedNotFraud() public {
        uint256 id = _file(alice, TX1, 1_000 * USD);
        _vote(bob, id, AgentInsurancePool.Vote.Fraud); // 30k
        _vote(dave, id, AgentInsurancePool.Vote.Reject); // 60k
        _endVoting();
        pool.resolve(id);
        assertEq(uint256(pool.getClaim(id).status), uint256(AgentInsurancePool.Status.Rejected));
        assertTrue(pool.getMember(alice).active);
    }

    function test_noQuorum_refundsBondAndVoterBonds() public {
        uint256 before = usdc.balanceOf(alice);
        uint256 bobShares = pool.getMember(bob).shares;

        uint256 id = _file(alice, TX1, 1_000 * USD);
        _vote(bob, id, AgentInsurancePool.Vote.Approve); // 30k of 200k = 15% < 20%
        _endVoting();
        pool.resolve(id);

        assertEq(uint256(pool.getClaim(id).status), uint256(AgentInsurancePool.Status.NoQuorum));
        assertEq(usdc.balanceOf(alice), before);

        pool.settleVote(id, bob);
        assertEq(pool.getMember(bob).shares, bobShares);
    }

    // ------------------------------------------------------------------
    // Voting rules and voter bonds
    // ------------------------------------------------------------------

    function test_voterBonds_winnersTakeLosersBonds() public {
        uint256 bobShares = pool.getMember(bob).shares;
        uint256 carolShares = pool.getMember(carol).shares;
        uint256 bobBond = bobShares / 100;

        uint256 id = _file(alice, TX1, 1_000 * USD);
        _vote(bob, id, AgentInsurancePool.Vote.Approve); // loses
        _vote(carol, id, AgentInsurancePool.Vote.Reject); // wins
        _endVoting();
        pool.resolve(id);

        pool.settleVote(id, bob);
        pool.settleVote(id, carol);

        assertEq(pool.getMember(bob).shares, bobShares - bobBond);
        assertEq(pool.getMember(carol).shares, carolShares + bobBond);

        vm.expectRevert(AgentInsurancePool.NothingToSettle.selector);
        pool.settleVote(id, carol);
    }

    function test_leave_requiresSettledVotes() public {
        uint256 id = _file(alice, TX1, 1_000 * USD);
        _vote(carol, id, AgentInsurancePool.Vote.Approve);
        _endVoting();
        pool.resolve(id);

        vm.prank(carol);
        vm.expectRevert(AgentInsurancePool.UnsettledVotes.selector);
        pool.leave();

        pool.settleVote(id, carol);
        vm.prank(carol);
        pool.leave();
    }

    function test_vote_revertsForClaimant() public {
        uint256 id = _file(alice, TX1, 1_000 * USD);
        vm.prank(alice);
        vm.expectRevert(AgentInsurancePool.CannotVoteOwnClaim.selector);
        pool.vote(id, AgentInsurancePool.Vote.Approve);
    }

    function test_vote_revertsIfJoinedAfterClaim() public {
        uint256 id = _file(alice, TX1, 1_000 * USD);
        vm.warp(block.timestamp + 1);
        _join(erin, 1_000_000 * USD);
        vm.prank(erin);
        vm.expectRevert(AgentInsurancePool.JoinedAfterClaim.selector);
        pool.vote(id, AgentInsurancePool.Vote.Approve);
    }

    function test_vote_revertsOnDoubleVote() public {
        uint256 id = _file(alice, TX1, 1_000 * USD);
        _vote(bob, id, AgentInsurancePool.Vote.Approve);
        vm.prank(bob);
        vm.expectRevert(AgentInsurancePool.AlreadyVoted.selector);
        pool.vote(id, AgentInsurancePool.Vote.Reject);
    }

    function test_vote_revertsAfterVotingEnds() public {
        uint256 id = _file(alice, TX1, 1_000 * USD);
        _endVoting();
        vm.prank(bob);
        vm.expectRevert(AgentInsurancePool.VotingClosed.selector);
        pool.vote(id, AgentInsurancePool.Vote.Approve);
    }

    function test_resolve_revertsBeforeVotingEnds() public {
        uint256 id = _file(alice, TX1, 1_000 * USD);
        vm.expectRevert(AgentInsurancePool.VotingNotOver.selector);
        pool.resolve(id);
    }

    function test_oneOpenClaimPerMember() public {
        _file(alice, TX1, 1_000 * USD);
        vm.prank(alice);
        vm.expectRevert(AgentInsurancePool.HasOpenClaim.selector);
        pool.fileClaim(_hashes(TX2), 1_000 * USD, "");
    }

    function test_txLock_isPerAgent() public {
        // Bob filing Alice's tx hash doesn't block Alice from claiming it.
        _file(bob, TX1, 1_000 * USD);
        _file(alice, TX1, 1_000 * USD);
    }

    // ------------------------------------------------------------------
    // Invariant-style fuzz: pool assets always cover what members can withdraw
    // ------------------------------------------------------------------

    function testFuzz_payoutNeverExceedsCaps(uint256 requested) public {
        requested = bound(requested, 10, 1_000_000 * USD);
        uint256 id = _file(bob, TX1, requested);
        _vote(carol, id, AgentInsurancePool.Vote.Approve);
        _endVoting();
        uint256 poolBefore = pool.totalAssets();
        uint256 bobValue = pool.stakeValue(bob);
        pool.resolve(id);

        uint256 payout = pool.getClaim(id).payout;
        assertLe(payout, (requested * 8_000) / 10_000);
        assertLe(payout, bobValue);
        assertLe(payout, poolBefore / 10);
    }
}
