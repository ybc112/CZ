import { useState, useEffect, useCallback, useMemo } from 'react';
import { ethers } from 'ethers';
import { CURRENT_NETWORK, EXPECTED_CHAIN_ID } from '../utils/constants';

// 创建默认的只读 Provider（用于未连接钱包时读取链上数据）
const createDefaultProvider = () => {
  // 使用多个 RPC 节点，提高可靠性
  const rpcUrls = CURRENT_NETWORK.rpcUrls;
  // 随机选择一个 RPC 节点，避免单点故障
  const randomRpc = rpcUrls[Math.floor(Math.random() * rpcUrls.length)];
  return new ethers.JsonRpcProvider(randomRpc);
};

const parseChainId = (value) => {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value !== 'string') return null;
  return value.toLowerCase().startsWith('0x')
    ? parseInt(value, 16)
    : parseInt(value, 10);
};

export function useWallet() {
  const [account, setAccount] = useState(null);
  const [chainId, setChainId] = useState(null);
  const [walletProvider, setWalletProvider] = useState(null);
  const [signer, setSigner] = useState(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState(null);

  // 默认只读 Provider（始终可用）
  const defaultProvider = useMemo(() => createDefaultProvider(), []);

  // Read calls should always use the configured target network.
  const provider = defaultProvider;

  // 断开连接
  const disconnect = useCallback(() => {
    setAccount(null);
    setChainId(null);
    setWalletProvider(null);
    setSigner(null);
  }, []);

  const refreshWalletState = useCallback(async () => {
    if (typeof window.ethereum === 'undefined') return;

    const [accounts, currentChainId] = await Promise.all([
      window.ethereum.request({ method: 'eth_accounts' }),
      window.ethereum.request({ method: 'eth_chainId' }),
    ]);

    setChainId(parseChainId(currentChainId));

    if (accounts.length > 0) {
      const browserProvider = new ethers.BrowserProvider(window.ethereum);
      const walletSigner = await browserProvider.getSigner();

      setAccount(accounts[0]);
      setWalletProvider(browserProvider);
      setSigner(walletSigner);
    } else {
      disconnect();
    }
  }, [disconnect]);

  const isCorrectNetwork = !account || chainId === EXPECTED_CHAIN_ID;

  // 检查钱包是否已连接
  const checkConnection = useCallback(async () => {
    if (typeof window.ethereum === 'undefined') return;

    try {
      await refreshWalletState();
    } catch (err) {
      console.error('Check connection error:', err);
    }
  }, [refreshWalletState]);

  // 连接钱包
  const connect = useCallback(async () => {
    if (typeof window.ethereum === 'undefined') {
      setError('请安装 MetaMask 钱包');
      return;
    }

    setIsConnecting(true);
    setError(null);

    try {
      const accounts = await window.ethereum.request({
        method: 'eth_requestAccounts',
      });

      const browserProvider = new ethers.BrowserProvider(window.ethereum);
      const walletSigner = await browserProvider.getSigner();
      const currentChainId = await window.ethereum.request({ method: 'eth_chainId' });

      setAccount(accounts[0]);
      setChainId(parseChainId(currentChainId));
      setWalletProvider(browserProvider);
      setSigner(walletSigner);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsConnecting(false);
    }
  }, []);

  // 切换网络
  const switchNetwork = useCallback(async () => {
    if (typeof window.ethereum === 'undefined') return;

    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: CURRENT_NETWORK.chainId }],
      });
      await refreshWalletState();
    } catch (switchError) {
      // 如果网络不存在，添加网络
      if (switchError.code === 4902) {
        try {
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [CURRENT_NETWORK],
          });
          await refreshWalletState();
        } catch (addError) {
          setError('添加网络失败');
        }
      } else {
        setError('切换网络失败');
      }
    }
  }, [refreshWalletState]);

  // 监听账户和网络变化
  useEffect(() => {
    if (typeof window.ethereum === 'undefined') return;

    const handleAccountsChanged = () => {
      refreshWalletState().catch((err) => console.error('Refresh wallet after account change error:', err));
    };

    const handleChainChanged = (chainId) => {
      setChainId(parseChainId(chainId));
      refreshWalletState().catch((err) => console.error('Refresh wallet after chain change error:', err));
    };

    const handleFocus = () => {
      refreshWalletState().catch((err) => console.error('Refresh wallet on focus error:', err));
    };

    window.ethereum.on('accountsChanged', handleAccountsChanged);
    window.ethereum.on('chainChanged', handleChainChanged);
    window.addEventListener('focus', handleFocus);

    checkConnection();

    return () => {
      window.ethereum.removeListener('accountsChanged', handleAccountsChanged);
      window.ethereum.removeListener('chainChanged', handleChainChanged);
      window.removeEventListener('focus', handleFocus);
    };
  }, [checkConnection, refreshWalletState]);

  return {
    account,
    chainId,
    provider,
    walletProvider,
    signer,
    isConnecting,
    isConnected: !!account,
    isCorrectNetwork,
    error,
    connect,
    disconnect,
    switchNetwork,
  };
}
