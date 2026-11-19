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
/// How it works
/// - Members join with a stake (an ERC20, e.g. USDC), their agent's address, and a commitment to
///   their trading strategy (a hash of the text plus a URI/plain-text pointer to it).
/// - Coverage starts after a 7 day waiting period (reset whenever the strategy changes).
/// - When the agent breaks the strategy, the member files a claim with the offending transaction
///   hash(es), the loss amount, and an evidence link. Filing costs a bond of 10% of the request.
/// - Loss is "value out minus value in": the value of what left the wallet minus the value of what
///   came back, priced at the block of the trade. It is computed off-chain and checked by voters.
/// - Members vote Approve / Reject / Fraud, weighted by stake. Each vote escrows 1% of the voter's
///   stake as a bond; voters on the losing side (pay vs. don't pay) forfeit their bond to the winners.
/// - A claim needs at least 20% of total stake to vote. Approve needs more than half the votes cast.
///   Fraud needs more than half the votes cast and slashes the claimant's whole stake into the pool.
/// - Payout = min(80% of the requested loss, claimant's stake value, 10% of the pool).
///
/// Stakes are tracked as pool shares, so payouts and forfeitures are shared by all members pro rata.
contract AgentInsurancePool is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ------------------------------------------------------------------
    // Parameters
    // ------------------------------------------------------------------

    uint256 public constant BPS = 10_000;
    uint256 public constant WAITING_PERIOD = 7 days;
    uint256 public constant VOTING_PERIOD = 3 days;
    uint256 public constant CLAIM_BOND_BPS = 1_000; // claim bond: 10% of requested loss
    uint256 public constant VOTER_BOND_BPS = 100; // voter bond: 1% of voter's stake
    uint256 public constant QUORUM_BPS = 2_000; // 20% of total stake must vote
    uint256 public constant COVERAGE_BPS = 8_000; // pays 80% of the loss (20% deductible)
    uint256 public constant MAX_POOL_PAYOUT_BPS = 1_000; // a single claim pays at most 10% of the pool
    uint256 public constant MAX_TX_HASHES = 5;

    /// @dev Virtual offsets protect the share price against first-depositor inflation attacks.
    uint256 private constant VIRTUAL_SHARES = 1e6;
    uint256 private constant VIRTUAL_ASSETS = 1;

    // ------------------------------------------------------------------
    // Types
    // ------------------------------------------------------------------

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
        uint256 shares; // shares owned outright (excludes voter bonds currently in escrow)
        uint64 joinedAt;
        uint64 coveredFrom;
        uint32 strategyVersion;
        uint256 openClaimId;
        uint256 unsettledVotes;
        bool active;
    }

    struct Claim {
        address claimant;
        address agent;
        bytes32 strategyHash;
        uint32 strategyVersion;
        uint64 createdAt;
        uint64 votingEnds;
        Status status;
        bool refiled; // this claim has been refiled (a claim can be refiled once)
        uint256 refileOf; // id of the claim this one refiles, 0 if original
        uint256 requestedAmount;
        uint256 bond;
        uint256 totalSharesSnapshot;
        uint256 approveWeight;
        uint256 rejectWeight;
        uint256 fraudWeight;
        uint256 payBondShares; // escrowed voter bonds on the "pay" side (Approve)
        uint256 noPayBondShares; // escrowed voter bonds on the "don't pay" side (Reject + Fraud)
        uint256 payout;
        string evidenceURI;
        bytes32[] txHashes;
    }

    struct Ballot {
        Vote vote;
        uint256 weight;
        uint256 bondShares;
        bool settled;
    }

    // ------------------------------------------------------------------
    // State
    // ------------------------------------------------------------------

    IERC20 public immutable token;
    uint256 public immutable minStake;

    uint256 public totalShares;
    uint256 public claimBondsHeld; // claim bonds in escrow; not part of pool assets
    uint256 public claimCount;
    uint256 public openClaimCount;

    mapping(address => Member) internal _members;
    mapping(address => address) public agentOwner; // agent => member
    mapping(address => bool) public banned; // members slashed for fraud
    mapping(uint256 => Claim) internal _claims;
    mapping(uint256 => mapping(address => Ballot)) public ballots;
    /// @dev keccak256(agent, txHash) => locked. Set while a claim is open and kept after an approved or
    ///      fraud verdict. Keyed by agent so one member can't block another member's transactions.
    mapping(bytes32 => bool) internal _txLocked;

    // ------------------------------------------------------------------
    // Events
    // ------------------------------------------------------------------

    event Joined(address indexed member, address indexed agent, bytes32 strategyHash, string strategyURI, uint256 amount, uint256 shares);
    event StakeAdded(address indexed member, uint256 amount, uint256 shares);
    event StrategyUpdated(address indexed member, uint32 version, bytes32 strategyHash, string strategyURI, uint64 coveredFrom);
    event Left(address indexed member, uint256 amount, uint256 shares);
    event ClaimFiled(uint256 indexed claimId, address indexed claimant, uint256 requestedAmount, uint256 bond, bytes32[] txHashes, string evidenceURI, uint256 refileOf);
    event Voted(uint256 indexed claimId, address indexed voter, Vote vote, uint256 weight, uint256 bondShares);
    event ClaimResolved(uint256 indexed claimId, Status status, uint256 payout);
    event VoteSettled(uint256 indexed claimId, address indexed voter, uint256 sharesReturned);

    // ------------------------------------------------------------------
    // Errors
    // ------------------------------------------------------------------

    error AlreadyMember();
    error NotMember();
    error Banned();
    error ZeroAddress();
    error AgentTaken();
    error EmptyStrategy();
    error StakeTooSmall();
    error ClaimsOpen();
    error UnsettledVotes();
    error HasOpenClaim();
    error NotCovered();
    error BadTxHashes();
    error TxHashLocked();
    error BondTooSmall();
    error ClaimNotOpen();
    error VotingClosed();
    error VotingNotOver();
    error InvalidVote();
    error CannotVoteOwnClaim();
    error JoinedAfterClaim();
    error AlreadyVoted();
    error NoVoteWeight();
    error NotResolved();
    error NothingToSettle();
    error NotClaimant();
    error CannotRefile();

    constructor(IERC20 token_, uint256 minStake_) {
        if (address(token_) == address(0)) revert ZeroAddress();
        token = token_;
        minStake = minStake_;
    }

    // ------------------------------------------------------------------
    // Membership
    // ------------------------------------------------------------------

    /// @notice Join the pool.
    /// @param agent The address your trading agent transacts from.
    /// @param strategyHash keccak256 of your full strategy text. Lets you keep it private until a claim.
    /// @param strategyURI Where the strategy text lives (IPFS link, or the plain text itself).
    /// @param amount Stake in pool tokens. Requires prior ERC20 approval.
    function join(address agent, bytes32 strategyHash, string calldata strategyURI, uint256 amount)
        external
        nonReentrant
    {
        Member storage m = _members[msg.sender];
        if (m.active) revert AlreadyMember();
        if (banned[msg.sender]) revert Banned();
        if (agent == address(0)) revert ZeroAddress();
        if (agentOwner[agent] != address(0)) revert AgentTaken();
        if (strategyHash == bytes32(0)) revert EmptyStrategy();
        if (amount < minStake) revert StakeTooSmall();

        uint256 shares = _toShares(amount);
        token.safeTransferFrom(msg.sender, address(this), amount);

        m.agent = agent;
        m.strategyHash = strategyHash;
        m.strategyURI = strategyURI;
        m.shares = shares;
        m.joinedAt = uint64(block.timestamp);
        m.coveredFrom = uint64(block.timestamp + WAITING_PERIOD);
        m.strategyVersion = 1;
        m.active = true;

        agentOwner[agent] = msg.sender;
        totalShares += shares;

        emit Joined(msg.sender, agent, strategyHash, strategyURI, amount, shares);
    }

    /// @notice Add more stake.
    function addStake(uint256 amount) external nonReentrant {
        Member storage m = _requireMember(msg.sender);
        uint256 shares = _toShares(amount);
        token.safeTransferFrom(msg.sender, address(this), amount);
        m.shares += shares;
        totalShares += shares;
        emit StakeAdded(msg.sender, amount, shares);
    }

    /// @notice Change your committed strategy. Restarts the waiting period.
    function updateStrategy(bytes32 strategyHash, string calldata strategyURI) external {
        Member storage m = _requireMember(msg.sender);
        if (m.openClaimId != 0) revert HasOpenClaim();
        if (strategyHash == bytes32(0)) revert EmptyStrategy();

        m.strategyHash = strategyHash;
        m.strategyURI = strategyURI;
        m.strategyVersion += 1;
        m.coveredFrom = uint64(block.timestamp + WAITING_PERIOD);

        emit StrategyUpdated(msg.sender, m.strategyVersion, strategyHash, strategyURI, m.coveredFrom);
    }

    /// @notice Leave the pool and withdraw your full stake value.
    /// @dev Blocked while any claim is open, so members can't exit to dodge a payout.
    ///      All of your votes must be settled first.
    function leave() external nonReentrant {
        Member storage m = _requireMember(msg.sender);
        if (openClaimCount != 0) revert ClaimsOpen();
        if (m.unsettledVotes != 0) revert UnsettledVotes();

        uint256 shares = m.shares;
        uint256 amount = _toAssets(shares);

        totalShares -= shares;
        delete agentOwner[m.agent];
        delete _members[msg.sender];

        token.safeTransfer(msg.sender, amount);
        emit Left(msg.sender, amount, shares);
    }

    // ------------------------------------------------------------------
    // Claims
    // ------------------------------------------------------------------

    /// @notice File a claim that your agent broke your committed strategy.
    /// @param txHashes The offending transaction hash(es), 1 to 5.
    /// @param requestedAmount Loss in pool tokens: value out minus value in, priced at the trade's block.
    /// @param evidenceURI Link to the evidence: strategy text, why the trade breaks it, and the loss math.
    function fileClaim(bytes32[] calldata txHashes, uint256 requestedAmount, string calldata evidenceURI)
        external
        nonReentrant
        returns (uint256)
    {
        return _fileClaim(txHashes, requestedAmount, evidenceURI, 0);
    }

    /// @notice Refile a rejected (or no-quorum) claim once, e.g. with a corrected amount.
    function refileClaim(uint256 claimId, uint256 requestedAmount, string calldata evidenceURI)
        external
        nonReentrant
        returns (uint256)
    {
        Claim storage prev = _claims[claimId];
        if (prev.claimant != msg.sender) revert NotClaimant();
        if (prev.status != Status.Rejected && prev.status != Status.NoQuorum) revert CannotRefile();
        if (prev.refiled || prev.refileOf != 0) revert CannotRefile();
        prev.refiled = true;
        return _fileClaim(prev.txHashes, requestedAmount, evidenceURI, claimId);
    }

    /// @notice Vote on an open claim. Escrows 1% of your stake as a bond.
    function vote(uint256 claimId, Vote choice) external {
        Claim storage c = _claims[claimId];
        if (c.status != Status.Open) revert ClaimNotOpen();
        if (block.timestamp >= c.votingEnds) revert VotingClosed();
        if (choice == Vote.None) revert InvalidVote();
        if (msg.sender == c.claimant) revert CannotVoteOwnClaim();

        Member storage m = _requireMember(msg.sender);
        if (m.joinedAt >= c.createdAt) revert JoinedAfterClaim();

        Ballot storage b = ballots[claimId][msg.sender];
        if (b.vote != Vote.None) revert AlreadyVoted();

        uint256 weight = m.shares;
        if (weight == 0) revert NoVoteWeight();
        uint256 bondShares = (weight * VOTER_BOND_BPS) / BPS;

        m.shares -= bondShares;
        m.unsettledVotes += 1;
        b.vote = choice;
        b.weight = weight;
        b.bondShares = bondShares;

        if (choice == Vote.Approve) {
            c.approveWeight += weight;
            c.payBondShares += bondShares;
        } else {
            if (choice == Vote.Reject) c.rejectWeight += weight;
            else c.fraudWeight += weight;
            c.noPayBondShares += bondShares;
        }

        emit Voted(claimId, msg.sender, choice, weight, bondShares);
    }

    /// @notice Resolve a claim once voting has ended. Anyone can call.
    function resolve(uint256 claimId) external nonReentrant {
        Claim storage c = _claims[claimId];
        if (c.status != Status.Open) revert ClaimNotOpen();
        if (block.timestamp < c.votingEnds) revert VotingNotOver();

        openClaimCount -= 1;
        Member storage claimant = _members[c.claimant];
        claimant.openClaimId = 0;

        uint256 cast = c.approveWeight + c.rejectWeight + c.fraudWeight;
        uint256 bond = c.bond;
        // Payout caps are measured on pool assets while the claim bond is still excluded.
        bool approved = cast * BPS >= c.totalSharesSnapshot * QUORUM_BPS && c.approveWeight * 2 > cast;
        uint256 payout = approved ? _payoutFor(c, claimant.shares) : 0;
        claimBondsHeld -= bond;

        if (cast * BPS < c.totalSharesSnapshot * QUORUM_BPS) {
            // Not enough turnout: refund the claimant's bond; tx hashes can be claimed again.
            c.status = Status.NoQuorum;
            _unlockTxHashes(c.agent, c.txHashes);
            token.safeTransfer(c.claimant, bond);
        } else if (approved) {
            c.status = Status.Approved;
            c.payout = payout;
            token.safeTransfer(c.claimant, bond + payout);
        } else if (c.fraudWeight * 2 > cast) {
            // Fraud: claimant's whole stake and bond go to the pool.
            c.status = Status.Fraud;
            totalShares -= claimant.shares;
            claimant.shares = 0;
            claimant.active = false;
            delete agentOwner[claimant.agent];
            banned[c.claimant] = true;
        } else {
            // Rejected: bond goes to the pool; tx hashes are released so the claim can be refiled.
            c.status = Status.Rejected;
            _unlockTxHashes(c.agent, c.txHashes);
        }

        emit ClaimResolved(claimId, c.status, c.payout);
    }

    /// @notice Return a voter's bond (plus winnings) after a claim is resolved. Anyone can call.
    /// @dev Winners are voters on the side of the outcome (pay vs. don't pay). They get their bond
    ///      back plus a pro-rata share of the losing side's bonds. Losers get nothing back.
    function settleVote(uint256 claimId, address voter) external {
        Claim storage c = _claims[claimId];
        if (c.status == Status.None || c.status == Status.Open) revert NotResolved();
        Ballot storage b = ballots[claimId][voter];
        if (b.vote == Vote.None || b.settled) revert NothingToSettle();
        b.settled = true;

        uint256 reward;
        if (c.status == Status.NoQuorum) {
            reward = b.bondShares;
        } else {
            bool paid = c.status == Status.Approved;
            bool votedPay = b.vote == Vote.Approve;
            if (votedPay == paid) {
                uint256 winTotal = paid ? c.payBondShares : c.noPayBondShares;
                uint256 loseTotal = paid ? c.noPayBondShares : c.payBondShares;
                reward = b.bondShares;
                if (winTotal != 0) reward += Math.mulDiv(b.bondShares, loseTotal, winTotal);
            }
        }

        Member storage m = _members[voter];
        m.unsettledVotes -= 1;
        if (m.active) {
            m.shares += reward;
        } else {
            // Voter was slashed for fraud in the meantime: their returned bond is forfeited.
            totalShares -= reward;
        }

        emit VoteSettled(claimId, voter, reward);
    }

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------

    /// @notice Pool assets: token balance minus claim bonds held in escrow.
    function totalAssets() public view returns (uint256) {
        return token.balanceOf(address(this)) - claimBondsHeld;
    }

    /// @notice Current token value of a member's stake (excluding voter bonds in escrow).
    function stakeValue(address member) public view returns (uint256) {
        return _toAssets(_members[member].shares);
    }

    /// @notice What an open claim would pay if approved right now.
    function previewPayout(uint256 claimId) external view returns (uint256) {
        Claim storage c = _claims[claimId];
        return _payoutFor(c, _members[c.claimant].shares);
    }

    /// @notice Whether a transaction is already part of an open, approved, or fraud claim for this agent.
    function isTxLocked(address agent, bytes32 txHash) external view returns (bool) {
        return _txLocked[_txKey(agent, txHash)];
    }

    function getMember(address member) external view returns (Member memory) {
        return _members[member];
    }

    function getClaim(uint256 claimId) external view returns (Claim memory) {
        return _claims[claimId];
    }

    // ------------------------------------------------------------------
    // Internal
    // ------------------------------------------------------------------

    function _fileClaim(
        bytes32[] memory txHashes,
        uint256 requestedAmount,
        string calldata evidenceURI,
        uint256 refileOf
    ) internal returns (uint256 claimId) {
        Member storage m = _requireMember(msg.sender);
        if (m.openClaimId != 0) revert HasOpenClaim();
        if (block.timestamp < m.coveredFrom) revert NotCovered();
        uint256 n = txHashes.length;
        if (n == 0 || n > MAX_TX_HASHES) revert BadTxHashes();
        for (uint256 i; i < n; ++i) {
            bytes32 h = txHashes[i];
            if (h == bytes32(0)) revert BadTxHashes();
            bytes32 key = _txKey(m.agent, h);
            if (_txLocked[key]) revert TxHashLocked();
            _txLocked[key] = true;
        }

        uint256 bond = (requestedAmount * CLAIM_BOND_BPS) / BPS;
        if (bond == 0) revert BondTooSmall();
        token.safeTransferFrom(msg.sender, address(this), bond);
        claimBondsHeld += bond;

        claimId = ++claimCount;
        Claim storage c = _claims[claimId];
        c.claimant = msg.sender;
        c.agent = m.agent;
        c.strategyHash = m.strategyHash;
        c.strategyVersion = m.strategyVersion;
        c.createdAt = uint64(block.timestamp);
        c.votingEnds = uint64(block.timestamp + VOTING_PERIOD);
        c.status = Status.Open;
        c.refileOf = refileOf;
        c.requestedAmount = requestedAmount;
        c.bond = bond;
        c.totalSharesSnapshot = totalShares;
        c.evidenceURI = evidenceURI;
        c.txHashes = txHashes;

        m.openClaimId = claimId;
        openClaimCount += 1;

        emit ClaimFiled(claimId, msg.sender, requestedAmount, bond, txHashes, evidenceURI, refileOf);
    }

    /// @dev min(80% of requested, claimant's stake value, 10% of pool assets)
    function _payoutFor(Claim storage c, uint256 claimantShares) internal view returns (uint256) {
        uint256 covered = (c.requestedAmount * COVERAGE_BPS) / BPS;
        uint256 stakeCap = _toAssets(claimantShares);
        uint256 poolCap = (totalAssets() * MAX_POOL_PAYOUT_BPS) / BPS;
        return Math.min(covered, Math.min(stakeCap, poolCap));
    }

    function _txKey(address agent, bytes32 txHash) internal pure returns (bytes32) {
        return keccak256(abi.encode(agent, txHash));
    }

    function _unlockTxHashes(address agent, bytes32[] storage txHashes) internal {
        for (uint256 i; i < txHashes.length; ++i) {
            _txLocked[_txKey(agent, txHashes[i])] = false;
        }
    }

    function _requireMember(address account) internal view returns (Member storage m) {
        m = _members[account];
        if (!m.active) revert NotMember();
    }

    function _toShares(uint256 assets) internal view returns (uint256) {
        return Math.mulDiv(assets, totalShares + VIRTUAL_SHARES, totalAssets() + VIRTUAL_ASSETS);
    }

    function _toAssets(uint256 shares) internal view returns (uint256) {
        return Math.mulDiv(shares, totalAssets() + VIRTUAL_ASSETS, totalShares + VIRTUAL_SHARES);
    }
}
