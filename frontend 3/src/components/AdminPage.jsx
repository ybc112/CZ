import { useState } from 'react';
import { ethers } from 'ethers';
import toast from 'react-hot-toast';
import { FiAward, FiCopy, FiPause, FiPlay, FiSettings, FiShield, FiUploadCloud } from 'react-icons/fi';
import { CONTRACTS, formatAddress, formatNumber, parseContractError } from '../utils/constants';
import { useLanguage } from '../contexts/LanguageContext';

export default function AdminPage({ account, contracts, stakingData, onRefresh }) {
  const { t } = useLanguage();
  const [releaseAmount, setReleaseAmount] = useState('');
  const [inviteReward, setInviteReward] = useState('');
  const [stakeValueRate, setStakeValueRate] = useState('');
  const [isWorking, setIsWorking] = useState(false);

  const owner = null;
  const isReady = account && contracts?.writeStakingBank;
  const currentRelease = stakingData?.currentRelease;

  const copyRewardAddress = async () => {
    if (!CONTRACTS.STAKING_BANK) return;
    try {
      await navigator.clipboard.writeText(CONTRACTS.STAKING_BANK);
      toast.success(t('cz.common.copied'));
    } catch {
      toast.error(CONTRACTS.STAKING_BANK);
    }
  };

  const approveRewardToken = async () => {
    if (!contracts?.writeNbtToken || !CONTRACTS.STAKING_BANK || !releaseAmount) return;
    setIsWorking(true);
    try {
      const tx = await contracts.writeNbtToken.approve(CONTRACTS.STAKING_BANK, ethers.parseEther(releaseAmount));
      toast.loading(t('cz.toast.approveRelease'), { id: 'approveRelease' });
      await tx.wait();
      toast.success(t('cz.toast.approveSuccess'), { id: 'approveRelease' });
      onRefresh?.();
    } catch (err) {
      toast.error(parseContractError(err), { id: 'approveRelease' });
    } finally {
      setIsWorking(false);
    }
  };

  const openRelease = async () => {
    if (!isReady) return;
    setIsWorking(true);
    try {
      // V3：开启新结算周期（无参数）
      const tx = await contracts.writeStakingBank.openEpoch();
      toast.loading(t('cz.toast.openRelease'), { id: 'openRelease' });
      await tx.wait();
      toast.success(t('cz.toast.openReleaseSuccess'), { id: 'openRelease' });
      onRefresh?.();
    } catch (err) {
      toast.error(parseContractError(err), { id: 'openRelease' });
    } finally {
      setIsWorking(false);
    }
  };

  const fundEpoch = async () => {
    if (!isReady || !releaseAmount) return;
    setIsWorking(true);
    try {
      // V3：向当前结算周期注资
      const tx = await contracts.writeStakingBank.fundEpoch(ethers.parseEther(releaseAmount));
      toast.loading(t('cz.toast.approveRelease'), { id: 'fundEpoch' });
      await tx.wait();
      toast.success(t('cz.toast.openReleaseSuccess'), { id: 'fundEpoch' });
      setReleaseAmount('');
      onRefresh?.();
    } catch (err) {
      toast.error(parseContractError(err), { id: 'fundEpoch' });
    } finally {
      setIsWorking(false);
    }
  };

  const settleEpoch = async () => {
    if (!isReady) return;
    setIsWorking(true);
    try {
      // V3：结算当前周期，未领奖励滚入下期
      const tx = await contracts.writeStakingBank.settleEpoch();
      toast.loading(t('cz.toast.allocateRelease'), { id: 'settleEpoch' });
      await tx.wait();
      toast.success(t('cz.toast.allocateReleaseSuccess'), { id: 'settleEpoch' });
      onRefresh?.();
    } catch (err) {
      toast.error(parseContractError(err), { id: 'settleEpoch' });
    } finally {
      setIsWorking(false);
    }
  };

  const updateStakeValueRate = async () => {
    if (!isReady || stakeValueRate === '') return;
    setIsWorking(true);
    try {
      const tx = await contracts.writeStakingBank.setStakeValueRate(ethers.parseEther(stakeValueRate));
      toast.loading(t('cz.toast.updateFee'), { id: 'feeConfig' });
      await tx.wait();
      toast.success(t('cz.toast.updateFeeSuccess'), { id: 'feeConfig' });
      setStakeValueRate('');
      onRefresh?.();
    } catch (err) {
      toast.error(parseContractError(err), { id: 'feeConfig' });
    } finally {
      setIsWorking(false);
    }
  };

  const updateInviteReward = async () => {
    if (!isReady || inviteReward === '') return;
    setIsWorking(true);
    try {
      const tx = await contracts.writeStakingBank.setInviteReward(ethers.parseEther(inviteReward));
      toast.loading(t('cz.toast.updateInvite'), { id: 'inviteReward' });
      await tx.wait();
      toast.success(t('cz.toast.updateInviteSuccess'), { id: 'inviteReward' });
      setInviteReward('');
      onRefresh?.();
    } catch (err) {
      toast.error(parseContractError(err), { id: 'inviteReward' });
    } finally {
      setIsWorking(false);
    }
  };

  const setPaused = async (paused) => {
    if (!isReady) return;
    setIsWorking(true);
    try {
      const tx = paused ? await contracts.writeStakingBank.pause() : await contracts.writeStakingBank.unpause();
      toast.loading(paused ? t('cz.toast.pausing') : t('cz.toast.resuming'), { id: 'pause' });
      await tx.wait();
      toast.success(paused ? t('cz.toast.paused') : t('cz.toast.resumed'), { id: 'pause' });
      onRefresh?.();
    } catch (err) {
      toast.error(parseContractError(err), { id: 'pause' });
    } finally {
      setIsWorking(false);
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-white flex items-center gap-3">
            <FiShield className="text-[#FFB800]" />
            {t('cz.admin.title')}
          </h1>
          <p className="text-white/50 mt-1">{t('cz.admin.subtitle')}</p>
        </div>
        <div className="badge-glow">{t('cz.admin.currentWallet')} {formatAddress(account || owner)}</div>
      </div>

      <section className="grid lg:grid-cols-3 gap-4">
        {[
          { label: t('cz.admin.totalStaked'), value: stakingData?.miningStatus?.totalStaked || '0', suffix: 'CZ' },
          { label: t('cz.admin.nodeCount'), value: stakingData?.miningStatus?.rankedNodeCount || 0, suffix: t('cz.common.nodes') },
          { label: t('cz.admin.claimableRewards'), value: stakingData?.miningStatus?.claimableRewards || '0', suffix: 'CZ' },
        ].map((item) => (
          <div key={item.label} className="stat-card-premium">
            <div className="text-white/45 text-sm mb-2">{item.label}</div>
            <div className="text-2xl font-bold text-white">{formatNumber(item.value, 4)} <span className="text-sm text-white/40">{item.suffix}</span></div>
          </div>
        ))}
      </section>

      <section className="grid lg:grid-cols-2 gap-6">
        <div className="neon-card">
          <div className="neon-card-inner">
            <h2 className="text-xl font-bold text-white mb-5 flex items-center gap-2">
              <FiUploadCloud className="text-[#FFB800]" />
              {t('cz.admin.monthlyRelease')}
            </h2>
            <div className="mb-4 p-4 rounded-xl bg-white/5 border border-white/10">
              <div className="text-sm text-white/45 mb-2">{t('cz.admin.rewardTopupAddress')}</div>
              <button
                onClick={copyRewardAddress}
                className="w-full flex items-center justify-between gap-3 rounded-lg bg-[#0B1120]/60 px-3 py-3 text-left font-mono text-sm text-white/80 hover:bg-white/10"
              >
                <span className="truncate">{CONTRACTS.STAKING_BANK}</span>
                <FiCopy className="shrink-0 text-[#FFB800]" />
              </button>
            </div>
            <div className="grid sm:grid-cols-2 gap-3 mb-4">
              <input className="input-premium" value={releaseAmount} onChange={(e) => setReleaseAmount(e.target.value)} placeholder={t('cz.admin.releasePlaceholder')} />
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <button onClick={approveRewardToken} disabled={isWorking || !releaseAmount} className="btn-ghost disabled:opacity-50">{t('cz.admin.approveRelease')}</button>
              <button onClick={fundEpoch} disabled={isWorking || !releaseAmount} className="btn-premium disabled:opacity-50"><span>{t('cz.admin.fundEpoch')}</span></button>
            </div>
            <div className="grid grid-cols-2 gap-3 mt-3">
              <button onClick={openRelease} disabled={isWorking} className="btn-ghost disabled:opacity-50">{t('cz.admin.openEpoch')}</button>
              <button onClick={settleEpoch} disabled={isWorking} className="btn-ghost disabled:opacity-50">{t('cz.admin.settleEpoch')}</button>
            </div>

            {currentRelease && Number(currentRelease.epochId) > 0 && (
              <div className="mt-5 p-4 rounded-xl bg-white/5 border border-white/10">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div><span className="text-white/40">Epoch</span><div className="font-bold text-white">#{currentRelease.epochId}</div></div>
                  <div><span className="text-white/40">{t('cz.admin.epochState')}</span><div className="font-bold text-white">{currentRelease.settled || currentRelease.finalized ? t('cz.admin.epochSettled') : t('cz.admin.epochFunded')}</div></div>
                  <div><span className="text-white/40">{t('cz.admin.poolAmount')}</span><div className="font-bold text-white">{formatNumber(currentRelease.amount, 4)} CZ</div></div>
                  <div><span className="text-white/40">{t('cz.admin.nodeCount')}</span><div className="font-bold text-white">{formatNumber(currentRelease.totalNodes, 0)}</div></div>
                </div>
                <div className="mt-3 text-xs text-white/40">{t('cz.admin.epochCarryover')}</div>
              </div>
            )}
          </div>
        </div>

        <div className="glass-premium p-5">
          <h2 className="text-xl font-bold text-white mb-5 flex items-center gap-2">
            <FiSettings className="text-[#00D9A5]" />
            {t('cz.admin.settings')}
          </h2>
          <div className="space-y-3">
            <input className="input-premium" value={stakeValueRate} onChange={(e) => setStakeValueRate(e.target.value)} placeholder={t('cz.admin.stakeValueRatePlaceholder')} />
            <button onClick={updateStakeValueRate} disabled={isWorking || stakeValueRate === ''} className="w-full btn-premium disabled:opacity-50"><span>{t('cz.admin.saveStakeValueRate')}</span></button>
          </div>

          <div className="mt-5 p-4 rounded-xl bg-white/5 border border-white/10 text-sm text-white/55">
            {t('cz.admin.currentStakeValueRate')}: {formatNumber(stakingData?.stakeValueRate || 1, 4)} U / CZ
          </div>

          <div className="mt-5 grid sm:grid-cols-[1fr_auto] gap-3">
            <input className="input-premium" value={inviteReward} onChange={(e) => setInviteReward(e.target.value)} placeholder={t('cz.admin.inviteRewardPlaceholder')} />
            <button onClick={updateInviteReward} disabled={isWorking || inviteReward === ''} className="btn-ghost disabled:opacity-50">{t('cz.admin.save')}</button>
          </div>
        </div>
      </section>

      <section className="glass-premium p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-white">{t('cz.admin.pauseTitle')}</h2>
          <p className="text-white/45 text-sm">{t('cz.admin.pauseDesc')}</p>
        </div>
        <div className="flex gap-3">
          <button onClick={() => setPaused(true)} disabled={isWorking || stakingData?.isPaused} className="px-4 py-2 rounded-lg bg-[#FFB800]/20 text-[#FFB800] disabled:opacity-50 flex items-center gap-2">
            <FiPause /> {t('cz.admin.pause')}
          </button>
          <button onClick={() => setPaused(false)} disabled={isWorking || !stakingData?.isPaused} className="px-4 py-2 rounded-lg bg-[#00D9A5]/20 text-[#00D9A5] disabled:opacity-50 flex items-center gap-2">
            <FiPlay /> {t('cz.admin.resume')}
          </button>
        </div>
      </section>
    </div>
  );
}
