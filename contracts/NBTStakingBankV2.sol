// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function allowance(address owner, address spender) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

contract NBTStakingBankV2 {
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
    event Paused();
    event Unpaused();
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event WrongTokenRecovered(address indexed token, address indexed to, uint256 amount);

    modifier onlyOwner() {
        require(msg.sender == owner, "Ownable: caller is not the owner");
        _;
    }

    modifier onlyAdmin() {
        require(msg.sender == owner || operators[msg.sender], "Admin: caller is not admin");
        _;
    }

    modifier nonReentrant() {
        require(_unlocked == 1, "ReentrancyGuard: reentrant call");
        _unlocked = 2;
        _;
        _unlocked = 1;
    }

    modifier whenNotPaused() {
        require(!paused, "Paused");
        _;
    }

    receive() external payable {}

    constructor(
        address stakingToken_,
        address rewardToken_,
        address feeReceiver_,
        uint256 interactionFee_
    ) {
        require(stakingToken_ != address(0) && rewardToken_ != address(0), "Invalid token");
        require(feeReceiver_ != address(0), "Invalid fee receiver");

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
        require(amount > 0, "Invalid amount");
        UserInfo storage user = userInfo[msg.sender];
        require(user.activeStakeCount < MAX_ACTIVE_STAKES, "Too many active stakes");

        if (user.referrer == address(0)) {
            require(referrer != address(0), "Must bind referrer first");
            _setReferrer(msg.sender, referrer);
        } else if (referrer != address(0) && referrer != user.referrer) {
            revert("Referrer mismatch");
        }

        _collectInteractionFee(msg.sender);

        uint256 beforeBalance = stakingToken.balanceOf(address(this));
        _safeTransferFrom(stakingToken, msg.sender, address(this), amount);
        uint256 received = stakingToken.balanceOf(address(this)) - beforeBalance;
        require(received > 0, "No tokens received");

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
        require(record.active, "Stake not active");
        require(block.timestamp >= record.startTime + LOCK_PERIOD, "Lock period not ended");

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

    function claimReferralRewards() external payable {
        claimNodeRewards();
    }

    function claimAll() external payable {
        claimNodeRewards();
    }

    function compoundNodeRewards(address referrer) external payable nonReentrant whenNotPaused {
        require(address(stakingToken) == address(rewardToken), "Compound token mismatch");

        UserInfo storage user = userInfo[msg.sender];
        require(user.activeStakeCount < MAX_ACTIVE_STAKES, "Too many active stakes");

        if (user.referrer == address(0)) {
            require(referrer != address(0), "Must bind referrer first");
            _setReferrer(msg.sender, referrer);
        } else if (referrer != address(0) && referrer != user.referrer) {
            revert("Referrer mismatch");
        }
        require(user.referrer != address(0), "Must bind referrer first");

        _collectInteractionFee(msg.sender);

        _unlockInviteRewards(msg.sender);
        uint256 amount = user.pendingInviteRewards;
        require(amount > 0, "No rewards");

        user.pendingInviteRewards = 0;
        user.totalInviteClaimed += amount;
        totalInviteRewardsClaimed += amount;

        uint256 stakeId = user.stakeCount;
        uint256 scoreValue = _stakeValue(amount);

        stakeRecords[msg.sender][stakeId] = StakeRecord({
            amount: amount,
            scoreValue: scoreValue,
            startTime: block.timestamp,
            active: true,
            countedToReferrer: true
        });

        user.stakeCount += 1;
        user.activeStakeCount += 1;
        user.totalStaked += amount;
        user.personalStakeVolume += scoreValue;
        totalStaked += amount;
        _updateNodePosition(msg.sender);

        address boundReferrer = user.referrer;
        userInfo[boundReferrer].referralStakeVolume += scoreValue;
        _updateNodePosition(boundReferrer);

        emit NodeRewardsClaimed(msg.sender, amount, 0);
        emit Deposit(msg.sender, boundReferrer, stakeId, amount);
        emit NodeRewardsCompounded(msg.sender, stakeId, amount);
    }

    // ---------------- 15天结算 ----------------

    function openEpoch() external onlyAdmin nonReentrant whenNotPaused {
        if (currentEpochId > 0) {
            Epoch storage prev = epochs[currentEpochId];
            if (!prev.settled) {
                require(_settlementTimePassed(prev), "Previous epoch not settled");
                _settle(currentEpochId);
            }
        }

        currentEpochId += 1;
        Epoch storage ep = epochs[currentEpochId];
        require(ep.snapshotTime == 0, "Epoch already opened");

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
        require(amount > 0, "Invalid amount");
        Epoch storage ep = epochs[currentEpochId];
        require(ep.snapshotTime > 0, "No active epoch");
        require(!ep.settled, "Epoch settled");

        uint256 beforeBalance = rewardToken.balanceOf(address(this));
        _safeTransferFrom(rewardToken, msg.sender, address(this), amount);
        uint256 received = rewardToken.balanceOf(address(this)) - beforeBalance;
        require(received > 0, "No tokens received");

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
        require(currentEpochId > 0, "No epoch");
        _settle(currentEpochId);
    }

    // ---------------- 参数 / 管理 ----------------

    function setInteractionFeeConfig(address feeToken, uint256 fee, address receiver) external onlyOwner {
        require(receiver != address(0), "Invalid fee receiver");
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
        require(rate > 0, "Invalid rate");
        stakeValueRate = rate;
        emit StakeValueRateUpdated(rate);
    }

    function setOperator(address operator, bool status) external onlyOwner {
        require(operator != address(0), "Invalid address");
        require(operator != owner, "Owner is super admin");
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
        require(token != address(0) && to != address(0), "Invalid address");
        require(token != address(stakingToken), "Cannot recover staking token");
        require(token != address(rewardToken), "Cannot recover reward token");
        require(token != address(interactionFeeToken), "Cannot recover fee token");
        require(amount > 0, "Invalid amount");
        _safeTransfer(IERC20(token), to, amount);
        emit WrongTokenRecovered(token, to, amount);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Invalid address");
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnership() external {
        require(msg.sender == pendingOwner, "Ownable: caller is not the new owner");
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
        if (totalNodes == 0) return 0;
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

    // ---------------- 内部 ----------------

    function _settle(uint256 epochId) internal {
        Epoch storage ep = epochs[epochId];
        require(ep.snapshotTime > 0, "No such epoch");
        require(!ep.settled, "Already settled");
        if (!ep.disabled) {
            require(_pastClaimEnd(ep), "Claim period not ended");
        }
        uint256 unclaimed = ep.poolAmount > ep.totalClaimed ? ep.poolAmount - ep.totalClaimed : 0;
        ep.settled = true;
        pendingCarryover += unclaimed;
        emit EpochSettled(epochId, ep.totalClaimed, unclaimed);
    }

    function _claimEpochReward(uint256 epochId, address node) internal {
        Epoch storage ep = epochs[epochId];
        require(ep.snapshotTime > 0, "No such epoch");
        require(!ep.settled, "Epoch settled");
        require(!ep.disabled, "Pool merged to next epoch");
        require(_withinClaim(ep), "Out of claim window");

        uint256 rank = epochRank[epochId][node];
        require(rank > 0 && rank <= ep.totalNodes, "Not a snapshot node");
        require(!ep.claimed[node], "Already claimed");
        uint256 share = _rankShare(ep.poolAmount, ep.totalNodes, rank);
        require(share > 0, "No reward");

        ep.claimed[node] = true;
        ep.totalClaimed += share;
        totalRankDistributed += share;
        totalRankClaimed += share;

        _safeTransfer(rewardToken, node, share);
        emit EpochRewardClaimed(epochId, node, rank, share);
    }

    function _setReferrer(address user, address referrer) internal {
        require(referrer != address(0), "Invalid referrer");
        require(referrer != user, "Cannot refer self");
        require(userInfo[user].referrer == address(0), "Already has referrer");
        require(!_createsReferralCycle(user, referrer), "Circular referral not allowed");
        userInfo[user].referrer = referrer;
        _referrals[referrer].push(user);
        emit ReferrerSet(user, referrer);
    }

    function _qualifyReferral(address referrer, address user, uint256 stakeId, uint256 scoreValue) internal {
        if (qualifiedReferral[referrer][user]) return;
        if (scoreValue < minReferralStakeValue) return;
        require(_rewardReserveAvailable() >= inviteReward, "Insufficient invite reward reserve");
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

    function _stakeValue(uint256 amount) internal view returns (uint256) {
        return amount * stakeValueRate / 1 ether;
    }

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
        }

        _rebalanceNode(node);
        emit NodeScoreUpdated(node, score);
    }

    function _removeNode(address node) internal {
        uint256 index = _nodeIndexPlusOne[node] - 1;
        uint256 last = _nodes.length - 1;
        if (index != last) {
            address moved = _nodes[last];
            _nodes[index] = moved;
            _nodeIndexPlusOne[moved] = index + 1;
        }
        _nodes.pop();
        _nodeIndexPlusOne[node] = 0;

        if (index < _nodes.length) {
            _rebalanceNode(_nodes[index]);
        }
    }

    function _rebalanceNode(address node) internal {
        uint256 index = _nodeIndexPlusOne[node] - 1;
        while (index > 0 && _isHigherRank(node, _nodes[index - 1])) {
            _swapNodes(index, index - 1);
            index -= 1;
        }
        while (index + 1 < _nodes.length && _isHigherRank(_nodes[index + 1], node)) {
            _swapNodes(index, index + 1);
            index += 1;
        }
    }

    function _swapNodes(uint256 a, uint256 b) internal {
        address nodeA = _nodes[a];
        address nodeB = _nodes[b];
        _nodes[a] = nodeB;
        _nodes[b] = nodeA;
        _nodeIndexPlusOne[nodeA] = b + 1;
        _nodeIndexPlusOne[nodeB] = a + 1;
    }

    function _scoreOf(address a) internal view returns (uint256) {
        return userInfo[a].personalStakeVolume + userInfo[a].referralStakeVolume;
    }

    function _isHigherRank(address a, address b) internal view returns (bool) {
        uint256 scoreA = _scoreOf(a);
        uint256 scoreB = _scoreOf(b);
        if (scoreA != scoreB) return scoreA > scoreB;
        return uint160(a) < uint160(b);
    }

    function _claimInviteRewards(address user) internal {
        _unlockInviteRewards(user);
        UserInfo storage info = userInfo[user];
        uint256 amount = info.pendingInviteRewards;
        require(amount > 0, "No rewards");
        info.pendingInviteRewards = 0;
        info.totalInviteClaimed += amount;
        totalInviteRewardsClaimed += amount;
        _safeTransfer(rewardToken, user, amount);
        emit NodeRewardsClaimed(user, amount, 0);
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
            require(msg.value >= interactionFee, "Insufficient BNB fee");
            _safeTransferNative(feeReceiver, interactionFee);
            uint256 refund = msg.value - interactionFee;
            if (refund > 0) {
                _safeTransferNative(user, refund);
            }
        } else {
            require(msg.value == 0, "Unexpected BNB");
            _safeTransferFrom(IERC20(feeToken), user, feeReceiver, interactionFee);
        }
        emit InteractionFeePaid(user, feeToken, interactionFee, feeReceiver);
    }

    function _safeTransferNative(address to, uint256 amount) internal {
        (bool ok, ) = payable(to).call{value: amount}("");
        require(ok, "Native transfer failed");
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
        require(counts > 0, "Invalid rank");

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
        uint256 reserved = _pendingNodeRewards() + _activeEpochTotalClaimed();
        if (address(stakingToken) == address(rewardToken)) {
            reserved += totalStaked;
        }
        return balance > reserved ? balance - reserved : 0;
    }

    // 预留：当前活跃期已分配的奖励额度视为已占用，避免邀请奖励透支尚未解锁的奖励池
    function _activeEpochTotalClaimed() internal view returns (uint256) {
        Epoch storage ep = epochs[currentEpochId];
        if (ep.snapshotTime == 0 || ep.settled) return 0;
        return ep.totalClaimed;
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

    function _subOrZero(uint256 a, uint256 b) internal pure returns (uint256) {
        return a >= b ? a - b : 0;
    }

    function _safeTransfer(IERC20 token, address to, uint256 amount) internal {
        require(token.transfer(to, amount), "Transfer failed");
    }

    function _safeTransferFrom(IERC20 token, address from, address to, uint256 amount) internal {
        require(token.transferFrom(from, to, amount), "TransferFrom failed");
    }
}