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

    AgentInsurancePool.Vote constant APPROVE = AgentInsurancePool.Vote.Approve;
    AgentInsurancePool.Vote constant REJECT = AgentInsurancePool.Vote.Reject;
    AgentInsurancePool.Vote constant FRAUD = AgentInsurancePool.Vote.Fraud;

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
        usdc.mint(member, amount);
        vm.startPrank(member);
        usdc.approve(address(pool), amount);
        pool.join(_agent(member), keccak256("Only trade ETH/USDC, max 5% per trade"), "ipfs://strategy", amount);
        vm.stopPrank();
    }

    function _file(address member, bytes32 txHash, uint256 amount) internal returns (uint256) {
        vm.prank(member);
        return pool.fileClaim(txHash, amount, "ipfs://evidence");
    }

    function _vote(address voter, uint256 id, AgentInsurancePool.Vote v) internal {
        vm.prank(voter);
        pool.vote(id, v);
    }

    function _endVotingAndResolve(uint256 id) internal {
        vm.warp(block.timestamp + pool.VOTING_PERIOD());
        pool.resolve(id);
    }

    function _status(uint256 id) internal view returns (AgentInsurancePool.Status) {
        return pool.getClaim(id).status;
    }

    // ------------------------------------------------------------------
    // Membership
    // ------------------------------------------------------------------

    function test_join_recordsMember() public view {
        AgentInsurancePool.Member memory m = pool.getMember(alice);
        assertTrue(m.active);
        assertEq(m.agent, _agent(alice));
        assertEq(pool.agentOwner(_agent(alice)), alice);
        assertEq(pool.totalAssets(), 200_000 * USD);
        assertEq(pool.stakeValue(alice), 10_000 * USD);
    }

    function test_join_revertsForTakenAgent() public {
        usdc.mint(erin, 1_000 * USD);
        vm.startPrank(erin);
        usdc.approve(address(pool), 1_000 * USD);
        vm.expectRevert(AgentInsurancePool.AgentTaken.selector);
        pool.join(_agent(alice), keccak256("x"), "", 1_000 * USD);
        vm.stopPrank();
    }

    function test_join_revertsBelowMinStake() public {
        usdc.mint(erin, 99 * USD);
        vm.startPrank(erin);
        usdc.approve(address(pool), 99 * USD);
        vm.expectRevert(AgentInsurancePool.StakeTooSmall.selector);
        pool.join(_agent(erin), keccak256("x"), "", 99 * USD);
        vm.stopPrank();
    }

    function test_leave_returnsStake() public {
        vm.prank(dave);
        pool.leave();
        assertEq(usdc.balanceOf(dave), 60_000 * USD);
        assertFalse(pool.getMember(dave).active);
        assertEq(pool.agentOwner(_agent(dave)), address(0));
    }

    function test_leave_blockedWhileClaimOpen() public {
        _file(alice, TX1, 1_000 * USD);
        vm.prank(dave);
        vm.expectRevert(AgentInsurancePool.ClaimsOpen.selector);
        pool.leave();
    }

    function test_joinAfterPayout_getsFairShare() public {
        uint256 id = _file(alice, TX1, 1_000 * USD);
        _vote(carol, id, APPROVE);
        _endVotingAndResolve(id); // pool pays 800

        _join(erin, 10_000 * USD);
        assertApproxEqAbs(pool.stakeValue(erin), 10_000 * USD, 1);
    }

    // ------------------------------------------------------------------
    // Filing
    // ------------------------------------------------------------------

    function test_fileClaim_revertsDuringWaitingPeriod() public {
        _join(erin, 1_000 * USD);
        vm.prank(erin);
        vm.expectRevert(AgentInsurancePool.NotCovered.selector);
        pool.fileClaim(TX1, 100 * USD, "");
    }

    function test_fileClaim_oneOpenClaimPerMember() public {
        _file(alice, TX1, 1_000 * USD);
        vm.prank(alice);
        vm.expectRevert(AgentInsurancePool.HasOpenClaim.selector);
        pool.fileClaim(TX2, 1_000 * USD, "");
    }

    function test_txLock_isPerAgent() public {
        // Bob filing Alice's tx hash doesn't block Alice from claiming it.
        _file(bob, TX1, 1_000 * USD);
        _file(alice, TX1, 1_000 * USD);
    }

    // ------------------------------------------------------------------
    // Payouts
    // ------------------------------------------------------------------

    function test_approved_paysEightyPercent() public {
        uint256 id = _file(alice, TX1, 1_000 * USD);
        _vote(bob, id, APPROVE);
        _vote(carol, id, APPROVE);
        _endVotingAndResolve(id);

        assertEq(uint256(_status(id)), uint256(AgentInsurancePool.Status.Approved));
        assertEq(pool.getClaim(id).payout, 800 * USD);
        assertEq(usdc.balanceOf(alice), 800 * USD);
        assertEq(pool.totalAssets(), 199_200 * USD);
    }

    function test_payout_cappedAtClaimantStake() public {
        // Alice (10k) claims 20k: 80% = 16k, capped at her 10k stake.
        uint256 id = _file(alice, TX1, 20_000 * USD);
        _vote(bob, id, APPROVE);
        _vote(dave, id, APPROVE);
        _endVotingAndResolve(id);
        assertEq(pool.getClaim(id).payout, 10_000 * USD);
    }

    function test_payout_cappedAtTenPercentOfPool() public {
        // Carol (100k) claims 50k: 80% = 40k, capped at 10% of 200k = 20k.
        uint256 id = _file(carol, TX1, 50_000 * USD);
        _vote(bob, id, APPROVE);
        _vote(dave, id, APPROVE);
        _endVotingAndResolve(id);
        assertEq(pool.getClaim(id).payout, 20_000 * USD);
    }

    function test_approvedTx_cannotBeClaimedAgain() public {
        uint256 id = _file(alice, TX1, 1_000 * USD);
        _vote(carol, id, APPROVE);
        _endVotingAndResolve(id);

        vm.prank(alice);
        vm.expectRevert(AgentInsurancePool.TxAlreadyClaimed.selector);
        pool.fileClaim(TX1, 1_000 * USD, "");
    }

    // ------------------------------------------------------------------
    // Rejection, fraud, quorum
    // ------------------------------------------------------------------

    function test_rejected_txCanBeClaimedAgain() public {
        uint256 id = _file(alice, TX1, 1_000 * USD);
        _vote(carol, id, REJECT);
        _endVotingAndResolve(id);

        assertEq(uint256(_status(id)), uint256(AgentInsurancePool.Status.Rejected));
        assertEq(pool.totalAssets(), 200_000 * USD);
        _file(alice, TX1, 900 * USD);
    }

    function test_fraud_slashesClaimantStake() public {
        uint256 aliceShares = pool.getMember(alice).shares;
        uint256 sharesBefore = pool.totalShares();

        uint256 id = _file(alice, TX1, 5_000 * USD);
        _vote(carol, id, FRAUD);
        _vote(dave, id, FRAUD);
        _endVotingAndResolve(id);

        assertEq(uint256(_status(id)), uint256(AgentInsurancePool.Status.Fraud));
        assertFalse(pool.getMember(alice).active);
        assertEq(pool.totalShares(), sharesBefore - aliceShares);
        assertEq(pool.totalAssets(), 200_000 * USD); // her 10k stays in the pool
        // Bob didn't vote, so his stake just grows with the pool: 30k * 200k / 190k.
        assertApproxEqAbs(pool.stakeValue(bob), (30_000 * USD * 200) / 190, 1);
    }

    function test_rejectAndFraudSplit_isRejected() public {
        uint256 id = _file(alice, TX1, 1_000 * USD);
        _vote(bob, id, FRAUD); // 30k
        _vote(dave, id, REJECT); // 60k
        _endVotingAndResolve(id);
        assertEq(uint256(_status(id)), uint256(AgentInsurancePool.Status.Rejected));
        assertTrue(pool.getMember(alice).active);
    }

    function test_noQuorum_noPenalties() public {
        uint256 bobShares = pool.getMember(bob).shares;
        uint256 id = _file(alice, TX1, 1_000 * USD);
        _vote(bob, id, APPROVE); // 30k of 200k = 15% < 20%
        _endVotingAndResolve(id);

        assertEq(uint256(_status(id)), uint256(AgentInsurancePool.Status.NoQuorum));
        assertEq(pool.getMember(bob).shares, bobShares);
        assertFalse(pool.isTxLocked(_agent(alice), TX1));
    }

    // ------------------------------------------------------------------
    // Voting rules and voter penalties
    // ------------------------------------------------------------------

    function test_losingVoters_payWinners() public {
        uint256 bobShares = pool.getMember(bob).shares;
        uint256 carolShares = pool.getMember(carol).shares;
        uint256 daveShares = pool.getMember(dave).shares;
        uint256 totalBefore = pool.totalShares();

        uint256 id = _file(alice, TX1, 1_000 * USD);
        _vote(bob, id, APPROVE); // loses: 1% of 30k = 300
        _vote(carol, id, REJECT); // wins, weight 100k
        _vote(dave, id, FRAUD); // wins (same "don't pay" side), weight 60k
        _endVotingAndResolve(id);

        uint256 penalty = bobShares / 100;
        assertEq(pool.getMember(bob).shares, bobShares - penalty);
        assertEq(pool.getMember(carol).shares, carolShares + (penalty * 100) / 160);
        assertEq(pool.getMember(dave).shares, daveShares + (penalty * 60) / 160);
        assertApproxEqAbs(pool.totalShares(), totalBefore, 1);
    }

    function test_vote_revertsForClaimant() public {
        uint256 id = _file(alice, TX1, 1_000 * USD);
        vm.prank(alice);
        vm.expectRevert(AgentInsurancePool.CannotVoteOwnClaim.selector);
        pool.vote(id, APPROVE);
    }

    function test_vote_revertsIfJoinedAfterClaim() public {
        uint256 id = _file(alice, TX1, 1_000 * USD);
        vm.warp(block.timestamp + 1);
        _join(erin, 1_000_000 * USD);
        vm.prank(erin);
        vm.expectRevert(AgentInsurancePool.JoinedAfterClaim.selector);
        pool.vote(id, APPROVE);
    }

    function test_vote_revertsOnDoubleVote() public {
        uint256 id = _file(alice, TX1, 1_000 * USD);
        _vote(bob, id, APPROVE);
        vm.prank(bob);
        vm.expectRevert(AgentInsurancePool.AlreadyVoted.selector);
        pool.vote(id, REJECT);
    }

    function test_vote_revertsAfterVotingEnds() public {
        uint256 id = _file(alice, TX1, 1_000 * USD);
        vm.warp(block.timestamp + pool.VOTING_PERIOD());
        vm.prank(bob);
        vm.expectRevert(AgentInsurancePool.VotingClosed.selector);
        pool.vote(id, APPROVE);
    }

    function test_resolve_revertsBeforeVotingEnds() public {
        uint256 id = _file(alice, TX1, 1_000 * USD);
        vm.expectRevert(AgentInsurancePool.VotingNotOver.selector);
        pool.resolve(id);
    }

    function test_slashedVoter_isSkippedInOtherClaims() public {
        // Alice votes on Bob's claim, then gets slashed for fraud on her own claim first.
        uint256 bobClaim = _file(bob, TX2, 1_000 * USD);
        _vote(alice, bobClaim, REJECT);
        _vote(carol, bobClaim, APPROVE);

        uint256 aliceClaim = _file(alice, TX1, 5_000 * USD);
        _vote(carol, aliceClaim, FRAUD);
        _vote(dave, aliceClaim, FRAUD);
        vm.warp(block.timestamp + pool.VOTING_PERIOD());
        pool.resolve(aliceClaim);
        pool.resolve(bobClaim); // must not revert on Alice's deleted membership
        assertEq(uint256(_status(bobClaim)), uint256(AgentInsurancePool.Status.Approved));
    }

    // ------------------------------------------------------------------
    // Fuzz
    // ------------------------------------------------------------------

    function testFuzz_payoutNeverExceedsCaps(uint256 requested) public {
        requested = bound(requested, 1, 1_000_000 * USD);
        uint256 id = _file(bob, TX1, requested);
        _vote(carol, id, APPROVE);
        uint256 poolBefore = pool.totalAssets();
        uint256 bobValue = pool.stakeValue(bob);
        _endVotingAndResolve(id);

        uint256 payout = pool.getClaim(id).payout;
        assertLe(payout, (requested * 8_000) / 10_000);
        assertLe(payout, bobValue);
        assertLe(payout, poolBefore / 10);
    }
}
