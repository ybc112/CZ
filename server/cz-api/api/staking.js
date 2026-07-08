const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');

const DEFAULT_STAKING_BANK = '0x903fcce5d67648FBE6Dccc9806e3bd7D303380fD';
const DEFAULT_CZ_TOKEN = '0xD0F2A86C7EbCeE887F5bFB86771f994CD142bD04';
const DEFAULT_RPC_URLS = [
  'https://bsc.publicnode.com',
  'https://bsc-dataseed.binance.org/',
  'https://bsc-dataseed1.binance.org/',
  'https://bsc-dataseed2.binance.org/',
  'https://bsc.blockpi.network/v1/rpc/public',
  'https://rpc.ankr.com/bsc',
];

const STAKING_ABI = [
  'function stakingToken() view returns (address)',
  'function rewardToken() view returns (address)',
  'function inviteReward() view returns (uint256)',
  'function minReferralStakeValue() view returns (uint256)',
  'function stakeValueRate() view returns (uint256)',
  'function LOCK_PERIOD() view returns (uint256)',
  'function paused() view returns (bool)',
  'function getMiningStatus() view returns (uint256 _totalStaked, uint256 _totalDistributed, uint256 _claimableRewards, bool _releaseInProgress, uint256 _startTime, uint256 _rankedNodeCount)',
  'function getCurrentRelease() view returns (uint256 epochId, uint256 amount, uint256 totalNodes, uint256 nextRank, uint256 allocatedAmount, bool finalized)',
  'function getInteractionFeeConfig() view returns (address feeToken, uint256 fee, address receiverA, address receiverB)',
  'function getRankedNodes(uint256 offset, uint256 limit) view returns (address[] nodes, uint256[] scores, uint256 total)',
  'function getUserInfo(address user) view returns (tuple(uint256 totalStaked, uint256 totalWithdrawn, uint256 stakeCount, uint256 activeStakeCount, address referrer, uint256 directReferrals, uint256 referralStakeVolume, uint256 pendingInviteRewards, uint256 totalInviteClaimed, uint256 pendingRankRewards, uint256 totalRankClaimed, uint256 lockedInviteRewards, uint256 inviteUnlockCursor) info, uint256 pendingRewards, uint256 totalClaimed, uint256 rank)',
  'function getUserStakes(address user) view returns (uint256[] stakeIds, uint256[] amounts, uint256[] scoreValues, uint256[] startTimes, bool[] actives)',
  'function pendingRewardAll(address user) view returns (uint256)',
  'function getReferralsPaginated(address user, uint256 offset, uint256 limit) view returns (address[] result, uint256 total)',
];

const ZERO = '0x0000000000000000000000000000000000000000';
const PUBLIC_CACHE_MS = Number(process.env.STAKING_PUBLIC_CACHE_MS || 15000);
const USER_CACHE_MS = Number(process.env.STAKING_USER_CACHE_MS || 8000);

const cacheStore = globalThis.__czStakingCache || {
  snapshots: new Map(),
};
globalThis.__czStakingCache = cacheStore;

const CACHE_DIR = process.env.STAKING_CACHE_DIR || process.env.CACHE_DIR || '';
const FILE_CACHE_MAX_AGE_MS = Number(process.env.STAKING_FILE_CACHE_MAX_AGE_MS || 24 * 60 * 60 * 1000);

const cacheFilePath = (key) => {
  if (!CACHE_DIR) return '';
  const name = Buffer.from(key).toString('base64url');
  return path.join(CACHE_DIR, `${name}.json`);
};

const readFileCache = (key) => {
  const filePath = cacheFilePath(key);
  if (!filePath) return null;
  try {
    if (!fs.existsSync(filePath)) return null;
    const cached = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!cached?.timestamp || !cached?.data) return null;
    if (Date.now() - cached.timestamp > FILE_CACHE_MAX_AGE_MS) return null;
    return cached;
  } catch (error) {
    console.warn('read staking file cache failed:', error?.message || error);
    return null;
  }
};

const writeFileCache = (key, cached) => {
  const filePath = cacheFilePath(key);
  if (!filePath) return;
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(cached)}\n`);
  } catch (error) {
    console.warn('write staking file cache failed:', error?.message || error);
  }
};

const rpcUrls = () => {
  const configured = process.env.BSC_RPC_URLS || process.env.RPC_URLS || '';
  const urls = configured
    ? configured.split(',').map((url) => url.trim()).filter(Boolean)
    : DEFAULT_RPC_URLS;
  return [...new Set(urls)];
};

const stakingBankAddress = () =>
  process.env.STAKING_BANK || process.env.VITE_STAKING_BANK || DEFAULT_STAKING_BANK;

const valueAt = (value, key, index, fallback = undefined) => {
  if (!value) return fallback;
  return value[key] ?? value[index] ?? fallback;
};

const toNumber = (value, fallback = 0) => {
  if (value === undefined || value === null) return fallback;
  return Number(value);
};

const toEther = (value, fallback = '0') => {
  if (value === undefined || value === null) return fallback;
  return ethers.formatEther(value);
};

const activeStakeView = (userStakes, lockPeriod) => {
  if (!userStakes) return [];

  const ids = Array.from(valueAt(userStakes, 'stakeIds', 0, []));
  const amounts = valueAt(userStakes, 'amounts', 1, []);
  const scoreValues = valueAt(userStakes, 'scoreValues', 2, []);
  const startTimes = valueAt(userStakes, 'startTimes', 3, []);
  const actives = valueAt(userStakes, 'actives', 4, []);
  const nowSeconds = Math.floor(Date.now() / 1000);

  return ids.map((id, index) => {
    const startTime = toNumber(startTimes[index]);
    const unlockTime = startTime + lockPeriod;
    return {
      stakeId: toNumber(id),
      amount: toEther(amounts[index]),
      scoreValue: toEther(scoreValues[index]),
      startTime,
      unlockTime,
      isUnlocked: nowSeconds >= unlockTime,
      active: Boolean(actives[index]),
    };
  }).filter((stake) => stake.active);
};

const rankedNodesView = (rankedData) => {
  if (!rankedData) return { rankedNodes: [], rankedNodesTotal: 0 };
  const nodes = Array.from(valueAt(rankedData, 'nodes', 0, []));
  const scores = valueAt(rankedData, 'scores', 1, []);
  const total = toNumber(valueAt(rankedData, 'total', 2, 0));

  return {
    rankedNodes: nodes.map((address, index) => ({
      address,
      score: toEther(scores[index]),
      rank: index + 1,
    })),
    rankedNodesTotal: total,
  };
};

const userInfoView = (userInfo) => {
  if (!userInfo) return null;
  const info = valueAt(userInfo, 'info', 0);
  if (!info) return null;

  return {
    totalStaked: toEther(valueAt(info, 'totalStaked', 0)),
    totalWithdrawn: toEther(valueAt(info, 'totalWithdrawn', 1)),
    stakeCount: toNumber(valueAt(info, 'stakeCount', 2)),
    activeStakeCount: toNumber(valueAt(info, 'activeStakeCount', 3)),
    referrer: valueAt(info, 'referrer', 4, ZERO),
    directReferrals: toNumber(valueAt(info, 'directReferrals', 5)),
    referralStakeVolume: toEther(valueAt(info, 'referralStakeVolume', 6)),
    pendingInviteRewards: toEther(valueAt(info, 'pendingInviteRewards', 7)),
    totalInviteClaimed: toEther(valueAt(info, 'totalInviteClaimed', 8)),
    pendingRankRewards: toEther(valueAt(info, 'pendingRankRewards', 9)),
    totalRankClaimed: toEther(valueAt(info, 'totalRankClaimed', 10)),
    lockedInviteRewards: toEther(valueAt(info, 'lockedInviteRewards', 11, 0n)),
    inviteUnlockCursor: toNumber(valueAt(info, 'inviteUnlockCursor', 12, 0n)),
    pendingRewards: toEther(valueAt(userInfo, 'pendingRewards', 1)),
    totalClaimed: toEther(valueAt(userInfo, 'totalClaimed', 2)),
    rank: toNumber(valueAt(userInfo, 'rank', 3)),
  };
};

const releaseView = (currentRelease) => {
  if (!currentRelease) return null;
  return {
    epochId: toNumber(valueAt(currentRelease, 'epochId', 0)),
    amount: toEther(valueAt(currentRelease, 'amount', 1)),
    totalNodes: toNumber(valueAt(currentRelease, 'totalNodes', 2)),
    nextRank: toNumber(valueAt(currentRelease, 'nextRank', 3)),
    allocatedAmount: toEther(valueAt(currentRelease, 'allocatedAmount', 4)),
    finalized: Boolean(valueAt(currentRelease, 'finalized', 5)),
  };
};

const feeConfigView = (interactionFeeConfig) => {
  if (!interactionFeeConfig) return null;
  return {
    feeToken: valueAt(interactionFeeConfig, 'feeToken', 0, ZERO),
    fee: toEther(valueAt(interactionFeeConfig, 'fee', 1)),
    receiverA: valueAt(interactionFeeConfig, 'receiverA', 2, ZERO),
    receiverB: valueAt(interactionFeeConfig, 'receiverB', 3, ZERO),
  };
};

const readWithProvider = async (provider, account, rpcUrl) => {
  const contract = new ethers.Contract(stakingBankAddress(), STAKING_ABI, provider);

  const [
    miningStatus,
    isPaused,
    currentRelease,
    interactionFeeConfig,
    stakingTokenAddress,
    rewardTokenAddress,
    inviteReward,
    minReferralStakeValue,
    lockPeriodRaw,
    stakeValueRate,
    rankedData,
  ] = await Promise.all([
    contract.getMiningStatus(),
    contract.paused().catch(() => false),
    contract.getCurrentRelease().catch(() => null),
    contract.getInteractionFeeConfig().catch(() => null),
    contract.stakingToken().catch(() => DEFAULT_CZ_TOKEN),
    contract.rewardToken().catch(() => DEFAULT_CZ_TOKEN),
    contract.inviteReward().catch(() => ethers.parseEther('1000000')),
    contract.minReferralStakeValue().catch(() => ethers.parseEther('100')),
    contract.LOCK_PERIOD().catch(() => BigInt(15 * 24 * 60 * 60)),
    contract.stakeValueRate().catch(() => ethers.parseEther('1')),
    contract.getRankedNodes(0, 100).catch(() => null),
  ]);

  const lockPeriod = toNumber(lockPeriodRaw, 15 * 24 * 60 * 60);
  let userInfo = null;
  let pendingRewardAll = '0';
  let stakes = [];
  let referrals = [];
  let referralsTotal = 0;

  if (account) {
    const [userInfoRaw, pendingRewardRaw, userStakesRaw, referralsRaw] = await Promise.all([
      contract.getUserInfo(account).catch(() => null),
      contract.pendingRewardAll(account).catch(() => 0n),
      contract.getUserStakes(account).catch(() => null),
      contract.getReferralsPaginated(account, 0, 10).catch(() => null),
    ]);

    userInfo = userInfoView(userInfoRaw);
    pendingRewardAll = toEther(pendingRewardRaw);
    stakes = activeStakeView(userStakesRaw, lockPeriod);
    if (referralsRaw) {
      referrals = Array.from(valueAt(referralsRaw, 'result', 0, []));
      referralsTotal = toNumber(valueAt(referralsRaw, 'total', 1));
    }
  }

  const ranked = rankedNodesView(rankedData);

  return {
    userInfo,
    stakes,
    miningStatus: {
      totalStaked: toEther(valueAt(miningStatus, '_totalStaked', 0)),
      totalDistributed: toEther(valueAt(miningStatus, '_totalDistributed', 1)),
      claimableRewards: toEther(valueAt(miningStatus, '_claimableRewards', 2)),
      releaseInProgress: Boolean(valueAt(miningStatus, '_releaseInProgress', 3)),
      startTime: toNumber(valueAt(miningStatus, '_startTime', 4)),
      rankedNodeCount: toNumber(valueAt(miningStatus, '_rankedNodeCount', 5)),
    },
    pendingRewardAll,
    referrals,
    referralsTotal,
    rankedNodes: ranked.rankedNodes,
    rankedNodesTotal: ranked.rankedNodesTotal,
    currentRelease: releaseView(currentRelease),
    interactionFeeConfig: feeConfigView(interactionFeeConfig),
    stakingTokenAddress,
    rewardTokenAddress,
    inviteReward: toEther(inviteReward),
    minReferralStakeValue: toEther(minReferralStakeValue),
    lockPeriod,
    stakeValueRate: toEther(stakeValueRate),
    isPaused: Boolean(isPaused),
    cache: {
      source: 'live',
      rpcUrl,
      generatedAt: Date.now(),
      stale: false,
    },
  };
};

const readSnapshot = async (account) => {
  let lastError = null;
  for (const url of rpcUrls()) {
    try {
      const provider = new ethers.JsonRpcProvider(url, 56, { staticNetwork: true });
      return await readWithProvider(provider, account, url);
    } catch (error) {
      lastError = error;
      console.warn(`staking api rpc failed: ${url}`, error?.shortMessage || error?.message || error);
    }
  }
  throw lastError || new Error('All BSC RPC nodes failed');
};

const getCachedSnapshot = async (account, refresh) => {
  const key = account ? `user:${account.toLowerCase()}` : 'public';
  const ttl = account ? USER_CACHE_MS : PUBLIC_CACHE_MS;
  const now = Date.now();
  let cached = cacheStore.snapshots.get(key);
  if (!cached) {
    cached = readFileCache(key);
    if (cached) cacheStore.snapshots.set(key, cached);
  }

  if (!refresh && cached && now - cached.timestamp <= ttl) {
    return {
      ...cached.data,
      cache: {
        ...cached.data.cache,
        source: 'memory-cache',
        ageMs: now - cached.timestamp,
        stale: false,
      },
    };
  }

  try {
    const data = await readSnapshot(account);
    const nextCache = { timestamp: Date.now(), data };
    cacheStore.snapshots.set(key, nextCache);
    writeFileCache(key, nextCache);
    return data;
  } catch (error) {
    if (cached) {
      return {
        ...cached.data,
        cache: {
          ...cached.data.cache,
          source: 'stale-memory-cache',
          ageMs: now - cached.timestamp,
          stale: true,
          error: error?.shortMessage || error?.message || 'RPC read failed',
        },
      };
    }
    throw error;
  }
};

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }

  const accountInput = req.query?.account || '';
  const account = accountInput && ethers.isAddress(accountInput) ? ethers.getAddress(accountInput) : '';
  const refresh = req.query?.refresh === '1' || req.query?.refresh === 'true';

  try {
    const data = await getCachedSnapshot(account, refresh);
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ ok: true, data });
  } catch (error) {
    res.status(502).json({
      ok: false,
      error: 'Unable to read staking data',
      message: error?.shortMessage || error?.message || String(error),
    });
  }
};
