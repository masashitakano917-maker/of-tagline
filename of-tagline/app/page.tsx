"use client";

import React, { useMemo, useState } from "react";
import { Button } from "../components/ui/Button";

/* ========= helpers ========= */
const cn = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");
const jaLen = (s: string) => Array.from(s || "").length;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const parseWords = (src: string) =>
  src.split(/[ ,、\s\n/]+/).map((s) => s.trim()).filter(Boolean);

/** LCSベースの差分（挿入/変更部分を <mark> 赤表示） */
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
    else if (dp[i + 1][j] >= dp[i][j + 1]) { i++; } // 削除は赤にしない
    else { out.push(`<mark class="bg-red-50 text-red-600">${B[j++]}</mark>`); }
  }
  while (j < m) out.push(`<mark class="bg-red-50 text-red-600">${B[j++]}</mark>`);
  return out.join("");
}

type GitHubBlock = { ts: string; issueText: string; prDiff: string };

/* ========= page ========= */
export default function Page() {
  // 入力
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [mustInput, setMustInput] = useState("");
  const mustWords = useMemo(() => parseWords(mustInput), [mustInput]);

  // 文字数
  const [minChars, setMinChars] = useState(450);
  const [maxChars, setMaxChars] = useState(550);

  // 状態
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 出力①②③
  const [text1, setText1] = useState(""); // 初回生成
  const [text2, setText2] = useState(""); // チェック結果
  const [text3, setText3] = useState(""); // 要望反映

  // 差分表示（①→②、②→③）
  const [diff12Html, setDiff12Html] = useState("");
  const [diff23Html, setDiff23Html] = useState("");

  // チェック結果の内容
  const [issues2, setIssues2] = useState<string[]>([]);
  const [issues3, setIssues3] = useState<string[]>([]);
  const [summary2, setSummary2] = useState("");
  const [summary3, setSummary3] = useState("");

  // 追加要望
  const [requestNote, setRequestNote] = useState("");

  // GitHub出力履歴（“改善案”の下に積む）
  const [ghBlocks, setGhBlocks] = useState<GitHubBlock[]>([]);

  const validUrl = (s: string) => /^https?:\/\/\S+/i.test(s.trim());
  const currentText = text3 || text2 || text1;

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    // リセット（新しい流れを開始）
    setText1(""); setText2(""); setText3("");
    setDiff12Html(""); setDiff23Html("");
    setIssues2([]); setIssues3([]);
    setSummary2(""); setSummary3("");
    setGhBlocks([]);

    try {
      if (!name.trim()) throw new Error("物件名を入力してください。");
      if (!validUrl(url)) throw new Error("正しい物件URLを入力してください。");
      if (minChars > maxChars) throw new Error("最小文字数は最大文字数以下にしてください。");

      setBusy(true);
      const res = await fetch("/api/describe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, url, mustWords: mustInput, minChars, maxChars }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || "生成に失敗しました。");
      setText1(String(j?.text || ""));
    } catch (err: any) {
      setError(err?.message || "エラーが発生しました。");
    } finally {
      setBusy(false);
    }
  }

  async function handleCheck() {
    setError(null);
    setIssues2([]); setSummary2(""); setDiff12Html("");
    try {
      if (!text1.trim()) throw new Error("まず①の文章を生成してください。");

      setBusy(true);
      const res = await fetch("/api/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: text1,
          name, url, mustWords: mustInput,
          minChars, maxChars,
          request: "", // チェック時は空
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || "チェックに失敗しました。");

      const improved = String(j?.improved ?? text1);
      const issues = Array.isArray(j?.issues) ? j.issues : [];
      const summary = j?.summary || (issues.length ? issues.join(" / ") : "");

      setText2(improved);
      setIssues2(issues);
      setSummary2(summary);
      setDiff12Html(markDiffRed(text1, improved));
    } catch (err: any) {
      setError(err?.message || "エラーが発生しました。");
    } finally {
      setBusy(false);
    }
  }

  async function handleApplyRequest() {
    setError(null);
    setIssues3([]); setSummary3(""); setDiff23Html("");
    try {
      if (!text2.trim()) throw new Error("まず②のチェックを実行してください。");
      if (!requestNote.trim()) throw new Error("修正要望を入力してください。");

      setBusy(true);
      const res = await fetch("/api/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: `${text2}\n\n【追加要望】${requestNote}`,
          name, url, mustWords: mustInput,
          minChars, maxChars,
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || "要望反映に失敗しました。");

      const improved = String(j?.improved ?? text2);
      const issues = Array.isArray(j?.issues) ? j.issues : [];
      const summary = j?.summary || (issues.length ? issues.join(" / ") : "");

      setText3(improved);
      setIssues3(issues);
      setSummary3(summary);
      setDiff23Html(markDiffRed(text2, improved));

      // GitHub用カードを追加
      const oldSnip = text2.replace(/\s+/g, " ").slice(0, 160);
      const newSnip = improved.replace(/\s+/g, " ").slice(0, 160);
      const issueText = [
        "## タスク: 修正要望の反映",
        "### 要望",
        requestNote,
        "### 改善案サマリ",
        summary || "（改善案の要約）",
        `### 文字数: ${jaLen(improved)}（目標: ${minChars}〜${maxChars}）`,
        "### チェックリスト",
        "- [ ] 要望反映の本文を生成",
        "- [ ] 禁止語/表記ゆれ/誤字の最終チェック",
        `- [ ] 文字数レンジ(${minChars}〜${maxChars})内に調整`,
      ].join("\n\n");
      const prDiff = ["```diff", `- ${oldSnip}`, `+ ${newSnip}`, "```"].join("\n");
      setGhBlocks(prev => [{ ts: new Date().toLocaleString("ja-JP"), issueText, prDiff }, ...prev]);

      setRequestNote("");
    } catch (err: any) {
      setError(err?.message || "エラーが発生しました。");
    } finally {
      setBusy(false);
    }
  }

  function handleReset() {
    setName(""); setUrl(""); setMustInput("");
    setMinChars(450); setMaxChars(550);
    setText1(""); setText2(""); setText3("");
    setDiff12Html(""); setDiff23Html("");
    setIssues2([]); setIssues3([]);
    setSummary2(""); setSummary3("");
    setGhBlocks([]);
    setRequestNote("");
    setError(null);
  }

  const copy = async (text: string) => { try { await navigator.clipboard.writeText(text); } catch {} };

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900">
      <header className="sticky top-0 z-10 bg-white/80 backdrop-blur border-b">
        <div className="max-w-7xl mx-auto px-5 py-3 flex items-center justify-between">
          <div className="text-lg font-semibold">マンション説明文ジェネレーター（URL版・チェック付き）</div>
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
                <input className="border rounded-lg p-2" placeholder="例）パークタワー晴海"
                  value={name} onChange={(e) => setName(e.target.value)} />
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-sm font-medium">物件URL</span>
                <input className="border rounded-lg p-2" placeholder="例）https://www.rehouse.co.jp/buy/mansion/..."
                  value={url} onChange={(e) => setUrl(e.target.value)} />
                {!url || validUrl(url) ? null : <span className="text-xs text-red-600">URLの形式が正しくありません。</span>}
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-sm font-medium">マストワード</span>
                <textarea className="border rounded-lg p-2 min-h-[84px]"
                  placeholder="例）駅徒歩3分 ラウンジ ペット可 角部屋 など（空白/改行/カンマ区切り）"
                  value={mustInput} onChange={(e) => setMustInput(e.target.value)} />
                <span className="text-xs text-neutral-500">認識語数：{mustWords.length}</span>
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1">
                  <span className="text-sm font-medium">最小文字数（全角）</span>
                  <input type="number" className="border rounded-lg p-2" value={minChars} min={200} max={2000}
                    onChange={(e) => setMinChars(clamp(Number(e.target.value || 450), 200, 2000))} />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-sm font-medium">最大文字数（全角）</span>
                  <input type="number" className="border rounded-lg p-2" value={maxChars} min={200} max={2000}
                    onChange={(e) => setMaxChars(clamp(Number(e.target.value || 550), 200, 2000))} />
                </label>
                <div className="col-span-2 text-xs text-neutral-500">
                  推奨：450〜550　|　現在：{minChars}〜{maxChars}　|　最新本文長：{jaLen(currentText)} 文字
                </div>
              </div>

              <div className="flex gap-3">
                <Button type="submit" disabled={busy || !name || !url}>
                  {busy ? "生成中…" : "文章を生成（API）"}
                </Button>
                <Button type="button" color="orange" onClick={handleReset}>リセット</Button>
              </div>

              {error && <div className="text-sm text-red-600">{error}</div>}
            </div>
          </section>

          <section className="bg-white rounded-2xl shadow p-4 space-y-3">
            <div className="text-sm font-medium">チェック &amp; 改善</div>

            <div className="flex gap-3">
              <Button type="button" onClick={handleCheck} disabled={busy || !text1}>
                チェック
              </Button>
              <span className="text-xs text-neutral-500 self-center">
                依頼条件の遵守／不自然表現／誤字脱字を点検し、改善案を反映します（変更箇所は赤字）。
              </span>
            </div>

            {/* チェック結果（①→②の差分と要点） */}
            {(issues2.length > 0 || diff12Html) && (
              <div className="space-y-2">
                {issues2.length > 0 && (
                  <ul className="text-sm list-disc pl-5 space-y-1">{issues2.map((it, i) => <li key={i}>{it}</li>)}</ul>
                )}
                {!!summary2 && <div className="text-xs text-neutral-500">要約: {summary2}</div>}
                {!!diff12Html && (
                  <div className="border rounded-lg p-3 text-sm leading-relaxed"
                       dangerouslySetInnerHTML={{ __html: diff12Html }} />
                )}
              </div>
            )}

            <div className="grid gap-2">
              <label className="text-sm font-medium">追加の修正要望</label>
              <textarea className="border rounded-lg p-2 min-h-[72px]"
                placeholder="例）冒頭で物件名を自然に強調／交通の具体性を1文だけ入れてほしい など"
                value={requestNote} onChange={(e) => setRequestNote(e.target.value)} />
              <div>
                <Button type="button" onClick={handleApplyRequest}
                        disabled={busy || !text2 || !requestNote.trim()} color="orange">
                  要望を反映して再修正
                </Button>
              </div>
            </div>

            {/* 要望反映（②→③の差分と要点） */}
            {(issues3.length > 0 || diff23Html) && (
              <div className="space-y-2 pt-2">
                {issues3.length > 0 && (
                  <ul className="text-sm list-disc pl-5 space-y-1">{issues3.map((it, i) => <li key={i}>{it}</li>)}</ul>
                )}
                {!!summary3 && <div className="text-xs text-neutral-500">要約: {summary3}</div>}
                {!!diff23Html && (
                  <div className="border rounded-lg p-3 text-sm leading-relaxed"
                       dangerouslySetInnerHTML={{ __html: diff23Html }} />
                )}
            </div>)}

            {/* ▼ “改善案”の直下にGitHub用履歴カード */}
            {ghBlocks.length > 0 && (
              <section className="space-y-4 pt-3">
                {ghBlocks.map((b, i) => (
                  <div key={i} className="rounded-2xl border p-4 space-y-4">
                    <div className="text-xs text-neutral-500">{b.ts}</div>
                    <div className="space-y-2">
                      <h3 className="font-semibold">GitHub Issue 文面</h3>
                      <pre className="whitespace-pre-wrap text-sm bg-gray-50 rounded-xl p-3">{b.issueText}</pre>
                      <div className="flex gap-2"><Button onClick={() => copy(b.issueText)}>コピー</Button></div>
                    </div>
                    <div className="space-y-2">
                      <h3 className="font-semibold">PR 変更点（擬似diff）</h3>
                      <pre className="overflow-x-auto text-sm bg-gray-50 rounded-xl p-3">{b.prDiff}</pre>
                      <div className="flex gap-2"><Button color="orange" onClick={() => copy(b.prDiff)}>コピー</Button></div>
                    </div>
                  </div>
                ))}
              </section>
            )}
          </section>
        </form>

        {/* 右カラム：3つの出力 */}
        <section className="space-y-4">
          {/* 出力① */}
          <div className="bg-white rounded-2xl shadow min-h-[220px] flex flex-col overflow-hidden">
            <div className="p-4 border-b flex items-center justify-between">
              <div className="text-sm font-medium">出力① 初回生成</div>
              <div className="flex items-center gap-3">
                <div className="text-xs text-neutral-500">長さ：{jaLen(text1)} 文字</div>
                <Button onClick={() => copy(text1)} disabled={!text1}>コピー</Button>
              </div>
            </div>
            <div className="p-4 flex-1 overflow-auto">
              {text1 ? <p className="whitespace-pre-wrap leading-relaxed text-[15px]">{text1}</p>
                     : <div className="text-neutral-500 text-sm">— 未生成 —</div>}
            </div>
          </div>

          {/* 出力② */}
          <div className="bg-white rounded-2xl shadow min-h-[220px] flex flex-col overflow-hidden">
            <div className="p-4 border-b flex items-center justify-between">
              <div className="text-sm font-medium">出力② チェック結果</div>
              <div className="flex items-center gap-3">
                <div className="text-xs text-neutral-500">長さ：{jaLen(text2)} 文字</div>
                <Button onClick={() => copy(text2)} disabled={!text2}>コピー</Button>
              </div>
            </div>
            <div className="p-4 flex-1 overflow-auto">
              {text2 ? <p className="whitespace-pre-wrap leading-relaxed text-[15px]">{text2}</p>
                     : <div className="text-neutral-500 text-sm">— まだチェック未実行 —</div>}
            </div>
          </div>

          {/* 出力③ */}
          <div className="bg-white rounded-2xl shadow min-h-[220px] flex flex-col overflow-hidden">
            <div className="p-4 border-b flex items-center justify-between">
              <div className="text-sm font-medium">出力③ 要望反映結果</div>
              <div className="flex items-center gap-3">
                <div className="text-xs text-neutral-500">長さ：{jaLen(text3)} 文字</div>
                <Button onClick={() => copy(text3)} disabled={!text3}>コピー</Button>
              </div>
            </div>
            <div className="p-4 flex-1 overflow-auto">
              {text3 ? <p className="whitespace-pre-wrap leading-relaxed text-[15px]">{text3}</p>
                     : <div className="text-neutral-500 text-sm">— まだ要望未反映 —</div>}
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow p-4">
            <div className="text-xs text-neutral-500 leading-relaxed">
              ※ <code>/api/describe</code> が物件URLを解析して初回文（①）を生成。<code>/api/review</code> が条件順守をチェックし改善案を反映して（②）、追加要望を加味して（③）を返します。
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
