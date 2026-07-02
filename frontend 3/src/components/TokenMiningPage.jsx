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
  const [isApprovingStake, setIsApprovingStake] = useState(false);
  const [isApprovingFee, setIsApprovingFee] = useState(false);
  const [isStaking, setIsStaking] = useState(false);
  const [withdrawingStakeId, setWithdrawingStakeId] = useState(null);
  const [isClaiming, setIsClaiming] = useState(false);
  const [copied, setCopied] = useState(false);

  const userInfo = stakingData?.userInfo;
  const miningStatus = stakingData?.miningStatus;
  const feeConfig = stakingData?.interactionFeeConfig;
  const feeAmount = feeConfig?.fee || '0.4';
  const hasReferrer = userInfo?.referrer && userInfo.referrer !== ZERO;
  const needsStakeApproval = parseFloat(stakingAllowance || '0') < parseFloat(stakeAmount || '0');
  const needsFeeApproval = parseFloat(feeAllowance || '0') < parseFloat(feeAmount || '0');
  const activeRelease = miningStatus?.releaseInProgress;

  const rankBands = [
    { label: t('cz.node.bandTop10'), percent: '50%', color: '#FFB800' },
    { label: t('cz.node.band11To50'), percent: '30%', color: '#00D9A5' },
    { label: t('cz.node.band51To100'), percent: '15%', color: '#FF8A00' },
    { label: t('cz.node.bandAfter100'), percent: '5%', color: '#94A3B8' },
  ];

  const selectedReferrer = useMemo(() => {
    if (hasReferrer) return ZERO;
    if (referrerInput && ethers.isAddress(referrerInput)) return referrerInput;
    return ZERO;
  }, [hasReferrer, referrerInput]);

  const ensureNetwork = async () => {
    const currentChainId = await getWalletChainId();
    if (currentChainId !== EXPECTED_CHAIN_ID) {
      onSwitchNetwork?.();
      return false;
    }
    return true;
  };

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
    setIsStaking(true);
    try {
      const tx = await contracts.writeStakingBank.stake(ethers.parseEther(stakeAmount), selectedReferrer);
      toast.loading(t('cz.toast.staking'), { id: 'stake' });
      await tx.wait();
      toast.success(t('cz.toast.stakeSuccess'), { id: 'stake' });
      setStakeAmount('');
      onRefresh?.();
    } catch (err) {
      toast.error(parseContractError(err), { id: 'stake' });
    } finally {
      setIsStaking(false);
    }
  };

  const handleWithdraw = async (stakeId) => {
    if (!contracts?.writeStakingBank) return;
    setWithdrawingStakeId(stakeId);
    try {
      const tx = await contracts.writeStakingBank.withdraw(stakeId);
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
      const tx = await contracts.writeStakingBank.claimNodeRewards();
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
            {!hasReferrer && (
              <input
                value={referrerInput}
                onChange={(e) => setReferrerInput(e.target.value)}
                placeholder={t('cz.node.referrerPlaceholder')}
                className="input-premium font-mono text-sm"
              />
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

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="p-3 rounded-xl bg-white/5 border border-white/5">
                <div className="text-white/40">{t('cz.node.interactionFee')}</div>
                <div className="text-white font-semibold">{formatNumber(feeAmount, 4)} U</div>
              </div>
              <div className="p-3 rounded-xl bg-white/5 border border-white/5">
                <div className="text-white/40">{t('cz.node.inviteStakeReward')}</div>
                <div className="text-[#00D9A5] font-semibold">1 CZ / {t('cz.common.person')}</div>
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
                disabled={isStaking || !account || !stakeAmount || activeRelease}
                className="w-full btn-premium disabled:opacity-50"
              >
                <span>{activeRelease ? t('cz.node.monthlyAllocating') : isStaking ? t('cz.toast.staking') : t('cz.node.confirmStake')}</span>
              </button>
            )}
          </div>
        </motion.div>
      </section>

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
                <div className="text-2xl font-bold text-white">{formatNumber(userInfo?.referralStakeVolume, 4)} CZ</div>
              </div>
              <div className="p-4 rounded-xl bg-white/5 border border-white/5">
                <div className="text-white/45 text-sm">{t('cz.node.directInvites')}</div>
                <div className="text-2xl font-bold text-white">{userInfo?.directReferrals || 0} {t('cz.common.person')}</div>
              </div>
              <div className="p-4 rounded-xl bg-white/5 border border-white/5">
                <div className="text-white/45 text-sm">{t('cz.node.invitePending')}</div>
                <div className="text-2xl font-bold text-[#00D9A5]">{formatNumber(userInfo?.pendingInviteRewards, 4)} CZ</div>
              </div>
              <div className="p-4 rounded-xl bg-white/5 border border-white/5">
                <div className="text-white/45 text-sm">{t('cz.node.rankPending')}</div>
                <div className="text-2xl font-bold text-[#FFB800]">{formatNumber(userInfo?.pendingRankRewards, 4)} CZ</div>
              </div>
            </div>

            <button
              onClick={needsFeeApproval ? approveFeeToken : handleClaim}
              disabled={!account || isClaiming || (!needsFeeApproval && parseFloat(userInfo?.pendingRewards || '0') <= 0)}
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
                    <div className="text-sm font-semibold text-white">{formatNumber(node.score, 4)} CZ</div>
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
                    <div className="text-xs text-white/35 mt-1">{t('cz.node.startTime')} {new Date(stake.startTime * 1000).toLocaleString()}</div>
                  </div>
                  <button
                    onClick={() => needsFeeApproval ? approveFeeToken() : handleWithdraw(stake.stakeId)}
                    disabled={withdrawingStakeId === stake.stakeId || activeRelease}
                    className="px-4 py-2 rounded-lg bg-white/10 text-white/75 hover:bg-white/15 disabled:opacity-50"
                  >
                    {activeRelease ? t('cz.node.cannotWithdraw') : withdrawingStakeId === stake.stakeId ? t('cz.node.withdrawing') : needsFeeApproval ? t('cz.node.approveFeeBeforeWithdraw') : t('cz.node.withdrawPrincipal')}
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
