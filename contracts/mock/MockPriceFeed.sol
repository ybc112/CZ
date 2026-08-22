// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// 测试用实时价格源：owner 可随时改价，模拟链上实时价格
contract MockPriceFeed {
    address public owner;
    uint256 public price;

    event PriceSet(uint256 price);

    constructor(uint256 initialPrice) {
        owner = msg.sender;
        price = initialPrice;
    }

    function getPrice() external view returns (uint256) {
        return price;
    }

    function setPrice(uint256 newPrice) external {
        require(msg.sender == owner, "not owner");
        price = newPrice;
        emit PriceSet(newPrice);
    }
}
