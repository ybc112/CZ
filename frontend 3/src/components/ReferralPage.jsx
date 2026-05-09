import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { ethers } from 'ethers';
import toast from 'react-hot-toast';
import { FiCheck, FiCopy, FiExternalLink, FiGift, FiInfo, FiRefreshCw, FiShare2, FiUserPlus, FiUsers } from 'react-icons/fi';
import { formatAddress, formatNumber, getExplorerAddressUrl, parseContractError } from '../utils/constants';
import { useLanguage } from '../contexts/LanguageContext';

const PAGE_SIZE = 20;

export default function ReferralPage({
  account,
  stakingData,
  contracts,
  onRefresh,
}) {
  const { t } = useLanguage();
  const data = stakingData || {};
  const userInfo = data.userInfo;
  const referralRates = data.referralRates || [];
  const hasReferrer = userInfo?.referrer && userInfo.referrer !== ethers.ZeroAddress;
  const [referrerAddress, setReferrerAddress] = useState('');
  const [isSettingReferrer, setIsSettingReferrer] = useState(false);
  const [isClaimingReferral, setIsClaimingReferral] = useState(false);
  const [copied, setCopied] = useState(false);
  const [referrals, setReferrals] = useState([]);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [loadingReferrals, setLoadingReferrals] = useState(false);

  const stakingContract = contracts?.stakingBank;

  const copyReferralLink = async () => {
    if (!account) return;
    const link = `${window.location.origin}?ref=${account}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      toast.success(t('toast.referralLinkCopied'));
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(`复制失败，请手动复制: ${link}`);
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
    setReferrals(data.referrals || []);
    setTotal(data.referralsTotal || 0);
    setOffset((data.referrals || []).length);
  }, [data.referrals, data.referralsTotal]);

  const handleRefreshReferrals = () => {
    loadReferrals(true);
    onRefresh?.();
  };

  const handleSetReferrer = async () => {
    if (!stakingContract || !referrerAddress) return;
    if (!ethers.isAddress(referrerAddress)) {
      toast.error(t('toast.invalidAddress'));
      return;
    }
    if (referrerAddress.toLowerCase() === account?.toLowerCase()) {
      toast.error(t('toast.cannotReferSelf'));
      return;
    }

    setIsSettingReferrer(true);
    try {
      const tx = await stakingContract.setReferrer(referrerAddress);
      toast.loading(t('toast.settingReferrer'), { id: 'setReferrer' });
      await tx.wait();
      toast.success(t('toast.setReferrerSuccess'), { id: 'setReferrer' });
      setReferrerAddress('');
      onRefresh?.();
    } catch (err) {
      toast.error(parseContractError(err), { id: 'setReferrer' });
    } finally {
      setIsSettingReferrer(false);
    }
  };

  const handleClaimReferral = async () => {
    if (!stakingContract) return;
    setIsClaimingReferral(true);
    try {
      const tx = await stakingContract.claimReferralRewards();
      toast.loading(t('toast.claimingReferral'), { id: 'claimReferral' });
      await tx.wait();
      toast.success(t('toast.claimSuccess'), { id: 'claimReferral' });
      onRefresh?.();
    } catch (err) {
      toast.error(parseContractError(err), { id: 'claimReferral' });
    } finally {
      setIsClaimingReferral(false);
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#00D9A5] to-[#FFB800] flex items-center justify-center shadow-lg shadow-[#00D9A5]/20">
            <FiUsers className="w-7 h-7 text-[#0B1120]" />
          </div>
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-white">{t('referral.title')}</h1>
            <p className="text-white/50">{t('referral.subtitle')}</p>
          </div>
        </div>
        <div className="badge-glow">
          <FiGift className="w-4 h-4 mr-2" />
          {t('referral.maxBonus')}
        </div>
      </div>

      {account && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="relative overflow-hidden rounded-2xl border border-white/10"
        >
          <div className="absolute inset-0 bg-gradient-to-r from-[#00D9A5]/10 via-[#FFB800]/10 to-[#00D9A5]/10" />
          <div className="relative p-4 sm:p-8">
            <div className="flex flex-col md:flex-row items-center gap-6">
              <div className="w-16 sm:w-20 h-16 sm:h-20 rounded-2xl bg-gradient-to-br from-[#00D9A5] to-[#FFB800] flex items-center justify-center flex-shrink-0 shadow-lg shadow-[#00D9A5]/30">
                <FiShare2 className="w-8 sm:w-10 h-8 sm:h-10 text-[#0B1120]" />
              </div>
              <div className="flex-1 text-center md:text-left">
                <h2 className="text-xl sm:text-2xl font-bold mb-2 text-white">{t('referral.myReferralLink')}</h2>
                <p className="text-white/50">{t('referral.shareLinkDesc')}</p>
              </div>
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={copyReferralLink}
                className="btn-premium flex items-center gap-2"
              >
                {copied ? <FiCheck className="w-5 h-5" /> : <FiCopy className="w-5 h-5" />}
                <span>{copied ? t('referral.copied') : t('referral.copyLink')}</span>
              </motion.button>
            </div>
          </div>
        </motion.div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: t('referral.directReferrals'), value: userInfo?.directReferrals || 0, suffix: t('referral.person'), icon: <FiUserPlus className="w-5 h-5" />, color: 'primary' },
          { label: t('referral.pendingReferralReward'), value: userInfo?.referralRewards || 0, suffix: 'NBT', icon: <FiGift className="w-5 h-5" />, color: 'gold' },
          { label: t('tokenMining.totalReferralClaimed'), value: userInfo?.totalReferralClaimed || 0, suffix: 'NBT', icon: <FiCheck className="w-5 h-5" />, color: 'primary' },
          { label: t('referral.total'), value: total, suffix: t('referral.personTotal'), icon: <FiUsers className="w-5 h-5" />, color: 'gold' },
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
              {formatNumber(stat.value, 4)}
              {stat.suffix && <span className="text-white/40 text-xs sm:text-sm ml-1">{stat.suffix}</span>}
            </div>
          </motion.div>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} className="neon-card">
          <div className="neon-card-inner">
            <h2 className="text-xl font-bold mb-6 flex items-center gap-3">
              <span className="w-10 h-10 rounded-xl bg-[#00D9A5]/20 flex items-center justify-center">
                <FiUserPlus className="w-5 h-5 text-[#00D9A5]" />
              </span>
              {t('referral.myReferrer')}
            </h2>

            {hasReferrer ? (
              <div className="p-4 rounded-xl bg-white/5 border border-white/5">
                <div className="text-white/50 text-sm mb-2">{t('referral.referrerAddress')}</div>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-lg text-white truncate min-w-0">{formatAddress(userInfo.referrer)}</span>
                  <a
                    href={getExplorerAddressUrl(userInfo.referrer)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-[#00D9A5] hover:text-[#00FFB8] transition-colors flex-shrink-0"
                  >
                    <FiExternalLink className="w-4 h-4" />
                    <span className="text-sm">{t('referral.view')}</span>
                  </a>
                </div>
              </div>
            ) : (
              <>
                <p className="text-white/50 text-sm mb-4">{t('referral.setReferrerDesc')}</p>
                <div className="p-3 rounded-xl bg-[#00D9A5]/10 border border-[#00D9A5]/20 mb-4">
                  <div className="flex items-start gap-2">
                    <FiInfo className="w-4 h-4 text-[#00D9A5] mt-0.5 flex-shrink-0" />
                    <div className="text-sm text-white/70">
                      <p className="font-medium text-[#00D9A5] mb-1">{t('referral.referrerTip')}</p>
                      <p className="text-white/50">{t('referral.referrerTipDesc')}</p>
                    </div>
                  </div>
                </div>
                <div className="space-y-4">
                  <input
                    type="text"
                    value={referrerAddress}
                    onChange={(e) => setReferrerAddress(e.target.value)}
                    placeholder={t('referral.enterReferrerAddress')}
                    className="input-premium font-mono text-sm w-full overflow-hidden"
                  />
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={handleSetReferrer}
                    disabled={isSettingReferrer || !referrerAddress || !account}
                    className="w-full btn-premium disabled:opacity-50"
                  >
                    <span>{isSettingReferrer ? t('referral.settingReferrer') : t('referral.setReferrer')}</span>
                  </motion.button>
                </div>
              </>
            )}
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="neon-card">
          <div className="neon-card-inner">
            <h2 className="text-xl font-bold mb-6 flex items-center gap-3">
              <span className="w-10 h-10 rounded-xl bg-[#FFB800]/20 flex items-center justify-center">
                <FiGift className="w-5 h-5 text-[#FFB800]" />
              </span>
              {t('referral.referralReward')}
            </h2>

            <div className="relative p-4 sm:p-6 rounded-2xl mb-4 overflow-hidden bg-gradient-to-br from-[#1A2332] to-[#111827] border border-white/5">
              <div className="absolute inset-0 bg-gradient-to-br from-[#00D9A5]/5 to-[#FFB800]/5" />
              <div className="relative text-center">
                <div className="text-white/50 text-sm mb-2">{t('referral.pendingReferralReward')}</div>
                <div className="text-3xl sm:text-4xl font-bold text-gradient-premium mb-1">
                  {formatNumber(userInfo?.referralRewards, 4)}
                </div>
                <div className="text-white/40">NBT</div>
              </div>
            </div>

            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={handleClaimReferral}
              disabled={isClaimingReferral || parseFloat(userInfo?.referralRewards || '0') <= 0}
              className="w-full btn-premium disabled:opacity-50"
            >
              <span className="flex items-center justify-center gap-2">
                <FiGift className="w-5 h-5" />
                {isClaimingReferral ? t('referral.claiming') : t('referral.claimReferralReward')}
              </span>
            </motion.button>

            {referralRates.length > 0 && (
              <div className="mt-6 p-4 rounded-xl bg-white/5 border border-white/10">
                <div className="text-sm text-white/50 mb-3">{t('tokenMining.referralRates')}</div>
                <div className="grid grid-cols-3 gap-2">
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
        </motion.div>
      </div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-premium p-4 sm:p-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          <h2 className="text-xl font-bold flex items-center gap-2 text-white">
            <FiUsers className="text-[#00D9A5]" />
            {t('referral.myTeam')}
            <span className="text-sm font-normal text-white/40 ml-2">
              {t('referral.total')} {total} {t('referral.personTotal')}
            </span>
          </h2>
          <button
            onClick={handleRefreshReferrals}
            disabled={loadingReferrals}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/10 text-white/70 hover:bg-white/20 transition-colors disabled:opacity-50"
          >
            <FiRefreshCw className={`w-4 h-4 ${loadingReferrals ? 'animate-spin' : ''}`} />
            {t('referral.refresh')}
          </button>
        </div>

        {referrals.length === 0 ? (
          <div className="text-center py-12 text-white/40">
            <FiUsers className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p>{account ? t('referral.noTeamMembers') : t('referral.shareYourLink')}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {referrals.map((address, index) => (
              <div key={`${address}-${index}`} className="flex items-center justify-between p-4 rounded-xl bg-white/5 border border-white/5">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#00D9A5] to-[#00B88A] flex items-center justify-center text-[#0B1120] text-xs font-bold flex-shrink-0">
                    {index + 1}
                  </div>
                  <span className="font-mono text-white truncate block">{formatAddress(address)}</span>
                </div>
                <a
                  href={getExplorerAddressUrl(address)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-[#00D9A5] transition-colors flex-shrink-0"
                >
                  <span className="text-sm hidden sm:inline">{t('referral.view')}</span>
                  <FiExternalLink className="w-4 h-4" />
                </a>
              </div>
            ))}
          </div>
        )}

        {referrals.length < total && (
          <button
            onClick={() => loadReferrals(false)}
            disabled={loadingReferrals}
            className="w-full mt-4 py-3 rounded-xl bg-white/5 text-white/60 hover:bg-white/10 transition-colors disabled:opacity-50"
          >
            {loadingReferrals ? t('common.loading') : t('referral.loadMore')}
          </button>
        )}
      </motion.div>
    </div>
  );
}
