"use client";

import React, { useMemo, useState } from "react";

/* ========= helpers ========= */
const cn = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");
const jaLen = (s: string) => Array.from(s || "").length;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const parseWords = (src: string) =>
  src.split(/[ ,、\s\n/]+/).map((s) => s.trim()).filter(Boolean);

/** LCSベースの差分（改善文中の“挿入/変更された部分”を <mark> で赤表示） */
function markDiffRed(original: string, improved: string) {
  const A = Array.from(original);
  const B = Array.from(improved);
  const n = A.length, m = B.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
    dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);

  const out: string[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { out.push(B[j]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { /* 削除：赤表示しない */ i++; }
    else {
      // 挿入を赤表示
      out.push(`<mark class="bg-red-50 text-red-600">${B[j]}</mark>`);
      j++;
    }
  }
  while (j < m) { out.push(`<mark class="bg-red-50 text-red-600">${B[j++]}</mark>`); }
  return out.join("");
}

/* ========= page component ========= */
export default function Page() {
  // 入力
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [mustInput, setMustInput] = useState("");
  const mustWords = useMemo(() => parseWords(mustInput), [mustInput]);

  // トーン
  const tones = ["プロフェッショナル", "フレンドリー", "ニュートラル"] as const;
  type Tone = typeof tones[number];
  const [tone, setTone] = useState<Tone>("プロフェッショナル");

  // 文字数
  const [minChars, setMinChars] = useState(450);
  const [maxChars, setMaxChars] = useState(550);

  // 出力＆状態
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");             // 生成結果
  const [reviewIssues, setReviewIssues] = useState<string[]>([]);
  const [reviewHtml, setReviewHtml] = useState<string>(""); // 赤字差分HTML
  const [requestNote, setRequestNote] = useState("");       // 追加要望

  const validUrl = (s: string) => /^https?:\/\/\S+/i.test(s.trim());

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setText("");
    setReviewIssues([]);
    setReviewHtml("");

    try {
      if (!name.trim()) throw new Error("物件名を入力してください。");
      if (!validUrl(url)) throw new Error("正しい物件URLを入力してください。");
      if (minChars > maxChars) throw new Error("最小文字数は最大文字数以下にしてください。");

      setBusy(true);
      const res = await fetch("/api/describe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          url,
          mustWords: mustInput,
          tone,
          minChars,
          maxChars,
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || "生成に失敗しました。");

      setText(String(j?.text || ""));
    } catch (err: any) {
      setError(err?.message || "エラーが発生しました。");
    } finally {
      setBusy(false);
    }
  }

  async function handleAutoReview() {
    setError(null);
    setReviewIssues([]);
    setReviewHtml("");
    try {
      if (!text.trim()) throw new Error("まず文章を生成してください。");

      setBusy(true);
      const res = await fetch("/api/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          name,
          url,
          mustWords: mustInput,
          tone,
          minChars,
          maxChars,
          request: "", // ここは空。次の「要望反映」で使う。
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || "自動チェックに失敗しました。");

      const improved = String(j?.improved ?? text);
      const issues = Array.isArray(j?.issues) ? j.issues : [];
      setReviewIssues(issues);

      // 差分を赤で表示
      setReviewHtml(markDiffRed(text, improved));
      setText(improved); // 画面上の本文も最新に
    } catch (err: any) {
      setError(err?.message || "エラーが発生しました。");
    } finally {
      setBusy(false);
    }
  }

  async function handleApplyRequest() {
    setError(null);
    try {
      if (!text.trim()) throw new Error("まず文章を生成してください。");
      if (!requestNote.trim()) throw new Error("修正要望を入力してください。");

      setBusy(true);
      const res = await fetch("/api/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: `${text}\n\n【追加要望】${requestNote}`,
          name,
          url,
          mustWords: mustInput,
          tone,
          minChars,
          maxChars,
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || "修正反映に失敗しました。");

      const improved = String(j?.improved ?? text);
      setReviewHtml(markDiffRed(text, improved));
      setText(improved);
      setReviewIssues(Array.isArray(j?.issues) ? j.issues : []);
      setRequestNote("");
    } catch (err: any) {
      setError(err?.message || "エラーが発生しました。");
    } finally {
      setBusy(false);
    }
  }

  function handleReset() {
    setName("");
    setUrl("");
    setMustInput("");
    setTone("プロフェッショナル");
    setMinChars(450);
    setMaxChars(550);
    setText("");
    setReviewIssues([]);
    setReviewHtml("");
    setRequestNote("");
    setError(null);
  }

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900">
      <header className="sticky top-0 z-10 bg-white/80 backdrop-blur border-b">
        <div className="max-w-7xl mx-auto px-5 py-3 flex items-center justify-between">
          <div className="text-lg font-semibold">マンション説明文ジェネレーター（URL版・自動チェック付）</div>
          <div className="text-xs text-neutral-500">Demo / Frontend with API</div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-5 py-6 grid lg:grid-cols-[minmax(360px,500px)_1fr] gap-6">
        {/* 左カラム：入力 */}
        <form onSubmit={handleGenerate} className="space-y-4">
          <section className="bg-white rounded-2xl shadow p-4 space-y-3">
            <div className="grid gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-sm font-medium">物件名</span>
                <input
                  className="border rounded-lg p-2"
                  placeholder="例）パークタワー晴海"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-sm font-medium">物件URL</span>
                <input
                  className="border rounded-lg p-2"
                  placeholder="例）https://www.rehouse.co.jp/buy/mansion/..."
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                />
                {!url || validUrl(url) ? null : (
                  <span className="text-xs text-red-600">URLの形式が正しくありません。</span>
                )}
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-sm font-medium">マストワード</span>
                <textarea
                  className="border rounded-lg p-2 min-h-[84px]"
                  placeholder="例）駅徒歩3分 ラウンジ ペット可 角部屋 など（空白/改行/カンマ区切り）"
                  value={mustInput}
                  onChange={(e) => setMustInput(e.target.value)}
                />
                <span className="text-xs text-neutral-500">
                  認識語数：{mustWords.length}
                </span>
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1">
                  <span className="text-sm font-medium">トーン</span>
                  <select className="border rounded-lg p-2" value={tone} onChange={(e) => setTone(e.target.value as any)}>
                    {tones.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </label>

                <div className="grid grid-cols-2 gap-3">
                  <label className="flex flex-col gap-1">
                    <span className="text-sm font-medium">最小文字数（全角）</span>
                    <input
                      type="number"
                      className="border rounded-lg p-2"
                      value={minChars}
                      min={200}
                      max={2000}
                      onChange={(e) => setMinChars(clamp(Number(e.target.value || 450), 200, 2000))}
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-sm font-medium">最大文字数（全角）</span>
                    <input
                      type="number"
                      className="border rounded-lg p-2"
                      value={maxChars}
                      min={200}
                      max={2000}
                      onChange={(e) => setMaxChars(clamp(Number(e.target.value || 550), 200, 2000))}
                    />
                  </label>
                </div>
                <div className="col-span-2 text-xs text-neutral-500">
                  例：450〜550を推奨。現在：{minChars}〜{maxChars}（本文長：{jaLen(text)}）
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  type="submit"
                  disabled={busy || !name || !url}
                  className={cn(
                    "px-4 py-2 rounded-xl text-white",
                    busy ? "bg-neutral-400" : "bg-black hover:bg-neutral-800"
                  )}
                >
                  {busy ? "生成中…" : "文章を生成（API）"}
                </button>
                <button type="button" className="px-4 py-2 rounded-xl border" onClick={handleReset}>
                  リセット
                </button>
              </div>

              {error && <div className="text-sm text-red-600">{error}</div>}
            </div>
          </section>

          <section className="bg-white rounded-2xl shadow p-4 space-y-3">
            <div className="text-sm font-medium">自動チェック &amp; 改善</div>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={handleAutoReview}
                disabled={busy || !text}
                className={cn("px-3 py-2 rounded-xl text-white", busy ? "bg-neutral-400" : "bg-indigo-600 hover:bg-indigo-700")}
              >
                自動チェック
              </button>
              <span className="text-xs text-neutral-500 self-center">
                依頼条件の遵守／不自然表現／誤字脱字を点検し、改善案を反映します（変更箇所は赤字）。
              </span>
            </div>

            {reviewIssues.length > 0 && (
              <ul className="text-sm list-disc pl-5 space-y-1">
                {reviewIssues.map((it, i) => <li key={i}>{it}</li>)}
              </ul>
            )}

            {!!reviewHtml && (
              <div className="border rounded-lg p-3 text-sm leading-relaxed" dangerouslySetInnerHTML={{ __html: reviewHtml }} />
            )}

            <div className="grid gap-2">
              <label className="text-sm font-medium">追加の修正要望</label>
              <textarea
                className="border rounded-lg p-2 min-h-[72px]"
                placeholder="例）冒頭で物件名を自然に強調／交通の具体性を1文だけ入れてほしい／トーンは少しフレンドリー寄りに など"
                value={requestNote}
                onChange={(e) => setRequestNote(e.target.value)}
              />
              <div>
                <button
                  type="button"
                  onClick={handleApplyRequest}
                  disabled={busy || !text || !requestNote.trim()}
                  className={cn("px-3 py-2 rounded-xl text-white", busy ? "bg-neutral-400" : "bg-emerald-600 hover:bg-emerald-700")}
                >
                  要望を反映して再修正
                </button>
              </div>
            </div>
          </section>
        </form>

        {/* 右カラム：生成結果 */}
        <section className="space-y-4">
          <div className="bg-white rounded-2xl shadow h-[72vh] min-h-[560px] flex flex-col overflow-hidden">
            <div className="p-4 border-b flex items-center justify-between">
              <div className="text-sm font-medium">生成結果</div>
              <div className="text-xs text-neutral-500">長さ：{jaLen(text)} 文字</div>
            </div>
            <div className="p-4 flex-1 overflow-auto">
              {text ? (
                <p className="whitespace-pre-wrap leading-relaxed text-[15px]">{text}</p>
              ) : (
                <div className="text-neutral-500 text-sm">— 未生成 —</div>
              )}
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow p-4">
            <div className="text-xs text-neutral-500 leading-relaxed">
              ※ 本番では <code>/api/describe</code> が物件URLを取得・解析し、<code>/api/review</code> が条件順守を自動チェックして改善案を返します。禁止語／交通記述／会社情報などの制約はサーバ側プロンプトに反映済み。
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
