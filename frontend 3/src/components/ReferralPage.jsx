import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { ethers } from 'ethers';
import toast from 'react-hot-toast';
import { FiAward, FiCheck, FiCopy, FiExternalLink, FiGift, FiRefreshCw, FiShare2, FiUserPlus, FiUsers } from 'react-icons/fi';
import { CONTRACTS, formatAddress, formatNumber, getExplorerAddressUrl, parseContractError } from '../utils/constants';
import { useLanguage } from '../contexts/LanguageContext';

const PAGE_SIZE = 20;

export default function ReferralPage({
  account,
  stakingData,
  feeAllowance,
  contracts,
  onRefresh,
}) {
  const { t } = useLanguage();
  const userInfo = stakingData?.userInfo;
  const feeAmount = stakingData?.interactionFeeConfig?.fee || '0.4';
  const needsFeeApproval = parseFloat(feeAllowance || '0') < parseFloat(feeAmount || '0');
  const [copied, setCopied] = useState(false);
  const [referrals, setReferrals] = useState([]);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [loadingReferrals, setLoadingReferrals] = useState(false);
  const [isApprovingFee, setIsApprovingFee] = useState(false);
  const [isClaiming, setIsClaiming] = useState(false);

  const stakingContract = contracts?.stakingBank;

  const copyReferralLink = async () => {
    if (!account) return;
    const link = `${window.location.origin}?ref=${account}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      toast.success(t('cz.toast.linkCopied'));
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(`${t('cz.toast.copyFailed')} ${link}`);
    }
  };

  const approveFeeToken = async () => {
    if (!contracts?.writeFeeToken || !CONTRACTS.STAKING_BANK) return;
    setIsApprovingFee(true);
    try {
      const tx = await contracts.writeFeeToken.approve(CONTRACTS.STAKING_BANK, ethers.MaxUint256);
      toast.loading(t('cz.toast.approveFee'), { id: 'approveFeeRef' });
      await tx.wait();
      toast.success(t('cz.toast.approveFeeSuccess'), { id: 'approveFeeRef' });
      onRefresh?.();
    } catch (err) {
      toast.error(parseContractError(err), { id: 'approveFeeRef' });
    } finally {
      setIsApprovingFee(false);
    }
  };

  const claimRewards = async () => {
    if (!contracts?.writeStakingBank) return;
    setIsClaiming(true);
    try {
      const tx = await contracts.writeStakingBank.claimNodeRewards();
      toast.loading(t('cz.toast.claiming'), { id: 'claimRefPage' });
      await tx.wait();
      toast.success(t('cz.toast.claimSuccess'), { id: 'claimRefPage' });
      onRefresh?.();
    } catch (err) {
      toast.error(parseContractError(err), { id: 'claimRefPage' });
    } finally {
      setIsClaiming(false);
    }
  };

  const loadReferrals = useCallback(async (reset = false) => {
    if (!stakingContract || !account) return;
    setLoadingReferrals(true);
    try {
      const nextOffset = reset ? 0 : offset;
      const result = await stakingContract.getReferralsPaginated(account, nextOffset, PAGE_SIZE);
      const nextItems = Array.from(result.result);
      setReferrals(prev => reset ? nextItems : [...prev, ...nextItems]);
      setOffset(nextOffset + nextItems.length);
      setTotal(Number(result.total));
    } catch (err) {
      console.error('Fetch referrals error:', err);
    } finally {
      setLoadingReferrals(false);
    }
  }, [stakingContract, account, offset]);

  useEffect(() => {
    setReferrals(stakingData?.referrals || []);
    setTotal(stakingData?.referralsTotal || 0);
    setOffset((stakingData?.referrals || []).length);
  }, [stakingData?.referrals, stakingData?.referralsTotal]);

  return (
    <div className="space-y-8">
      <section className="relative overflow-hidden rounded-3xl border border-white/10 bg-[#111827]">
        <div className="absolute inset-0 bg-gradient-to-r from-[#FFB800]/15 via-[#00D9A5]/10 to-transparent" />
        <div className="relative p-5 sm:p-8 flex flex-col md:flex-row md:items-center gap-6">
          <img src="/cz-logo.png" alt="CZ" className="w-20 h-20 rounded-full object-cover shadow-lg shadow-[#FFB800]/30" />
          <div className="flex-1">
            <h1 className="text-2xl sm:text-4xl font-bold text-white">{t('cz.referral.title')}</h1>
            <p className="text-white/55 mt-2">{t('cz.referral.subtitle')}</p>
          </div>
          <button onClick={copyReferralLink} disabled={!account} className="btn-premium flex items-center justify-center gap-2 disabled:opacity-50">
            {copied ? <FiCheck className="w-5 h-5" /> : <FiCopy className="w-5 h-5" />}
            <span>{copied ? t('cz.common.copied') : t('cz.common.copyExclusiveLink')}</span>
          </button>
        </div>
      </section>

      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: t('cz.referral.myRank'), value: userInfo?.rank ? `#${userInfo.rank}` : '-', suffix: '', icon: <FiAward /> },
          { label: t('cz.referral.directInvites'), value: userInfo?.directReferrals || 0, suffix: t('cz.common.person'), icon: <FiUserPlus /> },
          { label: t('cz.referral.referralVolume'), value: userInfo?.referralStakeVolume || 0, suffix: 'CZ', icon: <FiUsers /> },
          { label: t('cz.referral.pendingRewards'), value: userInfo?.pendingRewards || 0, suffix: 'CZ', icon: <FiGift /> },
        ].map((stat) => (
          <div key={stat.label} className="stat-card-premium">
            <div className="flex items-center gap-2 text-[#FFB800] mb-3">
              {stat.icon}
              <span className="text-white/45 text-sm">{stat.label}</span>
            </div>
            <div className="text-xl sm:text-2xl font-bold text-white">
              {typeof stat.value === 'string' && stat.value.startsWith('#') ? stat.value : formatNumber(stat.value, 4)}
              {stat.suffix && <span className="text-white/40 text-sm ml-1">{stat.suffix}</span>}
            </div>
          </div>
        ))}
      </section>

      <section className="grid lg:grid-cols-[0.9fr_1.1fr] gap-6">
        <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} className="neon-card">
          <div className="neon-card-inner">
            <h2 className="text-xl font-bold mb-5 flex items-center gap-2">
              <FiShare2 className="text-[#00D9A5]" />
              {t('cz.referral.nodeRewards')}
            </h2>

            <div className="space-y-3 mb-5">
              <div className="p-4 rounded-xl bg-white/5 border border-white/5 flex justify-between">
                <span className="text-white/50">{t('cz.referral.invitePending')}</span>
                <span className="text-[#00D9A5] font-bold">{formatNumber(userInfo?.pendingInviteRewards, 4)} CZ</span>
              </div>
              <div className="p-4 rounded-xl bg-white/5 border border-white/5 flex justify-between">
                <span className="text-white/50">{t('cz.referral.rankPending')}</span>
                <span className="text-[#FFB800] font-bold">{formatNumber(userInfo?.pendingRankRewards, 4)} CZ</span>
              </div>
              <div className="p-4 rounded-xl bg-white/5 border border-white/5 flex justify-between">
                <span className="text-white/50">{t('cz.referral.totalClaimed')}</span>
                <span className="text-white font-bold">{formatNumber(userInfo?.totalClaimed, 4)} CZ</span>
              </div>
            </div>

            <button
              onClick={needsFeeApproval ? approveFeeToken : claimRewards}
              disabled={!account || isApprovingFee || isClaiming || (!needsFeeApproval && parseFloat(userInfo?.pendingRewards || '0') <= 0)}
              className="w-full btn-premium disabled:opacity-50"
            >
              <span>{needsFeeApproval ? t('cz.referral.approveFee') : isClaiming ? t('cz.referral.claiming') : t('cz.referral.claimRewards')}</span>
            </button>
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="glass-premium p-4 sm:p-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
            <h2 className="text-xl font-bold flex items-center gap-2 text-white">
              <FiUsers className="text-[#00D9A5]" />
              {t('cz.referral.myInvites')}
              <span className="text-sm font-normal text-white/40">{t('cz.referral.totalPrefix')} {total} {t('cz.common.person')}</span>
            </h2>
            <button
              onClick={() => {
                loadReferrals(true);
                onRefresh?.();
              }}
              disabled={loadingReferrals}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/10 text-white/70 hover:bg-white/20 disabled:opacity-50"
            >
              <FiRefreshCw className={`w-4 h-4 ${loadingReferrals ? 'animate-spin' : ''}`} />
              {t('cz.common.refresh')}
            </button>
          </div>

          {referrals.length === 0 ? (
            <div className="text-center py-12 text-white/40">{t('cz.referral.noInvites')}</div>
          ) : (
            <div className="space-y-2">
              {referrals.map((address, index) => (
                <div key={`${address}-${index}`} className="flex items-center justify-between p-4 rounded-xl bg-white/5 border border-white/5">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-full bg-[#FFB800] flex items-center justify-center text-black text-xs font-bold flex-shrink-0">
                      {index + 1}
                    </div>
                    <span className="font-mono text-white truncate">{formatAddress(address)}</span>
                  </div>
                  <a href={getExplorerAddressUrl(address)} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-[#00D9A5] flex-shrink-0">
                    <span className="text-sm hidden sm:inline">{t('cz.common.view')}</span>
                    <FiExternalLink className="w-4 h-4" />
                  </a>
                </div>
              ))}
            </div>
          )}

          {referrals.length < total && (
            <button onClick={() => loadReferrals(false)} disabled={loadingReferrals} className="w-full mt-4 py-3 rounded-xl bg-white/5 text-white/60 hover:bg-white/10 disabled:opacity-50">
              {loadingReferrals ? t('cz.common.loadingMore') : t('cz.common.loadMore')}
            </button>
          )}
        </motion.div>
      </section>
    </div>
  );
}
