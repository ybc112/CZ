// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function allowance(address owner, address spender) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

// 实时价格源：getPrice() 返回 1 个质押代币兑 USDT 的价格，1e18 精度
interface IPriceFeed {
    function getPrice() external view returns (uint256);
}

contract NBTStakingBankV3 {
    struct UserInfo {
        uint256 totalStaked;
        uint256 totalWithdrawn;
        uint256 stakeCount;
        uint256 activeStakeCount;
        address referrer;
        uint256 directReferrals;
        uint256 referralStakeVolume;
        uint256 personalStakeVolume;
        uint256 pendingInviteRewards;
        uint256 totalInviteClaimed;
        uint256 lockedInviteRewards;
        uint256 inviteUnlockCursor;
    }

    struct StakeRecord {
        uint256 amount;
        uint256 scoreValue;
        uint256 startTime;
        bool active;
        bool countedToReferrer;
    }

    struct NodeSnapshot {
        address node;
        uint256 personalScore;
        uint256 inviteScore;
        uint256 totalScore;
    }

    struct Epoch {
        NodeSnapshot[] nodes;
        uint256 snapshotTime;
        uint256 poolAmount;
        uint256 totalClaimed;
        uint256 totalNodes;
        bool settled;
        bool disabled;
        mapping(address => bool) claimed;
    }

    struct InviteRewardLock {
        address invitee;
        uint256 stakeId;
        uint256 amount;
        uint256 unlockTime;
    }

    IERC20 public immutable stakingToken;
    IERC20 public immutable rewardToken;
    IERC20 public interactionFeeToken;

    uint256 public constant RATE_BASE = 10_000;
    uint256 public constant MAX_ACTIVE_STAKES = 50;
    uint256 public constant MAX_REFERRAL_DEPTH = 20;
    uint256 public constant LOCK_PERIOD = 15 days;
    uint256 public constant DISPLAY_PERIOD = 3 days;
    uint256 public constant CLAIM_PERIOD = 7 days;
    uint256 public constant MIN_NODES = 10;
    uint256 public constant DEFAULT_INVITE_REWARD = 1_000_000 ether;
    uint256 public constant DEFAULT_MIN_REFERRAL_STAKE_VALUE = 100 ether;

    uint256 public totalStaked;
    uint256 public totalRankDistributed;
    uint256 public totalRankClaimed;
    uint256 public totalInviteRewardsAccrued;
    uint256 public totalInviteRewardsClaimed;
    uint256 public interactionFee;
    uint256 public inviteReward;
    uint256 public minReferralStakeValue;
    uint256 public stakeValueRate;
    uint256 public startTime;
    uint256 public currentEpochId;
    uint256 public pendingCarryover;
    bool public paused;

    address public owner;
    address public pendingOwner;
    address public feeReceiver;
    address public priceFeed;
    uint256 private _unlocked = 1;

    mapping(address => UserInfo) public userInfo;
    mapping(address => mapping(uint256 => StakeRecord)) public stakeRecords;
    mapping(address => bool) public operators;
    mapping(address => address[]) private _referrals;
    mapping(address => InviteRewardLock[]) private _inviteRewardLocks;
    mapping(address => mapping(address => bool)) public qualifiedReferral;
    mapping(uint256 => Epoch) private epochs;
    mapping(uint256 => mapping(address => uint256)) public epochRank;

    address[] private _nodes;
    mapping(address => uint256) private _nodeIndexPlusOne;

    event Deposit(address indexed user, address indexed referrer, uint256 indexed stakeId, uint256 amount);
    event Withdraw(address indexed user, uint256 indexed stakeId, uint256 amount);
    event ReferrerSet(address indexed user, address indexed referrer);
    event ReferralQualified(address indexed referrer, address indexed user, uint256 inviteReward);
    event InviteRewardUnlocked(address indexed referrer, address indexed invitee, uint256 amount);
    event NodeScoreUpdated(address indexed node, uint256 score);
    event NodeRewardsClaimed(address indexed user, uint256 inviteReward, uint256 rankReward);
    event NodeRewardsCompounded(address indexed user, uint256 indexed stakeId, uint256 amount);
    event EpochOpened(uint256 indexed epochId, uint256 totalNodes, uint256 carryover, bool disabled);
    event EpochFunded(uint256 indexed epochId, address indexed funder, uint256 amount, uint256 poolAmount);
    event EpochRewardClaimed(uint256 indexed epochId, address indexed node, uint256 rank, uint256 amount);
    event EpochSettled(uint256 indexed epochId, uint256 claimed, uint256 carryover);
    event InteractionFeeConfigUpdated(address indexed feeToken, uint256 fee, address indexed receiver);
    event InteractionFeePaid(address indexed user, address indexed token, uint256 totalFee, address indexed receiver);
    event InviteRewardUpdated(uint256 reward);
    event MinReferralStakeValueUpdated(uint256 value);
    event StakeValueRateUpdated(uint256 rate);
    event OperatorUpdated(address indexed operator, bool status);
    event PriceFeedUpdated(address indexed priceFeed);
    event Paused();
    event Unpaused();
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event WrongTokenRecovered(address indexed token, address indexed to, uint256 amount);

    error NotOwner();
    error NotAdmin();
    error Reentrant();
    error ContractPaused();
    error InvalidToken();
    error InvalidFeeReceiver();
    error InvalidAmount();
    error TooManyActiveStakes();
    error CompoundTokenMismatch();
    error PreviousEpochNotSettled();
    error NoEpoch();
    error InvalidRate();
    error MustBindReferrer();
    error ReferrerMismatch();
    error NoTokensReceived();
    error StakeNotActive();
    error LockNotEnded();
    error InvalidReferrer();
    error CannotSelfRefer();
    error AlreadyHasReferrer();
    error CircularReferral();
    error NoInviteReserve();
    error InvalidPrice();
    error NoReinvestableAssets();
    error NoSuchEpoch();
    error AlreadySettled();
    error ClaimPeriodNotEnded();
    error EpochAlreadyOpened();
    error NoActiveEpoch();
    error EpochAlreadySettled();
    error PoolMerged();
    error OutOfClaimWindow();
    error NotSnapshotNode();
    error AlreadyClaimed();
    error NoReward();
    error NotNode();
    error InvalidRank();
    error InvalidAddress();
    error OwnerIsSuperAdmin();
    error CannotRecoverStakingToken();
    error CannotRecoverRewardToken();
    error CannotRecoverFeeToken();
    error NotNewOwner();
    error NativeTransferFailed();
    error TransferFailed();
    error TransferFromFailed();
    error NoRewards();
    error InsufficientBnbFee();
    error UnexpectedBnb();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyAdmin() {
        if (msg.sender != owner && !operators[msg.sender]) revert NotAdmin();
        _;
    }

    modifier nonReentrant() {
        if (_unlocked != 1) revert Reentrant();
        _unlocked = 2;
        _;
        _unlocked = 1;
    }

    modifier whenNotPaused() {
        if (paused) revert ContractPaused();
        _;
    }

    receive() external payable {}

    constructor(
        address stakingToken_,
        address rewardToken_,
        address feeReceiver_,
        uint256 interactionFee_
    ) {
        if (stakingToken_ == address(0) || rewardToken_ == address(0)) revert InvalidToken();
        if (feeReceiver_ == address(0)) revert InvalidFeeReceiver();

        stakingToken = IERC20(stakingToken_);
        rewardToken = IERC20(rewardToken_);
        feeReceiver = feeReceiver_;
        interactionFee = interactionFee_;
        inviteReward = DEFAULT_INVITE_REWARD;
        minReferralStakeValue = DEFAULT_MIN_REFERRAL_STAKE_VALUE;
        stakeValueRate = 1 ether;
        owner = msg.sender;
        startTime = block.timestamp;

        emit OwnershipTransferred(address(0), msg.sender);
        emit InteractionFeeConfigUpdated(feeReceiver_, interactionFee_, feeReceiver_);
    }

    // ---------------- 用户操作 ----------------

    function stake(uint256 amount, address referrer) external payable nonReentrant whenNotPaused {
        if (amount == 0) revert InvalidAmount();
        UserInfo storage user = userInfo[msg.sender];
        if (user.activeStakeCount >= MAX_ACTIVE_STAKES) revert TooManyActiveStakes();

        if (user.referrer == address(0)) {
            if (referrer == address(0)) revert MustBindReferrer();
            _setReferrer(msg.sender, referrer);
        } else if (referrer != address(0) && referrer != user.referrer) {
            revert ReferrerMismatch();
        }

        _collectInteractionFee(msg.sender);

        uint256 beforeBalance = stakingToken.balanceOf(address(this));
        _safeTransferFrom(stakingToken, msg.sender, address(this), amount);
        uint256 received = stakingToken.balanceOf(address(this)) - beforeBalance;
        if (received == 0) revert NoTokensReceived();

        uint256 stakeId = user.stakeCount;
        uint256 scoreValue = _stakeValue(received);

        stakeRecords[msg.sender][stakeId] = StakeRecord({
            amount: received,
            scoreValue: scoreValue,
            startTime: block.timestamp,
            active: true,
            countedToReferrer: true
        });

        user.stakeCount += 1;
        user.activeStakeCount += 1;
        user.totalStaked += received;
        user.personalStakeVolume += scoreValue;
        totalStaked += received;
        _updateNodePosition(msg.sender);

        address boundReferrer = user.referrer;
        userInfo[boundReferrer].referralStakeVolume += scoreValue;
        _updateNodePosition(boundReferrer);
        _qualifyReferral(boundReferrer, msg.sender, stakeId, scoreValue);

        emit Deposit(msg.sender, boundReferrer, stakeId, received);
    }

    function withdraw(uint256 stakeId) external payable nonReentrant whenNotPaused {
        StakeRecord storage record = stakeRecords[msg.sender][stakeId];
        if (!record.active) revert StakeNotActive();
        if (block.timestamp < record.startTime + LOCK_PERIOD) revert LockNotEnded();

        _collectInteractionFee(msg.sender);

        uint256 amount = record.amount;
        uint256 scoreValue = record.scoreValue;
        record.active = false;
        record.amount = 0;
        record.scoreValue = 0;
        record.countedToReferrer = false;

        UserInfo storage user = userInfo[msg.sender];
        user.activeStakeCount -= 1;
        user.totalWithdrawn += amount;
        user.personalStakeVolume = _subOrZero(user.personalStakeVolume, scoreValue);
        totalStaked -= amount;
        _updateNodePosition(msg.sender);

        address referrer = user.referrer;
        if (referrer != address(0)) {
            userInfo[referrer].referralStakeVolume =
                _subOrZero(userInfo[referrer].referralStakeVolume, scoreValue);
            _updateNodePosition(referrer);
        }

        _safeTransfer(stakingToken, msg.sender, amount);
        emit Withdraw(msg.sender, stakeId, amount);
    }

    function setReferrer(address referrer) external payable nonReentrant whenNotPaused {
        _collectInteractionFee(msg.sender);
        _setReferrer(msg.sender, referrer);
    }

    function claimNodeRewards() public payable nonReentrant whenNotPaused {
        _collectInteractionFee(msg.sender);
        _claimInviteRewards(msg.sender);
    }

    // ---------------- 三源复投（邀请奖励 + 排名分红 + 到期本金，免费） ----------------

    function reinvest(address referrer) external nonReentrant whenNotPaused {
        if (address(stakingToken) != address(rewardToken)) revert CompoundTokenMismatch();

        UserInfo storage user = userInfo[msg.sender];
        if (user.referrer == address(0)) revert MustBindReferrer();

        if (referrer != address(0) && referrer != user.referrer) {
            revert ReferrerMismatch();
        }

        // 1. 解锁邀请奖励
        _unlockInviteRewards(msg.sender);
        uint256 inviteAmount = user.pendingInviteRewards;

        // 2. 可领取的排名分红（遍历所有未结算且处于领取窗口的期）
        uint256 rankAmount;
        uint256 maturedCount;
        for (uint256 i = 1; i <= currentEpochId; i++) {
            Epoch storage ep = epochs[i];
            if (ep.snapshotTime == 0 || ep.settled || ep.disabled || ep.claimed[msg.sender]) continue;
            uint256 rank = epochRank[i][msg.sender];
            if (rank == 0 || rank > ep.totalNodes) continue;
            if (!_withinClaim(ep)) continue;
            uint256 share = _rankShare(ep.poolAmount, ep.totalNodes, rank);
            if (share == 0) continue;
            ep.claimed[msg.sender] = true;
            ep.totalClaimed += share;
            totalRankDistributed += share;
            totalRankClaimed += share;
            rankAmount += share;
            emit EpochRewardClaimed(i, msg.sender, rank, share);
        }

        // 3. 到期本金（扫描）
        uint256 principalAmount;
        uint256 principalScore;
        uint256 count = user.stakeCount;
        for (uint256 i = 0; i < count; i++) {
            StakeRecord storage record = stakeRecords[msg.sender][i];
            if (!record.active) continue;
            if (block.timestamp < record.startTime + LOCK_PERIOD) continue;
            principalAmount += record.amount;
            principalScore += record.scoreValue;
            maturedCount += 1;
        }

        uint256 total = inviteAmount + rankAmount + principalAmount;
        if (total == 0) revert NoReinvestableAssets();
        if (user.activeStakeCount - maturedCount + 1 > MAX_ACTIVE_STAKES) revert TooManyActiveStakes();

        // 4. 关闭到期本金并扣减其计分（排名立即变化）
        if (principalScore > 0) {
            for (uint256 i = 0; i < count; i++) {
                StakeRecord storage record = stakeRecords[msg.sender][i];
                if (!record.active) continue;
                if (block.timestamp < record.startTime + LOCK_PERIOD) continue;
                record.active = false;
                record.amount = 0;
                record.scoreValue = 0;
                record.countedToReferrer = false;
            }
            user.activeStakeCount -= maturedCount;
            user.personalStakeVolume = _subOrZero(user.personalStakeVolume, principalScore);
            totalStaked = totalStaked >= principalAmount ? totalStaked - principalAmount : 0;
            _updateNodePosition(msg.sender);

            address r = user.referrer;
            if (r != address(0)) {
                userInfo[r].referralStakeVolume =
                    _subOrZero(userInfo[r].referralStakeVolume, principalScore);
                _updateNodePosition(r);
            }
        }

        // 5. 记账邀请奖励与排名分红
        if (inviteAmount > 0) {
            user.pendingInviteRewards = 0;
            user.totalInviteClaimed += inviteAmount;
            totalInviteRewardsClaimed += inviteAmount;
        }

        // 6. 合并为一笔新质押（重新锁 15 天，按当前 U 价计分）
        uint256 stakeId = user.stakeCount;
        uint256 scoreValue = _stakeValue(total);
        stakeRecords[msg.sender][stakeId] = StakeRecord({
            amount: total,
            scoreValue: scoreValue,
            startTime: block.timestamp,
            active: true,
            countedToReferrer: true
        });

        user.stakeCount += 1;
        user.activeStakeCount += 1;
        user.totalStaked += total;
        user.personalStakeVolume += scoreValue;
        totalStaked += total;
        _updateNodePosition(msg.sender);

        address boundReferrer = user.referrer;
        userInfo[boundReferrer].referralStakeVolume += scoreValue;
        _updateNodePosition(boundReferrer);

        emit NodeRewardsClaimed(msg.sender, inviteAmount, rankAmount);
        emit Deposit(msg.sender, boundReferrer, stakeId, total);
        emit NodeRewardsCompounded(msg.sender, stakeId, total);
    }

    // ---------------- 15天结算 ----------------

    function openEpoch() external onlyAdmin nonReentrant whenNotPaused {
        if (currentEpochId > 0) {
            Epoch storage prev = epochs[currentEpochId];
            if (!prev.settled) {
                if (!_settlementTimePassed(prev)) revert PreviousEpochNotSettled();
                _settle(currentEpochId);
            }
        }

        currentEpochId += 1;
        Epoch storage ep = epochs[currentEpochId];
        if (ep.snapshotTime != 0) revert EpochAlreadyOpened();

        uint256 carry = pendingCarryover;
        pendingCarryover = 0;

        uint256 n = _nodes.length;
        ep.snapshotTime = block.timestamp;
        ep.totalNodes = n;
        ep.disabled = n < MIN_NODES;
        if (carry > 0) {
            ep.poolAmount = carry;
        }

        for (uint256 i = 0; i < n; i++) {
            address node = _nodes[i];
            uint256 personal = userInfo[node].personalStakeVolume;
            uint256 invite = userInfo[node].referralStakeVolume;
            ep.nodes.push(NodeSnapshot({
                node: node,
                personalScore: personal,
                inviteScore: invite,
                totalScore: personal + invite
            }));
            epochRank[currentEpochId][node] = i + 1;
        }

        emit EpochOpened(currentEpochId, n, carry, ep.disabled);
    }

    function fundEpoch(uint256 amount) external onlyAdmin nonReentrant whenNotPaused {
        if (amount == 0) revert InvalidAmount();
        Epoch storage ep = epochs[currentEpochId];
        if (ep.snapshotTime == 0) revert NoActiveEpoch();
        if (ep.settled) revert EpochAlreadySettled();

        uint256 beforeBalance = rewardToken.balanceOf(address(this));
        _safeTransferFrom(rewardToken, msg.sender, address(this), amount);
        uint256 received = rewardToken.balanceOf(address(this)) - beforeBalance;
        if (received == 0) revert NoTokensReceived();

        ep.poolAmount += received;
        emit EpochFunded(currentEpochId, msg.sender, received, ep.poolAmount);
    }

    function claimEpochReward() external payable nonReentrant whenNotPaused {
        _collectInteractionFee(msg.sender);
        _claimEpochReward(currentEpochId, msg.sender);
    }

    function claimEpochReward(uint256 epochId) external payable nonReentrant whenNotPaused {
        _collectInteractionFee(msg.sender);
        _claimEpochReward(epochId, msg.sender);
    }

    function settleEpoch() external onlyAdmin nonReentrant whenNotPaused {
        if (currentEpochId == 0) revert NoEpoch();
        _settle(currentEpochId);
    }

    // ---------------- 参数 / 管理 ----------------

    function setInteractionFeeConfig(address feeToken, uint256 fee, address receiver) external onlyOwner {
        if (receiver == address(0)) revert InvalidFeeReceiver();
        interactionFeeToken = IERC20(feeToken);
        interactionFee = fee;
        feeReceiver = receiver;
        emit InteractionFeeConfigUpdated(feeToken, fee, receiver);
    }

    function setInviteReward(uint256 reward) external onlyOwner {
        inviteReward = reward;
        emit InviteRewardUpdated(reward);
    }

    function setMinReferralStakeValue(uint256 value) external onlyOwner {
        minReferralStakeValue = value;
        emit MinReferralStakeValueUpdated(value);
    }

    function setStakeValueRate(uint256 rate) external onlyOwner {
        if (rate == 0) revert InvalidRate();
        stakeValueRate = rate;
        emit StakeValueRateUpdated(rate);
    }

    function setPriceFeed(address feed) external onlyOwner {
        priceFeed = feed;
        emit PriceFeedUpdated(feed);
    }

    function setOperator(address operator, bool status) external onlyOwner {
        if (operator == address(0)) revert InvalidAddress();
        if (operator == owner) revert OwnerIsSuperAdmin();
        operators[operator] = status;
        emit OperatorUpdated(operator, status);
    }

    function pause() external onlyAdmin {
        paused = true;
        emit Paused();
    }

    function unpause() external onlyAdmin {
        paused = false;
        emit Unpaused();
    }

    function recoverWrongToken(address token, address to, uint256 amount) external onlyOwner nonReentrant {
        if (token == address(0) || to == address(0)) revert InvalidAddress();
        if (token == address(stakingToken)) revert CannotRecoverStakingToken();
        if (token == address(rewardToken)) revert CannotRecoverRewardToken();
        if (token == address(interactionFeeToken)) revert CannotRecoverFeeToken();
        if (amount == 0) revert InvalidAmount();
        _safeTransfer(IERC20(token), to, amount);
        emit WrongTokenRecovered(token, to, amount);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert InvalidAddress();
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotNewOwner();
        address oldOwner = owner;
        owner = pendingOwner;
        pendingOwner = address(0);
        emit OwnershipTransferred(oldOwner, owner);
    }

    // ---------------- 视图 ----------------

    function getUserInfo(address user) external view returns (
        UserInfo memory info,
        uint256 pendingRewards,
        uint256 totalClaimed,
        uint256 rank
    ) {
        UserInfo memory infoCopy = userInfo[user];
        return (
            infoCopy,
            pendingRewardAll(user),
            userInfo[user].totalInviteClaimed,
            getNodeRank(user)
        );
    }

    function getUserStakes(address user) external view returns (
        uint256[] memory stakeIds,
        uint256[] memory amounts,
        uint256[] memory scoreValues,
        uint256[] memory startTimes,
        bool[] memory actives
    ) {
        uint256 count = userInfo[user].stakeCount;
        stakeIds = new uint256[](count);
        amounts = new uint256[](count);
        scoreValues = new uint256[](count);
        startTimes = new uint256[](count);
        actives = new bool[](count);
        for (uint256 i = 0; i < count; i++) {
            StakeRecord memory record = stakeRecords[user][i];
            stakeIds[i] = i;
            amounts[i] = record.amount;
            scoreValues[i] = record.scoreValue;
            startTimes[i] = record.startTime;
            actives[i] = record.active;
        }
    }

    function getStakeRecord(address user, uint256 stakeId) external view returns (
        uint256 amount,
        uint256 scoreValue,
        uint256 stakeStartTime,
        bool active
    ) {
        StakeRecord memory record = stakeRecords[user][stakeId];
        return (record.amount, record.scoreValue, record.startTime, record.active);
    }

    function getInviteRewardLocks(address referrer) external view returns (
        address[] memory invitees,
        uint256[] memory stakeIds,
        uint256[] memory amounts,
        uint256[] memory unlockTimes,
        uint256 cursor
    ) {
        InviteRewardLock[] storage locks = _inviteRewardLocks[referrer];
        invitees = new address[](locks.length);
        stakeIds = new uint256[](locks.length);
        amounts = new uint256[](locks.length);
        unlockTimes = new uint256[](locks.length);
        for (uint256 i = 0; i < locks.length; i++) {
            InviteRewardLock memory rewardLock = locks[i];
            invitees[i] = rewardLock.invitee;
            stakeIds[i] = rewardLock.stakeId;
            amounts[i] = rewardLock.amount;
            unlockTimes[i] = rewardLock.unlockTime;
        }
        cursor = userInfo[referrer].inviteUnlockCursor;
    }

    function pendingRewardAll(address user) public view returns (uint256) {
        return userInfo[user].pendingInviteRewards + _unlockedInviteRewardView(user);
    }

    function getMiningStatus() external view returns (
        uint256 _totalStaked,
        uint256 _totalDistributed,
        uint256 _claimableRewards,
        bool _releaseInProgress,
        uint256 _startTime,
        uint256 _rankedNodeCount
    ) {
        return (
            totalStaked,
            totalRankDistributed + totalInviteRewardsAccrued,
            totalInviteRewardsAccrued - totalInviteRewardsClaimed,
            _hasActiveEpoch(),
            startTime,
            _nodes.length
        );
    }

    function getInteractionFeeConfig() external view returns (
        address feeToken,
        uint256 fee,
        address receiverA,
        address receiverB
    ) {
        return (address(interactionFeeToken), interactionFee, feeReceiver, feeReceiver);
    }

    function getCurrentRelease() external view returns (
        uint256 epochId,
        uint256 poolAmount,
        uint256 totalNodes,
        uint256 totalClaimed,
        uint256 claimStart,
        uint256 claimEnd,
        bool settled,
        bool disabled
    ) {
        Epoch storage ep = epochs[currentEpochId];
        if (ep.snapshotTime == 0) {
            return (currentEpochId, 0, 0, 0, 0, 0, false, false);
        }
        return (
            currentEpochId,
            ep.poolAmount,
            ep.totalNodes,
            ep.totalClaimed,
            _claimStart(ep),
            _claimEnd(ep),
            ep.settled,
            ep.disabled
        );
    }

    function getEpoch(uint256 epochId) external view returns (
        NodeSnapshot[] memory nodes,
        uint256 snapshotTime,
        uint256 poolAmount,
        uint256 totalClaimed,
        uint256 totalNodes,
        bool settled,
        bool disabled
    ) {
        Epoch storage ep = epochs[epochId];
        return (ep.nodes, ep.snapshotTime, ep.poolAmount, ep.totalClaimed, ep.totalNodes, ep.settled, ep.disabled);
    }

    function pendingEpochReward(uint256 epochId, address node) external view returns (uint256) {
        Epoch storage ep = epochs[epochId];
        if (ep.snapshotTime == 0 || ep.settled || ep.disabled || ep.claimed[node]) return 0;
        uint256 rank = epochRank[epochId][node];
        if (rank == 0 || rank > ep.totalNodes) return 0;
        if (!_withinClaim(ep)) return 0;
        return _rankShare(ep.poolAmount, ep.totalNodes, rank);
    }

    function getNodeRank(address node) public view returns (uint256) {
        return _nodeIndexPlusOne[node];
    }

    function getRankedNodeCount() external view returns (uint256) {
        return _nodes.length;
    }

    function getRankedNodes(uint256 offset, uint256 limit) external view returns (
        address[] memory nodes,
        uint256[] memory scores,
        uint256 total
    ) {
        total = _nodes.length;
        if (offset >= total) {
            return (new address[](0), new uint256[](0), total);
        }
        uint256 end = offset + limit;
        if (end > total) end = total;
        nodes = new address[](end - offset);
        scores = new uint256[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            address node = _nodes[i];
            nodes[i - offset] = node;
            scores[i - offset] = userInfo[node].personalStakeVolume + userInfo[node].referralStakeVolume;
        }
    }

    function getRankRewardPreview(uint256 amount, uint256 totalNodes, uint256 rank) external pure returns (uint256) {
        if (totalNodes == 0 || rank == 0 || rank > totalNodes) return 0;
        return _rankShare(amount, totalNodes, rank);
    }

    function getReferrals(address user) external view returns (address[] memory) {
        return _referrals[user];
    }

    function getReferralsPaginated(address user, uint256 offset, uint256 limit) external view returns (
        address[] memory result,
        uint256 total
    ) {
        address[] storage refs = _referrals[user];
        total = refs.length;
        if (offset >= total) {
            return (new address[](0), total);
        }
        uint256 end = offset + limit;
        if (end > total) end = total;
        result = new address[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            result[i - offset] = refs[i];
        }
    }

    function hasReferrer(address user) external view returns (bool) {
        return userInfo[user].referrer != address(0);
    }

    function hasClaimed(uint256 epochId, address node) external view returns (bool) {
        return epochs[epochId].claimed[node];
    }

    // 复投预览：返回可复投的邀请奖励、排名分红、到期本金及其合计
    function getReinvestPreview(address user) external view returns (
        uint256 inviteAmount,
        uint256 rankAmount,
        uint256 principalAmount,
        uint256 totalAmount,
        uint256 maturedStakeCount
    ) {
        UserInfo storage info = userInfo[user];
        inviteAmount = info.pendingInviteRewards + _unlockedInviteRewardView(user);

        for (uint256 i = 1; i <= currentEpochId; i++) {
            Epoch storage ep = epochs[i];
            if (ep.snapshotTime == 0 || ep.settled || ep.disabled || ep.claimed[user]) continue;
            uint256 rank = epochRank[i][user];
            if (rank == 0 || rank > ep.totalNodes) continue;
            if (!_withinClaim(ep)) continue;
            rankAmount += _rankShare(ep.poolAmount, ep.totalNodes, rank);
        }

        uint256 count = info.stakeCount;
        for (uint256 i = 0; i < count; i++) {
            StakeRecord storage record = stakeRecords[user][i];
            if (!record.active) continue;
            if (block.timestamp < record.startTime + LOCK_PERIOD) continue;
            principalAmount += record.amount;
            maturedStakeCount += 1;
        }

        totalAmount = inviteAmount + rankAmount + principalAmount;
    }

    // ---------------- 内部 ----------------

    function _settle(uint256 epochId) internal {
        Epoch storage ep = epochs[epochId];
        if (ep.snapshotTime == 0) revert NoSuchEpoch();
        if (ep.settled) revert AlreadySettled();
        if (!ep.disabled) {
            if (!_pastClaimEnd(ep)) revert ClaimPeriodNotEnded();
        }
        uint256 unclaimed = ep.poolAmount > ep.totalClaimed ? ep.poolAmount - ep.totalClaimed : 0;
        ep.settled = true;
        pendingCarryover += unclaimed;
        emit EpochSettled(epochId, ep.totalClaimed, unclaimed);
    }

    function _claimEpochReward(uint256 epochId, address node) internal {
        Epoch storage ep = epochs[epochId];
        if (ep.snapshotTime == 0) revert NoSuchEpoch();
        if (ep.settled) revert EpochAlreadySettled();
        if (ep.disabled) revert PoolMerged();
        if (!_withinClaim(ep)) revert OutOfClaimWindow();

        uint256 rank = epochRank[epochId][node];
        if (rank == 0 || rank > ep.totalNodes) revert NotSnapshotNode();
        if (ep.claimed[node]) revert AlreadyClaimed();
        uint256 share = _rankShare(ep.poolAmount, ep.totalNodes, rank);
        if (share == 0) revert NoReward();

        ep.claimed[node] = true;
        ep.totalClaimed += share;
        totalRankDistributed += share;
        totalRankClaimed += share;

        _safeTransfer(rewardToken, node, share);
        emit EpochRewardClaimed(epochId, node, rank, share);
    }

    function _setReferrer(address user, address referrer) internal {
        if (referrer == address(0)) revert InvalidReferrer();
        if (referrer == user) revert CannotSelfRefer();
        if (userInfo[user].referrer != address(0)) revert AlreadyHasReferrer();
        if (_createsReferralCycle(user, referrer)) revert CircularReferral();
        userInfo[user].referrer = referrer;
        _referrals[referrer].push(user);
        emit ReferrerSet(user, referrer);
    }

    function _qualifyReferral(address referrer, address user, uint256 stakeId, uint256 scoreValue) internal {
        if (qualifiedReferral[referrer][user]) return;
        if (scoreValue < minReferralStakeValue) return;
        if (_rewardReserveAvailable() < inviteReward) revert NoInviteReserve();
        qualifiedReferral[referrer][user] = true;
        userInfo[referrer].directReferrals += 1;
        userInfo[referrer].lockedInviteRewards += inviteReward;
        totalInviteRewardsAccrued += inviteReward;
        _inviteRewardLocks[referrer].push(InviteRewardLock({
            invitee: user,
            stakeId: stakeId,
            amount: inviteReward,
            unlockTime: block.timestamp + LOCK_PERIOD
        }));
        emit ReferralQualified(referrer, user, inviteReward);
    }

    // U 本位计分：优先取链上实时价格折算 U 价值，未配置价格源时回退固定汇率
    function _stakeValue(uint256 amount) internal view returns (uint256) {
        address feed = priceFeed;
        if (feed != address(0)) {
            uint256 price = IPriceFeed(feed).getPrice();
            if (price == 0) revert InvalidPrice();
            return amount * price / 1 ether;
        }
        return amount * stakeValueRate / 1 ether;
    }

    // 维护降序节点表：新节点插入末尾后上浮，已有节点分数升高上浮、降低下沉，保证始终有序
    function _updateNodePosition(address node) internal {
        uint256 score = userInfo[node].personalStakeVolume + userInfo[node].referralStakeVolume;
        uint256 indexPlusOne = _nodeIndexPlusOne[node];

        if (score == 0) {
            if (indexPlusOne != 0) {
                _removeNode(node);
            }
            emit NodeScoreUpdated(node, 0);
            return;
        }

        if (indexPlusOne == 0) {
            _nodes.push(node);
            _nodeIndexPlusOne[node] = _nodes.length;
            indexPlusOne = _nodes.length;
        }

        uint256 pos = indexPlusOne - 1;
        // 分数升高：向上冒泡（前一名分数严格小于当前）
        while (pos > 0 && _scoreOf(_nodes[pos - 1]) < score) {
            _nodes[pos] = _nodes[pos - 1];
            _nodeIndexPlusOne[_nodes[pos]] = pos + 1;
            pos -= 1;
        }
        // 分数降低：向下沉（后一名分数严格大于当前）
        uint256 last = _nodes.length - 1;
        while (pos < last && _scoreOf(_nodes[pos + 1]) > score) {
            _nodes[pos] = _nodes[pos + 1];
            _nodeIndexPlusOne[_nodes[pos]] = pos + 1;
            pos += 1;
        }
        _nodes[pos] = node;
        _nodeIndexPlusOne[node] = pos + 1;
        emit NodeScoreUpdated(node, score);
    }

    // 前移覆盖式删除，保持降序不变
    function _removeNode(address node) internal {
        uint256 indexPlusOne = _nodeIndexPlusOne[node];
        if (indexPlusOne == 0) revert NotNode();
        uint256 pos = indexPlusOne - 1;
        uint256 last = _nodes.length - 1;
        for (uint256 i = pos; i < last; i++) {
            _nodes[i] = _nodes[i + 1];
            _nodeIndexPlusOne[_nodes[i]] = i + 1;
        }
        _nodes.pop();
        delete _nodeIndexPlusOne[node];
    }

    function _scoreOf(address node) internal view returns (uint256) {
        return userInfo[node].personalStakeVolume + userInfo[node].referralStakeVolume;
    }

    // 动态度权分配：按快照节点总数决定开启档位及权重，档内等分，档末兜底尾差，确保 100% 分完
    function _rankShare(uint256 pool, uint256 totalNodes, uint256 rank) internal pure returns (uint256) {
        if (totalNodes == 0) return 0;
        uint256[4] memory weights = _bucketWeights(totalNodes);
        uint256 activeWeight;
        for (uint256 i = 0; i < 4; i++) activeWeight += weights[i];
        if (activeWeight == 0) return 0;

        uint256 tier = _tierOf(rank);
        uint256 counts = _groupCounts(totalNodes, tier);
        if (counts == 0) revert InvalidRank();

        uint256 tierPool = pool * weights[tier] / activeWeight;
        uint256 base = tierPool / counts;
        uint256 firstRank = _tierFirstRank(tier);
        uint256 lastRank = firstRank + counts - 1;

        if (rank == lastRank) {
            return base + (tierPool - base * counts);
        }
        return base;
    }

    function _bucketWeights(uint256 totalNodes) internal pure returns (uint256[4] memory weights) {
        if (totalNodes <= 10) {
            weights = [uint256(10000), 0, 0, 0];
        } else if (totalNodes <= 50) {
            weights = [uint256(5000), 5000, 0, 0];
        } else if (totalNodes <= 100) {
            weights = [uint256(5000), 3000, 2000, 0];
        } else {
            weights = [uint256(5000), 3000, 1500, 500];
        }
    }

    function _tierOf(uint256 rank) internal pure returns (uint256) {
        if (rank <= 10) return 0;
        if (rank <= 50) return 1;
        if (rank <= 100) return 2;
        return 3;
    }

    function _tierFirstRank(uint256 tier) internal pure returns (uint256) {
        if (tier == 0) return 1;
        if (tier == 1) return 11;
        if (tier == 2) return 51;
        return 101;
    }

    function _groupCounts(uint256 totalNodes, uint256 tier) internal pure returns (uint256) {
        if (tier == 0) return totalNodes > 10 ? 10 : totalNodes;
        if (tier == 1) return totalNodes > 10 ? (totalNodes > 50 ? 40 : totalNodes - 10) : 0;
        if (tier == 2) return totalNodes > 50 ? (totalNodes > 100 ? 50 : totalNodes - 50) : 0;
        return totalNodes > 100 ? totalNodes - 100 : 0;
    }

    function _pendingNodeRewards() internal view returns (uint256) {
        return totalInviteRewardsAccrued - totalInviteRewardsClaimed;
    }

    function _rewardReserveAvailable() internal view returns (uint256) {
        uint256 balance = rewardToken.balanceOf(address(this));
        // 预留项 1：未领取的邀请奖励（已锁定 + 已解锁未领）负债
        uint256 reserved = _pendingNodeRewards();
        // 预留项 2：当前活跃期尚未领取的排名奖池（后续结算将结转）
        Epoch storage activeEp = epochs[currentEpochId];
        if (activeEp.snapshotTime > 0 && !activeEp.settled && !activeEp.disabled) {
            reserved += activeEp.poolAmount - activeEp.totalClaimed;
        }
        // 预留项 3：待结转的上期未领取奖励
        reserved += pendingCarryover;
        // 预留项 4：质押本金（同币种时不可挪作奖励）
        if (address(stakingToken) == address(rewardToken)) {
            reserved += totalStaked;
        }
        return balance > reserved ? balance - reserved : 0;
    }

    function _hasActiveEpoch() internal view returns (bool) {
        Epoch storage ep = epochs[currentEpochId];
        return ep.snapshotTime > 0 && !ep.settled && !_pastClaimEnd(ep);
    }

    function _claimStart(Epoch storage ep) internal view returns (uint256) {
        return ep.snapshotTime + DISPLAY_PERIOD;
    }

    function _claimEnd(Epoch storage ep) internal view returns (uint256) {
        return ep.snapshotTime + DISPLAY_PERIOD + CLAIM_PERIOD;
    }

    function _withinClaim(Epoch storage ep) internal view returns (bool) {
        uint256 start = _claimStart(ep);
        uint256 end = _claimEnd(ep);
        return block.timestamp >= start && block.timestamp < end;
    }

    function _pastClaimEnd(Epoch storage ep) internal view returns (bool) {
        return block.timestamp >= _claimEnd(ep);
    }

    function _settlementTimePassed(Epoch storage ep) internal view returns (bool) {
        if (ep.snapshotTime == 0) return true;
        if (ep.disabled) return block.timestamp >= ep.snapshotTime;
        return _pastClaimEnd(ep);
    }

    function _createsReferralCycle(address user, address referrer) internal view returns (bool) {
        address current = referrer;
        for (uint256 i = 0; i < MAX_REFERRAL_DEPTH && current != address(0); i++) {
            if (current == user) return true;
            current = userInfo[current].referrer;
        }
        return false;
    }

    function _unlockInviteRewards(address referrer) internal {
        UserInfo storage info = userInfo[referrer];
        InviteRewardLock[] storage locks = _inviteRewardLocks[referrer];
        uint256 cursor = info.inviteUnlockCursor;
        uint256 unlocked;
        while (cursor < locks.length && locks[cursor].unlockTime <= block.timestamp) {
            unlocked += locks[cursor].amount;
            emit InviteRewardUnlocked(referrer, locks[cursor].invitee, locks[cursor].amount);
            cursor += 1;
        }
        if (unlocked > 0) {
            info.inviteUnlockCursor = cursor;
            info.lockedInviteRewards -= unlocked;
            info.pendingInviteRewards += unlocked;
        }
    }

    function _unlockedInviteRewardView(address referrer) internal view returns (uint256 unlocked) {
        UserInfo storage info = userInfo[referrer];
        InviteRewardLock[] storage locks = _inviteRewardLocks[referrer];
        uint256 cursor = info.inviteUnlockCursor;
        while (cursor < locks.length && locks[cursor].unlockTime <= block.timestamp) {
            unlocked += locks[cursor].amount;
            cursor += 1;
        }
    }

    function _collectInteractionFee(address user) internal {
        if (interactionFee == 0) return;
        address feeToken = address(interactionFeeToken);
        if (feeToken == address(0)) {
            if (msg.value < interactionFee) revert InsufficientBnbFee();
            _safeTransferNative(feeReceiver, interactionFee);
            uint256 refund = msg.value - interactionFee;
            if (refund > 0) {
                _safeTransferNative(user, refund);
            }
        } else {
            if (msg.value != 0) revert UnexpectedBnb();
            _safeTransferFrom(IERC20(feeToken), user, feeReceiver, interactionFee);
        }
        emit InteractionFeePaid(user, feeToken, interactionFee, feeReceiver);
    }

    function _safeTransferNative(address to, uint256 amount) internal {
        (bool ok, ) = payable(to).call{value: amount}("");
        if (!ok) revert NativeTransferFailed();
    }

    function _claimInviteRewards(address user) internal {
        _unlockInviteRewards(user);
        UserInfo storage info = userInfo[user];
        uint256 amount = info.pendingInviteRewards;
        if (amount == 0) revert NoRewards();
        info.pendingInviteRewards = 0;
        info.totalInviteClaimed += amount;
        totalInviteRewardsClaimed += amount;
        _safeTransfer(rewardToken, user, amount);
        emit NodeRewardsClaimed(user, amount, 0);
    }

    function _subOrZero(uint256 a, uint256 b) internal pure returns (uint256) {
        return a >= b ? a - b : 0;
    }

    function _safeTransfer(IERC20 token, address to, uint256 amount) internal {
        if (!token.transfer(to, amount)) revert TransferFailed();
    }

    function _safeTransferFrom(IERC20 token, address from, address to, uint256 amount) internal {
        if (!token.transferFrom(from, to, amount)) revert TransferFromFailed();
    }
}
