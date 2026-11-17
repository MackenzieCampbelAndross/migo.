// app/components/Nav.js
'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const tabs = [
  {
    href: '/dashboard',
    label: 'Home',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
      </svg>
    )
  },
  {
    href: '/send',
    label: 'Send',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 19V5m0 0l-7 7m7-7l7 7" />
      </svg>
    )
  },
  {
    href: '/scan',
    label: 'Scan',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 8V6a2 2 0 012-2h2M4 16v2a2 2 0 002 2h2m8-16h2a2 2 0 012 2v2m-4 12h2a2 2 0 002-2v-2" />
      </svg>
    )
  },
  {
    href: '/request',
    label: 'Request',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14m0 0l-7-7m7 7l7-7" />
      </svg>
    )
  },
  {
    href: '/history',
    label: 'History',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    )
  },
];

export default function Nav() {
  const pathname = usePathname();

  // Hide nav on public auth screens and dashboard (dashboard has its own floating pill nav matching Figma)
  if (pathname === '/' || pathname === '/login' || pathname.startsWith('/auth') || pathname === '/dashboard') return null;

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 safe-bottom bg-[#FFFFFF]/90 backdrop-blur-xl border-t border-[#E5E5EA]">
      <div className="w-full flex justify-around items-center py-2 px-3">
        {tabs.map((tab) => {
          const active = pathname === tab.href;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              onClick={() => {
                if (tab.href === '/dashboard') {
                  window.dispatchEvent(new Event('migo:refresh-balance'));
                }
              }}
              className="flex flex-col items-center py-1 group transition-all"
            >
              <div className={`w-10 h-10 rounded-2xl flex items-center justify-center transition-all ${
                active ? 'bg-[#000000] text-white shadow-sm' : 'text-[#8E8E93] group-hover:text-[#1C1C1E]'
              }`}>
                {tab.icon}
              </div>
              <span className={`text-[11px] mt-1 font-medium tracking-tight ${
                active ? 'text-[#000000] font-semibold' : 'text-[#8E8E93]'
              }`}>
                {tab.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
