// app/layout.js
import './globals.css';
import { WalletProvider } from './components/WalletProvider';
import Nav from './components/Nav';
import ChatBot from './components/ChatBot';

export const metadata = {
  title: 'Migo — Send Money Anywhere',
  description: 'Cross-border P2P payments on the XRP Ledger',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Migo',
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className="h-full">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
        <meta name="theme-color" content="#F5F5F7" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body className="min-h-full bg-[#F5F5F7] text-[#1C1C1E] antialiased">
        <WalletProvider>
          <main className="pb-20">
            {children}
          </main>
          <Nav />
          <ChatBot />
        </WalletProvider>
      </body>
    </html>
  );
}
