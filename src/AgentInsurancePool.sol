// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title AgentInsurancePool
/// @notice A mutual pool that insures members against their AI trading agent breaking the
///         trading strategy the member committed to when joining.
///
/// - Join with a stake, your agent's address, and a commitment to your strategy.
///   Coverage starts after a waiting period (7 days in production).
/// - File a claim with one primary transaction hash, a claimant-supplied amount, and evidence.
///   The demo UI includes a second sell hash in evidence and derives realized loss off-chain; voters verify both.
/// - Members vote Approve / Reject / Fraud during the voting period (3 days in production), weighted by stake.
/// - At least 20% of total stake must vote. Approve or Fraud needs more than half the votes cast.
///   Fraud slashes the claimant's whole stake into the pool.
/// - Voters on the losing side (pay vs. don't pay) lose 1% of their stake to the winning side.
/// - Payout = min(80% of the loss, claimant's stake value, 10% of the pool).
///
/// Stakes are tracked as pool shares, so payouts and slashes are shared by all members pro rata.
contract AgentInsurancePool is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant BPS = 10_000;
    uint256 public constant QUORUM_BPS = 2_000; // 20% of total stake must vote
    uint256 public constant VOTER_PENALTY_BPS = 100; // losing voters lose 1% of stake
    uint256 public constant COVERAGE_BPS = 8_000; // pays 80% of the loss
    uint256 public constant MAX_POOL_PAYOUT_BPS = 1_000; // at most 10% of the pool per claim

    enum Vote {
        None,
        Approve,
        Reject,
        Fraud
    }

    enum Status {
        None,
        Open,
        Approved,
        Rejected,
        Fraud,
        NoQuorum
    }

    struct Member {
        address agent;
        bytes32 strategyHash;
        string strategyURI;
        uint256 shares;
        uint64 joinedAt;
        uint64 coveredFrom;
        uint256 openClaimId;
        bool active;
    }

    struct Claim {
        address claimant;
        address agent;
        bytes32 txHash;
        uint256 requestedAmount;
        string evidenceURI;
        uint64 createdAt;
        uint64 votingEnds;
        Status status;
        uint256 totalSharesSnapshot;
        uint256 approveWeight;
        uint256 rejectWeight;
        uint256 fraudWeight;
        uint256 payout;
        address[] voters;
    }

    IERC20 public immutable token;
    uint256 public immutable minStake;
    /// @notice Time after joining before a member can file a claim (7 days in production).
    uint256 public immutable WAITING_PERIOD;
    /// @notice How long each claim is open for voting (3 days in production).
    uint256 public immutable VOTING_PERIOD;

    uint256 public totalShares;
    uint256 public claimCount;
    uint256 public openClaimCount;

    mapping(address => Member) internal _members;
    mapping(address => address) public agentOwner; // agent => member
    mapping(uint256 => Claim) internal _claims;
    mapping(uint256 => mapping(address => Vote)) public votes;
    mapping(uint256 => mapping(address => uint256)) public voteWeight;
    /// @dev keccak256(agent, txHash) => true while a claim on it is open, and forever once approved or fraud.
    mapping(bytes32 => bool) internal _txLocked;

    event Joined(address indexed member, address indexed agent, bytes32 strategyHash, string strategyURI, uint256 amount);
    event Left(address indexed member, uint256 amount);
    event ClaimFiled(uint256 indexed claimId, address indexed claimant, bytes32 txHash, uint256 requestedAmount, string evidenceURI);
    event Voted(uint256 indexed claimId, address indexed voter, Vote vote, uint256 weight);
    event ClaimResolved(uint256 indexed claimId, Status status, uint256 payout);

    error AlreadyMember();
    error NotMember();
    error ZeroAddress();
    error AgentTaken();
    error EmptyStrategy();
    error StakeTooSmall();
    error ClaimsOpen();
    error HasOpenClaim();
    error NotCovered();
    error InvalidClaim();
    error TxAlreadyClaimed();
    error ClaimNotOpen();
    error VotingClosed();
    error VotingNotOver();
    error InvalidVote();
    error CannotVoteOwnClaim();
    error JoinedAfterClaim();
    error AlreadyVoted();

    /// @param waitingPeriod_ Seconds before a new member is covered (production: 7 days).
    /// @param votingPeriod_ Seconds each claim is open for voting (production: 3 days).
    constructor(IERC20 token_, uint256 minStake_, uint256 waitingPeriod_, uint256 votingPeriod_) {
        if (address(token_) == address(0)) revert ZeroAddress();
        token = token_;
        minStake = minStake_;
        WAITING_PERIOD = waitingPeriod_;
        VOTING_PERIOD = votingPeriod_;
    }

    // ------------------------------------------------------------------
    // Membership
    // ------------------------------------------------------------------

    /// @notice Join the pool. Requires prior ERC20 approval of `amount`.
    /// @param agent The address your trading agent transacts from.
    /// @param strategyHash keccak256 of your full strategy text.
    /// @param strategyURI Where the strategy text lives (IPFS link, or the plain text itself).
    function join(address agent, bytes32 strategyHash, string calldata strategyURI, uint256 amount)
        external
        nonReentrant
    {
        if (_members[msg.sender].active) revert AlreadyMember();
        if (agent == address(0)) revert ZeroAddress();
        if (agentOwner[agent] != address(0)) revert AgentTaken();
        if (strategyHash == bytes32(0)) revert EmptyStrategy();
        if (amount < minStake) revert StakeTooSmall();

        uint256 assets = totalAssets();
        uint256 shares = totalShares == 0 || assets == 0 ? amount : Math.mulDiv(amount, totalShares, assets);
        token.safeTransferFrom(msg.sender, address(this), amount);

        _members[msg.sender] = Member({
            agent: agent,
            strategyHash: strategyHash,
            strategyURI: strategyURI,
            shares: shares,
            joinedAt: uint64(block.timestamp),
            coveredFrom: uint64(block.timestamp + WAITING_PERIOD),
            openClaimId: 0,
            active: true
        });
        agentOwner[agent] = msg.sender;
        totalShares += shares;

        emit Joined(msg.sender, agent, strategyHash, strategyURI, amount);
    }

    /// @notice Leave and withdraw your full stake value. Blocked while any claim is open,
    ///         so nobody can exit to dodge a payout.
    function leave() external nonReentrant {
        Member storage m = _requireMember(msg.sender);
        if (openClaimCount != 0) revert ClaimsOpen();

        uint256 amount = stakeValue(msg.sender);
        totalShares -= m.shares;
        delete agentOwner[m.agent];
        delete _members[msg.sender];

        token.safeTransfer(msg.sender, amount);
        emit Left(msg.sender, amount);
    }

    // ------------------------------------------------------------------
    // Claims
    // ------------------------------------------------------------------

    /// @notice File a claim that your agent broke your committed strategy.
    /// @param txHash The offending transaction.
    /// @param requestedAmount Claimant-supplied loss in pool tokens; the contract does not verify its calculation.
    /// @param evidenceURI Off-chain evidence; the demo UI includes the sell hash and strategy explanation.
    function fileClaim(bytes32 txHash, uint256 requestedAmount, string calldata evidenceURI)
        external
        returns (uint256 claimId)
    {
        Member storage m = _requireMember(msg.sender);
        if (m.openClaimId != 0) revert HasOpenClaim();
        if (block.timestamp < m.coveredFrom) revert NotCovered();
        if (txHash == bytes32(0) || requestedAmount == 0) revert InvalidClaim();
        bytes32 key = _txKey(m.agent, txHash);
        if (_txLocked[key]) revert TxAlreadyClaimed();
        _txLocked[key] = true;

        claimId = ++claimCount;
        Claim storage c = _claims[claimId];
        c.claimant = msg.sender;
        c.agent = m.agent;
        c.txHash = txHash;
        c.requestedAmount = requestedAmount;
        c.evidenceURI = evidenceURI;
        c.createdAt = uint64(block.timestamp);
        c.votingEnds = uint64(block.timestamp + VOTING_PERIOD);
        c.status = Status.Open;
        c.totalSharesSnapshot = totalShares;

        m.openClaimId = claimId;
        openClaimCount += 1;

        emit ClaimFiled(claimId, msg.sender, txHash, requestedAmount, evidenceURI);
    }

    /// @notice Vote on an open claim, weighted by your stake.
    function vote(uint256 claimId, Vote choice) external {
        Claim storage c = _claims[claimId];
        if (c.status != Status.Open) revert ClaimNotOpen();
        if (block.timestamp >= c.votingEnds) revert VotingClosed();
        if (choice == Vote.None) revert InvalidVote();
        if (msg.sender == c.claimant) revert CannotVoteOwnClaim();
        Member storage m = _requireMember(msg.sender);
        if (m.joinedAt >= c.createdAt) revert JoinedAfterClaim();
        if (votes[claimId][msg.sender] != Vote.None) revert AlreadyVoted();

        uint256 weight = m.shares;
        votes[claimId][msg.sender] = choice;
        voteWeight[claimId][msg.sender] = weight;
        c.voters.push(msg.sender);

        if (choice == Vote.Approve) c.approveWeight += weight;
        else if (choice == Vote.Reject) c.rejectWeight += weight;
        else c.fraudWeight += weight;

        emit Voted(claimId, msg.sender, choice, weight);
    }

    /// @notice Resolve a claim after voting ends. Anyone can call.
    function resolve(uint256 claimId) external nonReentrant {
        Claim storage c = _claims[claimId];
        if (c.status != Status.Open) revert ClaimNotOpen();
        if (block.timestamp < c.votingEnds) revert VotingNotOver();

        openClaimCount -= 1;
        Member storage claimant = _members[c.claimant];
        claimant.openClaimId = 0;

        uint256 cast = c.approveWeight + c.rejectWeight + c.fraudWeight;
        if (cast * BPS < c.totalSharesSnapshot * QUORUM_BPS) {
            c.status = Status.NoQuorum;
            _txLocked[_txKey(c.agent, c.txHash)] = false;
            emit ClaimResolved(claimId, c.status, 0);
            return;
        }

        bool pay = c.approveWeight * 2 > cast;
        _settleVoters(claimId, c, pay);

        if (pay) {
            c.status = Status.Approved;
            uint256 payout = Math.min(
                (c.requestedAmount * COVERAGE_BPS) / BPS,
                Math.min(stakeValue(c.claimant), (totalAssets() * MAX_POOL_PAYOUT_BPS) / BPS)
            );
            c.payout = payout;
            token.safeTransfer(c.claimant, payout);
        } else if (c.fraudWeight * 2 > cast) {
            c.status = Status.Fraud;
            totalShares -= claimant.shares;
            delete agentOwner[claimant.agent];
            delete _members[c.claimant];
        } else {
            c.status = Status.Rejected;
            _txLocked[_txKey(c.agent, c.txHash)] = false; // can be claimed again with better evidence
        }

        emit ClaimResolved(claimId, c.status, c.payout);
    }

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------

    function totalAssets() public view returns (uint256) {
        return token.balanceOf(address(this));
    }

    /// @notice Current token value of a member's stake.
    function stakeValue(address member) public view returns (uint256) {
        if (totalShares == 0) return 0;
        return Math.mulDiv(_members[member].shares, totalAssets(), totalShares);
    }

    function getMember(address member) external view returns (Member memory) {
        return _members[member];
    }

    function getClaim(uint256 claimId) external view returns (Claim memory) {
        return _claims[claimId];
    }

    function isTxLocked(address agent, bytes32 txHash) external view returns (bool) {
        return _txLocked[_txKey(agent, txHash)];
    }

    // ------------------------------------------------------------------
    // Internal
    // ------------------------------------------------------------------

    /// @dev Losing voters (pay vs. don't pay) lose 1% of their shares, split among winners by vote weight.
    function _settleVoters(uint256 claimId, Claim storage c, bool pay) internal {
        address[] storage voters = c.voters;
        uint256 n = voters.length;

        uint256 collected;
        uint256 winWeight;
        for (uint256 i; i < n; ++i) {
            address v = voters[i];
            Member storage m = _members[v];
            if (!m.active) continue;
            bool votedPay = votes[claimId][v] == Vote.Approve;
            if (votedPay == pay) {
                winWeight += voteWeight[claimId][v];
            } else {
                uint256 penalty = (m.shares * VOTER_PENALTY_BPS) / BPS;
                m.shares -= penalty;
                collected += penalty;
            }
        }
        if (collected == 0) return;
        if (winWeight == 0) {
            totalShares -= collected; // no eligible winners: penalty goes to the whole pool
            return;
        }

        uint256 distributed;
        for (uint256 i; i < n; ++i) {
            address v = voters[i];
            Member storage m = _members[v];
            if (!m.active) continue;
            if ((votes[claimId][v] == Vote.Approve) != pay) continue;
            uint256 reward = Math.mulDiv(collected, voteWeight[claimId][v], winWeight);
            m.shares += reward;
            distributed += reward;
        }
        totalShares -= collected - distributed; // rounding dust goes to the whole pool
    }

    function _requireMember(address account) internal view returns (Member storage m) {
        m = _members[account];
        if (!m.active) revert NotMember();
    }

    function _txKey(address agent, bytes32 txHash) internal pure returns (bytes32) {
        return keccak256(abi.encode(agent, txHash));
    }
}
