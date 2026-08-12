import { useState, useEffect } from 'react';
import { Toaster, toast } from 'react-hot-toast';
import { ethers } from 'ethers';
import { motion, AnimatePresence } from 'framer-motion';
import { FiUserPlus, FiCheck } from 'react-icons/fi';

import Header from './components/Header';
import HomePage from './components/HomePage';
import TokenMiningPage from './components/TokenMiningPage';
import ReferralPage from './components/ReferralPage';
import AdminPage from './components/AdminPage';

import { useWallet } from './hooks/useWallet';
import { useAllowance, useContracts, useStakingBank, useTokenBalance, useTokenFeeConfig } from './hooks/useContracts';
import { CONTRACTS, formatAddress, getExplorerAddressUrl, parseContractError } from './utils/constants';
import { useLanguage } from './contexts/LanguageContext';

function App() {
  const [currentPage, setCurrentPage] = useState('home');
  const [isAdmin, setIsAdmin] = useState(false);
  const [pendingReferrer, setPendingReferrer] = useState(null);
  const [showReferrerModal, setShowReferrerModal] = useState(false);
  const [isBindingReferrer, setIsBindingReferrer] = useState(false);

  const { t } = useLanguage();
  const {
    account,
    provider,
    signer,
    isConnecting,
    isCorrectNetwork,
    error: walletError,
    connect,
    switchNetwork,
  } = useWallet();

  const contracts = useContracts(signer, provider);

  // provider 还没初始化好时，不要传入空合约读取数据
  const stakingData = useStakingBank(provider ? contracts.stakingBank : null, account);
  const tokenFeeData = useTokenFeeConfig(provider ? contracts.nbtToken : null, account);
  const { balance: tokenBalance, refetch: refetchTokenBalance } = useTokenBalance(provider ? contracts.nbtToken : null, account);
  const { allowance: stakingAllowance, refetch: refetchStakingAllowance } = useAllowance(
    provider ? contracts.nbtToken : null,
    account,
    CONTRACTS.STAKING_BANK
  );
  const { allowance: feeAllowance, refetch: refetchFeeAllowance } = useAllowance(
    provider ? contracts.feeToken : null,
    account,
    CONTRACTS.STAKING_BANK
  );
  const feeConfig = stakingData?.interactionFeeConfig;
  const isNativeFee = feeConfig?.feeToken === ethers.ZeroAddress || !CONTRACTS.FEE_TOKEN;
  // 有可领取的节点/邀请奖励时，导航栏显示红点
  const hasClaimableRewards = parseFloat(stakingData?.userInfo?.pendingRewards || '0') > 0;
  const feeTxOptions = () => (
    isNativeFee && parseFloat(feeConfig?.fee || '0') > 0
      ? { value: ethers.parseEther(feeConfig.fee) }
      : {}
  );

  useEffect(() => {
    const checkAdmin = async () => {
      if (!account || (!contracts.stakingBank && !contracts.nbtToken)) {
        setIsAdmin(false);
        return;
      }

      try {
        const owners = await Promise.all([
          contracts.stakingBank?.owner().catch(() => null),
          contracts.nbtToken?.owner().catch(() => null),
        ]);
        setIsAdmin(owners.some(owner => owner && owner.toLowerCase() === account.toLowerCase()));
      } catch {
        setIsAdmin(false);
      }
    };

    checkAdmin();
  }, [account, contracts.stakingBank, contracts.nbtToken]);

  // 读取 URL / localStorage 中的待绑定推荐人
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const ref = urlParams.get('ref');
    if (ref && ethers.isAddress(ref)) {
      localStorage.setItem('referrer', ref);
      setPendingReferrer(ref);
      return;
    }

    const savedRef = localStorage.getItem('referrer');
    if (savedRef && ethers.isAddress(savedRef)) {
      setPendingReferrer(savedRef);
    }
  }, []);

  // 当钱包连接后检查是否和自己是同一人，或链上已绑定
  useEffect(() => {
    const checkReferrer = async () => {
      if (!account || !pendingReferrer || !contracts.stakingBank) return;

      try {
        // 不能推荐自己
        if (pendingReferrer.toLowerCase() === account.toLowerCase()) {
          toast.error(t('toast.cannotReferSelf'));
          localStorage.removeItem('referrer');
          setPendingReferrer(null);
          setShowReferrerModal(false);
          return;
        }

        let hasReferrer = true;
        try {
          hasReferrer = await contracts.stakingBank.hasReferrer(account);
        } catch {
          // 如果读不到 hasReferrer，保守认为已有推荐人，避免弹窗
          hasReferrer = true;
        }

        if (hasReferrer) {
          // 链上已绑定：不清空 localStorage（保留给未连接的钱包/后续新用户使用）
          setPendingReferrer(null);
          setShowReferrerModal(false);
          return;
        }

        // 未绑定且 pendingReferrer 有效：弹出绑定确认
        setShowReferrerModal(true);
      } catch (err) {
        console.error('Check referrer error:', err);
      }
    };

    checkReferrer();
  }, [account, contracts.stakingBank, pendingReferrer, t]);

  const handleRefresh = () => {
    stakingData.refetch();
    tokenFeeData.refetch();
    refetchTokenBalance();
    refetchStakingAllowance();
    refetchFeeAllowance();
  };

  useEffect(() => {
    if (walletError) {
      toast.error(walletError);
    }
  }, [walletError]);

  const handleConfirmBind = async () => {
    if (!pendingReferrer || !contracts.writeStakingBank) return;

    setIsBindingReferrer(true);
    try {
      let hasReferrer = true;
      try {
        hasReferrer = await contracts.stakingBank.hasReferrer(account);
      } catch {}

      if (hasReferrer) {
        toast.success(t('toast.bindSuccess'));
      } else {
        toast.loading(t('toast.bindingReferrer'), { id: 'bindRef' });
        const tx = await contracts.writeStakingBank.setReferrer(pendingReferrer, feeTxOptions());
        await tx.wait();
        toast.success(t('toast.bindSuccess'), { id: 'bindRef' });
      }

      localStorage.removeItem('referrer');
      setPendingReferrer(null);
      setShowReferrerModal(false);
      handleRefresh();
    } catch (err) {
      toast.error(parseContractError(err), { id: 'bindRef' });
    } finally {
      setIsBindingReferrer(false);
    }
  };

  const handleCancelBind = () => {
    // 取消绑定：只清空 localStorage 和 pendingReferrer，不再弹窗
    localStorage.removeItem('referrer');
    setPendingReferrer(null);
    setShowReferrerModal(false);
  };

  const renderPage = () => {
    switch (currentPage) {
      case 'token-mining':
        return (
          <TokenMiningPage
            account={account}
            stakingData={stakingData}
            tokenBalance={tokenBalance}
            stakingAllowance={stakingAllowance}
            feeAllowance={feeAllowance}
            contracts={contracts}
            isCorrectNetwork={isCorrectNetwork}
            onSwitchNetwork={switchNetwork}
            onRefresh={handleRefresh}
          />
        );
      case 'referral':
        return (
          <ReferralPage
            account={account}
            stakingData={stakingData}
            feeAllowance={feeAllowance}
            contracts={contracts}
            onRefresh={handleRefresh}
          />
        );
      case 'admin':
        return (
          <AdminPage
            account={account}
            contracts={contracts}
            stakingData={stakingData}
            tokenFeeData={tokenFeeData}
            onRefresh={handleRefresh}
          />
        );
      default:
        return (
          <HomePage
            onPageChange={setCurrentPage}
            stakingData={stakingData}
          />
        );
    }
  };

  return (
    <>
      <div className="animated-bg" />

      <AnimatePresence>
        {showReferrerModal && pendingReferrer && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
            onClick={(e) => e.target === e.currentTarget && !isBindingReferrer && handleCancelBind()}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="relative w-full max-w-md rounded-2xl border border-white/10 bg-[#0B1120]/95 p-4 sm:p-6 shadow-2xl"
            >
              <div className="flex items-center gap-3 sm:gap-4 mb-4 sm:mb-6">
                <div className="w-12 sm:w-14 h-12 sm:h-14 rounded-2xl bg-gradient-to-br from-[#00D9A5] to-[#00B88A] flex items-center justify-center">
                  <FiUserPlus className="w-6 sm:w-7 h-6 sm:h-7 text-[#0B1120]" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-white">{t('app.bindReferrer')}</h3>
                  <p className="text-white/50 text-sm">{t('app.viaReferralLink')}</p>
                </div>
              </div>

              <div className="p-4 rounded-xl bg-white/5 border border-white/10 mb-6">
                <div className="text-sm text-white/50 mb-2">{t('app.referrerAddress')}</div>
                <div className="font-mono text-white break-all">{pendingReferrer}</div>
                <div className="text-xs text-white/40 mt-2">{formatAddress(pendingReferrer)}</div>
              </div>

              <div className="p-4 rounded-xl bg-[#00D9A5]/10 border border-[#00D9A5]/20 mb-6">
                <p className="text-sm text-white/70">
                  {t('app.bindReferrerDesc')}
                  <span className="text-[#00D9A5] font-medium">{t('app.irreversible')}</span>
                  {t('app.confirmCorrect')}
                </p>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={handleCancelBind}
                  disabled={isBindingReferrer}
                  className="flex-1 py-3 rounded-xl bg-white/10 text-white/70 font-medium hover:bg-white/20 transition-colors disabled:opacity-50"
                >
                  {t('app.cancel')}
                </button>
                <button
                  onClick={handleConfirmBind}
                  disabled={isBindingReferrer}
                  className="flex-1 py-3 rounded-xl bg-gradient-to-r from-[#00D9A5] to-[#00B88A] text-[#0B1120] font-medium hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isBindingReferrer ? (
                    <>
                      <div className="w-4 h-4 border-2 border-[#0B1120]/30 border-t-[#0B1120] rounded-full animate-spin" />
                      {t('app.binding')}
                    </>
                  ) : (
                    <>
                      <FiCheck className="w-4 h-4" />
                      {t('app.confirmBind')}
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <Toaster
        position="top-center"
        containerStyle={{ top: 70 }}
        toastOptions={{
          duration: 4000,
          style: {
            background: 'rgba(26, 35, 50, 0.95)',
            color: '#F8FAFC',
            border: '1px solid rgba(0, 217, 165, 0.2)',
            backdropFilter: 'blur(10px)',
            borderRadius: '12px',
            fontSize: '14px',
            maxWidth: '90vw',
            fontFamily: '-apple-system, BlinkMacSystemFont, Segoe UI, PingFang SC, Microsoft YaHei, sans-serif',
          },
          success: {
            iconTheme: {
              primary: '#00D9A5',
              secondary: '#0B1120',
            },
          },
          error: {
            iconTheme: {
              primary: '#FF6B6B',
              secondary: '#0B1120',
            },
          },
        }}
      />

      {walletError && (
        <div className="fixed top-20 left-0 right-0 z-40 px-4">
          <div className="max-w-xl mx-auto rounded-xl bg-red-500/20 border border-red-500/40 p-3 text-sm text-white text-center">
            {walletError}
          </div>
        </div>
      )}

      <Header
        account={account}
        isConnecting={isConnecting}
        isCorrectNetwork={isCorrectNetwork}
        onConnect={connect}
        onSwitchNetwork={switchNetwork}
        currentPage={currentPage}
        onPageChange={setCurrentPage}
        isAdmin={isAdmin}
        hasClaimableRewards={hasClaimableRewards}
      />

      <main className="min-h-screen pt-20 md:pt-28 pb-8 md:pb-12 px-3 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">{renderPage()}</div>
      </main>

      <footer className="glass border-t border-white/5 py-6 md:py-8">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row items-center justify-between gap-3 md:gap-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#00D9A5] to-[#00B88A] flex items-center justify-center">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M3 17L9 11L13 15L21 7" stroke="#0B1120" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M17 7H21V11" stroke="#0B1120" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              <span className="text-white/50 text-sm">&copy; 2026 Crypto Zenith. {t('footer.builtOn')}</span>
            </div>
            {CONTRACTS.STAKING_BANK && (
              <a
                href={getExplorerAddressUrl(CONTRACTS.STAKING_BANK)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-white/40 hover:text-[#00D9A5] text-sm transition-colors"
              >
                {t('footer.tokenMiningContract')}
              </a>
            )}
          </div>
        </div>
      </footer>
    </>
  );
}

export default App;
