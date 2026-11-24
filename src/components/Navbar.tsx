'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { LogOut, Menu, Volume2, VolumeX, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { isSfxEnabled, playSfx, setSfxEnabled } from '@/lib/sfx';
import { loadLocal, saveLocal, STORAGE_KEYS, useApp } from '@/lib/client/store';
import { SPRING } from '@/lib/motion';

const TABS = [
  { href: '/', label: 'Explore' },
  { href: '/studio', label: 'Studio' },
  { href: '/playground', label: 'Playground' },
  { href: '/library', label: 'Library' },
  { href: '/pricing', label: 'Pricing' },
];

export default function Navbar() {
  const pathname = usePathname();
  const { credits, config, session, setAuthOpen, signOut } = useApp();
  const [sfxOn, setSfxOn] = useState(true);
  const [scrolled, setScrolled] = useState(false);
  const [menu, setMenu] = useState(false);

  useEffect(() => {
    const on = loadLocal<boolean>(STORAGE_KEYS.sfx, true);
    setSfxEnabled(on);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync with persisted preference once
    setSfxOn(on);
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    document.body.style.overflow = menu ? 'hidden' : '';
  }, [menu]);

  const toggleSfx = () => {
    const next = !isSfxEnabled();
    setSfxEnabled(next);
    setSfxOn(next);
    saveLocal(STORAGE_KEYS.sfx, next);
    if (next) playSfx('select');
  };

  const billingOn = config?.billing === 'credits';
  const creditLabel = credits === null ? (billingOn ? null : '—') : `${credits.toLocaleString()} CR`;

  return (
    <>
      <header className={`nav${scrolled || pathname !== '/' ? ' scrolled' : ''}`}>
        <Link href="/" className="brand" onClick={() => playSfx('tap')} aria-label="KINETIX home">
          <span className="brand-dot" aria-hidden="true" />
          KINETIX
        </Link>

        <nav className="nav-links" aria-label="Main">
          {TABS.map((tab) => {
            const active = tab.href === '/' ? pathname === '/' : pathname.startsWith(tab.href);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                onClick={() => playSfx('tap')}
                className={`nav-link${active ? ' active' : ''}`}
                aria-current={active ? 'page' : undefined}
              >
                {active && <motion.span layoutId="nav-pill" className="nav-pill" transition={SPRING} />}
                <span style={{ position: 'relative' }}>{tab.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="nav-right">
          <button type="button" className="icon-btn hide-sm" onClick={toggleSfx} aria-label={sfxOn ? 'Mute interface sounds' : 'Turn on interface sounds'}>
            {sfxOn ? <Volume2 size={16} /> : <VolumeX size={16} />}
          </button>
          {creditLabel && (
            <Link href="/pricing" className="credit-pill mono" title={billingOn ? 'Your credits' : 'Demo credits (stored in this browser)'}>
              <i aria-hidden="true" />
              {creditLabel}
            </Link>
          )}
          {billingOn &&
            (session ? (
              <button type="button" className="icon-btn hide-sm" onClick={() => void signOut()} aria-label="Sign out" title={session.user.email ?? 'Sign out'}>
                <LogOut size={16} />
              </button>
            ) : (
              <button type="button" className="btn btn-glass btn-sm hide-sm" onClick={() => setAuthOpen(true)}>
                Sign in
              </button>
            ))}
          <button type="button" className="icon-btn nav-burger" onClick={() => setMenu(true)} aria-label="Open menu">
            <Menu size={20} />
          </button>
        </div>
      </header>

      <AnimatePresence>
        {menu && (
          <motion.div
            className="mobile-menu"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            role="dialog"
            aria-modal="true"
            aria-label="Menu"
          >
            <button type="button" className="icon-btn" style={{ position: 'absolute', top: 14, right: 16 }} onClick={() => setMenu(false)} aria-label="Close menu">
              <X size={22} />
            </button>
            {TABS.map((tab, i) => {
              const active = tab.href === '/' ? pathname === '/' : pathname.startsWith(tab.href);
              return (
                <motion.div key={tab.href} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ ...SPRING, delay: 0.03 * i }}>
                  <Link href={tab.href} className={active ? 'active' : ''} onClick={() => setMenu(false)}>
                    {tab.label}
                  </Link>
                </motion.div>
              );
            })}
            <div className="mobile-menu-foot">
              <button type="button" className="btn btn-glass btn-sm" onClick={toggleSfx}>
                {sfxOn ? <Volume2 size={15} /> : <VolumeX size={15} />} Sounds {sfxOn ? 'on' : 'off'}
              </button>
              {billingOn &&
                (session ? (
                  <button type="button" className="btn btn-glass btn-sm" onClick={() => { void signOut(); setMenu(false); }}>
                    Sign out
                  </button>
                ) : (
                  <button type="button" className="btn btn-lime btn-sm" onClick={() => { setMenu(false); setAuthOpen(true); }}>
                    Sign in
                  </button>
                ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
