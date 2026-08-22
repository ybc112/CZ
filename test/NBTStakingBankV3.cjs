const { expect } = require("chai");
const { loadFixture, time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { ethers } = require("hardhat");

const DAY = 24 * 60 * 60;
const WEI = (x) => ethers.parseEther(x);
const ZERO = ethers.ZeroAddress;

// ---------- Fixture ----------
async function deployFixture() {
  const [owner, referrer, ...rest] = await ethers.getSigners();
  const nodes = rest.slice(0, 11);

  const Token = await ethers.getContractFactory("NBTToken");
  const token = await Token.deploy(
    "CZ", "CZ", WEI("100000000000"),
    owner.address, 0, 0, [], [owner.address]
  );
  const feeToken = await Token.deploy(
    "Fee", "FEE", WEI("100000000000"),
    owner.address, 0, 0, [], [owner.address]
  );

  const MockFeed = await ethers.getContractFactory("MockPriceFeed");
  const feed = await MockFeed.deploy(WEI("1"));

  const feeReceiver = rest[11];
  const Bank = await ethers.getContractFactory("NBTStakingBankV3");
  const bank = await Bank.deploy(
    await token.getAddress(),
    await token.getAddress(),
    feeReceiver.address,
    0
  );

  await bank.setInviteReward(WEI("100"));
  await bank.setMinReferralStakeValue(WEI("50"));

  await token.transfer(await bank.getAddress(), WEI("90000000000"));
  await token.connect(owner).approve(await bank.getAddress(), ethers.MaxUint256);

  return { owner, referrer, nodes, token, feeToken, bank, feed, feeReceiver };
}

async function stakeAs(token, bank, user, amount, referrer, { feeToken: ft, feeAmount, value } = {}) {
  if (ft && feeAmount) {
    await ft.connect(user).approve(await bank.getAddress(), feeAmount);
  }
  await token.connect(user).approve(await bank.getAddress(), amount);
  const tx = value !== undefined
    ? bank.connect(user).stake(amount, referrer, { value })
    : bank.connect(user).stake(amount, referrer);
  return tx;
}

async function createNodes(token, bank, nodes, referrer, amount) {
  const [owner] = await ethers.getSigners();
  for (const n of nodes) {
    await token.connect(owner).transfer(n.address, amount);
    await stakeAs(token, bank, n, amount, referrer.address);
  }
}

async function currentScores(bank, addresses) {
  const [nodes, scores] = await bank.getRankedNodes(0, 100);
  return { nodes, scores };
}

describe("NBTStakingBankV3", function () {
  describe("constructor", function () {
    it("应正确初始化基础参数", async function () {
      const { owner, bank, token, feeReceiver, feed } = await loadFixture(deployFixture);
      expect(await bank.owner()).to.equal(owner.address);
      expect(await bank.stakingToken()).to.equal(await token.getAddress());
      expect(await bank.rewardToken()).to.equal(await token.getAddress());
      expect(await bank.feeReceiver()).to.equal(feeReceiver.address);
      expect(await bank.priceFeed()).to.equal(ZERO);
      expect(await bank.inviteReward()).to.equal(WEI("100"));
      expect(await bank.minReferralStakeValue()).to.equal(WEI("50"));
      expect(await bank.LOCK_PERIOD()).to.equal(15 * DAY);
      expect(await bank.stakeValueRate()).to.equal(WEI("1"));
    });
  });

  describe("roles / 权限", function () {
    it("非 owner 不能设置价格源 / 参数", async function () {
      const { bank, nodes, feed } = await loadFixture(deployFixture);
      await expect(bank.connect(nodes[0]).setPriceFeed(await feed.getAddress())).to.be.revertedWithCustomError(bank, "NotOwner");
      await expect(bank.connect(nodes[0]).setStakeValueRate(2)).to.be.revertedWithCustomError(bank, "NotOwner");
      await expect(bank.connect(nodes[0]).setInviteReward(WEI("1"))).to.be.revertedWithCustomError(bank, "NotOwner");
    });

    it("owner 可设置 / 移除价格源", async function () {
      const { bank, feed } = await loadFixture(deployFixture);
      await bank.setPriceFeed(await feed.getAddress());
      expect(await bank.priceFeed()).to.equal(await feed.getAddress());
      await bank.setPriceFeed(ZERO);
      expect(await bank.priceFeed()).to.equal(ZERO);
    });

    it("operator 具备 admin 权限", async function () {
      const { bank, nodes } = await loadFixture(deployFixture);
      const op = nodes[10];
      await bank.setOperator(op.address, true);
      expect(await bank.operators(op.address)).to.equal(true);
      await expect(bank.connect(nodes[1]).openEpoch()).to.be.revertedWithCustomError(bank, "NotAdmin");
      await bank.connect(op).openEpoch();
      expect(await bank.currentEpochId()).to.equal(1);
    });
  });

  describe("U 本位价格源", function () {
    it("未配置价格源时回退固定汇率", async function () {
      const { bank, token, referrer, nodes } = await loadFixture(deployFixture);
      const u = nodes[0];
      await token.transfer(u.address, WEI("100"));
      await stakeAs(token, bank, u, WEI("100"), referrer.address);
      const rec = await bank.getStakeRecord(u.address, 0);
      // stakeValueRate=1e18 → scoreValue = amount * 1e18 / 1e18 = amount
      expect(rec.scoreValue).to.equal(WEI("100"));
    });

    it("配置价格源后按实时价折算 U 价值", async function () {
      const { bank, token, feed, referrer, nodes } = await loadFixture(deployFixture);
      await feed.setPrice(WEI("2")); // 1 CZ = 2 USDT
      await bank.setPriceFeed(await feed.getAddress());
      const u = nodes[0];
      await token.transfer(u.address, WEI("100"));
      await stakeAs(token, bank, u, WEI("100"), referrer.address);
      const rec = await bank.getStakeRecord(u.address, 0);
      expect(rec.scoreValue).to.equal(WEI("200")); // 100 * 2
    });

    it("质押时锁价：价格变化不影响已质押分数", async function () {
      const { bank, token, feed, referrer, nodes } = await loadFixture(deployFixture);
      await feed.setPrice(WEI("2"));
      await bank.setPriceFeed(await feed.getAddress());
      const u = nodes[0];
      await token.transfer(u.address, WEI("300"));
      await stakeAs(token, bank, u, WEI("100"), referrer.address);
      // 价格上升到 3
      await feed.setPrice(WEI("3"));
      await stakeAs(token, bank, u, WEI("100"), referrer.address);
      const rec0 = await bank.getStakeRecord(u.address, 0);
      const rec1 = await bank.getStakeRecord(u.address, 1);
      expect(rec0.scoreValue).to.equal(WEI("200")); // 锁在 2
      expect(rec1.scoreValue).to.equal(WEI("300")); // 新质押按 3
    });

    it("价格源返回 0 时报错", async function () {
      const { bank, token, feed, referrer, nodes } = await loadFixture(deployFixture);
      await bank.setPriceFeed(await feed.getAddress());
      const u = nodes[0];
      await token.transfer(u.address, WEI("100"));
      await token.connect(u).approve(await bank.getAddress(), WEI("100"));
      await feed.setPrice(0);
      await expect(bank.connect(u).stake(WEI("100"), referrer.address)).to.be.revertedWithCustomError(bank, "InvalidPrice");
    });
  });

  describe("stake 质押 + 排名", function () {
    it("必须先绑定推荐人才能质押", async function () {
      const { bank, nodes } = await loadFixture(deployFixture);
      await expect(bank.connect(nodes[0]).stake(WEI("100"), ZERO)).to.be.revertedWithCustomError(bank, "MustBindReferrer");
    });

    it("质押计入个人分并给推荐人加邀请分", async function () {
      const { bank, token, referrer, nodes } = await loadFixture(deployFixture);
      const u = nodes[0];
      await token.transfer(u.address, WEI("100"));
      await stakeAs(token, bank, u, WEI("100"), referrer.address);
      const info = await bank.getUserInfo(u.address);
      expect(info.info.personalStakeVolume).to.equal(WEI("100"));
      const refInfo = await bank.getUserInfo(referrer.address);
      expect(refInfo.info.referralStakeVolume).to.equal(WEI("100"));
      // referrer 因邀请分上榜（与 u 同分 100，u 先质押排第 1）
      expect(await bank.getNodeRank(referrer.address)).to.equal(2);
    });

    it("达标首押触发邀请奖励，锁定 15 天", async function () {
      const { bank, token, referrer, nodes } = await loadFixture(deployFixture);
      const u = nodes[0];
      await token.transfer(u.address, WEI("100"));
      await stakeAs(token, bank, u, WEI("100"), referrer.address);
      const locks = await bank.getInviteRewardLocks(referrer.address);
      expect(locks.invitees.length).to.equal(1);
      expect(locks.amounts[0]).to.equal(WEI("100"));
      // 未到 15 天，pending=0
      expect(await bank.pendingRewardAll(referrer.address)).to.equal(0);
      await time.increase(15 * DAY);
      expect(await bank.pendingRewardAll(referrer.address)).to.equal(WEI("100"));
    });

    it("未达标质押不触发邀请奖励", async function () {
      const { bank, token, referrer, nodes } = await loadFixture(deployFixture);
      const u = nodes[0];
      await token.transfer(u.address, WEI("10"));
      await stakeAs(token, bank, u, WEI("10"), referrer.address);
      const locks = await bank.getInviteRewardLocks(referrer.address);
      expect(locks.invitees.length).to.equal(0);
    });
  });

  describe("reinvest 复投：邀请奖励", function () {
    it("复投已解锁邀请奖励为新质押（免费）", async function () {
      const { bank, token, referrer, nodes, feeReceiver, owner } = await loadFixture(deployFixture);
      // 开启 BNB 手续费模式，证明复投免费
      await bank.setInteractionFeeConfig(ZERO, WEI("0.01"), feeReceiver.address);

      const u = nodes[0];
      await token.transfer(u.address, WEI("100"));
      await token.connect(u).approve(await bank.getAddress(), WEI("100"));
      // stake 需带 BNB 手续费
      await bank.connect(u).stake(WEI("100"), referrer.address, { value: WEI("0.01") });

      await time.increase(15 * DAY);
      expect(await bank.pendingRewardAll(referrer.address)).to.equal(WEI("100"));

      // 顶层推荐人也需绑定上级（平台账户）
      await bank.connect(referrer).setReferrer(owner.address, { value: WEI("0.01") });
      // 复投不带任何 BNB → 免费成功
      await bank.connect(referrer).reinvest(owner.address);
      const info = await bank.getUserInfo(referrer.address);
      expect(info.info.pendingInviteRewards).to.equal(0);
      expect(info.info.activeStakeCount).to.equal(1);
      const rec = await bank.getStakeRecord(referrer.address, 0);
      expect(rec.amount).to.equal(WEI("100"));
      expect(rec.active).to.equal(true);
    });

    it("复投免费：stake 需 BNB，复投不需 BNB", async function () {
      const { bank, token, referrer, nodes, feeReceiver, owner } = await loadFixture(deployFixture);
      await bank.setInteractionFeeConfig(ZERO, WEI("0.01"), feeReceiver.address);
      const u = nodes[0];
      await token.transfer(u.address, WEI("100"));
      await stakeAs(token, bank, u, WEI("100"), referrer.address, { value: WEI("0.01") });

      // 先绑定 nodes[1]，使其能走到手续费检查
      await bank.connect(nodes[1]).setReferrer(referrer.address, { value: WEI("0.01") });
      // 不带 BNB 的 stake 失败
      await expect(bank.connect(nodes[1]).stake(WEI("100"), referrer.address, { value: 0 })).to.be.revertedWithCustomError(bank, "InsufficientBnbFee");
      await time.increase(15 * DAY);
      await bank.connect(referrer).setReferrer(owner.address, { value: WEI("0.01") });
      // 不带 BNB 的复投成功
      await bank.connect(referrer).reinvest(owner.address);
      const info = await bank.getUserInfo(referrer.address);
      expect(info.info.activeStakeCount).to.equal(1);
    });

    it("无任何可复投资产时报错", async function () {
      const { bank, referrer, owner } = await loadFixture(deployFixture);
      await bank.connect(referrer).setReferrer(owner.address);
      await expect(bank.connect(referrer).reinvest(owner.address)).to.be.revertedWithCustomError(bank, "NoReinvestableAssets");
    });

    it("复投后新质押重新锁 15 天，期内不可取", async function () {
      const { bank, token, referrer, nodes, owner } = await loadFixture(deployFixture);
      const u = nodes[0];
      await token.transfer(u.address, WEI("100"));
      await stakeAs(token, bank, u, WEI("100"), referrer.address);
      await time.increase(15 * DAY);
      await bank.connect(referrer).setReferrer(owner.address);
      await bank.connect(referrer).reinvest(owner.address);
      // 复投后新质押未满 15 天
      await expect(bank.connect(referrer).withdraw(0)).to.be.revertedWithCustomError(bank, "LockNotEnded");
      await time.increase(15 * DAY);
      await bank.connect(referrer).withdraw(0);
      const info = await bank.getUserInfo(referrer.address);
      expect(info.info.totalWithdrawn).to.equal(WEI("100"));
    });

    it("getReinvestPreview 返回邀请奖励", async function () {
      const { bank, token, referrer, nodes } = await loadFixture(deployFixture);
      const u = nodes[0];
      await token.transfer(u.address, WEI("100"));
      await stakeAs(token, bank, u, WEI("100"), referrer.address);
      const p = await bank.getReinvestPreview(referrer.address);
      expect(p.inviteAmount).to.equal(0);
      expect(p.totalAmount).to.equal(0);
      await time.increase(15 * DAY);
      const p2 = await bank.getReinvestPreview(referrer.address);
      expect(p2.inviteAmount).to.equal(WEI("100"));
      expect(p2.totalAmount).to.equal(WEI("100"));
    });
  });

  describe("reinvest 复投：排名分红", function () {
    it("领取窗口内可将排名分红复投", async function () {
      const { bank, token, owner, referrer, nodes } = await loadFixture(deployFixture);
      // 11 节点挂 referrer
      for (const n of nodes) {
        await token.connect(owner).transfer(n.address, WEI("100"));
        await stakeAs(token, bank, n, WEI("100"), referrer.address);
      }
      // referrer + 11 nodes = 12 节点，>=10 不 disabled
      await bank.openEpoch();
      await bank.fundEpoch(WEI("1200"));
      // 推进到领取窗口 (快照 + 3 天)
      await time.increase(3 * DAY);

      const preview = await bank.getReinvestPreview(referrer.address);
      expect(preview.rankAmount).to.be.gt(0);

      const infoBefore = await bank.getUserInfo(referrer.address);
      const activeBefore = infoBefore.info.activeStakeCount;

      await bank.connect(referrer).setReferrer(owner.address);
      await bank.connect(referrer).reinvest(owner.address);

      const info = await bank.getUserInfo(referrer.address);
      expect(info.info.activeStakeCount).to.equal(activeBefore + 1n);
      // 排名分红已标记领取
      const ep = await bank.getEpoch(1);
      expect(await bank.hasClaimed(1, referrer.address)).to.equal(true);
    });

    it("非节点用户无排名分红可复投", async function () {
      const { bank, token, referrer, nodes } = await loadFixture(deployFixture);
      await bank.openEpoch();
      await bank.fundEpoch(WEI("1200"));
      await time.increase(3 * DAY);
      // nodes[0] 未质押，不是节点
      await bank.connect(nodes[0]).setReferrer(referrer.address);
      await expect(bank.connect(nodes[0]).reinvest(referrer.address)).to.be.revertedWithCustomError(bank, "NoReinvestableAssets");
    });
  });

  describe("reinvest 复投：到期本金", function () {
    it("到期本金并入新质押，旧记录失效", async function () {
      const { bank, token, referrer, nodes } = await loadFixture(deployFixture);
      const u = nodes[0];
      await token.transfer(u.address, WEI("200"));
      await stakeAs(token, bank, u, WEI("100"), referrer.address);
      await time.increase(15 * DAY);

      const p = await bank.getReinvestPreview(u.address);
      expect(p.principalAmount).to.equal(WEI("100"));
      expect(p.maturedStakeCount).to.equal(1);

      await bank.connect(u).reinvest(referrer.address);
      // 旧记录失效
      const rec0 = await bank.getStakeRecord(u.address, 0);
      expect(rec0.active).to.equal(false);
      // 新记录含本金
      const rec1 = await bank.getStakeRecord(u.address, 1);
      expect(rec1.amount).to.equal(WEI("100"));
      expect(rec1.active).to.equal(true);
      // 到期本金不能被再次提取
      await time.increase(15 * DAY);
      await expect(bank.connect(u).withdraw(0)).to.be.revertedWithCustomError(bank, "StakeNotActive");
    });

    it("未到期本金不可复投", async function () {
      const { bank, token, referrer, nodes } = await loadFixture(deployFixture);
      const u = nodes[0];
      await token.transfer(u.address, WEI("100"));
      await stakeAs(token, bank, u, WEI("100"), referrer.address);
      await time.increase(10 * DAY); // 未满 15 天
      await expect(bank.connect(u).reinvest(referrer.address)).to.be.revertedWithCustomError(bank, "NoReinvestableAssets");
    });
  });

  describe("reinvest 三源合并复投", function () {
    it("邀请奖励 + 排名分红 + 到期本金一次合并复投", async function () {
      const { bank, token, owner, referrer, nodes } = await loadFixture(deployFixture);
      // referrer 自身有到期本金：先质押一笔
      await token.transfer(referrer.address, WEI("100"));
      await stakeAs(token, bank, referrer, WEI("100"), owner.address);

      // 11 节点挂 referrer，产生邀请奖励
      for (const n of nodes) {
        await token.connect(owner).transfer(n.address, WEI("100"));
        await stakeAs(token, bank, n, WEI("100"), referrer.address);
      }

      // 推进 15 天：邀请奖励解锁 + referrer 本金到期
      await time.increase(15 * DAY);

      // 开新一期排名分红
      await bank.openEpoch();
      await bank.fundEpoch(WEI("1200"));
      await time.increase(3 * DAY); // 进入领取窗口

      const p = await bank.getReinvestPreview(referrer.address);
      expect(p.inviteAmount).to.equal(WEI("1100")); // 11 * 100
      expect(p.principalAmount).to.equal(WEI("100"));
      expect(p.rankAmount).to.be.gt(0);
      expect(p.totalAmount).to.equal(p.inviteAmount + p.rankAmount + p.principalAmount);

      const infoBefore = await bank.getUserInfo(referrer.address);
      const totalBefore = infoBefore.info.totalStaked;

      await bank.connect(referrer).reinvest(owner.address);

      const info = await bank.getUserInfo(referrer.address);
      // 新质押 = 三源合计
      const rec = await bank.getStakeRecord(referrer.address, 1);
      expect(rec.amount).to.equal(p.totalAmount);
      expect(rec.active).to.equal(true);
      // 复投后排名继续按 U 价值计算（分数不变或更高）
      expect(await bank.getNodeRank(referrer.address)).to.equal(1);
    });

    it("合并复投后到期本金 + 邀请奖励余额正确清零", async function () {
      const { bank, token, owner, referrer, nodes } = await loadFixture(deployFixture);
      await token.transfer(referrer.address, WEI("100"));
      await stakeAs(token, bank, referrer, WEI("100"), owner.address);
      for (const n of nodes) {
        await token.connect(owner).transfer(n.address, WEI("100"));
        await stakeAs(token, bank, n, WEI("100"), referrer.address);
      }
      await time.increase(15 * DAY);
      await bank.openEpoch();
      await bank.fundEpoch(WEI("1200"));
      await time.increase(3 * DAY);

      await bank.connect(referrer).reinvest(owner.address);

      const info = await bank.getUserInfo(referrer.address);
      expect(info.info.pendingInviteRewards).to.equal(0);
      // 到期本金旧记录全部失效
      const rec0 = await bank.getStakeRecord(referrer.address, 0);
      expect(rec0.active).to.equal(false);
    });
  });

  describe("取本掉排名 vs 复投保持排名", function () {
    it("取本后推荐人邀请分下降、排名下降", async function () {
      const { bank, token, referrer, nodes } = await loadFixture(deployFixture);
      const u = nodes[0];
      await token.transfer(u.address, WEI("100"));
      await stakeAs(token, bank, u, WEI("100"), referrer.address);
      // u 先质押排第 1，referrer 同分 100 排第 2
      expect(await bank.getNodeRank(referrer.address)).to.equal(2);

      await time.increase(15 * DAY);
      await bank.connect(u).withdraw(0);
      const refInfo = await bank.getUserInfo(referrer.address);
      expect(refInfo.info.referralStakeVolume).to.equal(0);
      expect(await bank.getNodeRank(referrer.address)).to.equal(0);
    });

    it("复投不降低排名（分数不降）", async function () {
      const { bank, token, owner, referrer, nodes } = await loadFixture(deployFixture);
      await token.transfer(referrer.address, WEI("100"));
      await stakeAs(token, bank, referrer, WEI("100"), owner.address);
      for (const n of nodes) {
        await token.connect(owner).transfer(n.address, WEI("100"));
        await stakeAs(token, bank, n, WEI("100"), referrer.address);
      }
      await time.increase(15 * DAY);
      const rankBefore = await bank.getNodeRank(referrer.address);
      await bank.openEpoch();
      await bank.fundEpoch(WEI("1200"));
      await time.increase(3 * DAY);
      await bank.connect(referrer).reinvest(owner.address);
      const rankAfter = await bank.getNodeRank(referrer.address);
      expect(Number(rankAfter)).to.be.lte(Number(rankBefore));
    });
  });

  describe("15 天结算机制回归", function () {
    it("节点不足 10 个时档位 disabled，奖励并入下期", async function () {
      const { bank, token, referrer, nodes } = await loadFixture(deployFixture);
      const u = nodes[0];
      await token.transfer(u.address, WEI("100"));
      await stakeAs(token, bank, u, WEI("100"), referrer.address);
      await bank.openEpoch();
      await bank.fundEpoch(WEI("100"));
      const ep = await bank.getEpoch(1);
      expect(ep.disabled).to.equal(true);
      await time.increase(10 * DAY);
      await bank.settleEpoch();
      await bank.openEpoch();
      const ep2 = await bank.getEpoch(2);
      // carryover 进 poolAmount
      expect(ep2.poolAmount).to.equal(WEI("100"));
    });

    it("正常结算：未领取奖励计入 carryover", async function () {
      const { bank, token, owner, referrer, nodes } = await loadFixture(deployFixture);
      for (const n of nodes) {
        await token.connect(owner).transfer(n.address, WEI("100"));
        await stakeAs(token, bank, n, WEI("100"), referrer.address);
      }
      await bank.openEpoch();
      await bank.fundEpoch(WEI("1200"));
      // 无人领取，推进过领取期
      await time.increase(15 * DAY);
      await bank.settleEpoch();
      await bank.openEpoch();
      const ep2 = await bank.getEpoch(2);
      expect(ep2.poolAmount).to.equal(WEI("1200"));
    });

    it("领取窗口外不可领取", async function () {
      const { bank, token, owner, referrer, nodes } = await loadFixture(deployFixture);
      for (const n of nodes) {
        await token.connect(owner).transfer(n.address, WEI("100"));
        await stakeAs(token, bank, n, WEI("100"), referrer.address);
      }
      await bank.openEpoch();
      await bank.fundEpoch(WEI("1200"));
      // 领取窗口未开始（未过公示期）
      await expect(bank.connect(referrer)["claimEpochReward(uint256)"](1)).to.be.revertedWithCustomError(bank, "OutOfClaimWindow");
    });

    it("领取窗口内节点可领取排名分红", async function () {
      const { bank, token, owner, referrer, nodes } = await loadFixture(deployFixture);
      for (const n of nodes) {
        await token.connect(owner).transfer(n.address, WEI("100"));
        await stakeAs(token, bank, n, WEI("100"), referrer.address);
      }
      await bank.openEpoch();
      await bank.fundEpoch(WEI("1200"));
      await time.increase(3 * DAY);
      const pending = await bank.pendingEpochReward(1, referrer.address);
      expect(pending).to.be.gt(0);
      await bank.connect(referrer)["claimEpochReward(uint256)"](1);
      expect(await bank.hasClaimed(1, referrer.address)).to.equal(true);
      // 重复领取失败
      await expect(bank.connect(referrer)["claimEpochReward(uint256)"](1)).to.be.revertedWithCustomError(bank, "AlreadyClaimed");
    });

    it("claimNodeRewards 领取已解锁邀请奖励", async function () {
      const { bank, token, referrer, nodes } = await loadFixture(deployFixture);
      const u = nodes[0];
      await token.transfer(u.address, WEI("100"));
      await stakeAs(token, bank, u, WEI("100"), referrer.address);
      await time.increase(15 * DAY);
      await bank.connect(referrer).claimNodeRewards();
      const info = await bank.getUserInfo(referrer.address);
      expect(info.info.totalInviteClaimed).to.equal(WEI("100"));
      expect(await bank.pendingRewardAll(referrer.address)).to.equal(0);
    });
  });

  describe("referrer 绑定边界", function () {
    it("setReferrer(0) 报 InvalidReferrer", async function () {
      const { bank, nodes } = await loadFixture(deployFixture);
      await expect(bank.connect(nodes[0]).setReferrer(ZERO)).to.be.revertedWithCustomError(bank, "InvalidReferrer");
    });

    it("自我绑定报 CannotSelfRefer", async function () {
      const { bank, nodes } = await loadFixture(deployFixture);
      await expect(bank.connect(nodes[0]).setReferrer(nodes[0].address)).to.be.revertedWithCustomError(bank, "CannotSelfRefer");
    });

    it("重复绑定报 AlreadyHasReferrer", async function () {
      const { bank, nodes, referrer } = await loadFixture(deployFixture);
      await bank.connect(nodes[0]).setReferrer(referrer.address);
      await expect(bank.connect(nodes[0]).setReferrer(nodes[1].address)).to.be.revertedWithCustomError(bank, "AlreadyHasReferrer");
    });

    it("循环绑定报 CircularReferral", async function () {
      const { bank, nodes } = await loadFixture(deployFixture);
      await bank.connect(nodes[0]).setReferrer(nodes[1].address);
      await expect(bank.connect(nodes[1]).setReferrer(nodes[0].address)).to.be.revertedWithCustomError(bank, "CircularReferral");
    });

    it("已绑定后质押传不同推荐人报 ReferrerMismatch", async function () {
      const { bank, token, nodes, referrer } = await loadFixture(deployFixture);
      const u = nodes[0];
      await token.transfer(u.address, WEI("100"));
      await stakeAs(token, bank, u, WEI("100"), referrer.address);
      await token.transfer(u.address, WEI("100"));
      await expect(bank.connect(u).stake(WEI("100"), nodes[1].address)).to.be.revertedWithCustomError(bank, "ReferrerMismatch");
    });
  });

  describe("暂停 / 所有权", function () {
    it("非 admin 不能暂停", async function () {
      const { bank, nodes } = await loadFixture(deployFixture);
      await expect(bank.connect(nodes[0]).pause()).to.be.revertedWithCustomError(bank, "NotAdmin");
    });

    it("暂停阻断质押/复投/取本，恢复后可用", async function () {
      const { bank, token, referrer, nodes, owner } = await loadFixture(deployFixture);
      const u = nodes[0];
      await token.transfer(u.address, WEI("100"));
      await stakeAs(token, bank, u, WEI("100"), referrer.address);
      await time.increase(15 * DAY);

      await bank.pause();
      await expect(bank.connect(nodes[1]).setReferrer(referrer.address)).to.be.revertedWithCustomError(bank, "ContractPaused");
      await expect(bank.connect(u).withdraw(0)).to.be.revertedWithCustomError(bank, "ContractPaused");
      await expect(bank.connect(referrer).reinvest(owner.address)).to.be.revertedWithCustomError(bank, "ContractPaused");
      await expect(bank.openEpoch()).to.be.revertedWithCustomError(bank, "ContractPaused");

      await bank.unpause();
      await bank.connect(u).withdraw(0);
      const info = await bank.getUserInfo(u.address);
      expect(info.info.totalWithdrawn).to.equal(WEI("100"));
    });

    it("两段式所有权转移", async function () {
      const { bank, nodes } = await loadFixture(deployFixture);
      await expect(bank.transferOwnership(ZERO)).to.be.revertedWithCustomError(bank, "InvalidAddress");
      await bank.transferOwnership(nodes[1].address);
      expect(await bank.pendingOwner()).to.equal(nodes[1].address);
      await expect(bank.connect(nodes[0]).acceptOwnership()).to.be.revertedWithCustomError(bank, "NotNewOwner");
      await bank.connect(nodes[1]).acceptOwnership();
      expect(await bank.owner()).to.equal(nodes[1].address);
      expect(await bank.pendingOwner()).to.equal(ZERO);
    });
  });

  describe("recoverWrongToken 限制", function () {
    it("可回收无关代币，禁止回收质押/奖励/手续费代币", async function () {
      const { bank, token, feeToken, owner } = await loadFixture(deployFixture);
      // 先以普通代币身份回收 feeToken（此时尚未设为手续费代币）
      await feeToken.transfer(await bank.getAddress(), WEI("100"));
      const before = await feeToken.balanceOf(owner.address);
      await bank.recoverWrongToken(await feeToken.getAddress(), owner.address, WEI("100"));
      expect(await feeToken.balanceOf(owner.address)).to.equal(before + WEI("100"));

      // 再设为手续费代币，此时禁止回收
      await bank.setInteractionFeeConfig(await feeToken.getAddress(), WEI("0.01"), owner.address);
      await expect(bank.recoverWrongToken(await token.getAddress(), owner.address, 1)).to.be.revertedWithCustomError(bank, "CannotRecoverStakingToken");
      await expect(bank.recoverWrongToken(await feeToken.getAddress(), owner.address, 1)).to.be.revertedWithCustomError(bank, "CannotRecoverFeeToken");
      await expect(bank.recoverWrongToken(ZERO, owner.address, 1)).to.be.revertedWithCustomError(bank, "InvalidAddress");
    });
  });

  describe("手续费收取", function () {
    it("BNB 手续费模式：质押与取本都收，进入 feeReceiver", async function () {
      const { bank, token, referrer, nodes, feeReceiver } = await loadFixture(deployFixture);
      await bank.setInteractionFeeConfig(ZERO, WEI("0.01"), feeReceiver.address);
      const u = nodes[0];
      await token.transfer(u.address, WEI("100"));
      const before = await ethers.provider.getBalance(feeReceiver.address);
      await stakeAs(token, bank, u, WEI("100"), referrer.address, { value: WEI("0.01") });
      await time.increase(15 * DAY);
      await bank.connect(u).withdraw(0, { value: WEI("0.01") });
      const after = await ethers.provider.getBalance(feeReceiver.address);
      expect(after - before).to.equal(WEI("0.02"));
    });

    it("ERC20 手续费模式：收 feeToken 并拒绝带 BNB", async function () {
      const { bank, token, feeToken, referrer, nodes, feeReceiver } = await loadFixture(deployFixture);
      await bank.setInteractionFeeConfig(await feeToken.getAddress(), WEI("0.01"), feeReceiver.address);
      const u = nodes[0];
      await token.transfer(u.address, WEI("100"));
      await token.connect(u).approve(await bank.getAddress(), WEI("100"));
      await feeToken.transfer(u.address, WEI("10"));
      await feeToken.connect(u).approve(await bank.getAddress(), WEI("10"));
      const before = await feeToken.balanceOf(feeReceiver.address);
      await bank.connect(u).stake(WEI("100"), referrer.address);
      expect(await feeToken.balanceOf(feeReceiver.address)).to.equal(before + WEI("0.01"));
      await expect(bank.connect(u).stake(WEI("100"), referrer.address, { value: WEI("0.01") })).to.be.revertedWithCustomError(bank, "UnexpectedBnb");
    });
  });

  describe("openEpoch / fundEpoch 边界", function () {
    it("上期过领取期后 openEpoch 自动结算并结转未领取奖励", async function () {
      const { bank, token, owner, referrer, nodes } = await loadFixture(deployFixture);
      for (const n of nodes) {
        await token.connect(owner).transfer(n.address, WEI("100"));
        await stakeAs(token, bank, n, WEI("100"), referrer.address);
      }
      await bank.openEpoch();
      await bank.fundEpoch(WEI("1200"));
      await time.increase(10 * DAY); // 3 公示 + 7 领取
      await bank.openEpoch(); // 自动结算期1并开启期2
      const ep1 = await bank.getEpoch(1);
      expect(ep1.settled).to.equal(true);
      const ep2 = await bank.getEpoch(2);
      expect(ep2.poolAmount).to.equal(WEI("1200"));
    });

    it("上期未过领取期 openEpoch 报 PreviousEpochNotSettled", async function () {
      const { bank, token, owner, referrer, nodes } = await loadFixture(deployFixture);
      for (const n of nodes) {
        await token.connect(owner).transfer(n.address, WEI("100"));
        await stakeAs(token, bank, n, WEI("100"), referrer.address);
      }
      await bank.openEpoch();
      await bank.fundEpoch(WEI("1200"));
      await time.increase(3 * DAY); // 领取窗口刚开，未结束
      await expect(bank.openEpoch()).to.be.revertedWithCustomError(bank, "PreviousEpochNotSettled");
    });

    it("fundEpoch 边界：未开期 / 0 金额 / 非 admin", async function () {
      const { bank, nodes } = await loadFixture(deployFixture);
      await expect(bank.fundEpoch(WEI("100"))).to.be.revertedWithCustomError(bank, "NoActiveEpoch");
      await bank.openEpoch();
      await expect(bank.fundEpoch(0)).to.be.revertedWithCustomError(bank, "InvalidAmount");
      await expect(bank.connect(nodes[0]).fundEpoch(WEI("1"))).to.be.revertedWithCustomError(bank, "NotAdmin");
    });

    it("已结算期不可再领取", async function () {
      const { bank, token, owner, referrer, nodes } = await loadFixture(deployFixture);
      for (const n of nodes) {
        await token.connect(owner).transfer(n.address, WEI("100"));
        await stakeAs(token, bank, n, WEI("100"), referrer.address);
      }
      await bank.openEpoch();
      await bank.fundEpoch(WEI("1200"));
      await time.increase(10 * DAY);
      await bank.settleEpoch();
      await expect(bank.connect(referrer)["claimEpochReward(uint256)"](1)).to.be.revertedWithCustomError(bank, "EpochAlreadySettled");
    });

    it("claimEpochReward() 无参默认领取当期", async function () {
      const { bank, token, owner, referrer, nodes } = await loadFixture(deployFixture);
      for (const n of nodes) {
        await token.connect(owner).transfer(n.address, WEI("100"));
        await stakeAs(token, bank, n, WEI("100"), referrer.address);
      }
      await bank.openEpoch();
      await bank.fundEpoch(WEI("1200"));
      await time.increase(3 * DAY);
      await bank.connect(referrer).claimEpochReward();
      expect(await bank.hasClaimed(1, referrer.address)).to.equal(true);
    });
  });

  describe("复投按实时价计分", function () {
    it("复投合并金额按当期 U 价折算新质押分数", async function () {
      const { bank, token, feed, referrer, nodes, owner } = await loadFixture(deployFixture);
      await feed.setPrice(WEI("2"));
      await bank.setPriceFeed(await feed.getAddress());
      const u = nodes[0];
      await token.transfer(u.address, WEI("100"));
      await stakeAs(token, bank, u, WEI("100"), referrer.address);
      await time.increase(15 * DAY);
      await bank.connect(referrer).setReferrer(owner.address);
      await bank.connect(referrer).reinvest(owner.address);
      // 复投 100 个 CZ，价 2 → 新质押 U 分 = 200
      const rec = await bank.getStakeRecord(referrer.address, 0);
      expect(rec.scoreValue).to.equal(WEI("200"));
      expect(rec.amount).to.equal(WEI("100"));
    });
  });

  describe("排名分配不变量 / 分页", function () {
    it("四档权重分配全池分完（任意档位和等于池）", async function () {
      const { bank } = await loadFixture(deployFixture);
      for (const total of [10, 11, 50, 51, 100, 101, 150]) {
        let sum = 0n;
        for (let r = 1; r <= total; r++) {
          sum += await bank.getRankRewardPreview(WEI("1000"), total, r);
        }
        expect(sum).to.equal(WEI("1000"));
      }
    });

    it("getRankedNodes 分页与总数一致", async function () {
      const { bank, token, owner, referrer, nodes } = await loadFixture(deployFixture);
      for (const n of nodes) {
        await token.connect(owner).transfer(n.address, WEI("100"));
        await stakeAs(token, bank, n, WEI("100"), referrer.address);
      }
      const count = await bank.getRankedNodeCount();
      const page = await bank.getRankedNodes(0, 5);
      expect(page.total).to.equal(count);
      expect(page.nodes.length).to.equal(5);
      const empty = await bank.getRankedNodes(count, 5);
      expect(empty.nodes.length).to.equal(0);
    });
  });

  describe("邀请奖励领取边界", function () {
    it("无可领取奖励时 claimNodeRewards 报 NoRewards", async function () {
      const { bank, nodes } = await loadFixture(deployFixture);
      await expect(bank.connect(nodes[1]).claimNodeRewards()).to.be.revertedWithCustomError(bank, "NoRewards");
    });
  });

  describe("排名有序性（审计回归）", function () {
    it("新质押高分节点应立即排到前面", async function () {
      const { bank, token, nodes } = await loadFixture(deployFixture);
      const a = nodes[0], b = nodes[1], rA = nodes[8], rB = nodes[9];
      // a 挂 rA、b 挂 rB（各自独立推荐人，避免累积干扰）
      await token.transfer(a.address, WEI("100"));
      await stakeAs(token, bank, a, WEI("100"), rA.address); // a=100, rA=100
      await token.transfer(b.address, WEI("200"));
      await stakeAs(token, bank, b, WEI("200"), rB.address); // b=200, rB=200
      expect(await bank.getNodeRank(b.address)).to.equal(1);
      expect(await bank.getNodeRank(a.address)).to.equal(3);
      const ranked = await bank.getRankedNodes(0, 10);
      expect(ranked.nodes[0]).to.equal(b.address);
    });

    it("分数降低后排名向下重排（取钱就掉排名）", async function () {
      const { bank, token, referrer, nodes } = await loadFixture(deployFixture);
      const a = nodes[0], b = nodes[1], c = nodes[2], r2 = nodes[3];
      // a、b 挂 R；c 挂独立推荐人 r2，避免 R 分数始终碾压
      await token.transfer(a.address, WEI("100"));
      await stakeAs(token, bank, a, WEI("100"), referrer.address); // R=100
      await token.transfer(b.address, WEI("200"));
      await stakeAs(token, bank, b, WEI("200"), referrer.address); // R=300,B=200
      await token.transfer(c.address, WEI("250"));
      await stakeAs(token, bank, c, WEI("250"), r2.address); // c=250,r2=250
      // 排序: R(300) > c(250) > r2(250) > B(200) > A(100)
      expect(await bank.getNodeRank(referrer.address)).to.equal(1);
      expect(await bank.getNodeRank(c.address)).to.equal(2);

      await time.increase(15 * DAY);
      await bank.connect(a).withdraw(0); // A 取本，R referral 300 -> 200
      // 新排序: c(250) > r2(250) > R(200) > B(200)
      expect(await bank.getNodeRank(c.address)).to.equal(1);
      expect(await bank.getNodeRank(referrer.address)).to.equal(3);
      expect(await bank.getNodeRank(b.address)).to.equal(4);
    });

    it("节点归零移除后其余排名保持有序", async function () {
      const { bank, token, referrer, nodes } = await loadFixture(deployFixture);
      const a = nodes[0], b = nodes[1], c = nodes[2];
      await token.transfer(b.address, WEI("300"));
      await stakeAs(token, bank, b, WEI("300"), referrer.address); // R=300,B=300
      await token.transfer(c.address, WEI("200"));
      await stakeAs(token, bank, c, WEI("200"), referrer.address); // R=500,C=200
      await token.transfer(a.address, WEI("100"));
      await stakeAs(token, bank, a, WEI("100"), referrer.address); // R=600,A=100
      // 排序: R(600) > B(300) > C(200) > A(100)
      await time.increase(15 * DAY);
      await bank.connect(b).withdraw(0); // B 归零移除
      expect(await bank.getNodeRank(c.address)).to.equal(2);
      expect(await bank.getNodeRank(a.address)).to.equal(3);
      const ranked = await bank.getRankedNodes(0, 10);
      expect(ranked.nodes[1]).to.equal(c.address);
      expect(ranked.nodes[2]).to.equal(a.address);
    });
  });

  describe("审计补充：质押边界", function () {
    it("stake(0) 报 InvalidAmount", async function () {
      const { bank, token, referrer, nodes } = await loadFixture(deployFixture);
      const u = nodes[0];
      await token.connect(u).approve(await bank.getAddress(), WEI("100"));
      await expect(bank.connect(u).stake(0, referrer.address)).to.be.revertedWithCustomError(bank, "InvalidAmount");
    });

    it("超过 50 笔活跃质押报 TooManyActiveStakes", async function () {
      const { bank, token, referrer, nodes } = await loadFixture(deployFixture);
      const u = nodes[0];
      await token.transfer(u.address, WEI("100"));
      await token.connect(u).approve(await bank.getAddress(), ethers.MaxUint256);
      // 前 50 笔小额（未达标不触发邀请奖励），占满活跃名额
      for (let i = 0; i < 50; i++) {
        await bank.connect(u).stake(1, referrer.address);
      }
      await expect(bank.connect(u).stake(1, referrer.address)).to.be.revertedWithCustomError(bank, "TooManyActiveStakes");
    });

    it("余额不足时报错（NBTToken 回滚）", async function () {
      const { bank, token, referrer, nodes } = await loadFixture(deployFixture);
      const u = nodes[0];
      await token.transfer(u.address, WEI("10"));
      await token.connect(u).approve(await bank.getAddress(), WEI("100"));
      await expect(bank.connect(u).stake(WEI("100"), referrer.address)).to.be.revertedWith("Insufficient balance");
    });
  });

  describe("审计补充：取本边界", function () {
    it("取不存在的质押记录报 StakeNotActive", async function () {
      const { bank, nodes } = await loadFixture(deployFixture);
      await expect(bank.connect(nodes[0]).withdraw(99)).to.be.revertedWithCustomError(bank, "StakeNotActive");
    });

    it("重复取本报 StakeNotActive", async function () {
      const { bank, token, referrer, nodes } = await loadFixture(deployFixture);
      const u = nodes[0];
      await token.transfer(u.address, WEI("100"));
      await stakeAs(token, bank, u, WEI("100"), referrer.address);
      await time.increase(15 * DAY);
      await bank.connect(u).withdraw(0);
      await expect(bank.connect(u).withdraw(0)).to.be.revertedWithCustomError(bank, "StakeNotActive");
    });

    it("锁定期内取本报 LockNotEnded", async function () {
      const { bank, token, referrer, nodes } = await loadFixture(deployFixture);
      const u = nodes[0];
      await token.transfer(u.address, WEI("100"));
      await stakeAs(token, bank, u, WEI("100"), referrer.address);
      await time.increase(10 * DAY); // 未满 15 天
      await expect(bank.connect(u).withdraw(0)).to.be.revertedWithCustomError(bank, "LockNotEnded");
    });
  });

  describe("审计补充：复投边界", function () {
    it("未绑定推荐人复投报 MustBindReferrer", async function () {
      const { bank, nodes } = await loadFixture(deployFixture);
      await expect(bank.connect(nodes[0]).reinvest(ZERO)).to.be.revertedWithCustomError(bank, "MustBindReferrer");
    });

    it("复投传不同推荐人报 ReferrerMismatch", async function () {
      const { bank, token, referrer, nodes } = await loadFixture(deployFixture);
      const u = nodes[0];
      await token.transfer(u.address, WEI("100"));
      await stakeAs(token, bank, u, WEI("100"), referrer.address);
      await time.increase(15 * DAY);
      await expect(bank.connect(u).reinvest(nodes[1].address)).to.be.revertedWithCustomError(bank, "ReferrerMismatch");
    });

    it("活跃质押满额且无到期本金时复投报 TooManyActiveStakes", async function () {
      const { bank, token, referrer, nodes, owner } = await loadFixture(deployFixture);
      const u = nodes[0];
      // 先给 referrer 产生可复投的邀请奖励
      await token.transfer(u.address, WEI("100"));
      await stakeAs(token, bank, u, WEI("100"), referrer.address);
      await time.increase(15 * DAY); // 邀请奖励解锁
      await bank.connect(referrer).setReferrer(owner.address);
      // 再让 referrer 质押 50 笔小额（未到期）占满活跃名额
      await token.transfer(referrer.address, WEI("100"));
      await token.connect(referrer).approve(await bank.getAddress(), ethers.MaxUint256);
      for (let i = 0; i < 50; i++) {
        await bank.connect(referrer).stake(1, owner.address);
      }
      // 有可复投邀请奖励，但 50 活跃 + 0 到期 + 1 新 = 51 > 50
      await expect(bank.connect(referrer).reinvest(owner.address)).to.be.revertedWithCustomError(bank, "TooManyActiveStakes");
    });
  });

  describe("审计补充：结算/领取边界", function () {
    it("fundEpoch 已结算期报 EpochAlreadySettled", async function () {
      const { bank, token, owner, referrer, nodes } = await loadFixture(deployFixture);
      for (const n of nodes) {
        await token.connect(owner).transfer(n.address, WEI("100"));
        await stakeAs(token, bank, n, WEI("100"), referrer.address);
      }
      await bank.openEpoch();
      await bank.fundEpoch(WEI("1200"));
      await time.increase(10 * DAY);
      await bank.settleEpoch();
      await expect(bank.fundEpoch(WEI("100"))).to.be.revertedWithCustomError(bank, "EpochAlreadySettled");
    });

    it("领取不存在的期报 NoSuchEpoch", async function () {
      const { bank, nodes } = await loadFixture(deployFixture);
      await expect(bank.connect(nodes[0])["claimEpochReward(uint256)"](7)).to.be.revertedWithCustomError(bank, "NoSuchEpoch");
    });

    it("领取 disabled 期报 PoolMerged", async function () {
      const { bank, token, referrer, nodes } = await loadFixture(deployFixture);
      const u = nodes[0];
      await token.transfer(u.address, WEI("100"));
      await stakeAs(token, bank, u, WEI("100"), referrer.address);
      await bank.openEpoch();
      await bank.fundEpoch(WEI("100"));
      await time.increase(3 * DAY);
      await expect(bank.connect(referrer)["claimEpochReward(uint256)"](1)).to.be.revertedWithCustomError(bank, "PoolMerged");
    });

    it("无期时 settleEpoch 报 NoEpoch", async function () {
      const { bank } = await loadFixture(deployFixture);
      await expect(bank.settleEpoch()).to.be.revertedWithCustomError(bank, "NoEpoch");
    });

    it("活跃期未过领取期结算报 ClaimPeriodNotEnded", async function () {
      const { bank, token, owner, referrer, nodes } = await loadFixture(deployFixture);
      for (const n of nodes) {
        await token.connect(owner).transfer(n.address, WEI("100"));
        await stakeAs(token, bank, n, WEI("100"), referrer.address);
      }
      await bank.openEpoch();
      await bank.fundEpoch(WEI("1200"));
      await time.increase(3 * DAY); // 窗口刚开未结束
      await expect(bank.settleEpoch()).to.be.revertedWithCustomError(bank, "ClaimPeriodNotEnded");
    });

    it("领取窗口结束后 pendingEpochReward 归零、再领报 OutOfClaimWindow", async function () {
      const { bank, token, owner, referrer, nodes } = await loadFixture(deployFixture);
      for (const n of nodes) {
        await token.connect(owner).transfer(n.address, WEI("100"));
        await stakeAs(token, bank, n, WEI("100"), referrer.address);
      }
      await bank.openEpoch();
      await bank.fundEpoch(WEI("1200"));
      await time.increase(3 * DAY);
      expect(await bank.pendingEpochReward(1, referrer.address)).to.be.gt(0);
      await time.increase(8 * DAY); // 3 公示 + 8 领取 = 11 天，窗口已过（10 天结束）
      expect(await bank.pendingEpochReward(1, referrer.address)).to.equal(0);
      await expect(bank.connect(referrer)["claimEpochReward(uint256)"](1)).to.be.revertedWithCustomError(bank, "OutOfClaimWindow");
    });
  });

  describe("审计补充：管理/权限边界", function () {
    it("非 owner 设置手续费配置报 NotOwner", async function () {
      const { bank, nodes, feeReceiver } = await loadFixture(deployFixture);
      await expect(bank.connect(nodes[0]).setInteractionFeeConfig(ZERO, 1, feeReceiver.address)).to.be.revertedWithCustomError(bank, "NotOwner");
    });

    it("setOperator 边界：owner 报 OwnerIsSuperAdmin，零地址报 InvalidAddress", async function () {
      const { bank, owner, nodes } = await loadFixture(deployFixture);
      await expect(bank.setOperator(owner.address, true)).to.be.revertedWithCustomError(bank, "OwnerIsSuperAdmin");
      await expect(bank.setOperator(ZERO, true)).to.be.revertedWithCustomError(bank, "InvalidAddress");
    });

    it("setStakeValueRate(0) 报 InvalidRate", async function () {
      const { bank } = await loadFixture(deployFixture);
      await expect(bank.setStakeValueRate(0)).to.be.revertedWithCustomError(bank, "InvalidRate");
    });

    it("recoverWrongToken 边界：非 owner / 金额 0 / 质押奖励代币不可回收", async function () {
      const { bank, token, nodes, feeToken } = await loadFixture(deployFixture);
      await expect(bank.connect(nodes[0]).recoverWrongToken(await feeToken.getAddress(), nodes[0].address, 1)).to.be.revertedWithCustomError(bank, "NotOwner");
      await expect(bank.recoverWrongToken(await feeToken.getAddress(), nodes[0].address, 0)).to.be.revertedWithCustomError(bank, "InvalidAmount");
      // rewardToken == stakingToken，均不可回收
      await expect(bank.recoverWrongToken(await token.getAddress(), nodes[0].address, 1)).to.be.revertedWithCustomError(bank, "CannotRecoverStakingToken");
    });

    it("构造参数校验：零地址代币/手续费接收方", async function () {
      const { feeToken, owner } = await loadFixture(deployFixture);
      const Bank = await ethers.getContractFactory("NBTStakingBankV3");
      await expect(Bank.deploy(ZERO, await feeToken.getAddress(), owner.address, 0)).to.be.revertedWithCustomError(Bank, "InvalidToken");
      await expect(Bank.deploy(await feeToken.getAddress(), await feeToken.getAddress(), ZERO, 0)).to.be.revertedWithCustomError(Bank, "InvalidFeeReceiver");
    });
  });

  describe("审计补充：手续费边界", function () {
    it("BNB 手续费不足报 InsufficientBnbFee", async function () {
      const { bank, token, referrer, nodes, feeReceiver } = await loadFixture(deployFixture);
      await bank.setInteractionFeeConfig(ZERO, WEI("0.01"), feeReceiver.address);
      const u = nodes[0];
      await token.transfer(u.address, WEI("100"));
      await token.connect(u).approve(await bank.getAddress(), WEI("100"));
      await expect(bank.connect(u).stake(WEI("100"), referrer.address, { value: WEI("0.005") })).to.be.revertedWithCustomError(bank, "InsufficientBnbFee");
    });

    it("BNB 手续费多付部分退还用户", async function () {
      const { bank, token, referrer, nodes, feeReceiver } = await loadFixture(deployFixture);
      await bank.setInteractionFeeConfig(ZERO, WEI("0.01"), feeReceiver.address);
      const u = nodes[0];
      await token.transfer(u.address, WEI("100"));
      const beforeUser = await ethers.provider.getBalance(u.address);
      const beforeFee = await ethers.provider.getBalance(feeReceiver.address);
      await stakeAs(token, bank, u, WEI("100"), referrer.address, { value: WEI("0.02") });
      const afterUser = await ethers.provider.getBalance(u.address);
      const afterFee = await ethers.provider.getBalance(feeReceiver.address);
      // 手续费正好 0.01 进 feeReceiver，多余 0.01 退还用户
      expect(afterFee - beforeFee).to.equal(WEI("0.01"));
      // 用户净损失 = 手续费 0.01 + gas，远小于多付的 0.02
      expect(beforeUser - afterUser).to.be.gt(WEI("0.009"));
      expect(beforeUser - afterUser).to.be.lt(WEI("0.012"));
    });

    it("手续费为 0 时不收取", async function () {
      const { bank, token, referrer, nodes, feeReceiver } = await loadFixture(deployFixture);
      const u = nodes[0];
      await token.transfer(u.address, WEI("100"));
      const before = await ethers.provider.getBalance(feeReceiver.address);
      await stakeAs(token, bank, u, WEI("100"), referrer.address);
      expect(await ethers.provider.getBalance(feeReceiver.address)).to.equal(before);
    });

    it("claimNodeRewards / claimEpochReward 收取 BNB 手续费", async function () {
      const { bank, token, owner, referrer, nodes, feeReceiver } = await loadFixture(deployFixture);
      await bank.setInteractionFeeConfig(ZERO, WEI("0.01"), feeReceiver.address);
      // referrer 有邀请奖励可领
      const u = nodes[0];
      await token.transfer(u.address, WEI("100"));
      await stakeAs(token, bank, u, WEI("100"), referrer.address, { value: WEI("0.01") });
      await time.increase(15 * DAY);
      await bank.connect(referrer).claimNodeRewards({ value: WEI("0.01") });
      expect((await bank.getUserInfo(referrer.address)).info.totalInviteClaimed).to.equal(WEI("100"));

      // 排名分红领取收手续费
      for (const n of nodes) {
        await token.connect(owner).transfer(n.address, WEI("100"));
        await stakeAs(token, bank, n, WEI("100"), referrer.address, { value: WEI("0.01") });
      }
      await bank.openEpoch();
      await bank.fundEpoch(WEI("1200"));
      await time.increase(3 * DAY);
      await bank.connect(referrer)["claimEpochReward(uint256)"](1, { value: WEI("0.01") });
      expect(await bank.hasClaimed(1, referrer.address)).to.equal(true);
      expect(await ethers.provider.getBalance(feeReceiver.address)).to.be.gt(0);
    });
  });

  describe("审计补充：排名稳定性与完整排序", function () {
    it("同分时先质押者排名靠前（稳定性）", async function () {
      const { bank, token, referrer, nodes } = await loadFixture(deployFixture);
      const a = nodes[0], b = nodes[1], c = nodes[2];
      for (const n of [a, b, c]) {
        await token.transfer(n.address, WEI("100"));
        await stakeAs(token, bank, n, WEI("100"), referrer.address);
      }
      // a/b/c 个人分各 100 同分，referrer 邀请分 300 居首
      expect(await bank.getNodeRank(referrer.address)).to.equal(1);
      expect(await bank.getNodeRank(a.address)).to.equal(2);
      expect(await bank.getNodeRank(b.address)).to.equal(3);
      expect(await bank.getNodeRank(c.address)).to.equal(4);
    });

    it("追加质押分数升高后排名上浮", async function () {
      const { bank, token, referrer, nodes } = await loadFixture(deployFixture);
      const a = nodes[0], b = nodes[1];
      await token.transfer(a.address, WEI("100"));
      await stakeAs(token, bank, a, WEI("100"), referrer.address);
      await token.transfer(b.address, WEI("200"));
      await stakeAs(token, bank, b, WEI("200"), referrer.address);
      const rankBefore = await bank.getNodeRank(a.address); // a=100 最末
      await token.transfer(a.address, WEI("250"));
      await stakeAs(token, bank, a, WEI("250"), referrer.address);
      const rankAfter = await bank.getNodeRank(a.address);
      // a 总分 350，排名应显著上浮（数值变小）
      expect(Number(rankAfter)).to.be.lt(Number(rankBefore));
      expect(await bank.getNodeRank(a.address)).to.equal(2); // R(550) 第一，a(350) 第二
    });

    it("getRankedNodes 返回严格非增序", async function () {
      const { bank, token, referrer, nodes } = await loadFixture(deployFixture);
      const amounts = [150, 90, 300, 40, 220, 500];
      for (let i = 0; i < amounts.length; i++) {
        const n = nodes[i];
        await token.transfer(n.address, WEI(String(amounts[i])));
        await stakeAs(token, bank, n, WEI(String(amounts[i])), referrer.address);
      }
      const ranked = await bank.getRankedNodes(0, 100);
      expect(ranked.nodes.length).to.be.gt(0);
      for (let i = 1; i < ranked.scores.length; i++) {
        expect(ranked.scores[i - 1]).to.be.gte(ranked.scores[i]);
      }
    });
  });

  describe("审计补充：多期与跨期领取", function () {
    it("期1领取后，期2快照独立，两期排名互不影响", async function () {
      const { bank, token, owner, referrer, nodes } = await loadFixture(deployFixture);
      for (const n of nodes) {
        await token.connect(owner).transfer(n.address, WEI("100"));
        await stakeAs(token, bank, n, WEI("100"), referrer.address);
      }
      // 期1
      await bank.openEpoch();
      await bank.fundEpoch(WEI("1200"));
      await time.increase(3 * DAY);
      await bank.connect(referrer)["claimEpochReward(uint256)"](1);
      expect(await bank.hasClaimed(1, referrer.address)).to.equal(true);
      // 进入期2（期1未领取自动结转）
      await time.increase(7 * DAY); // 领取期结束
      await bank.openEpoch();
      const ep2 = await bank.getEpoch(2);
      expect(ep2.totalNodes).to.equal(12);
      expect(ep2.poolAmount).to.be.gt(0);
      // 期2快照独立，referrer 仍可领取期2
      await time.increase(3 * DAY);
      expect(await bank.pendingEpochReward(2, referrer.address)).to.be.gt(0);
      await bank.connect(referrer)["claimEpochReward(uint256)"](2);
      expect(await bank.hasClaimed(2, referrer.address)).to.equal(true);
    });
  });

  describe("审计补充：储备保护（排名奖池不被邀请奖励透支）", function () {
    it("资金紧张时，邀请奖励不得占用排名奖池", async function () {
      const { owner, feeReceiver } = await loadFixture(deployFixture);
      const Token = await ethers.getContractFactory("NBTToken");
      const token = await Token.deploy("CZ", "CZ", WEI("100000000000"), owner.address, 0, 0, [], [owner.address]);
      const Bank = await ethers.getContractFactory("NBTStakingBankV3");
      const bank = await Bank.deploy(await token.getAddress(), await token.getAddress(), feeReceiver.address, 0);
      await bank.setInviteReward(WEI("100"));
      await bank.setMinReferralStakeValue(WEI("50"));
      await token.connect(owner).approve(await bank.getAddress(), ethers.MaxUint256);
      // 只注入 5000 底仓（资金紧张）
      await token.transfer(await bank.getAddress(), WEI("5000"));

      const signers = await ethers.getSigners();
      // 11 个节点各质押 100，挂 owner
      for (const n of signers.slice(2, 13)) {
        await token.transfer(n.address, WEI("100"));
        await token.connect(n).approve(await bank.getAddress(), WEI("100"));
        await bank.connect(n).stake(WEI("100"), owner.address);
      }
      // 开期 + 注入奖池 3000
      await bank.openEpoch();
      await bank.fundEpoch(WEI("3000"));

      // 提高邀请奖励至 5000，超出"扣除未领取奖池后"的可用储备
      await bank.setInviteReward(WEI("5000"));
      const newNode = signers[14];
      await token.transfer(newNode.address, WEI("100"));
      await token.connect(newNode).approve(await bank.getAddress(), WEI("100"));
      await expect(bank.connect(newNode).stake(WEI("100"), owner.address)).to.be.revertedWithCustomError(bank, "NoInviteReserve");

      // 奖池保持完整，排名分红可正常领取
      await time.increase(3 * DAY);
      expect(await bank.pendingEpochReward(1, owner.address)).to.be.gt(0);
      await bank.connect(owner)["claimEpochReward(uint256)"](1);
      expect(await bank.hasClaimed(1, owner.address)).to.equal(true);
    });
  });

  describe("审计补充：复投预览与实际一致", function () {
    it("getReinvestPreview 三源合计 == 复投后新质押金额", async function () {
      const { bank, token, owner, referrer, nodes } = await loadFixture(deployFixture);
      await token.transfer(referrer.address, WEI("100"));
      await stakeAs(token, bank, referrer, WEI("100"), owner.address);
      for (const n of nodes) {
        await token.connect(owner).transfer(n.address, WEI("100"));
        await stakeAs(token, bank, n, WEI("100"), referrer.address);
      }
      await time.increase(15 * DAY);
      await bank.openEpoch();
      await bank.fundEpoch(WEI("1200"));
      await time.increase(3 * DAY);

      const p = await bank.getReinvestPreview(referrer.address);
      const info = await bank.getUserInfo(referrer.address);
      const stakeId = info.info.stakeCount;
      await bank.connect(referrer).reinvest(owner.address);
      const rec = await bank.getStakeRecord(referrer.address, stakeId);
      expect(rec.amount).to.equal(p.totalAmount);
    });
  });

  // ================= 深度审计（第二轮）：补充场景全面覆盖 =================
  describe("深度审计：部分到期复投", function () {
    it("只有到期的质押并入新质押，未到期质押原样保留", async function () {
      const { bank, token, referrer, nodes } = await loadFixture(deployFixture);
      const u = nodes[0];
      await token.transfer(u.address, WEI("200"));
      await stakeAs(token, bank, u, WEI("100"), referrer.address); // t0，t0+15d 到期
      await time.increase(5 * DAY);
      await stakeAs(token, bank, u, WEI("100"), referrer.address); // t0+5d，t0+20d 到期
      await time.increase(10 * DAY); // 第一笔到期，第二笔还需 5 天

      const p = await bank.getReinvestPreview(u.address);
      expect(p.principalAmount).to.equal(WEI("100"));
      expect(p.maturedStakeCount).to.equal(1);

      await bank.connect(u).reinvest(referrer.address);
      const rec0 = await bank.getStakeRecord(u.address, 0);
      expect(rec0.active).to.equal(false); // 到期笔已并入
      const rec1 = await bank.getStakeRecord(u.address, 1);
      expect(rec1.active).to.equal(true); // 未到期笔保留
      const rec2 = await bank.getStakeRecord(u.address, 2);
      expect(rec2.amount).to.equal(WEI("100"));
      expect(rec2.active).to.equal(true);
      // 全局计数一致：只有第二笔(100) + 新质押(100)
      expect(await bank.totalStaked()).to.equal(WEI("200"));
    });
  });

  describe("深度审计：复投与领取互斥", function () {
    it("复投领取排名分红后，claimEpochReward 报 AlreadyClaimed", async function () {
      const { bank, token, owner, referrer, nodes } = await loadFixture(deployFixture);
      for (const n of nodes) {
        await token.connect(owner).transfer(n.address, WEI("100"));
        await stakeAs(token, bank, n, WEI("100"), referrer.address);
      }
      await bank.openEpoch();
      await bank.fundEpoch(WEI("1200"));
      await time.increase(3 * DAY);
      await bank.connect(referrer).setReferrer(owner.address);
      await bank.connect(referrer).reinvest(owner.address);
      expect(await bank.hasClaimed(1, referrer.address)).to.equal(true);
      await expect(bank.connect(referrer)["claimEpochReward(uint256)"](1)).to.be.revertedWithCustomError(bank, "AlreadyClaimed");
    });

    it("claimEpochReward 领取后，复投预览不再包含该期排名分红", async function () {
      const { bank, token, owner, referrer, nodes } = await loadFixture(deployFixture);
      for (const n of nodes) {
        await token.connect(owner).transfer(n.address, WEI("100"));
        await stakeAs(token, bank, n, WEI("100"), referrer.address);
      }
      await bank.openEpoch();
      await bank.fundEpoch(WEI("1200"));
      await time.increase(3 * DAY);
      expect((await bank.getReinvestPreview(referrer.address)).rankAmount).to.be.gt(0);
      await bank.connect(referrer)["claimEpochReward(uint256)"](1);
      expect((await bank.getReinvestPreview(referrer.address)).rankAmount).to.equal(0);
    });

    it("复投跳过 disabled 期（节点不足）的排名分红", async function () {
      const { bank, token, referrer, nodes, owner } = await loadFixture(deployFixture);
      const u = nodes[0];
      await token.transfer(u.address, WEI("100"));
      await stakeAs(token, bank, u, WEI("100"), referrer.address); // 仅 2 节点 < 10
      await bank.openEpoch();
      await bank.fundEpoch(WEI("100"));
      await time.increase(3 * DAY);
      // 邀请奖励未解锁、无到期本金、disabled 期被跳过 → 无可复投资产
      await bank.connect(referrer).setReferrer(owner.address);
      await expect(bank.connect(referrer).reinvest(owner.address)).to.be.revertedWithCustomError(bank, "NoReinvestableAssets");
    });
  });

  describe("深度审计：快照独立性与多期", function () {
    it("取本后当前排名下降，但本期快照排名分红仍可领取", async function () {
      const { bank, token, owner, referrer, nodes } = await loadFixture(deployFixture);
      for (const n of nodes) {
        await token.connect(owner).transfer(n.address, WEI("100"));
        await stakeAs(token, bank, n, WEI("100"), referrer.address);
      }
      await time.increase(12 * DAY); // 质押满 15 天
      await bank.openEpoch();
      await bank.fundEpoch(WEI("1200"));
      await time.increase(3 * DAY); // 进入领取窗口，质押已到期
      const u = nodes[0];
      await bank.connect(u).withdraw(0); // 取本 → 当前排名归零
      expect(await bank.getNodeRank(u.address)).to.equal(0);
      // 快照排名仍在 → 仍可领取期1分红
      expect(await bank.pendingEpochReward(1, u.address)).to.be.gt(0);
      await bank.connect(u)["claimEpochReward(uint256)"](1);
      expect(await bank.hasClaimed(1, u.address)).to.equal(true);
    });

    it("多笔 fundEpoch 累积奖池", async function () {
      const { bank, token, owner, referrer, nodes } = await loadFixture(deployFixture);
      for (const n of nodes) {
        await token.connect(owner).transfer(n.address, WEI("100"));
        await stakeAs(token, bank, n, WEI("100"), referrer.address);
      }
      await bank.openEpoch();
      await bank.fundEpoch(WEI("100"));
      await bank.fundEpoch(WEI("200"));
      const ep = await bank.getEpoch(1);
      expect(ep.poolAmount).to.equal(WEI("300"));
    });
  });

  describe("深度审计：复投循环", function () {
    it("复投产生的新质押到期后可再次复投", async function () {
      const { bank, token, referrer, nodes, owner } = await loadFixture(deployFixture);
      const u = nodes[0];
      await token.transfer(u.address, WEI("100"));
      await stakeAs(token, bank, u, WEI("100"), referrer.address);
      await time.increase(15 * DAY);
      await bank.connect(referrer).setReferrer(owner.address);
      // 第一次复投：邀请奖励 100
      await bank.connect(referrer).reinvest(owner.address);
      let info = await bank.getUserInfo(referrer.address);
      expect(info.info.activeStakeCount).to.equal(1);
      // 新质押到期后再次复投（本金 100）
      await time.increase(15 * DAY);
      const p = await bank.getReinvestPreview(referrer.address);
      expect(p.principalAmount).to.equal(WEI("100"));
      await bank.connect(referrer).reinvest(owner.address);
      info = await bank.getUserInfo(referrer.address);
      expect(info.info.activeStakeCount).to.equal(1);
      const rec = await bank.getStakeRecord(referrer.address, 1);
      expect(rec.amount).to.equal(WEI("100"));
    });

    it("复投新质押给推荐人增加邀请分（排名继续按价值计算）", async function () {
      const { bank, token, referrer, nodes, owner } = await loadFixture(deployFixture);
      const u = nodes[0];
      await token.transfer(u.address, WEI("100"));
      await stakeAs(token, bank, u, WEI("100"), referrer.address);
      await time.increase(15 * DAY);
      await bank.connect(referrer).setReferrer(owner.address);
      const before = (await bank.getUserInfo(owner.address)).info.referralStakeVolume;
      await bank.connect(referrer).reinvest(owner.address);
      const after = (await bank.getUserInfo(owner.address)).info.referralStakeVolume;
      expect(after).to.equal(before + WEI("100"));
    });
  });

  describe("深度审计：跨代币 / 手续费同币种", function () {
    it("stakingToken != rewardToken 时 reinvest 报 CompoundTokenMismatch", async function () {
      const { token, feeToken, owner, feeReceiver } = await loadFixture(deployFixture);
      const Bank = await ethers.getContractFactory("NBTStakingBankV3");
      const bank = await Bank.deploy(await token.getAddress(), await feeToken.getAddress(), feeReceiver.address, 0);
      await bank.setInviteReward(WEI("100"));
      await bank.setMinReferralStakeValue(WEI("50"));
      // 奖励代币需有储备，邀请奖励才能发放
      await feeToken.transfer(await bank.getAddress(), WEI("1000"));
      await token.connect(owner).approve(await bank.getAddress(), ethers.MaxUint256);
      const u = (await ethers.getSigners())[2];
      await token.transfer(u.address, WEI("100"));
      await token.connect(u).approve(await bank.getAddress(), WEI("100"));
      await bank.connect(u).stake(WEI("100"), owner.address);
      await time.increase(15 * DAY);
      await expect(bank.connect(u).reinvest(owner.address)).to.be.revertedWithCustomError(bank, "CompoundTokenMismatch");
    });

    it("手续费代币与质押代币相同时，质押按 ERC20 扣手续费", async function () {
      const { bank, token, feeReceiver, referrer, nodes } = await loadFixture(deployFixture);
      await bank.setInteractionFeeConfig(await token.getAddress(), WEI("1"), feeReceiver.address);
      const u = nodes[0];
      await token.transfer(u.address, WEI("200"));
      await token.connect(u).approve(await bank.getAddress(), WEI("200"));
      const before = await token.balanceOf(feeReceiver.address);
      await bank.connect(u).stake(WEI("100"), referrer.address);
      expect(await token.balanceOf(feeReceiver.address)).to.equal(before + WEI("1"));
      // 手续费不计入质押本金
      expect((await bank.getUserInfo(u.address)).info.totalStaked).to.equal(WEI("100"));
    });
  });

  describe("深度审计：锁定分批解锁与全局计数", function () {
    it("多条邀请锁定不同到期时间，只解锁已到期部分", async function () {
      const { bank, token, referrer, nodes } = await loadFixture(deployFixture);
      const a = nodes[0], b = nodes[1];
      await token.transfer(a.address, WEI("100"));
      await stakeAs(token, bank, a, WEI("100"), referrer.address); // 锁 t0+15d
      await time.increase(5 * DAY);
      await token.transfer(b.address, WEI("100"));
      await stakeAs(token, bank, b, WEI("100"), referrer.address); // 锁 t0+20d
      await time.increase(10 * DAY); // 到 t0+15d：仅第一条解锁
      expect(await bank.pendingRewardAll(referrer.address)).to.equal(WEI("100"));
      await time.increase(5 * DAY); // 到 t0+20d：第二条也解锁
      expect(await bank.pendingRewardAll(referrer.address)).to.equal(WEI("200"));
    });

    it("全局计数不变量：totalStaked == 各活跃质押金额之和", async function () {
      const { bank, token, referrer, nodes } = await loadFixture(deployFixture);
      const a = nodes[0], b = nodes[1];
      await token.transfer(a.address, WEI("150"));
      await stakeAs(token, bank, a, WEI("100"), referrer.address);
      await token.transfer(b.address, WEI("200"));
      await stakeAs(token, bank, b, WEI("200"), referrer.address);
      await time.increase(15 * DAY);
      await bank.connect(a).withdraw(0);
      expect(await bank.totalStaked()).to.equal(WEI("200"));
      await token.transfer(a.address, WEI("50"));
      await stakeAs(token, bank, a, WEI("50"), referrer.address);
      expect(await bank.totalStaked()).to.equal(WEI("250"));
    });
  });

  describe("深度审计：暂停期管理与预览边界", function () {
    it("暂停期间 admin 仍可 recoverWrongToken 与设置参数", async function () {
      const { bank, feeToken, owner } = await loadFixture(deployFixture);
      await feeToken.transfer(await bank.getAddress(), WEI("100"));
      await bank.pause();
      await bank.setInviteReward(WEI("50"));
      const before = await feeToken.balanceOf(owner.address);
      await bank.recoverWrongToken(await feeToken.getAddress(), owner.address, WEI("100"));
      expect(await feeToken.balanceOf(owner.address)).to.equal(before + WEI("100"));
    });

    it("getRankRewardPreview 边界：rank 为 0 / 超出节点数返回 0", async function () {
      const { bank } = await loadFixture(deployFixture);
      expect(await bank.getRankRewardPreview(WEI("1000"), 0, 1)).to.equal(0);
      expect(await bank.getRankRewardPreview(WEI("1000"), 12, 0)).to.equal(0);
      expect(await bank.getRankRewardPreview(WEI("1000"), 12, 13)).to.equal(0);
      expect(await bank.getRankRewardPreview(WEI("1000"), 12, 3)).to.be.gt(0);
    });
  });

  describe("深度审计：储备保护补充（pendingCarryover 预留）", function () {
    it("settle 后待结转奖励计入预留，禁止透支", async function () {
      const { owner, feeReceiver } = await loadFixture(deployFixture);
      const Token = await ethers.getContractFactory("NBTToken");
      const token = await Token.deploy("CZ", "CZ", WEI("100000000000"), owner.address, 0, 0, [], [owner.address]);
      const Bank = await ethers.getContractFactory("NBTStakingBankV3");
      const bank = await Bank.deploy(await token.getAddress(), await token.getAddress(), feeReceiver.address, 0);
      await bank.setInviteReward(WEI("100"));
      await bank.setMinReferralStakeValue(WEI("50"));
      await token.connect(owner).approve(await bank.getAddress(), ethers.MaxUint256);
      await token.transfer(await bank.getAddress(), WEI("5000"));
      const signers = await ethers.getSigners();
      for (const n of signers.slice(2, 13)) {
        await token.transfer(n.address, WEI("100"));
        await token.connect(n).approve(await bank.getAddress(), WEI("100"));
        await bank.connect(n).stake(WEI("100"), owner.address);
      }
      await bank.openEpoch();
      await bank.fundEpoch(WEI("2000"));
      await time.increase(10 * DAY); // 无人领取，过领取期
      await bank.settleEpoch(); // pendingCarryover = 2000
      expect(await bank.pendingCarryover()).to.equal(WEI("2000"));
      // 若未预留 pendingCarryover，提高邀请奖励将透支结转奖池 → 应拒绝
      await bank.setInviteReward(WEI("5000"));
      const newNode = signers[14];
      await token.transfer(newNode.address, WEI("100"));
      await token.connect(newNode).approve(await bank.getAddress(), WEI("100"));
      await expect(bank.connect(newNode).stake(WEI("100"), owner.address)).to.be.revertedWithCustomError(bank, "NoInviteReserve");
      // 结转奖池保持完整，可正常流入下一期
      await bank.openEpoch();
      const ep2 = await bank.getEpoch(2);
      expect(ep2.poolAmount).to.equal(WEI("2000"));
    });
  });
});
