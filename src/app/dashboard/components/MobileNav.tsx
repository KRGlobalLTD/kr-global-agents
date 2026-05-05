'use client';

import { usePathname } from 'next/navigation';

const MOBILE_NAV = [
  { label: 'Dashboard', href: '/dashboard',       emoji: '🏠' },
  { label: 'Chat',      href: '/dashboard/chat',  emoji: '💬' },
  { label: 'Activité',  href: '/dashboard#activity', emoji: '⚡' },
  { label: 'Réglages',  href: '/dashboard/settings', emoji: '⚙️' },
];

export default function MobileNav() {
  const pathname = usePathname();

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 md:hidden flex items-center border-t"
      style={{
        background:   'rgba(10,10,10,0.95)',
        borderColor:  'rgba(255,255,255,0.07)',
        backdropFilter: 'blur(12px)',
        height:       '60px',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      {MOBILE_NAV.map(item => {
        const isActive = item.href === '/dashboard'
          ? pathname === '/dashboard'
          : pathname.startsWith(item.href.split('#')[0]) && item.href !== '/dashboard';

        return (
          <a
            key={item.href}
            href={item.href}
            className="flex-1 flex flex-col items-center justify-center gap-0.5 py-2 transition-colors"
            style={{
              color:          isActive ? '#7c3aed' : 'rgba(148,163,184,0.7)',
              textDecoration: 'none',
            }}
          >
            <span className="text-lg leading-none">{item.emoji}</span>
            <span
              className="text-[9px] font-medium leading-none tracking-wide"
              style={{ color: isActive ? '#7c3aed' : 'rgba(148,163,184,0.5)' }}
            >
              {item.label}
            </span>
            {isActive && (
              <span
                className="absolute bottom-0 w-8 h-0.5 rounded-full"
                style={{ background: '#7c3aed', marginBottom: 'env(safe-area-inset-bottom)' }}
              />
            )}
          </a>
        );
      })}
    </nav>
  );
}
