import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "マンション説明文作成",
  description: "URLから抽出してマンションの説明文を作成するツール",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
