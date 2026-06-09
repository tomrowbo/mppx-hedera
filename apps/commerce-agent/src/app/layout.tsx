import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Hedera Commerce Agent',
  description: 'AI agent that pays for APIs using MPP on Hedera',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&family=JetBrains+Mono:wght@400&display=swap" rel="stylesheet" />
      </head>
      <body className="font-sans bg-white text-black antialiased">{children}</body>
    </html>
  );
}
