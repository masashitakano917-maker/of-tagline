export const metadata = {
  title: "マンション販促コピー・テスト",
  description: "外観＋間取りからキャッチコピー生成デモ",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
