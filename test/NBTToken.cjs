const { expect } = require("chai");
const { loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { ethers } = require("hardhat");

const WEI = (x) => ethers.parseEther(x);
const FEE = 200; // 2%

async function tokenFixture() {
  const [owner, feeRec, pair, alice, excluded] = await ethers.getSigners();
  // 构造即设 pair + 一个豁免地址
  const Token = await ethers.getContractFactory("NBTToken");
  const token = await Token.deploy(
    "NBT", "NBT", WEI("100000"),
    feeRec.address, FEE, FEE, [pair.address], [excluded.address]
  );
  await token.transfer(alice.address, WEI("1000"));
  return { owner, feeRec, pair, alice, excluded, token };
}

describe("NBTToken 审计测试", function () {
  describe("构造", function () {
    it("初始化供应、费用豁免、pair、费用配置", async function () {
      const { token, owner, feeRec, excluded } = await loadFixture(tokenFixture);
      expect(await token.totalSupply()).to.equal(WEI("100000"));
      expect(await token.symbol()).to.equal("NBT");
      expect(await token.name()).to.equal("NBT");
      expect(await token.isExcludedFromFee(owner.address)).to.equal(true);
      expect(await token.isExcludedFromFee(feeRec.address)).to.equal(true);
      expect(await token.isExcludedFromFee(excluded.address)).to.equal(true);
      const [b, s, r] = await token.getFeeConfig();
      expect(b).to.equal(FEE);
      expect(s).to.equal(FEE);
      expect(r).to.equal(feeRec.address);
    });
  });

  describe("标准 ERC20", function () {
    it("transfer 余额不足拒绝", async function () {
      const { token, alice, feeRec } = await loadFixture(tokenFixture);
      await expect(token.connect(alice).transfer(feeRec.address, WEI("999999"))).to.be.revertedWith(
        "Insufficient balance"
      );
    });

    it("approve / transferFrom 扣减 allowance 且越权拒绝", async function () {
      const { token, owner, alice, feeRec } = await loadFixture(tokenFixture);
      await token.connect(alice).approve(owner.address, WEI("20"));
      expect(await token.allowance(alice.address, owner.address)).to.equal(WEI("20"));
      // owner 从 alice 转给 feeRec（非 pair，无费）
      await token.transferFrom(alice.address, feeRec.address, WEI("20"));
      expect(await token.balanceOf(feeRec.address)).to.equal(WEI("20"));
      expect(await token.allowance(alice.address, owner.address)).to.equal(0);
      await expect(token.transferFrom(alice.address, feeRec.address, WEI("1"))).to.be.revertedWith(
        "ERC20: insufficient allowance"
      );
    });

    it("burn 销毁减少总供应", async function () {
      const { token, alice } = await loadFixture(tokenFixture);
      const before = await token.totalSupply();
      await token.connect(alice).burn(WEI("100"));
      expect(await token.totalSupply()).to.equal(before - WEI("100"));
      expect(await token.balanceOf(alice.address)).to.equal(WEI("900"));
    });
  });

  describe("买卖费用", function () {
    it("普通地址转给 pair(sell) 收取卖费到 feeReceiver", async function () {
      const { token, alice, pair, feeRec } = await loadFixture(tokenFixture);
      const feeRecBefore = await token.balanceOf(feeRec.address);
      await token.connect(alice).transfer(pair.address, WEI("1000"));
      // 卖费 2% = 20
      expect(await token.balanceOf(pair.address)).to.equal(WEI("980"));
      expect(await token.balanceOf(feeRec.address)).to.equal(feeRecBefore + WEI("20"));
    });

    it("pair 转给普通地址(buy) 收取买费", async function () {
      const { token, alice, pair, feeRec } = await loadFixture(tokenFixture);
      // 先让 pair 有余额
      await token.connect(alice).transfer(pair.address, WEI("1000"));
      const feeRecBefore = await token.balanceOf(feeRec.address);
      await token.connect(pair).transfer(alice.address, WEI("500"));
      // 买费(转出方是 pair) 2% = 10
      expect(await token.balanceOf(alice.address)).to.equal(WEI("490")); // 1000-1000+490
      expect(await token.balanceOf(pair.address)).to.equal(WEI("480")); // 980-500
      expect(await token.balanceOf(feeRec.address)).to.equal(feeRecBefore + WEI("10"));
    });

    it("豁免地址交易不收费用", async function () {
      const { token, excluded, pair, feeRec } = await loadFixture(tokenFixture);
      const feeRecBefore = await token.balanceOf(feeRec.address);
      // 给 excluded 一些币以便转出（owner 为部署者，持有发行量）
      await token.transfer(excluded.address, WEI("500"));
      await token.connect(excluded).transfer(pair.address, WEI("100"));
      expect(await token.balanceOf(pair.address)).to.equal(WEI("100")); // 全额无费
      expect(await token.balanceOf(feeRec.address)).to.equal(feeRecBefore);
    });

    it("非 pair 的普通转账不收费用", async function () {
      const { token, owner, alice, feeRec } = await loadFixture(tokenFixture);
      const feeRecBefore = await token.balanceOf(feeRec.address);
      await token.connect(alice).transfer(owner.address, WEI("100"));
      expect(await token.balanceOf(feeRec.address)).to.equal(feeRecBefore); // 无费
    });

    it("calculate* 计算应收费用", async function () {
      const { token } = await loadFixture(tokenFixture);
      const { feeAmount, receiveAmount } = await token.calculateSellAmount(WEI("1000"));
      expect(feeAmount).to.equal(WEI("20"));
      expect(receiveAmount).to.equal(WEI("980"));
      const buy = await token.calculateBuyAmount(WEI("1000"));
      expect(buy.feeAmount).to.equal(WEI("20"));
      expect(buy.receiveAmount).to.equal(WEI("980"));
    });

    it("FeeCollected 事件携带收费明细", async function () {
      const { token, alice, pair } = await loadFixture(tokenFixture);
      await expect(token.connect(alice).transfer(pair.address, WEI("1000")))
        .to.emit(token, "FeeCollected")
        .withArgs(alice.address, pair.address, WEI("20"), true);
    });
  });

  describe("pair 与豁免不可被非 owner 篡改", function () {
    it("isPair / isExcludedFromFee 为公开只读映射", async function () {
      const { token, pair } = await loadFixture(tokenFixture);
      expect(await token.isPair(pair.address)).to.equal(true);
      expect(await token.isPair(ethers.ZeroAddress)).to.equal(false);
    });
  });
});