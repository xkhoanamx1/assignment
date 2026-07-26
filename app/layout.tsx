import './globals.css';

export const metadata = {
  title: 'Logistics Gemini Demo',
  description: 'AI-powered logistics analytics demo'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
