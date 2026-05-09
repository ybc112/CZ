import { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { ethers } from 'ethers';
import toast from 'react-hot-toast';
import { FiDollarSign, FiTrendingUp, FiGift, FiInfo, FiChevronDown, FiChevronUp, FiZap, FiLayers, FiActivity, FiLock, FiUnlock, FiClock, FiAlertTriangle, FiUsers, FiCopy, FiCheck } from 'react-icons/fi';
import { formatNumber, formatAddress, CONTRACTS, parseContractError } from '../utils/constants';
import { useLanguage } from '../contexts/LanguageContext';

// 默认档位配置（当链上数据未加载时使用）
const DEFAULT_TIER_CONFIG = [
  { id: 0, name: '随进随出', duration: 0, rate: 0.4, color: '#00D9A5' },
  { id: 1, name: '3个月', duration: 90, rate: 0.6, color: '#FFB800' },
  { id: 2, name: '6个月', duration: 180, rate: 0.8, color: '#FF8A00' },
  { id: 3, name: '12个月', duration: 365, rate: 1.0, color: '#FF6B6B' },
];

export default function TokenMiningPage({
  account,
  stakingData,
  tokenBalance,
  stakingAllowance,
  contracts,
  isCorrectNetwork,
  onSwitchNetwork,
  onRefresh
}) {
  const { t } = useLanguage();

  const [depositAmount, setDepositAmount] = useState('');
  const [selectedTier, setSelectedTier] = useState(0);
  const [isDepositing, setIsDepositing] = useState(false);
  const [isClaimingAll, setIsClaimingAll] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [showCalculator, setShowCalculator] = useState(false);
  const [withdrawingStakeId, setWithdrawingStakeId] = useState(null);
  const [claimingStakeId, setClaimingStakeId] = useState(null);
  const [now, setNow] = useState(Math.floor(Date.now() / 1000));

  // Referral states
  const [copied, setCopied] = useState(false);
  const [referrerInput, setReferrerInput] = useState('');
  const [isSettingReferrer, setIsSettingReferrer] = useState(false);
  const [isClaimingReferral, setIsClaimingReferral] = useState(false);
  const [referralPage, setReferralPage] = useState(0);
  const [allReferrals, setAllReferrals] = useState([]);
  const [loadingMoreReferrals, setLoadingMoreReferrals] = useState(false);

  // 更新当前时间用于倒计时
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Math.floor(Date.now() / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // 初始化推荐列表
  useEffect(() => {
    if (stakingData?.referrals) {
      setAllReferrals(stakingData.referrals);
    }
  }, [stakingData?.referrals]);

  const v3UserInfo = stakingData?.userInfo;
  const v3Stakes = stakingData?.stakes || [];
  const v3MiningStatus = stakingData?.miningStatus;
  const v3TierConfigs = stakingData?.tierConfigs;
  const v3PendingRewardAll = stakingData?.pendingRewardAll || '0';

  // Build tier configs from chain data (V3)
  const TIER_CONFIG = useMemo(() => {
    if (!v3TierConfigs?.dailyRates || v3TierConfigs.dailyRates.length === 0) {
      return DEFAULT_TIER_CONFIG.map(tier => ({
        ...tier,
        apy: Math.round(tier.rate * 365)
      }));
    }
    return [
      { id: 0, name: '随进随出', duration: v3TierConfigs.durations?.[0] || 0, rate: v3TierConfigs.dailyRates[0], color: '#00D9A5' },
      { id: 1, name: '3个月', duration: v3TierConfigs.durations?.[1] || 90, rate: v3TierConfigs.dailyRates[1], color: '#FFB800' },
      { id: 2, name: '6个月', duration: v3TierConfigs.durations?.[2] || 180, rate: v3TierConfigs.dailyRates[2], color: '#FF8A00' },
      { id: 3, name: '12个月', duration: v3TierConfigs.durations?.[3] || 365, rate: v3TierConfigs.dailyRates[3], color: '#FF6B6B' },
    ].map((tier, index) => ({
      ...tier,
      apy: v3TierConfigs.annualAPYs?.[index] || Math.round(tier.rate * 365)
    }));
  }, [v3TierConfigs]);

  const needsApproval = parseFloat(stakingAllowance) < parseFloat(depositAmount || '0');

  // 动态档位名称
  const tierNames = [
    t('tokenMining.flexible'),
    t('tokenMining.months3'),
    t('tokenMining.months6'),
    t('tokenMining.months12'),
  ];

  const handleApprove = async () => {
    const tokenContract = contracts?.nbtToken;
    if (!tokenContract || !CONTRACTS.STAKING_BANK) return;
    if (!isCorrectNetwork) {
      onSwitchNetwork?.();
      return;
    }
    setIsApproving(true);
    try {
      const tx = await tokenContract.approve(CONTRACTS.STAKING_BANK, ethers.MaxUint256);
      toast.loading(t('toast.approving'), { id: 'approve' });
      await tx.wait();
      toast.success(t('toast.approveSuccess'), { id: 'approve' });
      onRefresh?.();
    } catch (err) {
      toast.error(parseContractError(err), { id: 'approve' });
    } finally {
      setIsApproving(false);
    }
  };

  const handleDeposit = async () => {
    const stakingContract = contracts?.stakingBank;
    if (!stakingContract || !depositAmount) return;
    if (!isCorrectNetwork) {
      onSwitchNetwork?.();
      return;
    }
    const num = parseFloat(depositAmount);
    if (isNaN(num) || num <= 0) {
      toast.error(t('toast.invalidAmount') || '请输入有效金额');
      return;
    }
    if (num > parseFloat(tokenBalance || '0')) {
      toast.error(t('toast.insufficientBalance') || '余额不足');
      return;
    }
    setIsDepositing(true);
    try {
      const amount = ethers.parseEther(depositAmount);
      const tx = await stakingContract.deposit(amount, selectedTier);
      toast.loading(t('toast.staking'), { id: 'deposit' });
      await tx.wait();
      toast.success(t('toast.stakeSuccess'), { id: 'deposit' });
      setDepositAmount('');
      onRefresh?.();
    } catch (err) {
      toast.error(parseContractError(err), { id: 'deposit' });
    } finally {
      setIsDepositing(false);
    }
  };

  const handleWithdraw = async (stakeId) => {
    const stakingContract = contracts?.stakingBank;
    if (!stakingContract) return;
    setWithdrawingStakeId(stakeId);
    try {
      const tx = await stakingContract.withdraw(stakeId);
      toast.loading(t('toast.withdrawing'), { id: 'withdraw' });
      await tx.wait();
      toast.success(t('toast.withdrawSuccess'), { id: 'withdraw' });
      onRefresh?.();
    } catch (err) {
      toast.error(parseContractError(err), { id: 'withdraw' });
    } finally {
      setWithdrawingStakeId(null);
    }
  };

  const handleClaim = async (stakeId) => {
    const stakingContract = contracts?.stakingBank;
    if (!stakingContract) return;
    setClaimingStakeId(stakeId);
    try {
      const tx = await stakingContract.claim(stakeId);
      toast.loading(t('toast.claiming'), { id: 'claim' });
      await tx.wait();
      toast.success(t('toast.claimSuccess'), { id: 'claim' });
      onRefresh?.();
    } catch (err) {
      toast.error(parseContractError(err), { id: 'claim' });
    } finally {
      setClaimingStakeId(null);
    }
  };

  const handleClaimAll = async () => {
    const stakingContract = contracts?.stakingBank;
    if (!stakingContract) return;
    setIsClaimingAll(true);
    try {
      const tx = await stakingContract.claimAll();
      toast.loading(t('toast.claimingAll'), { id: 'claimAll' });
      await tx.wait();
      toast.success(t('toast.claimSuccess'), { id: 'claimAll' });
      onRefresh?.();
    } catch (err) {
      toast.error(parseContractError(err), { id: 'claimAll' });
    } finally {
      setIsClaimingAll(false);
    }
  };

  // ============ 推荐系统操作 ============

  // 复制推荐链接
  const copyReferralLink = async () => {
    const link = `${window.location.origin}?ref=${account}`;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(link);
      } else {
        const textArea = document.createElement('textarea');
        textArea.value = link;
        textArea.style.position = 'fixed';
        textArea.style.left = '-9999px';
        textArea.style.top = '-9999px';
        textArea.style.opacity = '0';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
      }
      setCopied(true);
      toast.success(t('toast.referralLinkCopied'));
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      try {
        const textArea = document.createElement('textarea');
        textArea.value = link;
        textArea.style.position = 'fixed';
        textArea.style.left = '-9999px';
        textArea.style.top = '-9999px';
        textArea.style.opacity = '0';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        setCopied(true);
        toast.success(t('toast.referralLinkCopied'));
        setTimeout(() => setCopied(false), 2000);
      } catch (e) {
        toast.error('Copy failed: ' + link);
      }
    }
  };

  // 设置推荐人
  const handleSetReferrer = async () => {
    const stakingContract = contracts?.stakingBank;
    if (!stakingContract || !referrerInput) return;
    if (!ethers.isAddress(referrerInput)) {
      toast.error(t('toast.invalidAddress'));
      return;
    }
    setIsSettingReferrer(true);
    try {
      const tx = await stakingContract.setReferrer(referrerInput);
      toast.loading(t('toast.settingReferrer'), { id: 'setRef' });
      await tx.wait();
      toast.success(t('toast.setReferrerSuccess'), { id: 'setRef' });
      setReferrerInput('');
      onRefresh?.();
    } catch (err) {
      toast.error(parseContractError(err), { id: 'setRef' });
    } finally {
      setIsSettingReferrer(false);
    }
  };

  // 领取推荐奖励
  const handleClaimReferral = async () => {
    const stakingContract = contracts?.stakingBank;
    if (!stakingContract) return;
    setIsClaimingReferral(true);
    try {
      const tx = await stakingContract.claimReferralRewards();
      toast.loading(t('toast.claimingReferral'), { id: 'claimRef' });
      await tx.wait();
      toast.success(t('toast.claimSuccess'), { id: 'claimRef' });
      onRefresh?.();
    } catch (err) {
      toast.error(parseContractError(err), { id: 'claimRef' });
    } finally {
      setIsClaimingReferral(false);
    }
  };

  // 加载更多推荐列表
  const loadMoreReferrals = async () => {
    const stakingContract = contracts?.stakingBank;
    if (!stakingContract || !account) return;
    setLoadingMoreReferrals(true);
    try {
      const nextPage = referralPage + 1;
      const refData = await stakingContract.getReferralsPaginated(account, nextPage * 10, 10);
      setAllReferrals(prev => [...prev, ...refData.result]);
      setReferralPage(nextPage);
    } catch (err) {
      console.error('Load more referrals error:', err);
    } finally {
      setLoadingMoreReferrals(false);
    }
  };

  // ============ 工具函数 ============

  const formatTimeRemaining = (unlockTime) => {
    const remaining = unlockTime - now;
    if (remaining <= 0) return t('tokenMining.unlocked');
    const days = Math.floor(remaining / 86400);
    const hours = Math.floor((remaining % 86400) / 3600);
    const minutes = Math.floor((remaining % 3600) / 60);
    const seconds = remaining % 60;
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m ${seconds}s`;
  };

  const canWithdraw = (stake) => {
    if (stake.tier === 0) return true;
    return now >= stake.unlockTime;
  };

  const v3TotalRewards = v3MiningStatus
    ? parseFloat(v3MiningStatus.totalDistributed || '0') + parseFloat(v3MiningStatus.remainingRewards || '0')
    : 0;
  const v3Progress = v3MiningStatus
    ? (parseFloat(v3MiningStatus.totalDistributed || '0') / (v3TotalRewards || 1)) * 100
    : 0;

  const currentTier = TIER_CONFIG[selectedTier];

  // 推荐人信息
  const hasReferrerBound = v3UserInfo?.referrer && v3UserInfo.referrer !== ethers.ZeroAddress;
  const referralRates = stakingData?.referralRates || [];

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#FFB800] to-[#FF8A00] flex items-center justify-center shadow-lg shadow-[#FFB800]/20">
            <FiDollarSign className="w-7 h-7 text-[#0B1120]" />
          </div>
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-white">{t('tokenMining.title')}</h1>
            <p className="text-white/50">{t('tokenMining.subtitle')}</p>
          </div>
        </div>
      </div>

      {/* ============================================================ */}
      {/* Staking bank */}
      {/* ============================================================ */}
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <span className="px-3 py-1 rounded-full text-xs font-medium bg-[#00D9A5]/20 text-[#00D9A5] border border-[#00D9A5]/30">
            <FiActivity className="w-3 h-3 inline mr-1" />
            {t('tokenMining.stakingBadge')}
          </span>
        </div>

        {v3MiningStatus?.miningEnded && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-4 rounded-xl bg-[#FF6B6B]/10 border border-[#FF6B6B]/30"
          >
            <div className="flex items-start gap-3">
              <FiAlertTriangle className="w-5 h-5 text-[#FF6B6B] mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-[#FF6B6B] font-medium">{t('tokenMining.miningEndedTitle')}</p>
                <p className="text-white/50 text-sm mt-1">{t('tokenMining.miningEndedDesc')}</p>
              </div>
            </div>
          </motion.div>
        )}

        {/* Tier Selection Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {TIER_CONFIG.map((tier) => (
            <motion.button
              key={tier.id}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => setSelectedTier(tier.id)}
              className={`relative p-3 sm:p-5 rounded-2xl border transition-all duration-300 text-left ${
                selectedTier === tier.id
                  ? 'bg-white/10 border-white/30 shadow-lg'
                  : 'bg-white/5 border-white/10 hover:bg-white/8'
              }`}
              style={{
                boxShadow: selectedTier === tier.id ? `0 0 30px ${tier.color}20` : 'none',
              }}
            >
              {selectedTier === tier.id && (
                <div className="absolute top-2 right-2 w-3 h-3 rounded-full" style={{ backgroundColor: tier.color }} />
              )}
              <div className="flex items-center gap-2 mb-3">
                {tier.duration === 0 ? (
                  <FiUnlock className="w-4 h-4" style={{ color: tier.color }} />
                ) : (
                  <FiLock className="w-4 h-4" style={{ color: tier.color }} />
                )}
                <span className="text-sm text-white/60">{tierNames[tier.id]}</span>
              </div>
              <div className="text-xl sm:text-2xl font-bold mb-1" style={{ color: tier.color }}>
                {tier.apy}%
              </div>
              <div className="text-xs text-white/40">
                {t('tokenMining.dailyRate')} {tier.rate}%
              </div>
              {tier.duration > 0 && (
                <div className="text-xs text-white/30 mt-1">
                  {t('tokenMining.lockDays')} {tier.duration} {t('tokenMining.days')}
                </div>
              )}
            </motion.button>
          ))}
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: t('tokenMining.totalStaked'), value: v3MiningStatus?.totalStaked, suffix: 'NBT', icon: <FiLayers className="w-5 h-5" />, color: 'primary' },
            { label: t('tokenMining.distributedRewards'), value: v3MiningStatus?.totalDistributed, suffix: 'NBT', icon: <FiGift className="w-5 h-5" />, color: 'gold' },
            { label: t('tokenMining.remainingRewards'), value: v3MiningStatus?.remainingRewards, suffix: 'NBT', icon: <FiZap className="w-5 h-5" />, color: 'primary' },
            { label: t('tokenMining.myPending'), value: v3PendingRewardAll, suffix: 'NBT', icon: <FiTrendingUp className="w-5 h-5" />, color: 'gold' },
          ].map((stat, index) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
              className="stat-card-premium"
            >
              <div className={`flex items-center gap-2 mb-3 ${stat.color === 'primary' ? 'text-[#00D9A5]' : 'text-[#FFB800]'}`}>
                {stat.icon}
                <span className="text-white/40 text-sm">{stat.label}</span>
              </div>
              <div className="text-lg sm:text-2xl font-bold text-white">
                {formatNumber(stat.value)}
                <span className="text-white/40 text-xs sm:text-sm ml-1">{stat.suffix}</span>
              </div>
            </motion.div>
          ))}
        </div>

        {/* Progress Bar */}
        <div className="glass-premium p-5">
          <div className="flex justify-between items-center mb-3">
            <span className="text-white/60 text-sm">{t('tokenMining.rewardProgress')}</span>
            <span className="text-sm font-medium text-[#FFB800]">{v3Progress.toFixed(2)}%</span>
          </div>
          <div className="progress-glow">
            <motion.div
              className="progress-glow-bar"
              style={{ background: 'linear-gradient(90deg, #FFB800, #00D9A5)' }}
              initial={{ width: 0 }}
              animate={{ width: `${Math.min(v3Progress, 100)}%` }}
              transition={{ duration: 1, ease: 'easeOut' }}
            />
          </div>
          <div className="flex justify-between text-xs text-white/40 mt-2">
            <span>0</span>
            <span>{formatNumber(v3TotalRewards)} NBT</span>
          </div>
        </div>

        {/* Main Cards: Staking + My Stakes */}
        <div className="grid lg:grid-cols-2 gap-6">
          {/* Staking Card */}
          <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} className="neon-card">
            <div className="neon-card-inner">
              <h2 className="text-xl font-bold mb-6 flex items-center gap-3">
                <span className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: `${currentTier.color}20` }}>
                  <FiDollarSign className="w-5 h-5" style={{ color: currentTier.color }} />
                </span>
                {t('tokenMining.stakeToken')} - {tierNames[selectedTier]}
              </h2>

              {/* Selected Tier Info */}
              <div className="p-4 rounded-xl mb-4 bg-white/5 border border-white/10">
                <div className="flex justify-between items-center">
                  <div>
                    <div className="text-sm text-white/50">{t('tokenMining.selectedTier')}</div>
                    <div className="text-lg font-bold" style={{ color: currentTier.color }}>{tierNames[selectedTier]}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm text-white/50">{t('tokenMining.annualYield')}</div>
                    <div className="text-2xl font-bold text-white">{currentTier.apy}%</div>
                  </div>
                </div>
                {currentTier.duration > 0 && (
                  <div className="mt-3 pt-3 border-t border-white/10 flex items-center gap-2 text-sm text-white/50">
                    <FiClock className="w-4 h-4" />
                    <span>{t('tokenMining.lockPeriod')} {currentTier.duration} {t('tokenMining.days')}{t('tokenMining.afterExpiry')}</span>
                  </div>
                )}
              </div>

              {/* Balance */}
              <div className="flex justify-between text-sm mb-3">
                <span className="text-white/50">{t('tokenMining.availableBalance')}</span>
                <span className="font-medium text-white">{formatNumber(tokenBalance, 4)} NBT</span>
              </div>

              {/* Input */}
              <div className="relative mb-4">
                <input
                  type="number"
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(e.target.value)}
                  placeholder={t('tokenMining.enterAmount')}
                  className="input-premium pr-20"
                />
                <button
                  onClick={() => setDepositAmount(tokenBalance)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
                  style={{ backgroundColor: `${currentTier.color}20`, color: currentTier.color }}
                >
                  MAX
                </button>
              </div>

              {/* Estimated Earnings */}
              {depositAmount && parseFloat(depositAmount) > 0 && (
                <div className="p-3 rounded-xl mb-4 text-sm bg-white/5 border border-white/5">
                  <div className="flex justify-between mb-2">
                    <span className="text-white/50">{t('tokenMining.estimatedDaily')}</span>
                    <span className="font-medium" style={{ color: currentTier.color }}>
                      +{(parseFloat(depositAmount) * currentTier.rate / 100).toFixed(4)} NBT
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-white/50">{t('tokenMining.estimatedMonthly')}</span>
                    <span className="text-white/70">
                      +{(parseFloat(depositAmount) * currentTier.rate / 100 * 30).toFixed(2)} NBT
                    </span>
                  </div>
                </div>
              )}

              {/* Button */}
              {!account ? (
                <div className="text-center text-white/40 py-4 bg-white/5 rounded-xl border border-white/5">
                  {t('tokenMining.pleaseConnect')}
                </div>
              ) : !isCorrectNetwork ? (
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={onSwitchNetwork}
                  className="w-full btn-premium"
                  style={{ background: `linear-gradient(135deg, #FF6B6B, #FF6B6BCC)` }}
                >
                  <span>切换到 BSC Testnet</span>
                </motion.button>
              ) : needsApproval ? (
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={handleApprove}
                  disabled={isApproving}
                  className="w-full btn-premium disabled:opacity-50"
                  style={{ background: `linear-gradient(135deg, ${currentTier.color}, ${currentTier.color}CC)` }}
                >
                  <span>{isApproving ? t('tokenMining.approving') : t('tokenMining.approveToken')}</span>
                </motion.button>
              ) : (
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={handleDeposit}
                  disabled={isDepositing || !depositAmount || parseFloat(depositAmount) <= 0 || v3MiningStatus?.miningEnded}
                  className="w-full btn-premium disabled:opacity-50"
                  style={{ background: `linear-gradient(135deg, ${currentTier.color}, ${currentTier.color}CC)` }}
                >
                  <span>{isDepositing ? t('tokenMining.staking') : v3MiningStatus?.miningEnded ? t('tokenMining.miningEndedTitle') : `${t('tokenMining.stakeToken')} (${tierNames[selectedTier]})`}</span>
                </motion.button>
              )}

              {/* Info */}
              <div className="mt-4 p-4 rounded-xl bg-white/5 border border-white/5">
                <div className="flex gap-3">
                  <FiInfo className="text-[#00D9A5] mt-0.5 flex-shrink-0" />
                  <div className="text-sm text-white/70">
                    <p className="mb-2 font-medium text-white">{t('tokenMining.stakingRules')}</p>
                    <ul className="list-disc list-inside space-y-1 text-white/50">
                      <li>{t('tokenMining.rule1')}{TIER_CONFIG[0]?.rate || 0.4}%{t('tokenMining.rule1Desc')}</li>
                      <li>{t('tokenMining.rule2')}{TIER_CONFIG[1]?.rate || 0.6}%{t('tokenMining.rule2Desc')}</li>
                      <li>{t('tokenMining.rule3')}{TIER_CONFIG[2]?.rate || 0.8}%{t('tokenMining.rule3Desc')}</li>
                      <li>{t('tokenMining.rule4')}{TIER_CONFIG[3]?.rate || 1.0}%{t('tokenMining.rule4Desc')}</li>
                    </ul>
                  </div>
                </div>
              </div>

              {/* Slippage Warning */}
              <div className="mt-4 p-4 rounded-xl bg-[#FFB800]/10 border border-[#FFB800]/30">
                <div className="flex gap-3">
                  <FiAlertTriangle className="text-[#FFB800] mt-0.5 flex-shrink-0" />
                  <div className="text-sm">
                    <p className="font-medium text-[#FFB800]">{t('tokenMining.slippageWarning')}</p>
                    <p className="text-white/50 mt-1">
                      {t('tokenMining.slippageDesc1')} <span className="text-[#FFB800] font-medium">2.8%</span> {t('tokenMining.slippageDesc2')}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>

          {/* My Stakes Card */}
          <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="neon-card">
            <div className="neon-card-inner">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-bold flex items-center gap-3">
                  <span className="w-10 h-10 rounded-xl bg-[#00D9A5]/20 flex items-center justify-center">
                    <FiGift className="w-5 h-5 text-[#00D9A5]" />
                  </span>
                  {t('tokenMining.myStakes')}
                </h2>
                {v3Stakes.length > 0 && parseFloat(v3PendingRewardAll) > 0 && (
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={handleClaimAll}
                    disabled={isClaimingAll}
                    className="px-4 py-2 rounded-lg bg-[#00D9A5]/20 text-[#00D9A5] text-sm font-medium hover:bg-[#00D9A5]/30 transition-colors disabled:opacity-50"
                  >
                    {isClaimingAll ? t('tokenMining.claiming') : t('tokenMining.claimAll')}
                  </motion.button>
                )}
              </div>

              {/* Summary */}
              <div className="grid grid-cols-2 gap-4 mb-6">
                <div className="p-4 rounded-xl bg-white/5 border border-white/5">
                  <div className="text-sm text-white/50 mb-1">{t('tokenMining.totalStakedUser')}</div>
                  <div className="text-xl font-bold text-white">{formatNumber(v3UserInfo?.totalStaked, 4)} NBT</div>
                </div>
                <div className="p-4 rounded-xl bg-white/5 border border-white/5">
                  <div className="text-sm text-white/50 mb-1">{t('tokenMining.totalEarned')}</div>
                  <div className="text-xl font-bold text-[#00D9A5]">{formatNumber(v3UserInfo?.totalClaimed, 4)} NBT</div>
                </div>
              </div>

              {/* V3 Stakes List */}
              <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2">
                {v3Stakes.length === 0 ? (
                  <div className="text-center py-8 text-white/40">
                    <FiLayers className="w-12 h-12 mx-auto mb-3 opacity-50" />
                    <p>{t('tokenMining.noStakes')}</p>
                    <p className="text-sm mt-1">{t('tokenMining.startStaking')}</p>
                  </div>
                ) : (
                  v3Stakes.map((stake) => {
                    const tierInfo = TIER_CONFIG[stake.tier];
                    const isLocked = !canWithdraw(stake);
                    return (
                      <div key={stake.stakeId} className="p-4 rounded-xl bg-white/5 border border-white/10 hover:bg-white/8 transition-colors">
                        <div className="flex justify-between items-start mb-3">
                          <div className="flex items-center gap-2">
                            {isLocked ? <FiLock className="w-4 h-4" style={{ color: tierInfo.color }} /> : <FiUnlock className="w-4 h-4" style={{ color: tierInfo.color }} />}
                            <span className="font-medium" style={{ color: tierInfo.color }}>{tierNames[stake.tier]}</span>
                            <span className="text-xs text-white/40">#{stake.stakeId}</span>
                          </div>
                          <div className="text-right">
                            <div className="text-sm text-white/50">{t('tokenMining.dailyRate')}</div>
                            <div className="font-medium" style={{ color: tierInfo.color }}>{tierInfo.rate}%</div>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4 mb-3">
                          <div>
                            <div className="text-xs text-white/40 mb-1">{t('tokenMining.stakeAmount')}</div>
                            <div className="font-medium text-white">{formatNumber(stake.amount, 4)} NBT</div>
                          </div>
                          <div>
                            <div className="text-xs text-white/40 mb-1">{t('tokenMining.myPending')}</div>
                            <div className="font-medium text-[#00D9A5]">+{formatNumber(stake.pendingReward, 4)} NBT</div>
                          </div>
                        </div>
                        {stake.tier > 0 && (
                          <div className={`flex items-center gap-2 text-xs mb-3 ${isLocked ? 'text-[#FFB800]' : 'text-[#00D9A5]'}`}>
                            <FiClock className="w-3 h-3" />
                            <span>{isLocked ? `${t('tokenMining.remaining')} ${formatTimeRemaining(stake.unlockTime)}` : t('tokenMining.unlocked')}</span>
                          </div>
                        )}
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleClaim(stake.stakeId)}
                            disabled={claimingStakeId === stake.stakeId || parseFloat(stake.pendingReward) <= 0}
                            className="flex-1 py-2 rounded-lg bg-[#00D9A5]/20 text-[#00D9A5] text-sm font-medium hover:bg-[#00D9A5]/30 transition-colors disabled:opacity-50"
                          >
                            {claimingStakeId === stake.stakeId ? t('tokenMining.claiming') : t('tokenMining.claimReward')}
                          </button>
                          <button
                            onClick={() => handleWithdraw(stake.stakeId)}
                            disabled={withdrawingStakeId === stake.stakeId || isLocked}
                            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 ${
                              isLocked ? 'bg-white/5 text-white/30 cursor-not-allowed' : 'bg-white/10 text-white/70 hover:bg-white/20'
                            }`}
                          >
                            {withdrawingStakeId === stake.stakeId ? t('tokenMining.withdrawing') : isLocked ? t('tokenMining.inLockup') : t('tokenMining.withdrawPrincipal')}
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </motion.div>
        </div>

        {/* ============ 推荐系统区域 ============ */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="neon-card"
        >
          <div className="neon-card-inner">
            <h2 className="text-xl font-bold mb-6 flex items-center gap-3">
              <span className="w-10 h-10 rounded-xl bg-[#00D9A5]/20 flex items-center justify-center">
                <FiUsers className="w-5 h-5 text-[#00D9A5]" />
              </span>
              {t('tokenMining.referralSection')}
            </h2>

            <div className="grid lg:grid-cols-2 gap-6">
              {/* Left: Link + Referrer + Rates */}
              <div className="space-y-4">
                {/* Referral Link */}
                {account && (
                  <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                    <div className="text-sm text-white/50 mb-2">{t('tokenMining.myReferralLink')}</div>
                    <div className="flex gap-2">
                      <div className="flex-1 p-3 rounded-lg bg-white/5 border border-white/5 text-white/70 text-sm font-mono truncate">
                        {`${window.location.origin}?ref=${formatAddress(account)}`}
                      </div>
                      <motion.button
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        onClick={copyReferralLink}
                        className={`px-4 py-3 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${
                          copied
                            ? 'bg-[#00D9A5] text-[#0B1120]'
                            : 'bg-[#00D9A5]/20 text-[#00D9A5] hover:bg-[#00D9A5]/30'
                        }`}
                      >
                        {copied ? <FiCheck className="w-4 h-4" /> : <FiCopy className="w-4 h-4" />}
                        {copied ? t('tokenMining.copied') : t('tokenMining.copyLink')}
                      </motion.button>
                    </div>
                  </div>
                )}

                {/* Show Bound Referrer / Go to Referral Page */}
                <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                  {hasReferrerBound ? (
                    <div>
                      <div className="text-sm text-white/50 mb-2">{t('tokenMining.referrerBound')}</div>
                      <div className="p-3 rounded-lg bg-white/5 border border-white/5 font-mono text-white text-sm overflow-hidden">
                        {formatAddress(v3UserInfo.referrer)}
                      </div>
                    </div>
                  ) : (
                    <div>
                      <div className="text-sm text-white/50 mb-2">{t('tokenMining.setReferrer')}</div>
                      <div className="p-3 rounded-lg bg-[#00D9A5]/5 border border-[#00D9A5]/10">
                        <div className="flex gap-2 text-xs">
                          <FiInfo className="w-3 h-3 text-[#00D9A5] mt-0.5 flex-shrink-0" />
                          <span className="text-white/50">{t('tokenMining.referrerTipDesc')}</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Referral Rates */}
                {referralRates.length > 0 && (
                  <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                    <div className="text-sm text-white/50 mb-3">{t('tokenMining.referralRates')}</div>
                    <div className="grid grid-cols-3 gap-2 sm:gap-3">
                      {referralRates.map((rate, i) => (
                        <div key={i} className="text-center p-3 rounded-lg bg-white/5 border border-white/5">
                          <div className="text-xs text-white/40 mb-1">{i + 1}{t('tokenMining.level')}</div>
                          <div className="text-lg font-bold text-[#00D9A5]">{rate}%</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Right: Stats + Claim + Team */}
              <div className="space-y-4">
                {/* Referral Stats */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 rounded-xl bg-white/5 border border-white/5">
                    <div className="text-sm text-white/50 mb-1">{t('tokenMining.directReferrals')}</div>
                    <div className="text-xl font-bold text-white">{v3UserInfo?.directReferrals || 0} {t('tokenMining.person')}</div>
                  </div>
                  <div className="p-4 rounded-xl bg-white/5 border border-white/5">
                    <div className="text-sm text-white/50 mb-1">{t('tokenMining.totalReferralClaimed')}</div>
                    <div className="text-xl font-bold text-[#00D9A5]">{formatNumber(v3UserInfo?.totalReferralClaimed, 4)} NBT</div>
                  </div>
                </div>

                {/* Pending Referral Reward + Claim */}
                <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                  <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
                    <div>
                      <div className="text-sm text-white/50 mb-1">{t('tokenMining.pendingReferralReward')}</div>
                      <div className="text-2xl font-bold text-[#FFB800]">{formatNumber(v3UserInfo?.referralRewards, 4)} NBT</div>
                    </div>
                    <motion.button
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={handleClaimReferral}
                      disabled={isClaimingReferral || !v3UserInfo?.referralRewards || parseFloat(v3UserInfo?.referralRewards) <= 0}
                      className="w-full sm:w-auto px-4 py-2 rounded-lg bg-[#FFB800]/20 text-[#FFB800] text-sm font-medium hover:bg-[#FFB800]/30 transition-colors disabled:opacity-50"
                    >
                      {isClaimingReferral ? t('tokenMining.claimingReferral') : t('tokenMining.claimReferralReward')}
                    </motion.button>
                  </div>
                  <div className="text-xs text-white/40 mt-2">{t('tokenMining.referralRewardHint')}</div>
                </div>

                {/* Direct Referral List */}
                <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                  <div className="text-sm text-white/50 mb-3">
                    {t('tokenMining.myTeam')} ({stakingData?.referralsTotal || 0} {t('tokenMining.person')})
                  </div>
                  {allReferrals.length === 0 ? (
                    <div className="text-center py-4 text-white/30 text-sm">
                      {t('tokenMining.noTeamMembers')}
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-[200px] overflow-y-auto">
                      {allReferrals.map((addr, i) => (
                        <div key={i} className="flex items-center justify-between p-2 rounded-lg bg-white/5 text-sm">
                          <span className="text-white/40">#{i + 1}</span>
                          <span className="font-mono text-white/70">{formatAddress(addr)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {allReferrals.length < (stakingData?.referralsTotal || 0) && (
                    <button
                      onClick={loadMoreReferrals}
                      disabled={loadingMoreReferrals}
                      className="w-full mt-3 py-2 rounded-lg bg-white/5 text-white/50 text-sm hover:bg-white/10 transition-colors disabled:opacity-50"
                    >
                      {loadingMoreReferrals ? '...' : t('tokenMining.loadMore')}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </motion.div>

        {/* Calculator Section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-premium overflow-hidden"
        >
          <button
            onClick={() => setShowCalculator(!showCalculator)}
            className="w-full p-5 flex items-center justify-between hover:bg-white/5 transition-colors"
          >
            <span className="font-semibold flex items-center gap-2 text-white">
              <FiTrendingUp className="w-5 h-5 text-[#FFB800]" />
              {t('tokenMining.calculator')}
            </span>
            {showCalculator ? <FiChevronUp className="text-white/50" /> : <FiChevronDown className="text-white/50" />}
          </button>

          {showCalculator && (
            <div className="p-5 pt-0">
              <div className="divider-glow mb-6" style={{ background: 'linear-gradient(90deg, transparent, rgba(255, 184, 0, 0.4), transparent)' }} />
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-white/50">
                      <th className="text-left pb-3">{t('tokenMining.stakeAmount')}</th>
                      {TIER_CONFIG.map((tier, idx) => (
                        <th key={tier.id} className="text-center pb-3" style={{ color: tier.color }}>
                          {tierNames[idx]}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="text-white">
                    {[1000, 10000, 100000, 1000000].map(amount => (
                      <tr key={amount} className="border-t border-white/5">
                        <td className="py-3 text-white/70">{formatNumber(amount)} NBT</td>
                        {TIER_CONFIG.map(tier => (
                          <td key={tier.id} className="text-center py-3">
                            <div style={{ color: tier.color }}>{t('tokenMining.daily')} +{formatNumber(amount * tier.rate / 100)}</div>
                            <div className="text-xs text-white/40">{t('tokenMining.monthly')} +{formatNumber(amount * tier.rate / 100 * 30)}</div>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </motion.div>
      </div>

    </div>
  );
}
