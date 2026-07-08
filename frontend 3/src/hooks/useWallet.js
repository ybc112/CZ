import { useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';
import { CURRENT_NETWORK, EXPECTED_CHAIN_ID } from '../utils/constants';

const createDefaultProvider = async () => {
  const proxyRpcUrl = typeof window !== 'undefined' && import.meta.env.PROD
    ? `${window.location.origin}/api/rpc`
    : null;
  const rpcUrls = proxyRpcUrl
    ? [proxyRpcUrl, ...CURRENT_NETWORK.rpcUrls]
    : CURRENT_NETWORK.rpcUrls;
  const errors = [];

  for (const url of rpcUrls) {
    try {
      const provider = new ethers.JsonRpcProvider(url);
      await provider.getNetwork();
      return provider;
    } catch (err) {
      errors.push(`${url}: ${err?.message || err}`);
    }
  }

  console.error('All RPC nodes failed:', errors);
  return new ethers.JsonRpcProvider(rpcUrls[0]);
};

const parseChainId = (value) => {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value !== 'string') return null;
  return value.toLowerCase().startsWith('0x')
    ? parseInt(value, 16)
    : parseInt(value, 10);
};

const getInjectedProvider = () => {
  if (typeof window === 'undefined' || typeof window.ethereum === 'undefined') return null;
  const { ethereum } = window;

  if (Array.isArray(ethereum.providers)) {
    return ethereum.providers.find((provider) => provider.isMetaMask) || ethereum.providers[0];
  }

  return ethereum;
};

export function useWallet() {
  const [account, setAccount] = useState(null);
  const [chainId, setChainId] = useState(null);
  const [walletProvider, setWalletProvider] = useState(null);
  const [signer, setSigner] = useState(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState(null);
  const [defaultProvider, setDefaultProvider] = useState(null);
  const [providerError, setProviderError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    createDefaultProvider()
      .then((provider) => {
        if (!cancelled) {
          setDefaultProvider(provider);
          setProviderError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.error('Failed to initialize default provider:', err);
          setProviderError('无法连接到 BSC 节点，请检查网络或稍后重试');
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const provider = walletProvider || defaultProvider;

  const disconnect = useCallback(() => {
    setAccount(null);
    setChainId(null);
    setWalletProvider(null);
    setSigner(null);
  }, []);

  const refreshWalletState = useCallback(async () => {
    const injectedProvider = getInjectedProvider();
    if (!injectedProvider) return;

    const [accounts, currentChainId] = await Promise.all([
      injectedProvider.request({ method: 'eth_accounts' }),
      injectedProvider.request({ method: 'eth_chainId' }),
    ]);

    setChainId(parseChainId(currentChainId));

    if (accounts.length > 0) {
      const browserProvider = new ethers.BrowserProvider(injectedProvider);
      const walletSigner = await browserProvider.getSigner();

      setAccount(accounts[0]);
      setWalletProvider(browserProvider);
      setSigner(walletSigner);
    } else {
      disconnect();
    }
  }, [disconnect]);

  const isCorrectNetwork = !account || chainId === EXPECTED_CHAIN_ID;

  const checkConnection = useCallback(async () => {
    if (!getInjectedProvider()) return;

    try {
      await refreshWalletState();
    } catch (err) {
      console.error('Check connection error:', err);
    }
  }, [refreshWalletState]);

  const connect = useCallback(async () => {
    const injectedProvider = getInjectedProvider();
    if (!injectedProvider) {
      setError('请安装 MetaMask 钱包');
      return;
    }

    setIsConnecting(true);
    setError(null);

    try {
      const accounts = await injectedProvider.request({
        method: 'eth_requestAccounts',
      });

      const browserProvider = new ethers.BrowserProvider(injectedProvider);
      const walletSigner = await browserProvider.getSigner();
      const currentChainId = await injectedProvider.request({ method: 'eth_chainId' });

      setAccount(accounts[0]);
      setChainId(parseChainId(currentChainId));
      setWalletProvider(browserProvider);
      setSigner(walletSigner);
    } catch (err) {
      if (err?.code === -32002) {
        setError('MetaMask 已有连接请求，请打开钱包确认');
      } else if (err?.code === 4001) {
        setError('您取消了钱包连接');
      } else {
        setError(err?.message || '连接钱包失败');
      }
    } finally {
      setIsConnecting(false);
    }
  }, []);

  const switchNetwork = useCallback(async () => {
    const injectedProvider = getInjectedProvider();
    if (!injectedProvider) {
      setError('请安装 MetaMask 钱包');
      return;
    }

    try {
      await injectedProvider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: CURRENT_NETWORK.chainId }],
      });
      await refreshWalletState();
    } catch (switchError) {
      if (switchError.code === 4902) {
        try {
          await injectedProvider.request({
            method: 'wallet_addEthereumChain',
            params: [CURRENT_NETWORK],
          });
          await refreshWalletState();
        } catch {
          setError('添加网络失败');
        }
      } else {
        setError('切换网络失败');
      }
    }
  }, [refreshWalletState]);

  useEffect(() => {
    const injectedProvider = getInjectedProvider();
    if (!injectedProvider) return;

    const handleAccountsChanged = () => {
      refreshWalletState().catch((err) => console.error('Refresh wallet after account change error:', err));
    };

    const handleChainChanged = (nextChainId) => {
      setChainId(parseChainId(nextChainId));
      refreshWalletState().catch((err) => console.error('Refresh wallet after chain change error:', err));
    };

    const handleFocus = () => {
      refreshWalletState().catch((err) => console.error('Refresh wallet on focus error:', err));
    };

    injectedProvider.on?.('accountsChanged', handleAccountsChanged);
    injectedProvider.on?.('chainChanged', handleChainChanged);
    window.addEventListener('focus', handleFocus);

    checkConnection();

    return () => {
      injectedProvider.removeListener?.('accountsChanged', handleAccountsChanged);
      injectedProvider.removeListener?.('chainChanged', handleChainChanged);
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
    error: error || providerError,
    connect,
    disconnect,
    switchNetwork,
  };
}
