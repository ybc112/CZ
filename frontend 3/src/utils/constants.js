export const CONTRACTS = {
  NBT_TOKEN: import.meta.env.VITE_NBT_TOKEN || '',
  STAKING_BANK: import.meta.env.VITE_STAKING_BANK || '',
  NBT_PAIR: import.meta.env.VITE_NBT_PAIR || '',
};

const configuredChainId = (import.meta.env.VITE_CHAIN_ID || '0x61').toLowerCase();

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
  'Already has referrer': '您已设置过推荐人，无法更改',
  'Cannot refer self': '不能将自己设为推荐人',
  'Circular referral not allowed': '不允许循环推荐',
  'Invalid referrer': '无效的推荐人',
  'Invalid tier': '无效的锁仓档位',
  'Stake not found': '质押记录不存在',
  'Stake already withdrawn': '该质押已提取',
  'Lock period not ended': '锁仓期未结束',
  'No pending rewards': '暂无待领取收益',
  'No referral rewards': '暂无推荐奖励',
  'Rewards depleted': '奖励池已耗尽',
  'Too many active stakes': '活跃质押数量已达上限',
  'Stake not active': '该质押记录已失效',
  'Fee too high': '滑点设置过高',
  'Invalid address': '无效的地址',
  'Paused': '合约已暂停',
  'user rejected transaction': '您取消了交易',
  'insufficient funds': '钱包余额不足以支付 Gas 费',
  'execution reverted': '交易执行失败',
};

export const parseContractError = (error) => {
  if (!error) return '操作失败';
  const reason = error.reason || error.shortMessage || error.message || '';

  for (const [key, value] of Object.entries(CONTRACT_ERRORS)) {
    if (reason.toLowerCase().includes(key.toLowerCase())) {
      return value;
    }
  }

  if (reason.includes('user rejected') || reason.includes('denied')) {
    return '您取消了交易';
  }

  return reason || '操作失败，请稍后重试';
};
