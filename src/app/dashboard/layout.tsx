import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Mission Control — KR Global',
  description: 'Dashboard temps réel KR Global Solutions Ltd',
};

const NAV_ITEMS = [
  { label: 'Vue globale',  href: '/dashboard',             emoji: '🏠' },
  { label: 'Agents',       href: '/dashboard#agents',       emoji: '🤖' },
  { label: 'Activité',     href: '/dashboard#activity',     emoji: '⚡' },
  { label: 'Mémoire',      href: '/dashboard#qdrant',       emoji: '🧠' },
  { label: 'Workflows',    href: '/dashboard#n8n',          emoji: '🔁' },
];

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen" style={{ background: '#0a0a0a', fontFamily: 'var(--font-geist-sans, Inter, sans-serif)' }}>
      {/* Sidebar */}
      <aside
        className="hidden md:flex flex-col w-56 flex-shrink-0 sticky top-0 h-screen border-r"
        style={{ borderColor: 'rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.02)' }}
      >
        {/* Logo */}
        <div className="px-4 py-5 border-b" style={{ borderColor: 'rgba(255,255,255,0.07)' }}>
          <div className="flex items-center gap-2.5">
            <span
              className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-black text-white flex-shrink-0"
              style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)' }}
            >
              KR
            </span>
            <div className="leading-tight">
              <p className="text-[11px] font-bold text-white">KR Global</p>
              <p className="text-[9px] text-slate-500 uppercase tracking-widest">Mission Control</p>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-2 py-4 flex flex-col gap-0.5">
          {NAV_ITEMS.map(item => (
            <a
              key={item.href}
              href={item.href}
              className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-slate-400 hover:text-white transition-colors text-xs font-medium"
              style={{ textDecoration: 'none' }}
            >
              <span className="text-sm">{item.emoji}</span>
              {item.label}
            </a>
          ))}
        </nav>

        {/* Footer */}
        <div className="px-4 py-4 border-t" style={{ borderColor: 'rgba(255,255,255,0.07)' }}>
          <p className="text-[10px] text-slate-600 leading-relaxed">
            KR Global Solutions Ltd<br />Londres, UK 🇬🇧
          </p>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 min-w-0 overflow-auto">
        {children}
      </main>
    </div>
  );
}
