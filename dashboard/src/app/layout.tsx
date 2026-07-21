import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'BTC Grid Trading Bot - Live Terminal Dashboard',
  description: 'Dashboard en tiempo real para el Bot de Trading Algorítmico Adaptativo (BTC/USDT)',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <body className="min-h-screen bg-[#090D16] text-slate-100 antialiased p-4 space-y-4 max-w-[1600px] mx-auto">
        {children}
      </body>
    </html>
  );
}
