import { useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';
import { motion } from 'framer-motion';
import { FiArrowRight, FiDownload, FiGift, FiShield, FiTrophy, FiTrendingUp, FiUsers, FiZap } from 'react-icons/fi';
import { toast } from 'react-hot-toast';
import { LEGACY_CONTRACTS, formatNumber, getExplorerAddressUrl, getExplorerTxUrl, parseContractError } from '../utils/constants';
import { LEGACY_STAKING_BANK_ABI, ERC20_ABI } from '../abi';
import { useLanguage } from '../contexts/LanguageContext';

export default function LegacyClaimPage({ account, provider, signer, isCorrectNetwork, onSwitchNetwork, onRefresh, onGoStake }) {
  const { t } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);
  const [userData, setUserData] = useState(null);
  const [globalData, setGlobalData] = useState(null);
  const [czBalance, setCzBalance] = useState('0');
  const [refreshTick, setRefreshTick] = useState(0);

  const legacyBank = provider ? new ethers.Contract(LEGACY_CONTRACTS.STAKING_BANK, LEGACY_STAKING_BANK_ABI, provider) : null;
  const writeLegacyBank = signer ? new ethers.Contract(LEGACY_CONTRACTS.STAKING_BANK, LEGACY_STAKING_BANK_ABI, signer) : null;
  const legacyToken = provider ? new ethers.Contract(LEGACY_CONTRACTS.CZ_TOKEN, ERC20_ABI, provider) : null;

  const loadData = useCallback(async () => {
    if (!provider || !legacyBank) { setLoading(false); return; }
    setLoading(true);
    try {
      const [paused, miningStatus, epochId, totalRankDist, totalRankClaimed, totalInviteAcc, totalInviteClaimed] = await Promise.all([
        legacyBank.paused().catch(() => false),
        legacyBank.getMiningStatus().catch(() => null),
        legacyBank.currentEpochId().catch(() => 0n),
        legacyBank.totalRankDistributed().catch(() => 0n),
        legacyBank.totalRankClaimed().catch(() => 0n),
        legacyBank.totalInviteRewardsAccrued().catch(() => 0n),
        legacyBank.totalInviteRewardsClaimed().catch(() => 0n),
      ]);

      let user = null;
      let userBalance = '0';
      if (account) {
        try {
          const ui = await legacyBank.getUserInfo(account);
          user = {
            info: ui.info || ui[0],
            pendingRewards: ui.pendingRewards ?? ui[1],
            totalClaimed: ui.totalClaimed ?? ui[2],
            rank: Number(ui.rank ?? ui[3]),
          };
        } catch (err) {
          console.warn('getUserInfo failed:', err);
        }
        if (legacyToken) {
          userBalance = ethers.formatEther(await legacyToken.balanceOf(account).catch(() => 0n));
        }
      }

      setGlobalData({
        paused,
        miningStatus: miningStatus ? {
          totalStaked: ethers.formatEther(miningStatus._totalStaked ?? miningStatus[0] ?? 0n),
          totalDistributed: ethers.formatEther(miningStatus._totalDistributed ?? miningStatus[1] ?? 0n),
          claimableRewards: ethers.formatEther(miningStatus._claimableRewards ?? miningStatus[2] ?? 0n),
          releaseInProgress: miningStatus._releaseInProgress ?? miningStatus[3] ?? false,
          rankedNodeCount: Number(miningStatus._rankedNodeCount ?? miningStatus[5] ?? 0),
        } : null,
        epochId: Number(epochId),
        totalRankDistributed: ethers.formatEther(totalRankDist),
        totalRankClaimed: ethers.formatEther(totalRankClaimed),
        totalInviteAccrued: ethers.formatEther(totalInviteAcc),
        totalInviteClaimed: ethers.formatEther(totalInviteClaimed),
        unclaimedRank: ethers.formatEther(totalRankDist - totalRankClaimed),
        unclaimedInvite: ethers.formatEther(totalInviteAcc - totalInviteClaimed),
      });
      setUserData(user);
      setCzBalance(userBalance);
    } catch (err) {
      console.error('Load legacy data error:', err);
    } finally {
      setLoading(false);
    }
  }, [provider, account, legacyBank, legacyToken]);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 15000);
    return () => clearInterval(interval);
  }, [loadData, refreshTick]);

  const handleClaim = async () => {
    if (!writeLegacyBank || !account) return;
    setClaiming(true);
    try {
      // 读取交互费配置（旧合约用 BNB）
      let txOptions = {};
      try {
        const cfg = await legacyBank.getInteractionFeeConfig();
        const native = cfg.feeToken === ethers.ZeroAddress || !cfg.feeToken;
        if (native && cfg.fee > 0n) txOptions = { value: cfg.fee };
      } catch { /* 读不到时不带 value */ }
      const tx = await writeLegacyBank.claimAll(txOptions);
      toast.loading(t('legacy.claiming'), { id: 'legacyClaim' });
      await tx.wait();
      toast.success(t('legacy.claimSuccess'), { id: 'legacyClaim' });
      setRefreshTick(x => x + 1);
      onRefresh?.();
    } catch (err) {
      toast.error(parseContractError(err), { id: 'legacyClaim' });
    } finally {
      setClaiming(false);
    }
  };

  if (!isCorrectNetwork) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] text-center">
        <FiShield className="w-14 h-14 text-[#FFB800] mb-4" />
        <h2 className="text-2xl font-bold text-white mb-3">{t('legacy.wrongNetwork')}</h2>
        <p className="text-white/50 mb-6">{t('legacy.wrongNetworkDesc')}</p>
        <motion.button whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }} onClick={onSwitchNetwork} className="btn-premium">
          {t('header.switchNetwork')}
        </motion.button>
      </div>
    );
  }

  const pending = userData?.pendingRewards ? ethers.formatEther(userData.pendingRewards) : '0';
  const invitePending = userData?.info?.pendingInviteRewards ? ethers.formatEther(userData.info.pendingInviteRewards) : '0';
  const rankPending = userData?.info?.pendingRankRewards ? ethers.formatEther(userData.info.pendingRankRewards) : '0';
  const staked = userData?.info?.totalStaked ? ethers.formatEther(userData.info.totalStaked) : '0';

  return (
    <div className="space-y-6 md:space-y-8">
      {/* 标题区 */}
      <motion.section initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="relative overflow-hidden rounded-2xl md:rounded-[1.6rem] p-6 md:p-8 glass border border-white/5">
        <div className="absolute inset-0 bg-gradient-to-r from-[#FFB800]/10 via-transparent to-[#00D9A5]/10 pointer-events-none" />
        <div className="relative">
          <div className="badge-glow mb-3">
            <FiDownload className="w-4 h-4 mr-2" />
            {t('legacy.badge')}
          </div>
          <h1 className="text-3xl md:text-4xl font-bold mb-2">
            <span className="text-white">{t('legacy.title1')}</span>{' '}
            <span className="text-gradient-gold">{t('legacy.title2')}</span>
          </h1>
          <p className="text-white/60 max-w-2xl leading-relaxed">{t('legacy.desc')}</p>
          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-white/50">
            <span className="px-3 py-1 rounded-lg bg-white/5 border border-white/10">旧合约</span>
            <a href={getExplorerAddressUrl(LEGACY_CONTRACTS.STAKING_BANK)} target="_blank" rel="noopener noreferrer" className="font-mono hover:text-[#00D9A5] transition-colors">{LEGACY_CONTRACTS.STAKING_BANK.slice(0, 10)}...{LEGACY_CONTRACTS.STAKING_BANK.slice(-6)}</a>
          </div>
        </div>
      </motion.section>

      {/* 全局统计 */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-5">
        {[
          { label: t('legacy.statUnclaimedInvite'), value: globalData?.unclaimedInvite ?? '0', suffix: 'CZ', icon: <FiGift /> },
          { label: t('legacy.statUnclaimedRank'), value: globalData?.unclaimedRank ?? '0', suffix: 'CZ', icon: <FiTrophy /> },
          { label: t('legacy.statTotalStaked'), value: globalData?.miningStatus?.totalStaked ?? '0', suffix: 'CZ', icon: <FiTrendingUp /> },
          { label: t('legacy.statNodes'), value: globalData?.miningStatus?.rankedNodeCount ?? 0, suffix: t('legacy.nodesUnit'), icon: <FiUsers /> },
        ].map((stat, index) => (
          <motion.div key={stat.label} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.06 }} className="rounded-xl md:rounded-2xl p-4 md:p-5 glass border border-white/5">
            <div className="flex items-center gap-2 text-[#00D9A5] mb-2">{stat.icon}<span className="text-xs text-white/45">{stat.label}</span></div>
            <div className="text-xl md:text-2xl font-bold text-white">{formatNumber(stat.value)} <span className="text-xs text-white/40 font-normal">{stat.suffix}</span></div>
          </motion.div>
        ))}
      </section>

      {/* 我的旧 CZ 领取 */}
      <section className="grid lg:grid-cols-3 gap-4 md:gap-6">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="lg:col-span-2 rounded-2xl p-6 md:p-7 glass border border-[#FFB800]/20 bg-gradient-to-br from-[#FFB800]/5 to-transparent">
          <h2 className="text-xl font-bold text-white mb-5 flex items-center gap-2">
            <FiDownload className="text-[#FFB800]" />
            <span className="text-gradient-gold">{t('legacy.myClaim')}</span>
          </h2>

          {!account ? (
            <div className="text-center py-10 text-white/40">{t('legacy.connectFirst')}</div>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
                <div className="rounded-xl p-4 bg-white/5 border border-white/10 text-center">
                  <div className="text-[11px] text-white/45 mb-1">{t('legacy.pendingRewards')}</div>
                  <div className="text-xl md:text-2xl font-bold text-[#FFB800]">{formatNumber(pending)}</div>
                  <div className="text-[11px] text-white/35">CZ</div>
                </div>
                <div className="rounded-xl p-4 bg-white/5 border border-white/10 text-center">
                  <div className="text-[11px] text-white/45 mb-1">{t('legacy.invitePending')}</div>
                  <div className="text-xl md:text-2xl font-bold text-white">{formatNumber(invitePending)}</div>
                  <div className="text-[11px] text-white/35">CZ</div>
                </div>
                <div className="rounded-xl p-4 bg-white/5 border border-white/10 text-center">
                  <div className="text-[11px] text-white/45 mb-1">{t('legacy.rankPending')}</div>
                  <div className="text-xl md:text-2xl font-bold text-white">{formatNumber(rankPending)}</div>
                  <div className="text-[11px] text-white/35">CZ</div>
                </div>
                <div className="rounded-xl p-4 bg-white/5 border border-white/10 text-center">
                  <div className="text-[11px] text-white/45 mb-1">{t('legacy.myStaked')}</div>
                  <div className="text-xl md:text-2xl font-bold text-white">{formatNumber(staked)}</div>
                  <div className="text-[11px] text-white/35">CZ</div>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
                <div className="text-sm text-white/50">
                  {t('legacy.walletBalance')}: <span className="text-white font-semibold">{formatNumber(czBalance)} CZ</span>
                </div>
                <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
                  <motion.button
                    whileHover={{ scale: 1.03 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={handleClaim}
                    disabled={claiming || parseFloat(pending) <= 0}
                    className="btn-premium px-6 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {claiming ? <span className="flex items-center gap-2"><div className="w-4 h-4 border-2 border-[#0B1120]/30 border-t-[#0B1120] rounded-full animate-spin" />{t('legacy.claiming')}</span> : <span className="flex items-center gap-2"><FiDownload className="w-5 h-5" />{t('legacy.claimBtn')}</span>}
                  </motion.button>
                  <motion.button
                    whileHover={{ scale: 1.03 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => onGoStake('token-mining')}
                    className="btn-ghost border-[#00D9A5]/40 bg-[#00D9A5]/10 text-[#00D9A5] px-6"
                  >
                    <span className="flex items-center gap-2"><FiZap className="w-5 h-5" />{t('legacy.goStake')}<FiArrowRight className="w-4 h-4" /></span>
                  </motion.button>
                </div>
              </div>

              {parseFloat(pending) <= 0 && (
                <p className="mt-4 text-xs text-white/35">{t('legacy.noPending')}</p>
              )}
              <p className="mt-3 text-xs text-white/35">{t('legacy.feeNote')}</p>
            </>
          )}
        </motion.div>

        {/* 说明卡片 */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 }} className="rounded-2xl p-6 glass border border-white/5">
          <h3 className="font-bold text-white mb-4 flex items-center gap-2"><FiGift className="text-[#00D9A5]" />{t('legacy.about')}</h3>
          <ul className="space-y-3 text-sm text-white/55 leading-relaxed">
            <li className="flex gap-2"><span className="text-[#00D9A5]">•</span><span>{t('legacy.about1')}</span></li>
            <li className="flex gap-2"><span className="text-[#00D9A5]">•</span><span>{t('legacy.about2')}</span></li>
            <li className="flex gap-2"><span className="text-[#00D9A5]">•</span><span>{t('legacy.about3')}</span></li>
            <li className="flex gap-2"><span className="text-[#FFB800]">•</span><span>{t('legacy.about4')}</span></li>
          </ul>
        </motion.div>
      </section>

      {/* 操作记录 */}
      <section className="rounded-2xl p-6 glass border border-white/5">
        <h3 className="font-bold text-white mb-4">{t('legacy.history')}</h3>
        <div className="grid md:grid-cols-3 gap-3 text-sm">
          <div className="rounded-xl p-4 bg-white/5 border border-white/10">
            <div className="text-white/45 text-xs mb-1">{t('legacy.histTotalDistributed')}</div>
            <div className="text-white font-semibold">{formatNumber(globalData?.totalRankDistributed ?? '0')} CZ</div>
          </div>
          <div className="rounded-xl p-4 bg-white/5 border border-white/10">
            <div className="text-white/45 text-xs mb-1">{t('legacy.histTotalClaimed')}</div>
            <div className="text-white font-semibold">{formatNumber((parseFloat(globalData?.totalRankClaimed ?? '0') + parseFloat(globalData?.totalInviteClaimed ?? '0')).toFixed(4))} CZ</div>
          </div>
          <div className="rounded-xl p-4 bg-white/5 border border-white/10">
            <div className="text-white/45 text-xs mb-1">{t('legacy.histInviteAccrued')}</div>
            <div className="text-white font-semibold">{formatNumber(globalData?.totalInviteAccrued ?? '0')} CZ</div>
          </div>
        </div>
        {globalData?.paused && (
          <div className="mt-4 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/30 text-sm text-red-400">{t('legacy.pausedWarning')}</div>
        )}
        {globalData?.miningStatus?.releaseInProgress && (
          <div className="mt-4 px-4 py-3 rounded-xl bg-[#FFB800]/10 border border-[#FFB800]/30 text-sm text-[#FFB800]">{t('legacy.releaseNote')}</div>
        )}
      </section>
    </div>
  );
}
