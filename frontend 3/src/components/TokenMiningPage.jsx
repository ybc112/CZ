import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { ethers } from 'ethers';
import toast from 'react-hot-toast';
import {
  FiAward,
  FiCheck,
  FiCopy,
  FiDollarSign,
  FiGift,
  FiInfo,
  FiLayers,
  FiLock,
  FiTrendingUp,
  FiUsers,
  FiZap,
} from 'react-icons/fi';
import { CONTRACTS, EXPECTED_CHAIN_ID, formatAddress, formatNumber, parseContractError } from '../utils/constants';
import { useLanguage } from '../contexts/LanguageContext';

const ZERO = ethers.ZeroAddress;

const getWalletChainId = async () => {
  if (typeof window.ethereum === 'undefined') return null;
  const chainId = await window.ethereum.request({ method: 'eth_chainId' });
  return parseInt(chainId, 16);
};

const formatFullAmount = (value) => {
  if (value === undefined || value === null || value === '') return '0';
  const [whole, fraction = ''] = String(value).split('.');
  const trimmedFraction = fraction.replace(/0+$/, '');
  return trimmedFraction ? `${whole}.${trimmedFraction}` : whole;
};

const formatDateTime = (timestamp) => new Date(timestamp * 1000).toLocaleString();

export default function TokenMiningPage({
  account,
  stakingData,
  tokenBalance,
  stakingAllowance,
  feeAllowance,
  contracts,
  onSwitchNetwork,
  onRefresh,
}) {
  const { t } = useLanguage();
  const [stakeAmount, setStakeAmount] = useState('');
  const [referrerInput, setReferrerInput] = useState(() => localStorage.getItem('referrer') || '');
  const [showReferrerEdit, setShowReferrerEdit] = useState(false);
  const [isApprovingStake, setIsApprovingStake] = useState(false);
  const [isApprovingFee, setIsApprovingFee] = useState(false);
  const [isStaking, setIsStaking] = useState(false);
  const [isCompounding, setIsCompounding] = useState(false);
  const [withdrawingStakeId, setWithdrawingStakeId] = useState(null);
  const [isClaiming, setIsClaiming] = useState(false);
  const [copied, setCopied] = useState(false);
  const [manualCopyLink, setManualCopyLink] = useState(null);

  const userInfo = stakingData?.userInfo;
  const miningStatus = stakingData?.miningStatus;
  const feeAmount = stakingData?.interactionFeeConfig?.fee || '0.4';
  const isNativeFee = stakingData?.interactionFeeConfig?.feeToken === ethers.ZeroAddress || !CONTRACTS.FEE_TOKEN;
  const hasReferrer = userInfo?.referrer && userInfo.referrer !== ZERO;
  const needsStakeApproval = parseFloat(stakingAllowance || '0') < parseFloat(stakeAmount || '0');
  const needsFeeApproval = !isNativeFee && parseFloat(feeAllowance || '0') < parseFloat(feeAmount || '0');
  const pendingRewardsAmount = userInfo?.pendingRewards || '0';
  const pendingRewardsNumber = parseFloat(pendingRewardsAmount || '0');
  const needsCompoundFeeApproval = !isNativeFee && parseFloat(feeAllowance || '0') < parseFloat(feeAmount || '0');
  const canCompoundRewards = !stakingData?.stakingTokenAddress
    || !stakingData?.rewardTokenAddress
    || stakingData.stakingTokenAddress.toLowerCase() === stakingData.rewardTokenAddress.toLowerCase();
  const activeRelease = miningStatus?.releaseInProgress;
  const minReferralStakeValue = stakingData?.minReferralStakeValue || '100';

  const rankBands = [
    { label: t('cz.node.bandTop10'), percent: '50%', color: '#FFB800' },
    { label: t('cz.node.band11To50'), percent: '30%', color: '#00D9A5' },
    { label: t('cz.node.band51To100'), percent: '15%', color: '#FF8A00' },
    { label: t('cz.node.bandAfter100'), percent: '5%', color: '#94A3B8' },
  ];

  const selectedReferrer = useMemo(() => {
    if (hasReferrer) return userInfo.referrer;
    if (referrerInput && ethers.isAddress(referrerInput)) {
      if (referrerInput.toLowerCase() === (account || '').toLowerCase()) return ZERO;
      return referrerInput;
    }
    return ZERO;
  }, [hasReferrer, userInfo?.referrer, referrerInput, account]);

  const referrerFromStorage = useMemo(() => {
    const saved = localStorage.getItem('referrer');
    return saved && ethers.isAddress(saved) ? saved : '';
  }, []);
  const hasAutoFilledReferrer = Boolean(referrerFromStorage) && !showReferrerEdit;

  const ensureNetwork = async () => {
    const currentChainId = await getWalletChainId();
    if (currentChainId !== EXPECTED_CHAIN_ID) {
      onSwitchNetwork?.();
      return false;
    }
    return true;
  };

  const feeTxOptions = () => (
    isNativeFee && parseFloat(feeAmount || '0') > 0
      ? { value: ethers.parseEther(feeAmount) }
      : {}
  );

  const approveStakeToken = async () => {
    if (!contracts?.writeNbtToken || !CONTRACTS.STAKING_BANK) return;
    if (!(await ensureNetwork())) return;
    setIsApprovingStake(true);
    try {
      const tx = await contracts.writeNbtToken.approve(CONTRACTS.STAKING_BANK, ethers.MaxUint256);
      toast.loading(t('cz.toast.approveCz'), { id: 'approveStake' });
      await tx.wait();
      toast.success(t('cz.toast.approveCzSuccess'), { id: 'approveStake' });
      onRefresh?.();
    } catch (err) {
      toast.error(parseContractError(err), { id: 'approveStake' });
    } finally {
      setIsApprovingStake(false);
    }
  };

  const approveFeeToken = async () => {
    if (!contracts?.writeFeeToken || !CONTRACTS.STAKING_BANK) return;
    if (!(await ensureNetwork())) return;
    setIsApprovingFee(true);
    try {
      const tx = await contracts.writeFeeToken.approve(CONTRACTS.STAKING_BANK, ethers.MaxUint256);
      toast.loading(t('cz.toast.approveFee'), { id: 'approveFee' });
      await tx.wait();
      toast.success(t('cz.toast.approveFeeSuccess'), { id: 'approveFee' });
      onRefresh?.();
    } catch (err) {
      toast.error(parseContractError(err), { id: 'approveFee' });
    } finally {
      setIsApprovingFee(false);
    }
  };

  const handleStake = async () => {
    if (!contracts?.writeStakingBank || !stakeAmount) return;
    if (!(await ensureNetwork())) return;
    const amountNumber = parseFloat(stakeAmount);
    if (isNaN(amountNumber) || amountNumber <= 0) {
      toast.error(t('cz.toast.invalidStakeAmount'));
      return;
    }
    if (amountNumber > parseFloat(tokenBalance || '0')) {
      toast.error(t('cz.toast.insufficientCz'));
      return;
    }
    if (!hasReferrer && referrerInput && referrerInput.toLowerCase() === (account || '').toLowerCase()) {
      toast.error(t('cz.node.referrerSelfWarn'));
      return;
    }
    setIsStaking(true);
    try {
      const tx = await contracts.writeStakingBank.stake(ethers.parseEther(stakeAmount), selectedReferrer, feeTxOptions());
      toast.loading(t('cz.toast.staking'), { id: 'stake' });
      await tx.wait();
      toast.success(t('cz.toast.stakeSuccess'), { id: 'stake' });
      setStakeAmount('');
      onRefresh?.();
    } catch (err) {
      toast.error(parseContractError(err), { id: 'stake' });
      onRefresh?.();
    } finally {
      setIsStaking(false);
    }
  };

  const handleCompound = async () => {
    if (!contracts?.writeStakingBank) return;
    if (!(await ensureNetwork())) return;
    if (!canCompoundRewards) {
      toast.error(t('cz.toast.compoundUnavailable'));
      return;
    }
    if (activeRelease) {
      toast.error(parseContractError({ reason: 'Monthly release in progress' }));
      return;
    }
    if (isNaN(pendingRewardsNumber) || pendingRewardsNumber <= 0) {
      toast.error(t('cz.toast.noRewardsToCompound'));
      return;
    }

    setIsCompounding(true);
    try {
      toast.loading(t('cz.toast.compoundStake'), { id: 'compound' });
      const tx = await contracts.writeStakingBank.compoundNodeRewards(selectedReferrer, feeTxOptions());
      await tx.wait();

      toast.success(t('cz.toast.compoundSuccess'), { id: 'compound' });
      onRefresh?.();
    } catch (err) {
      toast.error(parseContractError(err), { id: 'compound' });
    } finally {
      setIsCompounding(false);
    }
  };

  const handleCompoundAction = async () => {
    if (needsCompoundFeeApproval) {
      await approveFeeToken();
      return;
    }
    await handleCompound();
  };

  const handleWithdraw = async (stakeId) => {
    if (!contracts?.writeStakingBank) return;
    setWithdrawingStakeId(stakeId);
    try {
      const tx = await contracts.writeStakingBank.withdraw(stakeId, feeTxOptions());
      toast.loading(t('cz.toast.withdrawing'), { id: 'withdraw' });
      await tx.wait();
      toast.success(t('cz.toast.withdrawSuccess'), { id: 'withdraw' });
      onRefresh?.();
    } catch (err) {
      toast.error(parseContractError(err), { id: 'withdraw' });
    } finally {
      setWithdrawingStakeId(null);
    }
  };

  const handleClaim = async () => {
    if (!contracts?.writeStakingBank) return;
    setIsClaiming(true);
    try {
      const tx = await contracts.writeStakingBank.claimNodeRewards(feeTxOptions());
      toast.loading(t('cz.toast.claiming'), { id: 'claimNode' });
      await tx.wait();
      toast.success(t('cz.toast.claimSuccess'), { id: 'claimNode' });
      onRefresh?.();
    } catch (err) {
      toast.error(parseContractError(err), { id: 'claimNode' });
    } finally {
      setIsClaiming(false);
    }
  };

  const fallbackCopy = (text) => {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '0';
      ta.style.left = '0';
      ta.style.width = '1px';
      ta.style.height = '1px';
      ta.style.opacity = '0';
      ta.style.pointerEvents = 'none';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      ta.setSelectionRange(0, ta.value.length);
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  };

  const copyReferralLink = async () => {
    if (!account) return;
    const link = `${window.location.origin}?ref=${account}`;

    let success = false;
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(link);
        success = true;
      } catch {
        success = false;
      }
    }
    if (!success) success = fallbackCopy(link);

    if (success) {
      setCopied(true);
      toast.success(t('cz.toast.linkCopied'));
      setTimeout(() => setCopied(false), 2000);
      return;
    }
    setManualCopyLink(link);
  };

  const stats = [
    { label: t('cz.node.statStaked'), value: miningStatus?.totalStaked || '0', suffix: 'CZ', icon: <FiLayers /> },
    { label: t('cz.node.statDistributed'), value: miningStatus?.totalDistributed || '0', suffix: 'CZ', icon: <FiGift /> },
    { label: t('cz.node.statNodeCount'), value: miningStatus?.rankedNodeCount || 0, suffix: t('cz.common.nodes'), icon: <FiUsers /> },
    { label: t('cz.node.myRank'), value: userInfo?.rank ? `#${userInfo.rank}` : '-', suffix: '', icon: <FiAward /> },
  ];

  return (
    <div className="space-y-8">
      <section className="grid lg:grid-cols-[1.1fr_0.9fr] gap-6 items-stretch">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="neon-card">
          <div className="neon-card-inner h-full">
            <div className="flex items-center gap-4 mb-6">
              <img src="/cz-logo.png" alt="CZ" className="w-16 h-16 rounded-full object-cover shadow-lg shadow-[#FFB800]/30" />
              <div>
                <h1 className="text-2xl md:text-4xl font-bold text-white">{t('cz.node.pageTitle')}</h1>
                <p className="text-white/50 mt-1">{t('cz.node.pageSubtitle')}</p>
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-3 mb-6">
              {rankBands.map((band) => (
                <div key={band.label} className="p-4 rounded-xl bg-white/5 border border-white/10">
                  <div className="text-sm text-white/50">{band.label}</div>
                  <div className="text-3xl font-bold mt-1" style={{ color: band.color }}>{band.percent}</div>
                  <div className="text-xs text-white/35 mt-1">{t('cz.node.bandNote')}</div>
                </div>
              ))}
            </div>

            <div className="p-4 rounded-xl bg-[#FFB800]/10 border border-[#FFB800]/25 text-sm text-white/70">
              <FiInfo className="inline mr-2 text-[#FFB800]" />
              {t('cz.node.releaseHint')}
            </div>
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-premium p-5">
          <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
            <FiDollarSign className="text-[#FFB800]" />
            {t('cz.node.stakeTitle')}
          </h2>

          <div className="space-y-4">
            {!hasReferrer ? (
              hasAutoFilledReferrer && !showReferrerEdit ? (
                <div className="rounded-xl border border-[#00D9A5]/30 bg-[#00D9A5]/10 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-xs text-[#00D9A5]">{t('cz.node.referrerAutoFilled')}</div>
                      <div className="font-mono text-sm text-white truncate">{formatAddress(referrerInput)}</div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        onClick={() => setShowReferrerEdit(true)}
                        className="px-3 py-1.5 rounded-lg bg-white/10 text-xs text-white hover:bg-white/20"
                      >
                        {t('cz.node.referrerChange')}
                      </button>
                      <button
                        onClick={() => {
                          setReferrerInput('');
                          localStorage.removeItem('referrer');
                          setShowReferrerEdit(false);
                        }}
                        className="px-3 py-1.5 rounded-lg bg-white/10 text-xs text-white hover:bg-white/20"
                      >
                        {t('cz.node.referrerClear')}
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <input
                  value={referrerInput}
                  onChange={(e) => setReferrerInput(e.target.value)}
                  placeholder={t('cz.node.referrerPlaceholder')}
                  className="input-premium font-mono text-sm"
                />
              )
            ) : (
              <div className="rounded-xl border border-[#FFB800]/30 bg-[#FFB800]/10 p-3">
                <div className="text-xs text-[#FFB800]">{t('cz.node.referrerBound')}</div>
                <div className="font-mono text-sm text-white">{formatAddress(userInfo.referrer)}</div>
              </div>
            )}

            <div>
              <div className="flex justify-between text-sm mb-2">
                <span className="text-white/50">{t('cz.node.stakeAmount')}</span>
                <button className="text-[#FFB800]" onClick={() => setStakeAmount(tokenBalance || '0')}>
                  {t('cz.node.all')} {formatNumber(tokenBalance, 4)} CZ
                </button>
              </div>
              <input
                type="number"
                value={stakeAmount}
                onChange={(e) => setStakeAmount(e.target.value)}
                placeholder={t('cz.node.amountPlaceholder')}
                className="input-premium"
              />
            </div>

            <div className="grid grid-cols-1 gap-3 text-sm">
              <div className="p-3 rounded-xl bg-white/5 border border-white/5">
                <div className="text-white/40">{t('cz.node.inviteStakeReward')}</div>
                <div className="text-[#00D9A5] font-semibold">{formatFullAmount(stakingData?.inviteReward || '1000000')} CZ / {t('cz.common.person')}</div>
              </div>
              <div className="p-3 rounded-xl bg-[#00D9A5]/10 border border-[#00D9A5]/20 text-white/70 leading-relaxed">
                <div>质押15天，解锁后自由操作</div>
                <div>点击复投，质押周期自动延续15天</div>
                <div>排名权益持续生效，奖励自动累积</div>
                <div>邀请人成功质押满 {formatNumber(minReferralStakeValue, 2)}U 价值代币，获得 {formatFullAmount(stakingData?.inviteReward || '1000000')} CZ 奖励，质押到期后可领取</div>
              </div>
            </div>

            {needsFeeApproval ? (
              <button onClick={approveFeeToken} disabled={isApprovingFee || !account} className="w-full btn-premium disabled:opacity-50">
                <span>{isApprovingFee ? t('cz.node.approving') : t('cz.node.approveFee')}</span>
              </button>
            ) : needsStakeApproval ? (
              <button onClick={approveStakeToken} disabled={isApprovingStake || !account} className="w-full btn-premium disabled:opacity-50">
                <span>{isApprovingStake ? t('cz.node.approving') : t('cz.node.approveStake')}</span>
              </button>
            ) : (
              <button
                onClick={handleStake}
                disabled={isStaking || isCompounding || !account || !stakeAmount || activeRelease}
                className="w-full btn-premium disabled:opacity-50"
              >
                <span>{activeRelease ? t('cz.node.monthlyAllocating') : isStaking ? t('cz.toast.staking') : t('cz.node.confirmStake')}</span>
              </button>
            )}

            <button
              onClick={handleCompoundAction}
              disabled={!account || isApprovingFee || isApprovingStake || isCompounding || isClaiming || isStaking || activeRelease || !(pendingRewardsNumber > 0) || !canCompoundRewards}
              className="w-full btn-ghost border-[#FFB800]/50 bg-[#FFB800]/10 text-[#FFB800] hover:border-[#FFB800] hover:bg-[#FFB800]/20 hover:shadow-[0_0_30px_rgba(255,184,0,0.18)] disabled:opacity-50"
            >
              {!canCompoundRewards ? t('cz.node.compoundUnavailable') : activeRelease ? t('cz.node.monthlyAllocating') : isCompounding ? t('cz.node.compounding') : !(pendingRewardsNumber > 0) ? t('cz.node.compoundRewards') : needsCompoundFeeApproval ? t('cz.node.approveFeeFirst') : `${t('cz.node.compoundRewards')} ${formatNumber(pendingRewardsAmount, 4)} CZ`}
            </button>
          </div>
        </motion.div>
      </section>

      {manualCopyLink && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          onClick={() => setManualCopyLink(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-[#111827] border border-white/10 p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold text-white mb-1">{t('cz.toast.manualCopyTitle')}</h3>
            <p className="text-sm text-white/55 mb-4">{t('cz.toast.manualCopyHint')}</p>
            <div
              className="break-all rounded-xl bg-white/5 border border-white/10 p-3 text-[#00D9A5] text-sm font-mono select-all"
              style={{ WebkitUserSelect: 'all', userSelect: 'all' }}
            >
              {manualCopyLink}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setManualCopyLink(null)}
                className="px-4 py-2 rounded-lg bg-white/10 text-white hover:bg-white/20"
              >
                {t('cz.toast.manualCopyClose')}
              </button>
            </div>
          </div>
        </div>
      )}

      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat) => (
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

      <section className="grid lg:grid-cols-2 gap-6">
        <div className="neon-card">
          <div className="neon-card-inner">
            <div className="flex items-center justify-between gap-3 mb-5">
              <h2 className="text-xl font-bold flex items-center gap-2">
                <FiZap className="text-[#00D9A5]" />
                {t('cz.node.myRewards')}
              </h2>
              <button onClick={copyReferralLink} disabled={!account} className="px-4 py-2 rounded-lg bg-white/10 text-white/80 hover:bg-white/15 flex items-center gap-2">
                {copied ? <FiCheck /> : <FiCopy />}
                {copied ? t('cz.common.copied') : t('cz.common.copyLink')}
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-5">
              <div className="p-4 rounded-xl bg-white/5 border border-white/5">
                <div className="text-white/45 text-sm">{t('cz.node.referralVolume')}</div>
                <div className="text-2xl font-bold text-white">{formatNumber(userInfo?.referralStakeVolume, 4)} U</div>
              </div>
              <div className="p-4 rounded-xl bg-white/5 border border-white/5">
                <div className="text-white/45 text-sm">{t('cz.node.directInvites')}</div>
                <div className="text-2xl font-bold text-white">{userInfo?.directReferrals || 0} {t('cz.common.person')}</div>
              </div>
              <div className="p-4 rounded-xl bg-white/5 border border-white/5">
                <div className="text-white/45 text-sm">{t('cz.node.invitePending')}</div>
                <div className="text-2xl font-bold text-[#00D9A5]">{formatNumber(userInfo?.pendingInviteRewards, 4)} CZ</div>
                {parseFloat(userInfo?.lockedInviteRewards || '0') > 0 && (
                  <div className="text-xs text-white/35 mt-1">锁定中 {formatNumber(userInfo?.lockedInviteRewards, 4)} CZ，到期后可领取</div>
                )}
              </div>
              <div className="p-4 rounded-xl bg-white/5 border border-white/5">
                <div className="text-white/45 text-sm">{t('cz.node.rankPending')}</div>
                <div className="text-2xl font-bold text-[#FFB800]">{formatNumber(userInfo?.pendingRankRewards, 4)} CZ</div>
              </div>
            </div>

            <button
              onClick={needsFeeApproval ? approveFeeToken : handleClaim}
              disabled={!account || isClaiming || isCompounding || (!needsFeeApproval && !(pendingRewardsNumber > 0))}
              className="w-full btn-premium disabled:opacity-50"
            >
              <span>{needsFeeApproval ? t('cz.node.approveFeeFirst') : isClaiming ? t('cz.node.claiming') : t('cz.node.claimAll')}</span>
            </button>
          </div>
        </div>

        <div className="glass-premium p-5">
          <h2 className="text-xl font-bold flex items-center gap-2 text-white mb-5">
            <FiTrendingUp className="text-[#FFB800]" />
            {t('cz.node.leaderboard')}
          </h2>
          <div className="space-y-2 max-h-[430px] overflow-y-auto pr-1">
            {(stakingData?.rankedNodes || []).length === 0 ? (
              <div className="text-center py-12 text-white/35">{t('cz.node.noRank')}</div>
            ) : (
              stakingData.rankedNodes.map((node) => (
                <div key={node.address} className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/5">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`w-9 h-9 rounded-full flex items-center justify-center font-bold ${node.rank <= 10 ? 'bg-[#FFB800] text-black' : 'bg-white/10 text-white/70'}`}>
                      {node.rank}
                    </div>
                    <span className="font-mono text-white/75 truncate">{formatAddress(node.address)}</span>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-semibold text-white">{formatNumber(node.score, 4)} U</div>
                    <div className="text-xs text-white/35">{t('cz.node.referralVolume')}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      <section className="neon-card">
        <div className="neon-card-inner">
          <h2 className="text-xl font-bold flex items-center gap-2 mb-5">
            <FiLock className="text-[#00D9A5]" />
            {t('cz.node.myStakes')}
          </h2>
          <div className="space-y-3">
            {(stakingData?.stakes || []).length === 0 ? (
              <div className="text-center py-8 text-white/35">{t('cz.node.noStakes')}</div>
            ) : (
              stakingData.stakes.map((stake) => (
                <div key={stake.stakeId} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-xl bg-white/5 border border-white/10">
                  <div>
                    <div className="text-white font-semibold">#{stake.stakeId} · {formatNumber(stake.amount, 4)} CZ</div>
                    <div className="text-xs text-white/35 mt-1">{t('cz.node.stakeValue')} {formatNumber(stake.scoreValue, 4)} U · {t('cz.node.startTime')} {formatDateTime(stake.startTime)}</div>
                    <div className={`text-xs mt-1 ${stake.isUnlocked ? 'text-[#00D9A5]' : 'text-[#FFB800]'}`}>
                      {stake.isUnlocked ? '已解锁，可自由操作' : `15天质押中，解锁时间 ${formatDateTime(stake.unlockTime)}`}
                    </div>
                  </div>
                  <button
                    onClick={() => needsFeeApproval ? approveFeeToken() : handleWithdraw(stake.stakeId)}
                    disabled={withdrawingStakeId === stake.stakeId || activeRelease || !stake.isUnlocked}
                    className="px-4 py-2 rounded-lg bg-white/10 text-white/75 hover:bg-white/15 disabled:opacity-50"
                  >
                    {activeRelease ? t('cz.node.cannotWithdraw') : !stake.isUnlocked ? '待解锁' : withdrawingStakeId === stake.stakeId ? t('cz.node.withdrawing') : needsFeeApproval ? t('cz.node.approveFeeBeforeWithdraw') : t('cz.node.withdrawPrincipal')}
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
