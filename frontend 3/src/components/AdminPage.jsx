import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { ethers } from 'ethers';
import toast from 'react-hot-toast';
import { FiActivity, FiAlertTriangle, FiCopy, FiDollarSign, FiGift, FiPercent, FiRefreshCw, FiSave, FiShield, FiUsers } from 'react-icons/fi';
import { CONTRACTS, formatAddress, formatNumber, parseContractError } from '../utils/constants';
import { useLanguage } from '../contexts/LanguageContext';

export default function AdminPage({
  account,
  contracts,
  stakingData,
  tokenFeeData,
  onRefresh,
}) {
  const { t } = useLanguage();
  const [isUpdating, setIsUpdating] = useState(false);
  const [owners, setOwners] = useState({ stakingBank: null, nbtToken: null });
  const [loadingOwners, setLoadingOwners] = useState(true);
  const [rewardAmount, setRewardAmount] = useState('');
  const [tierRates, setTierRates] = useState(['', '', '', '']);
  const [referralRates, setReferralRates] = useState(['', '', '']);
  const [tokenConfig, setTokenConfig] = useState({
    buyFee: '',
    sellFee: '',
    pairAddress: '',
    excludeAddress: '',
    feeReceiver: '',
  });

  useEffect(() => {
    const loadOwners = async () => {
      setLoadingOwners(true);
      try {
        const [stakingOwner, tokenOwner] = await Promise.all([
          contracts.stakingBank?.owner().catch(() => null),
          contracts.nbtToken?.owner().catch(() => null),
        ]);
        setOwners({ stakingBank: stakingOwner, nbtToken: tokenOwner });
      } finally {
        setLoadingOwners(false);
      }
    };

    if (contracts.stakingBank || contracts.nbtToken) {
      loadOwners();
    } else {
      setLoadingOwners(false);
    }
  }, [contracts.stakingBank, contracts.nbtToken]);

  const isStakingOwner = owners.stakingBank && account && owners.stakingBank.toLowerCase() === account.toLowerCase();
  const isTokenOwner = owners.nbtToken && account && owners.nbtToken.toLowerCase() === account.toLowerCase();
  const isAnyOwner = isStakingOwner || isTokenOwner;
  const tierConfigs = stakingData?.tierConfigs;
  const miningStatus = stakingData?.miningStatus;
  const currentReferralRates = stakingData?.referralRates || [];
  const feeConfig = tokenFeeData?.feeConfig;

  const activeContracts = useMemo(() => ([
    { name: 'NBT Token', address: CONTRACTS.NBT_TOKEN, isOwner: isTokenOwner },
    { name: 'Staking Bank', address: CONTRACTS.STAKING_BANK, isOwner: isStakingOwner },
  ]), [isStakingOwner, isTokenOwner]);

  const copyAddress = async (address) => {
    if (!address) return;
    await navigator.clipboard.writeText(address);
    toast.success(t('toast.addressCopied'));
  };

  const handleFundRewards = async () => {
    if (!contracts.writeStakingBank || !rewardAmount) return;
    setIsUpdating(true);
    try {
      const amount = ethers.parseEther(rewardAmount);
      if (contracts.nbtToken) {
        const allowance = await contracts.nbtToken.allowance(account, CONTRACTS.STAKING_BANK);
        if (allowance < amount) {
          const approveTx = await contracts.writeNbtToken.approve(CONTRACTS.STAKING_BANK, ethers.MaxUint256);
          toast.loading(t('toast.approving'), { id: 'fundApprove' });
          await approveTx.wait();
          toast.success(t('toast.approveSuccess'), { id: 'fundApprove' });
        }
      }
      const tx = await contracts.writeStakingBank.fundRewards(amount);
      toast.loading(t('toast.settingTotalRewards'), { id: 'fundRewards' });
      await tx.wait();
      toast.success(t('toast.totalRewardsSuccess'), { id: 'fundRewards' });
      setRewardAmount('');
      onRefresh?.();
    } catch (err) {
      toast.error(parseContractError(err), { id: 'fundRewards' });
    } finally {
      setIsUpdating(false);
    }
  };

  const handleSetTierRate = async (tier) => {
    const rate = tierRates[tier];
    if (!contracts.writeStakingBank || rate === '') return;
    setIsUpdating(true);
    try {
      const current = await contracts.stakingBank.getTierConfig(tier);
      const dailyRate = Math.floor(parseFloat(rate) * 100);
      const tx = await contracts.writeStakingBank.setTierConfig(tier, current.duration, dailyRate);
      toast.loading(t('toast.settingTierRate'), { id: `tier-${tier}` });
      await tx.wait();
      toast.success(t('toast.tierRateSuccess'), { id: `tier-${tier}` });
      setTierRates(prev => prev.map((item, index) => index === tier ? '' : item));
      onRefresh?.();
    } catch (err) {
      toast.error(parseContractError(err), { id: `tier-${tier}` });
    } finally {
      setIsUpdating(false);
    }
  };

  const handleSetReferralRates = async () => {
    if (!contracts.writeStakingBank) return;
    const rates = referralRates.filter(rate => rate !== '');
    if (rates.length === 0) {
      toast.error(t('toast.fillValidRate'));
      return;
    }

    setIsUpdating(true);
    try {
      const ratesInBp = rates.map(rate => Math.floor(parseFloat(rate) * 100));
      const tx = await contracts.writeStakingBank.setReferralRates(ratesInBp);
      toast.loading(t('toast.settingReferralRates'), { id: 'refRates' });
      await tx.wait();
      toast.success(t('toast.referralRatesSuccess'), { id: 'refRates' });
      setReferralRates(['', '', '']);
      onRefresh?.();
    } catch (err) {
      toast.error(parseContractError(err), { id: 'refRates' });
    } finally {
      setIsUpdating(false);
    }
  };

  const handleSetFees = async () => {
    if (!contracts.writeNbtToken || tokenConfig.buyFee === '' || tokenConfig.sellFee === '') return;
    setIsUpdating(true);
    try {
      const buyFee = Math.floor(parseFloat(tokenConfig.buyFee) * 100);
      const sellFee = Math.floor(parseFloat(tokenConfig.sellFee) * 100);
      const tx = await contracts.writeNbtToken.setFees(buyFee, sellFee);
      toast.loading(t('toast.settingFees'), { id: 'fees' });
      await tx.wait();
      toast.success(t('toast.feesSuccess'), { id: 'fees' });
      setTokenConfig(prev => ({ ...prev, buyFee: '', sellFee: '' }));
      onRefresh?.();
    } catch (err) {
      toast.error(parseContractError(err), { id: 'fees' });
    } finally {
      setIsUpdating(false);
    }
  };

  const handleSetPair = async () => {
    if (!contracts.writeNbtToken || !ethers.isAddress(tokenConfig.pairAddress)) {
      toast.error(t('toast.invalidAddress'));
      return;
    }
    setIsUpdating(true);
    try {
      const tx = await contracts.writeNbtToken.setPair(tokenConfig.pairAddress, true);
      toast.loading(t('toast.settingPair'), { id: 'pair' });
      await tx.wait();
      toast.success(t('toast.pairSuccess'), { id: 'pair' });
      setTokenConfig(prev => ({ ...prev, pairAddress: '' }));
      onRefresh?.();
    } catch (err) {
      toast.error(parseContractError(err), { id: 'pair' });
    } finally {
      setIsUpdating(false);
    }
  };

  const handleSetExcluded = async (status) => {
    if (!contracts.writeNbtToken || !ethers.isAddress(tokenConfig.excludeAddress)) {
      toast.error(t('toast.invalidAddress'));
      return;
    }
    setIsUpdating(true);
    try {
      const tx = await contracts.writeNbtToken.setExcludedFromFee(tokenConfig.excludeAddress, status);
      toast.loading(status ? t('toast.addingWhitelist') : t('toast.removingWhitelist'), { id: 'exclude' });
      await tx.wait();
      toast.success(status ? t('toast.whitelistAdded') : t('toast.whitelistRemoved'), { id: 'exclude' });
      setTokenConfig(prev => ({ ...prev, excludeAddress: '' }));
      onRefresh?.();
    } catch (err) {
      toast.error(parseContractError(err), { id: 'exclude' });
    } finally {
      setIsUpdating(false);
    }
  };

  const handleSetFeeReceiver = async () => {
    if (!contracts.writeNbtToken || !ethers.isAddress(tokenConfig.feeReceiver)) {
      toast.error(t('toast.invalidAddress'));
      return;
    }
    setIsUpdating(true);
    try {
      const tx = await contracts.writeNbtToken.setFeeReceiver(tokenConfig.feeReceiver);
      toast.loading(t('toast.settingFeeReceiver'), { id: 'receiver' });
      await tx.wait();
      toast.success(t('toast.feeReceiverSuccess'), { id: 'receiver' });
      setTokenConfig(prev => ({ ...prev, feeReceiver: '' }));
      onRefresh?.();
    } catch (err) {
      toast.error(parseContractError(err), { id: 'receiver' });
    } finally {
      setIsUpdating(false);
    }
  };

  if (!account) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center">
          <FiShield className="w-16 h-16 text-white/20 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-white mb-2">{t('admin.title')}</h2>
          <p className="text-white/50">{t('admin.pleaseConnect')}</p>
        </div>
      </div>
    );
  }

  if (loadingOwners) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-[#00D9A5]/30 border-t-[#00D9A5] rounded-full animate-spin mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-white mb-2">{t('admin.loading')}</h2>
          <p className="text-white/50">{t('admin.verifyingAdmin')}</p>
        </div>
      </div>
    );
  }

  if (!isAnyOwner) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center">
          <FiAlertTriangle className="w-16 h-16 text-[#FF6B6B] mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-white mb-2">{t('admin.noAccess')}</h2>
          <p className="text-white/50 mb-4">{t('admin.notOwner')}</p>
          <div className="text-left bg-white/5 rounded-xl p-4 max-w-md mx-auto">
            <p className="text-xs text-white/60 mb-1">{t('admin.connectedAddress')} <code className="text-[#00D9A5]">{formatAddress(account)}</code></p>
            <p className="text-xs text-white/60 mb-1">NBT Token Owner: <code className="text-[#FFB800]">{owners.nbtToken || t('admin.notLoaded')}</code></p>
            <p className="text-xs text-white/60">Staking Bank Owner: <code className="text-[#FFB800]">{owners.stakingBank || t('admin.notLoaded')}</code></p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#FF6B6B] to-[#FF8A00] flex items-center justify-center shadow-lg shadow-[#FF6B6B]/20">
            <FiShield className="w-7 h-7 text-white" />
          </div>
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-white">{t('admin.title')}</h1>
            <p className="text-white/50">Fresh deployment controls for NBT Token and Staking Bank</p>
          </div>
        </div>
        <button
          onClick={onRefresh}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/10 text-white/70 hover:bg-white/20 transition-colors"
        >
          <FiRefreshCw className="w-4 h-4" />
          {t('admin.refreshData')}
        </button>
      </div>

      <div className="p-4 rounded-xl bg-[#FF6B6B]/10 border border-[#FF6B6B]/30">
        <div className="flex items-start gap-3">
          <FiAlertTriangle className="w-5 h-5 text-[#FF6B6B] mt-0.5" />
          <div>
            <p className="text-[#FF6B6B] font-medium">{t('admin.warning')}</p>
            <p className="text-white/50 text-sm mt-1">These settings affect live reward emission, referral accounting, and token transfer fees.</p>
          </div>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {activeContracts.map((contract) => (
          <div key={contract.name} className="p-4 rounded-xl bg-white/5 border border-white/10">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-white/50">{contract.name}</span>
              {contract.isOwner ? (
                <span className="px-2 py-0.5 rounded text-xs bg-[#00D9A5]/20 text-[#00D9A5]">Owner</span>
              ) : (
                <span className="px-2 py-0.5 rounded text-xs bg-white/10 text-white/40">Non-Owner</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <code className="text-xs text-white/70 truncate flex-1">{contract.address || 'Not configured'}</code>
              <button
                onClick={() => copyAddress(contract.address)}
                className="p-1 rounded hover:bg-white/10 text-white/40 hover:text-white/70 transition-colors"
              >
                <FiCopy className="w-3 h-3" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {isStakingOwner && (
        <section className="space-y-6">
          <div className="neon-card">
            <div className="neon-card-inner">
              <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                <FiActivity className="w-5 h-5 text-[#00D9A5]" />
                Staking Bank
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  { label: t('admin.totalStaked'), value: miningStatus?.totalStaked, suffix: 'NBT' },
                  { label: t('admin.distributed'), value: miningStatus?.totalDistributed, suffix: 'NBT' },
                  { label: t('admin.remainingRewards'), value: miningStatus?.remainingRewards, suffix: 'NBT' },
                  { label: t('admin.status'), value: miningStatus?.miningEnded ? t('admin.ended') : t('admin.inProgress'), suffix: '' },
                ].map((item) => (
                  <div key={item.label} className="p-3 rounded-lg bg-white/5">
                    <div className="text-xs text-white/40 mb-1">{item.label}</div>
                    <div className="text-lg font-bold text-white">
                      {item.suffix ? `${formatNumber(item.value)} ${item.suffix}` : item.value}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="glass-premium p-6">
            <h3 className="font-semibold text-white mb-4 flex items-center gap-2">
              <FiGift className="w-4 h-4 text-[#00D9A5]" />
              Fund Rewards
            </h3>
            <div className="flex gap-3">
              <input
                type="number"
                placeholder="Reward amount"
                value={rewardAmount}
                onChange={(e) => setRewardAmount(e.target.value)}
                className="input-premium flex-1"
              />
              <button
                onClick={handleFundRewards}
                disabled={isUpdating || !rewardAmount}
                className="btn-premium px-6 disabled:opacity-50"
              >
                <FiSave className="w-4 h-4 mr-2" />
                {t('admin.save')}
              </button>
            </div>
            <p className="text-xs text-white/40 mt-2">Approve NBT to the staking contract before funding rewards.</p>
          </div>

          <div className="glass-premium p-6">
            <h3 className="font-semibold text-white mb-4 flex items-center gap-2">
              <FiPercent className="w-4 h-4 text-[#FFB800]" />
              {t('admin.tierRateSetting')}
            </h3>
            <div className="space-y-3">
              {[t('admin.flexibleLock'), t('admin.months3Lock'), t('admin.months6Lock'), t('admin.months12Lock')].map((name, tier) => (
                <div key={tier} className="flex gap-3 items-center">
                  <span className="text-white/60 w-24 text-sm">{name}</span>
                  <div className="text-sm text-white/40 w-24">
                    {tierConfigs?.dailyRates?.[tier] ?? '-'}% / day
                  </div>
                  <input
                    type="number"
                    step="0.1"
                    placeholder="0.4"
                    value={tierRates[tier]}
                    onChange={(e) => setTierRates(prev => prev.map((item, index) => index === tier ? e.target.value : item))}
                    className="input-premium flex-1"
                  />
                  <button
                    onClick={() => handleSetTierRate(tier)}
                    disabled={isUpdating || tierRates[tier] === ''}
                    className="btn-ghost px-4 disabled:opacity-50"
                  >
                    {t('admin.save')}
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="glass-premium p-6">
            <h3 className="font-semibold text-white mb-4 flex items-center gap-2">
              <FiUsers className="w-4 h-4 text-[#00D9A5]" />
              {t('admin.referralRatesSetting')}
            </h3>
            <div className="flex flex-wrap gap-2 mb-4">
              {currentReferralRates.map((rate, i) => (
                <div key={i} className="px-3 py-2 rounded-lg bg-white/5">
                  <div className="text-xs text-white/40">{i + 1}{t('tokenMining.level')}</div>
                  <div className="text-sm font-bold text-[#00D9A5]">{rate}%</div>
                </div>
              ))}
            </div>
            <div className="grid md:grid-cols-3 gap-3 mb-3">
              {referralRates.map((rate, i) => (
                <input
                  key={i}
                  type="number"
                  step="0.1"
                  placeholder={`${i + 1}${t('tokenMining.level')} %`}
                  value={rate}
                  onChange={(e) => setReferralRates(prev => prev.map((item, index) => index === i ? e.target.value : item))}
                  className="input-premium"
                />
              ))}
            </div>
            <button
              onClick={handleSetReferralRates}
              disabled={isUpdating || !referralRates.some(Boolean)}
              className="btn-premium w-full disabled:opacity-50"
            >
              <FiSave className="w-4 h-4 mr-2" />
              {t('admin.saveReferralRates')}
            </button>
          </div>
        </section>
      )}

      {isTokenOwner && (
        <section className="space-y-6">
          <div className="neon-card">
            <div className="neon-card-inner">
              <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                <FiDollarSign className="w-5 h-5 text-[#FFB800]" />
                NBT Token
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div className="p-3 rounded-lg bg-white/5">
                  <div className="text-xs text-white/40 mb-1">{t('admin.buySlippage')}</div>
                  <div className="text-lg font-bold text-white">{feeConfig?.buyFee ?? '-'}%</div>
                </div>
                <div className="p-3 rounded-lg bg-white/5">
                  <div className="text-xs text-white/40 mb-1">{t('admin.sellSlippage')}</div>
                  <div className="text-lg font-bold text-white">{feeConfig?.sellFee ?? '-'}%</div>
                </div>
                <div className="p-3 rounded-lg bg-white/5">
                  <div className="text-xs text-white/40 mb-1">{t('admin.feeReceiver')}</div>
                  <div className="text-lg font-bold text-white">{formatAddress(feeConfig?.feeReceiver)}</div>
                </div>
              </div>
            </div>
          </div>

          <div className="glass-premium p-6">
            <h3 className="font-semibold text-white mb-4 flex items-center gap-2">
              <FiPercent className="w-4 h-4 text-[#FFB800]" />
              {t('admin.slippageSetting')}
            </h3>
            <div className="grid md:grid-cols-2 gap-3 mb-3">
              <input
                type="number"
                step="0.1"
                placeholder={t('admin.buySlippage')}
                value={tokenConfig.buyFee}
                onChange={(e) => setTokenConfig(prev => ({ ...prev, buyFee: e.target.value }))}
                className="input-premium"
              />
              <input
                type="number"
                step="0.1"
                placeholder={t('admin.sellSlippage')}
                value={tokenConfig.sellFee}
                onChange={(e) => setTokenConfig(prev => ({ ...prev, sellFee: e.target.value }))}
                className="input-premium"
              />
            </div>
            <button
              onClick={handleSetFees}
              disabled={isUpdating || tokenConfig.buyFee === '' || tokenConfig.sellFee === ''}
              className="btn-premium w-full disabled:opacity-50"
            >
              <FiSave className="w-4 h-4 mr-2" />
              {t('admin.saveSlippageSetting')}
            </button>
          </div>

          <div className="grid lg:grid-cols-3 gap-6">
            <div className="glass-premium p-6">
              <h3 className="font-semibold text-white mb-4">{t('admin.pairSetting')}</h3>
              <input
                type="text"
                placeholder="0x..."
                value={tokenConfig.pairAddress}
                onChange={(e) => setTokenConfig(prev => ({ ...prev, pairAddress: e.target.value }))}
                className="input-premium w-full mb-3 font-mono text-sm"
              />
              <button
                onClick={handleSetPair}
                disabled={isUpdating || !tokenConfig.pairAddress}
                className="btn-premium w-full disabled:opacity-50"
              >
                {t('admin.add')}
              </button>
            </div>

            <div className="glass-premium p-6">
              <h3 className="font-semibold text-white mb-4">{t('admin.feeReceiver')}</h3>
              <input
                type="text"
                placeholder="0x..."
                value={tokenConfig.feeReceiver}
                onChange={(e) => setTokenConfig(prev => ({ ...prev, feeReceiver: e.target.value }))}
                className="input-premium w-full mb-3 font-mono text-sm"
              />
              <button
                onClick={handleSetFeeReceiver}
                disabled={isUpdating || !tokenConfig.feeReceiver}
                className="btn-premium w-full disabled:opacity-50"
              >
                {t('admin.set')}
              </button>
            </div>

            <div className="glass-premium p-6">
              <h3 className="font-semibold text-white mb-4">{t('admin.whitelist')}</h3>
              <input
                type="text"
                placeholder="0x..."
                value={tokenConfig.excludeAddress}
                onChange={(e) => setTokenConfig(prev => ({ ...prev, excludeAddress: e.target.value }))}
                className="input-premium w-full mb-3 font-mono text-sm"
              />
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => handleSetExcluded(true)}
                  disabled={isUpdating || !tokenConfig.excludeAddress}
                  className="btn-premium disabled:opacity-50"
                >
                  {t('admin.add')}
                </button>
                <button
                  onClick={() => handleSetExcluded(false)}
                  disabled={isUpdating || !tokenConfig.excludeAddress}
                  className="btn-ghost disabled:opacity-50"
                >
                  {t('admin.remove')}
                </button>
              </div>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
