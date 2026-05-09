import { useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';
import { CONTRACTS, EXPECTED_CHAIN_ID } from '../utils/constants';
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

export function useContracts(signer, provider) {
  const [contracts, setContracts] = useState({
    nbtToken: null,
    stakingBank: null,
  });

  useEffect(() => {
    if (!provider) return;

    let cancelled = false;

    const initContracts = async () => {
      let runner = provider;

      if (signer) {
        try {
          const network = await signer.provider.getNetwork();
          if (Number(network.chainId) === EXPECTED_CHAIN_ID) {
            runner = signer;
          }
        } catch {
          runner = provider;
        }
      }

      if (cancelled) return;

      const nbtToken = CONTRACTS.NBT_TOKEN
        ? new ethers.Contract(CONTRACTS.NBT_TOKEN, NBT_TOKEN_ABI, runner)
        : null;
      const stakingBank = CONTRACTS.STAKING_BANK
        ? new ethers.Contract(CONTRACTS.STAKING_BANK, STAKING_BANK_ABI, runner)
        : null;

      setContracts({
        nbtToken,
        stakingBank,
      });
    };

    initContracts();
    return () => {
      cancelled = true;
    };
  }, [signer, provider]);

  return contracts;
}

export function useStakingBank(contract, account) {
  const [data, setData] = useState({
    userInfo: null,
    stakes: [],
    miningStatus: null,
    tierConfigs: null,
    pendingRewardAll: '0',
    referralRates: [],
    referralLevels: 0,
    referrals: [],
    referralsTotal: 0,
    isPaused: false,
    loading: true,
  });

  const fetchData = useCallback(async () => {
    if (!contract) {
      setData(prev => ({ ...prev, loading: false }));
      return;
    }

    try {
      const [miningStatus, tierConfigs, referralRates, referralLevels, isPaused] = await retryCall(() =>
        Promise.all([
          contract.getMiningStatus(),
          contract.getAllTierConfigs(),
          contract.getReferralRates().catch(() => []),
          contract.getReferralLevels().catch(() => 0),
          contract.paused ? contract.paused().catch(() => false) : Promise.resolve(false),
        ])
      );

      let userInfo = null;
      let stakes = [];
      let pendingRewardAll = BigInt(0);
      let referrals = [];
      let referralsTotal = 0;

      if (account) {
        userInfo = await retryCall(() => contract.getUserInfo(account));
        pendingRewardAll = await retryCall(() => contract.pendingRewardAll(account));

        try {
          const userStakes = await retryCall(() => contract.getUserStakes(account));
          stakes = userStakes.stakeIds.map((id, index) => ({
            stakeId: Number(id),
            amount: ethers.formatEther(userStakes.amounts[index]),
            unlockTime: Number(userStakes.unlockTimes[index]),
            tier: Number(userStakes.tiers[index]),
            pendingReward: ethers.formatEther(userStakes.pendingRewards[index]),
            active: userStakes.actives[index],
          })).filter(stake => stake.active);
        } catch {
          stakes = [];
        }

        try {
          const refData = await retryCall(() => contract.getReferralsPaginated(account, 0, 10));
          referrals = refData.result;
          referralsTotal = Number(refData.total);
        } catch {
          referrals = [];
          referralsTotal = 0;
        }
      }

      setData({
        userInfo: userInfo ? {
          totalStaked: ethers.formatEther(userInfo._totalStaked),
          totalClaimed: ethers.formatEther(userInfo._totalClaimed),
          stakeCount: Number(userInfo._stakeCount),
          pendingRewards: ethers.formatEther(userInfo._pendingRewards),
          activeStakeCount: Number(userInfo._activeStakeCount || 0),
          referrer: userInfo._referrer,
          directReferrals: Number(userInfo._directReferrals),
          referralRewards: ethers.formatEther(userInfo._referralRewards),
          totalReferralClaimed: ethers.formatEther(userInfo._totalReferralClaimed),
        } : null,
        stakes,
        miningStatus: {
          totalStaked: ethers.formatEther(miningStatus._totalStaked),
          totalDistributed: ethers.formatEther(miningStatus._totalDistributed),
          remainingRewards: ethers.formatEther(miningStatus._remainingRewards),
          miningEnded: miningStatus._miningEnded,
          startTime: Number(miningStatus._startTime),
          totalReferralDistributed: ethers.formatEther(miningStatus._totalReferralDistributed),
        },
        tierConfigs: {
          durations: tierConfigs.durations.map(duration => Number(duration) / 86400),
          dailyRates: tierConfigs.dailyRates.map(rate => Number(rate) / 100),
          annualAPYs: tierConfigs.annualAPYs.map(apy => Number(apy) / 100),
        },
        pendingRewardAll: ethers.formatEther(pendingRewardAll),
        referralRates: Array.from(referralRates).map(rate => Number(rate) / 100),
        referralLevels: Number(referralLevels),
        referrals,
        referralsTotal,
        isPaused,
        loading: false,
      });
    } catch (err) {
      console.error('Fetch staking bank data error:', err);
      setData(prev => ({ ...prev, loading: false }));
    }
  }, [contract, account]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 15000);
    return () => clearInterval(interval);
  }, [fetchData]);

  return { ...data, refetch: fetchData };
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

    try {
      const bal = await retryCall(() => tokenContract.balanceOf(account));
      setBalance(ethers.formatEther(bal));
    } catch (err) {
      console.error('Fetch balance error:', err);
      setBalance('0');
    } finally {
      setLoading(false);
    }
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

    try {
      const allow = await retryCall(() => tokenContract.allowance(owner, spender));
      setAllowance(ethers.formatEther(allow));
    } catch (err) {
      console.error('Fetch allowance error:', err);
      setAllowance('0');
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

    try {
      const feeConfig = await retryCall(() => tokenContract.getFeeConfig());
      let isExcluded = false;
      if (account) {
        isExcluded = await retryCall(() => tokenContract.isExcludedFromFee(account));
      }

      setData({
        feeConfig: {
          buyFee: Number(feeConfig._buyFee) / 100,
          sellFee: Number(feeConfig._sellFee) / 100,
          feeReceiver: feeConfig._feeReceiver,
        },
        isExcluded,
        loading: false,
      });
    } catch (err) {
      console.error('Fetch token fee config error:', err);
      setData(prev => ({ ...prev, loading: false }));
    }
  }, [tokenContract, account]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 15000);
    return () => clearInterval(interval);
  }, [fetchData]);

  return { ...data, refetch: fetchData };
}

export { ERC20_ABI };
