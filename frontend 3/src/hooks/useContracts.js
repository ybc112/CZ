import { useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';
import { CONTRACTS } from '../utils/constants';
import { ERC20_ABI, NBT_TOKEN_ABI, STAKING_BANK_ABI } from '../abi';

const retryCall = async (fn, retries = 3, delay = 1000) => {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === retries - 1) throw err;
      await new Promise(resolve => setTimeout(resolve, delay * (i + 1)));
    }
  }
};

const safeRead = async (fn, fallback) => {
  try {
    return await retryCall(fn);
  } catch (err) {
    console.warn('Contract read failed, using fallback:', err);
    return fallback;
  }
};

const fetchStakingSnapshot = async (account, refresh = false) => {
  const params = new URLSearchParams();
  if (account) params.set('account', account);
  if (refresh) params.set('refresh', '1');
  const query = params.toString();
  const response = await fetch(`/api/staking${query ? `?${query}` : ''}`, {
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  });
  const payload = await response.json();
  if (!response.ok || !payload?.ok || !payload?.data) {
    throw new Error(payload?.message || payload?.error || 'Staking cache API unavailable');
  }
  return payload.data;
};

const applyStakingSnapshot = (prev, snapshot) => ({
  ...prev,
  userInfo: snapshot.userInfo ?? null,
  stakes: snapshot.stakes ?? [],
  miningStatus: snapshot.miningStatus ?? prev.miningStatus,
  pendingRewardAll: snapshot.pendingRewardAll ?? '0',
  referrals: snapshot.referrals ?? [],
  referralsTotal: snapshot.referralsTotal ?? 0,
  rankedNodes: snapshot.rankedNodes ?? prev.rankedNodes,
  rankedNodesTotal: snapshot.rankedNodesTotal ?? prev.rankedNodesTotal,
  currentRelease: snapshot.currentRelease ?? prev.currentRelease,
  interactionFeeConfig: snapshot.interactionFeeConfig ?? prev.interactionFeeConfig,
  stakingTokenAddress: snapshot.stakingTokenAddress || prev.stakingTokenAddress,
  rewardTokenAddress: snapshot.rewardTokenAddress || prev.rewardTokenAddress,
  inviteReward: snapshot.inviteReward || prev.inviteReward,
  minReferralStakeValue: snapshot.minReferralStakeValue || prev.minReferralStakeValue,
  lockPeriod: snapshot.lockPeriod || prev.lockPeriod,
  stakeValueRate: snapshot.stakeValueRate || prev.stakeValueRate,
  isPaused: typeof snapshot.isPaused === 'boolean' ? snapshot.isPaused : prev.isPaused,
  apiCache: snapshot.cache || null,
  loading: false,
});

export function useContracts(signer, provider) {
  const [contracts, setContracts] = useState({
    nbtToken: null,
    feeToken: null,
    stakingBank: null,
    writeNbtToken: null,
    writeFeeToken: null,
    writeStakingBank: null,
  });

  useEffect(() => {
    if (!provider) return;

    const nbtToken = CONTRACTS.NBT_TOKEN
      ? new ethers.Contract(CONTRACTS.NBT_TOKEN, NBT_TOKEN_ABI, provider)
      : null;
    const stakingBank = CONTRACTS.STAKING_BANK
      ? new ethers.Contract(CONTRACTS.STAKING_BANK, STAKING_BANK_ABI, provider)
      : null;
    const feeToken = CONTRACTS.FEE_TOKEN
      ? new ethers.Contract(CONTRACTS.FEE_TOKEN, ERC20_ABI, provider)
      : null;
    const writeNbtToken = CONTRACTS.NBT_TOKEN && signer
      ? new ethers.Contract(CONTRACTS.NBT_TOKEN, NBT_TOKEN_ABI, signer)
      : null;
    const writeStakingBank = CONTRACTS.STAKING_BANK && signer
      ? new ethers.Contract(CONTRACTS.STAKING_BANK, STAKING_BANK_ABI, signer)
      : null;
    const writeFeeToken = CONTRACTS.FEE_TOKEN && signer
      ? new ethers.Contract(CONTRACTS.FEE_TOKEN, ERC20_ABI, signer)
      : null;

    setContracts({
      nbtToken,
      feeToken,
      stakingBank,
      writeNbtToken,
      writeFeeToken,
      writeStakingBank,
    });
  }, [signer, provider]);

  return contracts;
}

export function useStakingBank(contract, account) {
  const [data, setData] = useState({
    userInfo: null,
    stakes: [],
    miningStatus: null,
    pendingRewardAll: '0',
    referrals: [],
    referralsTotal: 0,
    rankedNodes: [],
    rankedNodesTotal: 0,
    currentRelease: null,
    interactionFeeConfig: null,
    stakingTokenAddress: null,
    rewardTokenAddress: null,
    inviteReward: '1000000',
    minReferralStakeValue: '100',
    lockPeriod: 15 * 24 * 60 * 60,
    stakeValueRate: '1',
    isPaused: false,
    loading: true,
  });

  const fetchData = useCallback(async (forceRefresh = false) => {

    // 错误时保留上一次有效数据，避免 RPC 抖动导致界面全 0
    setData(prev => ({ ...prev, loading: true }));

    try {
      const snapshot = await fetchStakingSnapshot(account, forceRefresh);
      setData(prev => applyStakingSnapshot(prev, snapshot));
      return;
    } catch (apiError) {
      console.warn('Staking cache API failed, falling back to direct contract reads:', apiError);
    }

    if (!contract) {
      setData(prev => ({ ...prev, loading: false }));
      return;
    }

    try {
      const [
        miningStatus,
        isPaused,
        currentRelease,
        interactionFeeConfig,
        stakingTokenAddress,
        rewardTokenAddress,
        inviteReward,
        minReferralStakeValue,
        lockPeriod,
        stakeValueRate,
        rankedData,
      ] = await safeRead(() =>
        Promise.all([
          contract.getMiningStatus(),
          contract.paused ? contract.paused().catch(() => false) : Promise.resolve(false),
          contract.getCurrentRelease().catch(() => null),
          contract.getInteractionFeeConfig().catch(() => null),
          contract.stakingToken().catch(() => ''),
          contract.rewardToken().catch(() => ''),
          contract.inviteReward().catch(() => ethers.parseEther('1000000')),
          contract.minReferralStakeValue ? contract.minReferralStakeValue().catch(() => ethers.parseEther('100')) : Promise.resolve(ethers.parseEther('100')),
          contract.LOCK_PERIOD ? contract.LOCK_PERIOD().catch(() => BigInt(15 * 24 * 60 * 60)) : Promise.resolve(BigInt(15 * 24 * 60 * 60)),
          contract.stakeValueRate().catch(() => ethers.parseEther('1')),
          contract.getRankedNodes(0, 100).catch(() => ({ nodes: [], scores: [], total: 0n })),
        ]), null);

      // 如果核心状态拉取失败，保留旧数据并停止 loading
      if (!miningStatus) {
        setData(prev => ({ ...prev, loading: false }));
        return;
      }

      let userInfo = null;
      let stakes = [];
      let pendingRewardAll = BigInt(0);
      let referrals = [];
      let referralsTotal = 0;

      if (account) {
        userInfo = await safeRead(() => contract.getUserInfo(account), null);
        pendingRewardAll = await safeRead(() => contract.pendingRewardAll(account), BigInt(0));

        const userStakes = await safeRead(() => contract.getUserStakes(account), null);
        if (userStakes) {
          const lockPeriodSeconds = Number(lockPeriod ?? data.lockPeriod);
          const nowSeconds = Math.floor(Date.now() / 1000);
          stakes = userStakes.stakeIds.map((id, index) => {
            const startTime = Number(userStakes.startTimes[index]);
            const unlockTime = startTime + lockPeriodSeconds;
            return {
              stakeId: Number(id),
              amount: ethers.formatEther(userStakes.amounts[index]),
              scoreValue: ethers.formatEther(userStakes.scoreValues?.[index] ?? 0n),
              startTime,
              unlockTime,
              isUnlocked: nowSeconds >= unlockTime,
              active: userStakes.actives[index],
            };
          }).filter(stake => stake.active);
        }

        const refData = await safeRead(() => contract.getReferralsPaginated(account, 0, 10), null);
        if (refData) {
          referrals = refData.result;
          referralsTotal = Number(refData.total);
        }
      }

      const info = userInfo?.info || userInfo?.[0];
      const rankedNodes = rankedData
        ? Array.from(rankedData.nodes || rankedData[0] || []).map((node, index) => ({
            address: node,
            score: ethers.formatEther((rankedData.scores || rankedData[1])[index]),
            rank: index + 1,
          }))
        : data.rankedNodes;
      const rankedNodesTotal = rankedData ? Number(rankedData.total || rankedData[2] || 0) : data.rankedNodesTotal;

      setData(prev => ({
        ...prev,
        userInfo: info ? {
          totalStaked: ethers.formatEther(info.totalStaked ?? info[0]),
          totalWithdrawn: ethers.formatEther(info.totalWithdrawn ?? info[1]),
          stakeCount: Number(info.stakeCount ?? info[2]),
          activeStakeCount: Number(info.activeStakeCount ?? info[3]),
          referrer: info.referrer ?? info[4],
          directReferrals: Number(info.directReferrals ?? info[5]),
          referralStakeVolume: ethers.formatEther(info.referralStakeVolume ?? info[6]),
          pendingInviteRewards: ethers.formatEther(info.pendingInviteRewards ?? info[7]),
          totalInviteClaimed: ethers.formatEther(info.totalInviteClaimed ?? info[8]),
          pendingRankRewards: ethers.formatEther(info.pendingRankRewards ?? info[9]),
          totalRankClaimed: ethers.formatEther(info.totalRankClaimed ?? info[10]),
          lockedInviteRewards: ethers.formatEther(info.lockedInviteRewards ?? info[11] ?? 0n),
          inviteUnlockCursor: Number(info.inviteUnlockCursor ?? info[12] ?? 0n),
          pendingRewards: ethers.formatEther(userInfo.pendingRewards ?? userInfo[1]),
          totalClaimed: ethers.formatEther(userInfo.totalClaimed ?? userInfo[2]),
          rank: Number(userInfo.rank ?? userInfo[3]),
        } : prev.userInfo,
        stakes: stakes.length > 0 ? stakes : prev.stakes,
        miningStatus: {
          totalStaked: ethers.formatEther(miningStatus._totalStaked),
          totalDistributed: ethers.formatEther(miningStatus._totalDistributed),
          claimableRewards: ethers.formatEther(miningStatus._claimableRewards),
          releaseInProgress: miningStatus._releaseInProgress,
          startTime: Number(miningStatus._startTime),
          rankedNodeCount: Number(miningStatus._rankedNodeCount),
        },
        pendingRewardAll: ethers.formatEther(pendingRewardAll),
        referrals: referrals.length > 0 ? referrals : prev.referrals,
        referralsTotal: referralsTotal > 0 ? referralsTotal : prev.referralsTotal,
        rankedNodes,
        rankedNodesTotal,
        currentRelease: currentRelease ? {
          epochId: Number(currentRelease.epochId ?? currentRelease[0]),
          amount: ethers.formatEther(currentRelease.amount ?? currentRelease[1]),
          totalNodes: Number(currentRelease.totalNodes ?? currentRelease[2]),
          nextRank: Number(currentRelease.nextRank ?? currentRelease[3]),
          allocatedAmount: ethers.formatEther(currentRelease.allocatedAmount ?? currentRelease[4]),
          finalized: currentRelease.finalized ?? currentRelease[5],
        } : prev.currentRelease,
        interactionFeeConfig: interactionFeeConfig ? {
          feeToken: interactionFeeConfig.feeToken ?? interactionFeeConfig[0],
          fee: ethers.formatEther(interactionFeeConfig.fee ?? interactionFeeConfig[1]),
          receiverA: interactionFeeConfig.receiverA ?? interactionFeeConfig[2],
          receiverB: interactionFeeConfig.receiverB ?? interactionFeeConfig[3],
        } : prev.interactionFeeConfig,
        stakingTokenAddress: stakingTokenAddress || prev.stakingTokenAddress,
        rewardTokenAddress: rewardTokenAddress || prev.rewardTokenAddress,
        inviteReward: ethers.formatEther(inviteReward ?? ethers.parseEther(prev.inviteReward || '1000000')),
        minReferralStakeValue: ethers.formatEther(minReferralStakeValue ?? ethers.parseEther(prev.minReferralStakeValue || '100')),
        lockPeriod: Number(lockPeriod ?? prev.lockPeriod),
        stakeValueRate: ethers.formatEther(stakeValueRate ?? ethers.parseEther(prev.stakeValueRate || '1')),
        isPaused: typeof isPaused === 'boolean' ? isPaused : prev.isPaused,
        loading: false,
      }));
    } catch (err) {
      console.error('Fetch staking bank data error:', err);
      setData(prev => ({ ...prev, loading: false }));
    }
  }, [contract, account]);

  useEffect(() => {
    fetchData(false);
    const interval = setInterval(() => fetchData(false), 15000);
    return () => clearInterval(interval);
  }, [fetchData]);

  return { ...data, refetch: () => fetchData(true) };
}

export function useTokenBalance(tokenContract, account) {
  const [balance, setBalance] = useState('0');
  const [loading, setLoading] = useState(true);

  const fetchBalance = useCallback(async () => {
    if (!tokenContract || !account) {
      setBalance('0');
      setLoading(false);
      return;
    }

    const bal = await safeRead(() => tokenContract.balanceOf(account), null);
    if (bal !== null) {
      setBalance(ethers.formatEther(bal));
    }
    setLoading(false);
  }, [tokenContract, account]);

  useEffect(() => {
    fetchBalance();
    const interval = setInterval(fetchBalance, 10000);
    return () => clearInterval(interval);
  }, [fetchBalance]);

  return { balance, loading, refetch: fetchBalance };
}

export function useAllowance(tokenContract, owner, spender) {
  const [allowance, setAllowance] = useState('0');

  const fetchAllowance = useCallback(async () => {
    if (!tokenContract || !owner || !spender) {
      setAllowance('0');
      return;
    }

    const allow = await safeRead(() => tokenContract.allowance(owner, spender), null);
    if (allow !== null) {
      setAllowance(ethers.formatEther(allow));
    }
  }, [tokenContract, owner, spender]);

  useEffect(() => {
    fetchAllowance();
  }, [fetchAllowance]);

  return { allowance, refetch: fetchAllowance };
}

export function useTokenFeeConfig(tokenContract, account) {
  const [data, setData] = useState({
    feeConfig: null,
    isExcluded: false,
    loading: true,
  });

  const fetchData = useCallback(async () => {
    if (!tokenContract) {
      setData(prev => ({ ...prev, loading: false }));
      return;
    }

    setData(prev => ({ ...prev, loading: true }));

    const feeConfig = await safeRead(() => tokenContract.getFeeConfig(), null);
    let isExcluded = null;
    if (account) {
      isExcluded = await safeRead(() => tokenContract.isExcludedFromFee(account), null);
    }

    if (!feeConfig) {
      setData(prev => ({ ...prev, loading: false }));
      return;
    }

    setData(prev => ({
      feeConfig: {
        buyFee: Number(feeConfig._buyFee) / 100,
        sellFee: Number(feeConfig._sellFee) / 100,
        feeReceiver: feeConfig._feeReceiver,
      },
      isExcluded: typeof isExcluded === 'boolean' ? isExcluded : prev.isExcluded,
      loading: false,
    }));
  }, [tokenContract, account]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 15000);
    return () => clearInterval(interval);
  }, [fetchData]);

  return { ...data, refetch: fetchData };
}

export { ERC20_ABI };
