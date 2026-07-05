const MAINNET_CONTRACTS = {
  NBT_TOKEN: '0xD0F2A86C7EbCeE887F5bFB86771f994CD142bD04',
  STAKING_BANK: '0x23cEB0c098c72d0207cdc1827e880D07f692c893',
  FEE_TOKEN: '',
};

const STALE_TESTNET_ADDRESSES = new Set([
  '0x99fbddb26bc6b10dc9df80d6c6d943812047f406',
  '0xb110ea48824383babede6ba7e19d5e01089de6cc',
]);

const configuredChainId = '0x38';

const mainnetSafeAddress = (value, fallback) => {
  if (!value) return fallback;
  if (STALE_TESTNET_ADDRESSES.has(value.toLowerCase())) return fallback;
  return value;
};

export const CONTRACTS = {
  NBT_TOKEN: mainnetSafeAddress(import.meta.env.VITE_NBT_TOKEN, MAINNET_CONTRACTS.NBT_TOKEN),
  STAKING_BANK: mainnetSafeAddress(import.meta.env.VITE_STAKING_BANK, MAINNET_CONTRACTS.STAKING_BANK),
  NBT_PAIR: import.meta.env.VITE_NBT_PAIR || '',
  FEE_TOKEN: MAINNET_CONTRACTS.FEE_TOKEN,
};

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
      'https://data-seed-prebsc-1-s1.binance.org:8545/',
      'https://data-seed-prebsc-2-s1.binance.org:8545/',
      'https://bsc-testnet.publicnode.com',
      'https://bsc-testnet.blockpi.network/v1/rpc/public',
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
    rpcUrls: [
      'https://bsc-dataseed.binance.org/',
      'https://bsc-dataseed1.binance.org/',
      'https://bsc-dataseed2.binance.org/',
      'https://bsc.publicnode.com',
      'https://bsc.blockpi.network/v1/rpc/public',
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
  'Insufficient BNB fee': 'BNB 交互费不足',
  'Unexpected BNB': '当前操作不需要附带 BNB',
  'Native transfer failed': 'BNB 手续费发送失败',
  'execution reverted': '交易执行失败',
  'could not coalesce error': '钱包返回异常，交易可能已经提交，请刷新页面或在钱包交易记录中确认',
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
