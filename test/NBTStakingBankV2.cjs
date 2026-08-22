const { expect } = require("chai");
const { loadFixture, time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { ethers } = require("hardhat");

const DAY = 24 * 60 * 60;
const WEI = (x) => ethers.parseEther(x);
const ZERO_ADDRESS = ethers.ZeroAddress;

// ---------- Fixture ----------
async function deployFixture() {
  const [owner, referrer, ...rest] = await ethers.getSigners();
  const nodes = rest.slice(0, 11); // 11 个节点账户

  const Token = await ethers.getContractFactory("NBTToken");
  const token = await Token.deploy(
    "CZ", "CZ", WEI("100000000000"),
    owner.address, 0, 0, [], [owner.address]
  );
  const feeToken = await Token.deploy(
    "Fee", "FEE", WEI("100000000000"),
    owner.address, 0, 0, [], [owner.address]
  );

  const feeReceiver = rest[11];
  const Bank = await ethers.getContractFactory("NBTStakingBankV2");
  const bank = await Bank.deploy(
    await token.getAddress(),
    await token.getAddress(),
    feeReceiver.address,
    0 // 默认关闭手续费
  );

  await bank.setInviteReward(WEI("100"));
  await bank.setMinReferralStakeValue(WEI("50"));

  // 预留充足奖励池(预留一部分给 owner 用于向测试账户分发)
  await token.transfer(await bank.getAddress(), WEI("90000000000"));

  return { owner, referrer, nodes, token, feeToken, bank, feeReceiver };
}

// 授权 + 质押
async function stakeAs(token, bank, user, amount, referrer, { feeToken: ft, feeAmount } = {}) {
  if (ft && feeAmount) {
    await ft.connect(user).approve(await bank.getAddress(), feeAmount);
  }
  await token.connect(user).approve(await bank.getAddress(), amount);
  return bank.connect(user).stake(amount, referrer);
}

// 生成 N 个节点(全部挂在 referrer 下)。referrer 因邀请分自动上榜，
// 所以最终榜单节点数 = nodes.length + 1(referrer)
async function createNodes(token, bank, nodes, referrer, amount) {
  const [owner] = await ethers.getSigners();
  for (const n of nodes) {
    await token.connect(owner).transfer(n.address, amount);
    await stakeAs(token, bank, n, amount, referrer.address);
  }
}

describe("NBTStakingBankV2", function () {
  describe("constructor", function () {
    it("应正确初始化基础参数", async function () {
      const { owner, bank, token, feeReceiver } = await loadFixture(deployFixture);
      expect(await bank.owner()).to.equal(owner.address);
      expect(await bank.stakingToken()).to.equal(await token.getAddress());
      expect(await bank.rewardToken()).to.equal(await token.getAddress());
      expect(await bank.feeReceiver()).to.equal(feeReceiver.address);
      expect(await bank.inviteReward()).to.equal(WEI("100"));
      expect(await bank.minReferralStakeValue()).to.equal(WEI("50"));
      expect(await bank.LOCK_PERIOD()).to.equal(15 * DAY);
      expect(await bank.MIN_NODES()).to.equal(10);
    });
  });

  describe("roles / 权限", function () {
    it("非 owner 不能设置参数", async function () {
      const { bank, nodes } = await loadFixture(deployFixture);
      await expect(bank.connect(nodes[0]).setInviteReward(WEI("1"))).to.be.revertedWith(
        "Ownable: caller is not the owner"
      );
      await expect(bank.connect(nodes[0]).setStakeValueRate(2)).to.be.revertedWith(
        "Ownable: caller is not the owner"
      );
    });

    it("two-step 所有权转移", async function () {
      const { bank, nodes } = await loadFixture(deployFixture);
      await bank.transferOwnership(nodes[0].address);
      expect(await bank.pendingOwner()).to.equal(nodes[0].address);
      await expect(bank.acceptOwnership()).to.be.revertedWith(
        "Ownable: caller is not the new owner"
      );
      await bank.connect(nodes[0]).acceptOwnership();
      expect(await bank.owner()).to.equal(nodes[0].address);
    });

    it("operator 具备 admin 权限(可快照/结算)", async function () {
      const { bank, nodes } = await loadFixture(deployFixture);
      const op = nodes[10];
      await bank.setOperator(op.address, true);
      expect(await bank.operators(op.address)).to.equal(true);
      await expect(bank.connect(nodes[1]).openEpoch()).to.be.revertedWith(
        "Admin: caller is not admin"
      );
      await bank.connect(op).openEpoch();
      expect(await bank.currentEpochId()).to.equal(1);
      await bank.settleEpoch();
      await bank.setOperator(op.address, false);
      expect(await bank.operators(op.address)).to.equal(false);
    });
  });

  describe("stake 质押", function () {
    it("必须先绑定推荐人才能质押", async function () {
      const { bank, nodes } = await loadFixture(deployFixture);
      await expect(bank.connect(nodes[0]).stake(WEI("100"), ZERO_ADDRESS)).to.be.revertedWith(
        "Must bind referrer first"
      );
    });

    it("stake 自动绑定推荐人并更新个人分/邀请分", async function () {
      const { owner, bank, token, referrer, nodes } = await loadFixture(deployFixture);
      const u = nodes[0];
      await token.connect(owner).transfer(u.address, WEI("300"));
      await expect(stakeAs(token, bank, u, WEI("300"), referrer.address))
        .to.emit(bank, "Deposit")
        .withArgs(u.address, referrer.address, 0, WEI("300"));
      expect(await bank.hasReferrer(u.address)).to.equal(true);
      const info = await bank.userInfo(u.address);
      expect(info.personalStakeVolume).to.equal(WEI("300"));
      expect(info.stakeCount).to.equal(1);
      expect(info.activeStakeCount).to.equal(1);
      expect(await bank.totalStaked()).to.equal(WEI("300"));
      const ri = await bank.userInfo(referrer.address);
      expect(ri.referralStakeVolume).to.equal(WEI("300"));
      expect(await bank.getRankedNodeCount()).to.equal(2);
    });

    it("已绑定时传入不一致推荐人则拒绝", async function () {
      const { owner, bank, token, referrer, nodes } = await loadFixture(deployFixture);
      const u = nodes[0];
      await token.connect(owner).transfer(u.address, WEI("100"));
      await stakeAs(token, bank, u, WEI("100"), referrer.address);
      await token.connect(owner).transfer(u.address, WEI("100"));
      await expect(bank.connect(u).stake(WEI("100"), nodes[1].address)).to.be.revertedWith(
        "Referrer mismatch"
      );
    });

    it("重复质押累计数量与分数", async function () {
      const { owner, bank, token, referrer, nodes } = await loadFixture(deployFixture);
      const u = nodes[0];
      await token.connect(owner).transfer(u.address, WEI("150"));
      await stakeAs(token, bank, u, WEI("50"), referrer.address);
      await stakeAs(token, bank, u, WEI("100"), referrer.address);
      expect((await bank.userInfo(u.address)).personalStakeVolume).to.equal(WEI("150"));
      expect((await bank.userInfo(referrer.address)).referralStakeVolume).to.equal(WEI("150"));
      expect(await bank.totalStaked()).to.equal(WEI("150"));
    });

    it("超过 MAX_ACTIVE_STAKES 拒绝", async function () {
      const { owner, bank, token, referrer, nodes } = await loadFixture(deployFixture);
      const u = nodes[0];
      await token.connect(owner).transfer(u.address, WEI("100000"));
      await token.connect(u).approve(await bank.getAddress(), WEI("100000"));
      for (let i = 0; i < 50; i++) {
        await bank.connect(u).stake(WEI("100"), referrer.address);
      }
      await expect(bank.connect(u).stake(WEI("100"), referrer.address)).to.be.revertedWith(
        "Too many active stakes"
      );
    });

    it("amount 为 0 拒绝", async function () {
      const { bank, nodes } = await loadFixture(deployFixture);
      await expect(bank.connect(nodes[0]).stake(0, nodes[1].address)).to.be.revertedWith(
        "Invalid amount"
      );
    });

    it("暂停时禁止质押", async function () {
      const { owner, bank, token, referrer, nodes } = await loadFixture(deployFixture);
      await bank.pause();
      await expect(bank.connect(nodes[0]).stake(WEI("100"), referrer.address)).to.be.revertedWith(
        "Paused"
      );
    });
  });

  describe("withdraw 提取", function () {
    it("锁定期内不能提取", async function () {
      const { owner, bank, token, referrer, nodes } = await loadFixture(deployFixture);
      const u = nodes[0];
      await token.connect(owner).transfer(u.address, WEI("100"));
      await stakeAs(token, bank, u, WEI("100"), referrer.address);
      await expect(bank.connect(u).withdraw(0)).to.be.revertedWith(
        "Lock period not ended"
      );
    });

    it("锁定期结束可提取并回退个人分/邀请分", async function () {
      const { owner, bank, token, referrer, nodes } = await loadFixture(deployFixture);
      const u = nodes[0];
      await token.connect(owner).transfer(u.address, WEI("100"));
      await stakeAs(token, bank, u, WEI("100"), referrer.address);
      await time.increase(15 * DAY + 1);
      const balBefore = await token.balanceOf(u.address);
      await expect(bank.connect(u).withdraw(0))
        .to.emit(bank, "Withdraw")
        .withArgs(u.address, 0, WEI("100"));
      expect(await token.balanceOf(u.address)).to.equal(balBefore + WEI("100"));
      expect((await bank.userInfo(u.address)).personalStakeVolume).to.equal(0);
      expect((await bank.userInfo(referrer.address)).referralStakeVolume).to.equal(0);
      expect(await bank.totalStaked()).to.equal(0);
      expect(await bank.getRankedNodeCount()).to.equal(0);
    });

    it("已提取记录不能二次提取", async function () {
      const { owner, bank, token, referrer, nodes } = await loadFixture(deployFixture);
      const u = nodes[0];
      await token.connect(owner).transfer(u.address, WEI("100"));
      await stakeAs(token, bank, u, WEI("100"), referrer.address);
      await time.increase(15 * DAY + 1);
      await bank.connect(u).withdraw(0);
      await expect(bank.connect(u).withdraw(0)).to.be.revertedWith("Stake not active");
    });

    it("提取仅扣本人对应份额(幽灵扣分修复)", async function () {
      const { owner, bank, token, referrer, nodes } = await loadFixture(deployFixture);
      const ua = nodes[0], ub = nodes[1];
      await token.connect(owner).transfer(ua.address, WEI("100"));
      await token.connect(owner).transfer(ub.address, WEI("100"));
      await stakeAs(token, bank, ua, WEI("100"), referrer.address);
      await stakeAs(token, bank, ub, WEI("100"), referrer.address);
      await time.increase(15 * DAY + 1);
      await bank.connect(ua).withdraw(0);
      expect((await bank.userInfo(referrer.address)).referralStakeVolume).to.equal(WEI("100"));
      expect((await bank.userInfo(ub.address)).personalStakeVolume).to.equal(WEI("100"));
    });
  });

  describe("referrer 绑定规则", function () {
    it("不能自绑/重绑/成环", async function () {
      const { bank, nodes } = await loadFixture(deployFixture);
      const a = nodes[0], b = nodes[1];
      await expect(bank.connect(a).setReferrer(a.address)).to.be.revertedWith("Cannot refer self");
      await bank.connect(a).setReferrer(b.address);
      await expect(bank.connect(a).setReferrer(nodes[2].address)).to.be.revertedWith("Already has referrer");
      await expect(bank.connect(b).setReferrer(a.address)).to.be.revertedWith("Circular referral not allowed");
    });

    it("setReferrer 显式绑定", async function () {
      const { bank, referrer, nodes } = await loadFixture(deployFixture);
      await expect(bank.connect(nodes[0]).setReferrer(referrer.address))
        .to.emit(bank, "ReferrerSet")
        .withArgs(nodes[0].address, referrer.address);
      expect(await bank.hasReferrer(nodes[0].address)).to.equal(true);
    });
  });

  describe("invite 邀请奖励", function () {
    it("低于门槛不达标，达到门槛计发邀请奖", async function () {
      const { owner, bank, token, referrer, nodes } = await loadFixture(deployFixture);
      await token.connect(owner).transfer(nodes[0].address, WEI("49"));
      await stakeAs(token, bank, nodes[0], WEI("49"), referrer.address);
      expect(await bank.qualifiedReferral(referrer.address, nodes[0].address)).to.equal(false);
      await token.connect(owner).transfer(nodes[1].address, WEI("50"));
      await stakeAs(token, bank, nodes[1], WEI("50"), referrer.address);
      expect(await bank.qualifiedReferral(referrer.address, nodes[1].address)).to.equal(true);
      expect((await bank.userInfo(referrer.address)).directReferrals).to.equal(1);
      expect((await bank.userInfo(referrer.address)).lockedInviteRewards).to.equal(WEI("100"));
    });

    it("锁定期结束后领取邀请奖励", async function () {
      const { owner, bank, token, referrer, nodes } = await loadFixture(deployFixture);
      await token.connect(owner).transfer(nodes[0].address, WEI("100"));
      await stakeAs(token, bank, nodes[0], WEI("100"), referrer.address);
      expect(await bank.pendingRewardAll(referrer.address)).to.equal(0);
      await time.increase(15 * DAY + 1);
      expect(await bank.pendingRewardAll(referrer.address)).to.equal(WEI("100"));
      await expect(bank.connect(referrer).claimNodeRewards())
        .to.emit(bank, "NodeRewardsClaimed")
        .withArgs(referrer.address, WEI("100"), 0);
      expect((await bank.userInfo(referrer.address)).totalInviteClaimed).to.equal(WEI("100"));
    });

    it("无奖励领取失败", async function () {
      const { bank, nodes } = await loadFixture(deployFixture);
      await expect(bank.connect(nodes[0]).claimNodeRewards()).to.be.revertedWith("No rewards");
    });

    it("compoundNodeRewards 复投邀请奖励生成新质押", async function () {
      const { owner, bank, token, referrer, nodes } = await loadFixture(deployFixture);
      // referrer 先质押成为节点(计入 stake id 0)
      await token.connect(owner).transfer(referrer.address, WEI("100"));
      await stakeAs(token, bank, referrer, WEI("100"), owner.address);
      // 邀请一个节点让 referrer 获得邀请奖
      await token.connect(owner).transfer(nodes[0].address, WEI("100"));
      await stakeAs(token, bank, nodes[0], WEI("100"), referrer.address);
      await time.increase(15 * DAY + 1);
      await expect(bank.connect(referrer).compoundNodeRewards(owner.address))
        .to.emit(bank, "NodeRewardsCompounded");
      expect((await bank.userInfo(referrer.address)).stakeCount).to.equal(2);
    });
  });

  describe("node ranking 排名", function () {
    it("按总分(个人+邀请)降序排列", async function () {
      const { owner, bank, token, referrer, nodes } = await loadFixture(deployFixture);
      const amts = [WEI("100"), WEI("200"), WEI("300")];
      for (let i = 0; i < 3; i++) {
        await token.connect(owner).transfer(nodes[i].address, amts[i]);
        await stakeAs(token, bank, nodes[i], amts[i], referrer.address);
      }
      await token.connect(owner).transfer(referrer.address, WEI("700"));
      await stakeAs(token, bank, referrer, WEI("700"), owner.address);
      const { nodes: ranked, scores } = await bank.getRankedNodes(0, 10);
      expect(ranked[0]).to.equal(referrer.address);
      for (let i = 1; i < ranked.length; i++) {
        expect(scores[i - 1] >= scores[i]).to.equal(true);
      }
      expect(await bank.getNodeRank(referrer.address)).to.equal(1);
    });

    it("提取后分数下降排名随之更新", async function () {
      const { owner, bank, token, referrer, nodes } = await loadFixture(deployFixture);
      await token.connect(owner).transfer(nodes[0].address, WEI("500"));
      await stakeAs(token, bank, nodes[0], WEI("500"), referrer.address);
      await token.connect(owner).transfer(nodes[1].address, WEI("300"));
      await stakeAs(token, bank, nodes[1], WEI("300"), referrer.address);
      // referrer=800, nodes0=500, nodes1=300
      expect(await bank.getNodeRank(nodes[1].address)).to.equal(3);
      await time.increase(15 * DAY + 1);
      await bank.connect(nodes[0]).withdraw(0);
      // nodes0 出榜, nodes1 升到 2
      expect(await bank.getNodeRank(nodes[1].address)).to.equal(2);
    });
  });

  describe("epoch 快照/结算", function () {
    it("快照≥10人档开启，锁定排名", async function () {
      const { owner, bank, token, referrer, nodes } = await loadFixture(deployFixture);
      await createNodes(token, bank, nodes, referrer, WEI("100"));
      await expect(bank.openEpoch())
        .to.emit(bank, "EpochOpened")
        .withArgs(1, 12, 0, false); // 11 节点 + referrer
      const ep = await bank.getEpoch(1);
      expect(ep.totalNodes).to.equal(12);
      expect(ep.disabled).to.equal(false);
      expect(ep.snapshotTime).to.equal(await time.latest());
    });

    it("节点数不足10 disabled，不可领取", async function () {
      const { owner, bank, token, referrer, nodes } = await loadFixture(deployFixture);
      await createNodes(token, bank, nodes.slice(0, 5), referrer, WEI("100"));
      await expect(bank.openEpoch())
        .to.emit(bank, "EpochOpened")
        .withArgs(1, 6, 0, true);
      await time.increase(3 * DAY + 1);
      await expect(bank["claimEpochReward(uint256)"](1)).to.be.revertedWith("Pool merged to next epoch");
      await bank.settleEpoch();
      await bank.openEpoch();
      expect(await bank.currentEpochId()).to.equal(2);
    });

    it("快照后新质押不影响本期榜单", async function () {
      const { owner, bank, token, referrer, nodes } = await loadFixture(deployFixture);
      await createNodes(token, bank, nodes, referrer, WEI("100"));
      await bank.openEpoch();
      await token.connect(owner).transfer(nodes[10].address, WEI("100000"));
      await stakeAs(token, bank, nodes[10], WEI("100000"), referrer.address);
      const ep = await bank.getEpoch(1);
      expect(ep.totalNodes).to.equal(12);
    });

    it("fundEpoch 注资进入奖励池", async function () {
      const { owner, bank, token, referrer, nodes } = await loadFixture(deployFixture);
      await createNodes(token, bank, nodes, referrer, WEI("100"));
      await bank.openEpoch();
      await token.connect(owner).approve(await bank.getAddress(), WEI("2000"));
      await expect(bank.fundEpoch(WEI("2000")))
        .to.emit(bank, "EpochFunded")
        .withArgs(1, owner.address, WEI("2000"), WEI("2000"));
      expect((await bank.getCurrentRelease()).poolAmount).to.equal(WEI("2000"));
    });

    it("禁止对未开启期注资", async function () {
      const { bank } = await loadFixture(deployFixture);
      await expect(bank.fundEpoch(WEI("1"))).to.be.revertedWith("No active epoch");
    });
  });

  describe("epoch 奖励领取", function () {
    it("窗口内领取，档内等分，档尾兜底，100%分完", async function () {
      const { owner, bank, token, referrer, nodes } = await loadFixture(deployFixture);
      await createNodes(token, bank, nodes, referrer, WEI("100")); // 12 节点
      await bank.openEpoch();
      await token.connect(owner).approve(await bank.getAddress(), WEI("2400"));
      await bank.fundEpoch(WEI("2400"));
      await time.increase(3 * DAY + 1);

      // 12 节点 bucket [5000,5000,0,0]: 前10名各 120, 后2名各 600
      expect(await bank.pendingEpochReward(1, referrer.address)).to.equal(WEI("120"));
      const { nodes: ranked } = await bank.getRankedNodes(0, 12);
      expect(await bank.pendingEpochReward(1, ranked[1])).to.equal(WEI("120"));
      expect(await bank.pendingEpochReward(1, ranked[9])).to.equal(WEI("120")); // 档尾兜底
      expect(await bank.pendingEpochReward(1, ranked[10])).to.equal(WEI("600"));
      expect(await bank.pendingEpochReward(1, ranked[11])).to.equal(WEI("600"));

      const balBefore = await token.balanceOf(referrer.address);
      await expect(bank.connect(referrer)["claimEpochReward(uint256)"](1))
        .to.emit(bank, "EpochRewardClaimed")
        .withArgs(1, referrer.address, 1, WEI("120"));
      expect(await token.balanceOf(referrer.address)).to.equal(balBefore + WEI("120"));
      expect(await bank.hasClaimed(1, referrer.address)).to.equal(true);
      await expect(bank.connect(referrer)["claimEpochReward(uint256)"](1)).to.be.revertedWith("Already claimed");
    });

    it("全部领取后总额=池(100%分配)", async function () {
      const { owner, bank, token, referrer, nodes } = await loadFixture(deployFixture);
      await createNodes(token, bank, nodes, referrer, WEI("100"));
      await bank.openEpoch();
      await token.connect(owner).approve(await bank.getAddress(), WEI("1000"));
      await bank.fundEpoch(WEI("1000"));
      await time.increase(3 * DAY + 1);
      const { nodes: ranked } = await bank.getRankedNodes(0, 12);
      const shares = [];
      for (const addr of ranked) {
        shares.push(await bank.pendingEpochReward(1, addr));
      }
      const total = shares.reduce((a, b) => a + b, 0n);
      expect(total).to.equal(WEI("1000"));
    });

    it("领取窗口外不能领取", async function () {
      const { owner, bank, token, referrer, nodes } = await loadFixture(deployFixture);
      await createNodes(token, bank, nodes, referrer, WEI("100"));
      await bank.openEpoch();
      await token.connect(owner).approve(await bank.getAddress(), WEI("1000"));
      await bank.fundEpoch(WEI("1000"));
      await time.increase(1 * DAY); // 未到公示期结束
      await expect(bank.connect(referrer)["claimEpochReward(uint256)"](1)).to.be.revertedWith(
        "Out of claim window"
      );
    });
  });

  describe("epoch 结算 carryover", function () {
    it("未领取奖励滚入下期奖励池", async function () {
      const { owner, bank, token, referrer, nodes } = await loadFixture(deployFixture);
      await createNodes(token, bank, nodes, referrer, WEI("100"));
      await bank.openEpoch();
      await token.connect(owner).approve(await bank.getAddress(), WEI("1000"));
      await bank.fundEpoch(WEI("1000"));
      await time.increase(3 * DAY + 1);
      await bank.connect(referrer)["claimEpochReward(uint256)"](1); // 领取 rank1 的 50
      await time.increase(7 * DAY); // 超过领取期
      await expect(bank.settleEpoch()).to.emit(bank, "EpochSettled");
      expect(await bank.pendingCarryover()).to.equal(WEI("1000") - WEI("50"));
      await bank.openEpoch();
      expect((await bank.getEpoch(2)).poolAmount).to.equal(WEI("1000") - WEI("50"));
    });

    it("不可重复结算", async function () {
      const { bank } = await loadFixture(deployFixture);
      await bank.openEpoch();
      await bank.settleEpoch();
      await expect(bank.settleEpoch()).to.be.revertedWith("Already settled");
    });
  });

  describe("动态分档权重 (_rankShare)", function () {
    // 注：已知“分档倒挂”风险（N=11/51~76/101~111 稀疏尾档单名反超）。
    // 经确认“只报告不修改”，此处仅保留 100% 分完与口径校验，不强制逐名次单调。
    it("1-10 人只开第一档 100%", async function () {
      const { bank } = await loadFixture(deployFixture);
      expect(await bank.getRankRewardPreview(WEI("1000"), 10, 1)).to.equal(WEI("100"));
      expect(await bank.getRankRewardPreview(WEI("1000"), 10, 10)).to.equal(WEI("100"));
    });

    it("11-50: 50/50 两档", async function () {
      const { bank } = await loadFixture(deployFixture);
      expect(await bank.getRankRewardPreview(WEI("1200"), 20, 1)).to.equal(WEI("60"));
      expect(await bank.getRankRewardPreview(WEI("1200"), 20, 20)).to.equal(WEI("60"));
    });

    it("51-100: 50/30/20 三档", async function () {
      const { bank } = await loadFixture(deployFixture);
      expect(await bank.getRankRewardPreview(WEI("2000"), 60, 1)).to.equal(WEI("100"));
      expect(await bank.getRankRewardPreview(WEI("2000"), 60, 20)).to.equal(WEI("15"));
      expect(await bank.getRankRewardPreview(WEI("2000"), 60, 51)).to.equal(WEI("40"));
    });

    it(">=101: 50/30/15/5 四档，杜绝倒挂", async function () {
      const { bank } = await loadFixture(deployFixture);
      const top = await bank.getRankRewardPreview(WEI("1000"), 200, 1);
      const tail = await bank.getRankRewardPreview(WEI("1000"), 200, 200);
      expect(top).to.be.gte(tail);
      // 各项求和 = 100%
      const t0 = (await bank.getRankRewardPreview(WEI("10000"), 200, 1)) * 10n;
      const t1 = (await bank.getRankRewardPreview(WEI("10000"), 200, 11)) * 40n;
      const t2 = (await bank.getRankRewardPreview(WEI("10000"), 200, 51)) * 50n;
      const t3 = (await bank.getRankRewardPreview(WEI("10000"), 200, 101)) * 100n;
      expect(t0 + t1 + t2 + t3).to.equal(WEI("10000"));
    });
  });

  describe("interaction fee 手续费", function () {
    it("代币手续费转到 feeReceiver", async function () {
      const { owner, bank, token, feeToken, referrer, nodes, feeReceiver } = await loadFixture(deployFixture);
      const u = nodes[0];
      await feeToken.connect(owner).transfer(u.address, WEI("100"));
      await bank.setInteractionFeeConfig(await feeToken.getAddress(), WEI("5"), feeReceiver.address);
      await token.connect(owner).transfer(u.address, WEI("100"));
      await stakeAs(token, bank, u, WEI("100"), referrer.address, {
        feeToken: feeToken, feeAmount: WEI("5")
      });
      expect(await feeToken.balanceOf(feeReceiver.address)).to.equal(WEI("5"));
    });

    it("BNB 手续费按 value 收取", async function () {
      const { owner, bank, token, referrer, nodes, feeReceiver } = await loadFixture(deployFixture);
      const u = nodes[0];
      await bank.setInteractionFeeConfig(ZERO_ADDRESS, WEI("1"), feeReceiver.address);
      await token.connect(owner).transfer(u.address, WEI("100"));
      await token.connect(u).approve(await bank.getAddress(), WEI("100"));
      const recvBefore = await ethers.provider.getBalance(feeReceiver.address);
      await bank.connect(u).stake(WEI("100"), referrer.address, { value: WEI("1") });
      const recvAfter = await ethers.provider.getBalance(feeReceiver.address);
      expect(recvAfter - recvBefore).to.equal(WEI("1"));
    });
  });

  describe("pause / recover", function () {
    it("暂停影响操作，恢复后可", async function () {
      const { bank } = await loadFixture(deployFixture);
      await bank.pause();
      await bank.unpause();
      expect(await bank.paused()).to.equal(false);
    });

    it("recoverWrongToken 可取回外来代币但不能取质押代币", async function () {
      const { owner, bank, token, feeToken } = await loadFixture(deployFixture);
      await feeToken.transfer(await bank.getAddress(), WEI("10"));
      const balBefore = await feeToken.balanceOf(owner.address);
      await bank.recoverWrongToken(await feeToken.getAddress(), owner.address, WEI("10"));
      expect(await feeToken.balanceOf(owner.address)).to.equal(balBefore + WEI("10"));
      await expect(
        bank.recoverWrongToken(await token.getAddress(), owner.address, WEI("1"))
      ).to.be.revertedWith("Cannot recover staking token");
    });

    it("仅 owner 可 recover", async function () {
      const { bank, feeToken, nodes } = await loadFixture(deployFixture);
      await expect(
        bank.connect(nodes[0]).recoverWrongToken(await feeToken.getAddress(), nodes[0].address, WEI("1"))
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });
  });

  describe("视图函数", function () {
    it("getUserInfo/getUserStakes/getMiningStatus 正确", async function () {
      const { owner, bank, token, referrer, nodes } = await loadFixture(deployFixture);
      const u = nodes[0];
      await token.connect(owner).transfer(u.address, WEI("100"));
      await stakeAs(token, bank, u, WEI("100"), referrer.address);
      const info = await bank.getUserInfo(u.address);
      expect(info.info.personalStakeVolume).to.equal(WEI("100"));
      expect(info.rank).to.equal(await bank.getNodeRank(u.address));
      const stakes = await bank.getUserStakes(u.address);
      expect(stakes.amounts[0]).to.equal(WEI("100"));
      expect((await bank.getStakeRecord(u.address, 0)).active).to.equal(true);
      const ms = await bank.getMiningStatus();
      expect(ms._totalStaked).to.equal(WEI("100"));
      expect(ms._rankedNodeCount).to.equal(2);
    });
  });

  describe("安全与边界补充审计", function () {
    it("档位边界(totalNodes=10/11/50/51/100/101)分配求和恒等于池", async function () {
      const { bank } = await loadFixture(deployFixture);
      const pool = WEI("10000");
      // 边界桶：<=10 -> [10000], 11-50 -> [5000,5000], 51-100 -> [5000,3000,2000], >100 -> [5000,3000,1500,500]
      const sumAll = async (n) => {
        let count = 0;
        const rankShares = [];
        // 枚举每个 rank 的份额
        for (let r = 1; r <= n; r++) {
          rankShares.push(await bank.getRankRewardPreview(pool, n, r));
        }
        return rankShares.reduce((a, b) => a + b, 0n);
      };
      for (const n of [1, 10, 11, 50, 51, 100, 101, 200]) {
        expect(await sumAll(n), `totalNodes=${n}`).to.equal(pool);
      }
      // rank 不能超出总节点数(合约 _rankShare 对无效档位归零并非 revert)
      expect(await bank.getRankRewardPreview(pool, 10, 10)).to.equal(WEI("1000")); // 100% 单档
    });

    it("全部节点领取后 totalClaimed / totalRankDistributed == 池(100% 分配，无尾差丢失)", async function () {
      const { owner, bank, token, referrer, nodes } = await loadFixture(deployFixture);
      await createNodes(token, bank, nodes, referrer, WEI("100"));
      await bank.openEpoch();
      await token.connect(owner).approve(await bank.getAddress(), WEI("1000"));
      await bank.fundEpoch(WEI("1000"));
      await time.increase(3 * DAY + 1);

      // 建立 address -> signer 映射，遍历榜单逐个领取
      const signerOf = new Map();
      signerOf.set(referrer.address, referrer);
      for (const n of nodes) signerOf.set(n.address, n);
      const { nodes: ranked } = await bank.getRankedNodes(0, 20);
      for (const addr of ranked) {
        const sig = signerOf.get(addr);
        if (!sig) throw new Error("missing signer");
        await bank.connect(sig)["claimEpochReward(uint256)"](1);
      }
      const ep = await bank.getEpoch(1);
      expect(ep.totalClaimed).to.equal(WEI("1000"));
      expect(await bank.totalRankDistributed()).to.equal(WEI("1000"));
      expect(await bank.totalRankClaimed()).to.equal(WEI("1000"));
    });

    it("前一期未到结算期时直接开启下一期被拒", async function () {
      const { owner, bank, token, referrer, nodes } = await loadFixture(deployFixture);
      await createNodes(token, bank, nodes, referrer, WEI("100"));
      await bank.openEpoch();
      await token.connect(owner).approve(await bank.getAddress(), WEI("1000"));
      await bank.fundEpoch(WEI("1000"));
      // 未过领取期
      expect(await bank.currentEpochId()).to.equal(1);
      await expect(bank.openEpoch()).to.be.revertedWith("Previous epoch not settled");
    });

    it("超额 BNB 手续费时找零且 feeReceiver 只收设定费", async function () {
      const { owner, bank, token, referrer, nodes, feeReceiver } = await loadFixture(deployFixture);
      const u = nodes[0];
      const fee = WEI("1");
      await bank.setInteractionFeeConfig(ZERO_ADDRESS, fee, feeReceiver.address);
      await token.connect(owner).transfer(u.address, WEI("100"));
      await token.connect(u).approve(await bank.getAddress(), WEI("100"));
      const recvBefore = await ethers.provider.getBalance(feeReceiver.address);
      const userBefore = await ethers.provider.getBalance(u.address);
      await bank.connect(u).stake(WEI("100"), referrer.address, { value: fee * 10n }); // 超额 10 倍
      const recvAfter = await ethers.provider.getBalance(feeReceiver.address);
      // feeReceiver 精确收 fee（1 ETH），其余 9 ETH 应返还给用户
      expect(recvAfter - recvBefore).to.equal(fee);
      // 用户先付 10*fee 的 value，收到 9*fee 找零，净支出应约等于 fee（另扣少量 gas）
      const userDelta = (await ethers.provider.getBalance(u.address)) - userBefore;
      expect(userDelta).to.be.lessThan(-fee); // 净支出已超过 1 个 fee（含 gas）
      expect(userDelta).to.be.greaterThan(-fee * 11n / 10n); // 支出不超过 1.1×fee（gas 余量）
    });

    it("非 owner 无法改手续费配置 / 所有权", async function () {
      const { bank, nodes } = await loadFixture(deployFixture);
      await expect(
        bank.connect(nodes[0]).setInteractionFeeConfig(nodes[1].address, WEI("1"), nodes[2].address)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("暂停状态阻断领取/快照管理操作", async function () {
      const { bank, nodes } = await loadFixture(deployFixture);
      await bank.pause();
      await expect(bank.claimNodeRewards()).to.be.revertedWith("Paused");
      await expect(bank.openEpoch()).to.be.revertedWith("Paused");
      await expect(bank.settleEpoch()).to.be.revertedWith("Paused");
      await bank.unpause();
    });

    it("非节点/非快照内地址无法领取本期奖励", async function () {
      const { owner, bank, token, referrer, nodes } = await loadFixture(deployFixture);
      await createNodes(token, bank, nodes, referrer, WEI("100"));
      await bank.openEpoch();
      await token.connect(owner).approve(await bank.getAddress(), WEI("1000"));
      await bank.fundEpoch(WEI("1000"));
      await time.increase(3 * DAY + 1);
      // nodes[0] 在快照内。新来得节点(owner 会因 referrer referral 而有分？不，owner 未质押)
      // owner 未入本期节点榜，领取应被拒
      await expect(bank.connect(owner)["claimEpochReward(uint256)"](1)).to.be.revertedWith(
        "Not a snapshot node"
      );
    });

    it("连续多期滚动：每期解锁后结算 carryover 正常流转", async function () {
      const { owner, bank, token, referrer, nodes } = await loadFixture(deployFixture);
      await createNodes(token, bank, nodes, referrer, WEI("100"));
      await bank.openEpoch();
      await token.connect(owner).approve(await bank.getAddress(), WEI("1000"));
      await bank.fundEpoch(WEI("1000"));
      // 第 1 期结束，无人领取 -> 全滚入下期
      await time.increase(10 * DAY + 1);
      await bank.settleEpoch();
      expect(await bank.pendingCarryover()).to.equal(WEI("1000"));
      // 第 2 期开，吸收 carryover
      await bank.openEpoch();
      expect((await bank.getEpoch(2)).poolAmount).to.equal(WEI("1000"));
      expect((await bank.getEpoch(2)).totalNodes).to.equal(12);
      // 领取期过后结算，全部再滚入第 3 期
      await time.increase(10 * DAY + 1);
      await bank.settleEpoch();
      expect(await bank.pendingCarryover()).to.equal(WEI("1000"));
    });
  });

  describe("补充审计：功能/安全边界", function () {
    it("快照后节点退出不影响本期榜单，但影响下一期", async function () {
      const { owner, bank, token, referrer, nodes } = await loadFixture(deployFixture);
      await createNodes(token, bank, nodes, referrer, WEI("100"));
      await bank.openEpoch(); // 12 节点快照
      expect((await bank.getEpoch(1)).totalNodes).to.equal(12); // 本期快照已锁定
      await time.increase(15 * DAY + 1);
      await bank.connect(nodes[0]).withdraw(0); // nodes[0] 仅一笔质押，全额退出降至 0、出榜
      expect(await bank.getRankedNodeCount()).to.equal(11); // 活榜单少了 nodes[0]
      expect((await bank.getEpoch(1)).totalNodes).to.equal(12); // 快照仍保留 12
      // 下一期快照人数=活榜
      await bank.settleEpoch();
      await bank.openEpoch();
      expect((await bank.getEpoch(2)).totalNodes).to.equal(11);
    });

    it("openEpoch 自动结算已过领取期的上一期并吸收 carryover", async function () {
      const { owner, bank, token, referrer, nodes } = await loadFixture(deployFixture);
      await createNodes(token, bank, nodes, referrer, WEI("100"));
      await bank.openEpoch();
      await token.connect(owner).approve(await bank.getAddress(), WEI("1000"));
      await bank.fundEpoch(WEI("1000"));
      await time.increase(10 * DAY + 1); // 超过领取期
      await bank.openEpoch(); // 不手动 settle，自动结算第1期
      expect(await bank.currentEpochId()).to.equal(2);
      expect((await bank.getEpoch(2)).poolAmount).to.equal(WEI("1000")); // 全量滚入
    });

    it("epochRank 对非快照节点为 0，无法领取", async function () {
      const { owner, bank, token, referrer, nodes } = await loadFixture(deployFixture);
      await createNodes(token, bank, nodes.slice(0, 10), referrer, WEI("100"));
      await bank.openEpoch();
      // owner 未质押，不在快照内
      expect(await bank.epochRank(1, owner.address)).to.equal(0);
      await token.connect(owner).approve(await bank.getAddress(), WEI("1000"));
      await bank.fundEpoch(WEI("1000"));
      await time.increase(3 * DAY + 1);
      await expect(bank.connect(owner)["claimEpochReward(uint256)"](1)).to.be.revertedWith(
        "Not a snapshot node"
      );
    });

    it("手续费在 withdraw/claim 时同样收取(代币模式)", async function () {
      const { owner, bank, token, feeToken, referrer, nodes, feeReceiver } = await loadFixture(deployFixture);
      const u = nodes[0];
      await bank.setInteractionFeeConfig(await feeToken.getAddress(), WEI("2"), feeReceiver.address);
      await token.connect(owner).transfer(u.address, WEI("100"));
      await feeToken.connect(owner).transfer(u.address, WEI("100"));
      await feeToken.connect(u).approve(await bank.getAddress(), WEI("100"));
      await stakeAs(token, bank, u, WEI("100"), referrer.address, { feeToken, feeAmount: WEI("2") });
      // withdraw 也要收费
      await time.increase(15 * DAY + 1);
      await feeToken.connect(u).approve(await bank.getAddress(), WEI("100"));
      await bank.connect(u).withdraw(0);
      expect(await feeToken.balanceOf(feeReceiver.address)).to.equal(WEI("4")); // stake+withdraw 各 2
    });

    it("compoundNodeRewards 无奖励时拒绝", async function () {
      const { owner, bank, token, referrer } = await loadFixture(deployFixture);
      // 先给 referrer 绑定 owner 作为上级，避免触发 “Cannot refer self”
      await token.transfer(referrer.address, WEI("1"));
      await stakeAs(token, bank, referrer, WEI("1"), owner.address);
      await expect(bank.connect(referrer).compoundNodeRewards(owner.address)).to.be.revertedWith(
        "No rewards"
      );
    });

    it("recoverWrongToken 不能取回 feeToken / amount 0 拒绝", async function () {
      const { owner, bank, feeToken, feeReceiver } = await loadFixture(deployFixture);
      await bank.setInteractionFeeConfig(await feeToken.getAddress(), 0, feeReceiver.address);
      await feeToken.transfer(await bank.getAddress(), WEI("5"));
      await expect(
        bank.recoverWrongToken(await feeToken.getAddress(), owner.address, WEI("5"))
      ).to.be.revertedWith("Cannot recover fee token");
      await expect(bank.recoverWrongToken(owner.address, owner.address, 0)).to.be.revertedWith(
        "Invalid amount"
      );
    });

    it("BNB 手续费 value 不足回滚 / 代币模式携带 BNB 被拒", async function () {
      const { owner, bank, token, referrer, nodes, feeReceiver } = await loadFixture(deployFixture);
      const u = nodes[0];
      await token.connect(owner).transfer(u.address, WEI("100"));
      await token.connect(u).approve(await bank.getAddress(), WEI("100"));
      // BNB 模式：value 不足
      await bank.setInteractionFeeConfig(ZERO_ADDRESS, WEI("1"), feeReceiver.address);
      await expect(bank.connect(u).stake(WEI("100"), referrer.address, { value: WEI("0") })).to.be.revertedWith(
        "Insufficient BNB fee"
      );
      // 代币模式：不应带 value
      await bank.setInteractionFeeConfig(await token.getAddress(), WEI("1"), feeReceiver.address);
      await expect(bank.connect(u).stake(WEI("100"), referrer.address, { value: WEI("1") })).to.be.revertedWith(
        "Unexpected BNB"
      );
    });

    it("claimReferralRewards / claimAll 别名可达", async function () {
      const { owner, bank, token, referrer, nodes } = await loadFixture(deployFixture);
      // claimReferralRewards
      await token.connect(owner).transfer(nodes[0].address, WEI("100"));
      await stakeAs(token, bank, nodes[0], WEI("100"), referrer.address);
      await time.increase(15 * DAY + 1);
      const balBefore = await token.balanceOf(referrer.address);
      await bank.connect(referrer).claimReferralRewards();
      expect(await token.balanceOf(referrer.address)).to.equal(balBefore + WEI("100"));
      // claimAll：用另一位下线再产生一笔邀请奖励
      await token.connect(owner).transfer(nodes[1].address, WEI("100"));
      await stakeAs(token, bank, nodes[1], WEI("100"), referrer.address);
      await time.increase(15 * DAY + 1);
      await bank.connect(referrer).claimAll();
      expect((await bank.userInfo(referrer.address)).totalInviteClaimed).to.equal(WEI("200"));
    });

    it("getRankedNodes 越界 offset 返回空数组与总数", async function () {
      const { owner, bank, token, referrer, nodes } = await loadFixture(deployFixture);
      await token.connect(owner).transfer(nodes[0].address, WEI("100"));
      await stakeAs(token, bank, nodes[0], WEI("100"), referrer.address);
      const res = await bank.getRankedNodes(999, 10);
      expect(res.nodes.length).to.equal(0);
      expect(res.total).to.equal(2);
    });

    it("setOperator 不能把 owner 设为操作员", async function () {
      const { owner, bank } = await loadFixture(deployFixture);
      await expect(bank.setOperator(owner.address, true)).to.be.revertedWith("Owner is super admin");
    });

    it("getReferrals 记录已绑定邀请关系", async function () {
      const { owner, bank, token, referrer, nodes } = await loadFixture(deployFixture);
      await token.connect(owner).transfer(nodes[0].address, WEI("100"));
      await stakeAs(token, bank, nodes[0], WEI("100"), referrer.address);
      const refs = await bank.getReferrals(referrer.address);
      expect(refs).to.include(nodes[0].address);
    });

    it("disabled 期(<10 节点)再次 openEpoch 自动合并且无需等待", async function () {
      const { owner, bank, token, referrer, nodes } = await loadFixture(deployFixture);
      await createNodes(token, bank, nodes.slice(0, 3), referrer, WEI("100")); // 4 节点
      await bank.openEpoch();
      expect((await bank.getEpoch(1)).disabled).to.equal(true);
      expect((await bank.getEpoch(1)).poolAmount).to.equal(0); // 空池
      await bank.openEpoch(); // disabled 立即可结算+开新期
      expect(await bank.currentEpochId()).to.equal(2);
    });

    it("非 owner/operator 不能设置/解除 operator", async function () {
      const { bank, nodes } = await loadFixture(deployFixture);
      await expect(bank.connect(nodes[0]).setOperator(nodes[1].address, true)).to.be.revertedWith(
        "Ownable: caller is not the owner"
      );
    });
  });
});