import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FiMenu, FiX, FiExternalLink, FiShield, FiGlobe } from 'react-icons/fi';
import { CURRENT_NETWORK, formatAddress, getExplorerAddressUrl } from '../utils/constants';
import { useLanguage } from '../contexts/LanguageContext';

function Logo({ onClick }) {
  return (
    <motion.div
      className="flex items-center gap-3 cursor-pointer group"
      whileHover={{ scale: 1.02 }}
      onClick={onClick}>
      <div className="relative">
        <img
          src="/cz-logo.png"
          alt="CZ"
          className="w-9 h-9 sm:w-11 sm:h-11 rounded-full shadow-lg shadow-[#FFB800]/30 group-hover:shadow-[#FFB800]/50 transition-shadow object-cover"
        />
        <div className="absolute inset-0 rounded-full bg-gradient-to-br from-[#FFB800] to-[#00D9A5] opacity-0 group-hover:opacity-20 blur-xl transition-opacity" />
      </div>

      <div className="hidden sm:block">
        <h1 className="text-xl font-bold">
          <span className="text-white">Crypto</span>
          <span className="text-[#FFB800]"> Zenith</span>
        </h1>
        <p className="text-xs text-white/50 tracking-wide">{useLanguage().t('header.tagline')}</p>
      </div>
    </motion.div>
  );
}

export default function Header({ account, isConnecting, isCorrectNetwork, onConnect, onSwitchNetwork, currentPage, onPageChange, isAdmin }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { language, toggleLanguage, t } = useLanguage();

  // 基础导航项
  const baseNavItems = [
    { id: 'home', label: t('header.home') },
    { id: 'token-mining', label: t('header.tokenMining') },
    { id: 'referral', label: t('header.referral') },
  ];

  // 只有管理员才能看到管理菜单
  const navItems = isAdmin
    ? [...baseNavItems,
       { id: 'admin', label: t('header.admin'), icon: <FiShield className="w-4 h-4" /> }
      ]
    : baseNavItems;

  return (
    <header className="fixed top-0 left-0 right-0 z-50">
      <div className="glass border-b border-white/5">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-14 md:h-20">
            {/* Logo */}
            <Logo onClick={() => onPageChange('home')} />

            {/* Desktop Navigation */}
            <nav className="hidden md:flex items-center gap-1">
              {navItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => onPageChange(item.id)}
                  className={`flex items-center gap-1.5 ${currentPage === item.id ? 'nav-link-active' : 'nav-link'}`}
                >
                  {item.icon}
                  {item.label}
                </button>
              ))}
              <a
                href="/whitepaper.pdf"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 nav-link"
              >
                {t('header.whitepaper')}
              </a>
              <a
                href="https://t.me/CZRSBNB"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 nav-link"
              >
                {t('header.telegram')}
              </a>
            </nav>

            {/* Wallet Connection */}
            <div className="flex items-center gap-3">
              {/* Language Toggle */}
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={toggleLanguage}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white/70 hover:text-white hover:bg-white/10 transition-colors"
                title={language === 'zh' ? 'Switch to English' : '切换到中文'}
              >
                <FiGlobe className="w-4 h-4" />
                <span className="text-sm font-medium">{language === 'zh' ? 'EN' : '中'}</span>
              </motion.button>

              {account ? (
                <div className="flex items-center gap-2">
                  {!isCorrectNetwork && (
                    <motion.button
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      onClick={onSwitchNetwork}
                      className="px-4 py-2 bg-[#FF6B6B]/20 border border-[#FF6B6B]/50 rounded-xl text-[#FF6B6B] text-sm font-medium hover:bg-[#FF6B6B]/30 transition-colors"
                    >
                      {t('header.switchNetwork')} {CURRENT_NETWORK.chainName}
                    </motion.button>
                  )}
                  <div className="hidden sm:flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#1A2332] border border-white/5">
                    <div className="w-2 h-2 rounded-full bg-[#00D9A5] animate-pulse" />
                    <span className="text-sm font-medium text-white/90">{formatAddress(account)}</span>
                    <a
                      href={getExplorerAddressUrl(account)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-white/40 hover:text-[#00D9A5] transition-colors"
                    >
                      <FiExternalLink size={14} />
                    </a>
                  </div>
                </div>
              ) : (
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={onConnect}
                  disabled={isConnecting}
                  className="btn-primary text-sm"
                >
                  {isConnecting ? t('header.connecting') : t('header.connectWallet')}
                </motion.button>
              )}

              {/* Mobile Menu Button */}
              <button
                className="md:hidden p-2 rounded-xl hover:bg-white/5 text-white/70 hover:text-white transition-colors"
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              >
                {mobileMenuOpen ? <FiX size={24} /> : <FiMenu size={24} />}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile Menu */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="md:hidden glass border-b border-white/5"
          >
            <nav className="px-4 py-4 space-y-1">
              {navItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => {
                    onPageChange(item.id);
                    setMobileMenuOpen(false);
                  }}
                  className={`w-full text-left flex items-center gap-2 ${currentPage === item.id ? 'nav-link-active' : 'nav-link'}`}
                >
                  {item.icon}
                  {item.label}
                </button>
              ))}
              <a
                href="/whitepaper.pdf"
                target="_blank"
                rel="noopener noreferrer"
                className="w-full text-left flex items-center gap-2 nav-link"
                onClick={() => setMobileMenuOpen(false)}
              >
                {t('header.whitepaper')}
              </a>
              <a
                href="https://t.me/CZRSBNB"
                target="_blank"
                rel="noopener noreferrer"
                className="w-full text-left flex items-center gap-2 nav-link"
                onClick={() => setMobileMenuOpen(false)}
              >
                {t('header.telegram')}
              </a>
              {account && (
                <div className="pt-3 mt-3 border-t border-white/5">
                  <div className="flex items-center gap-2 px-4 py-2">
                    <div className="w-2 h-2 rounded-full bg-[#00D9A5]" />
                    <span className="text-sm text-white/70">{formatAddress(account)}</span>
                  </div>
                </div>
              )}
            </nav>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
