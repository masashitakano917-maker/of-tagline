import React, { useMemo, useState } from "react";

/* ========== helpers ========== */
const cn = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");
const tones = ["ラグジュアリー", "ファミリー向け", "アクティブ", "落ち着き・静穏", "投資家向け", "スタンダード"] as const;
type Tone = typeof tones[number];

const adjectivesByTone: Record<string, string[]> = {
  "ラグジュアリー": ["上質", "洗練", "優雅", "都会的", "静謐", "重厚"],
  "ファミリー向け": ["安心", "のびのび", "あたたかい", "快適", "便利", "暮らしやすい"],
  "アクティブ": ["軽快", "伸びやか", "爽やか", "開放", "ダイナミック"],
  "落ち着き・静穏": ["静穏", "やすらぎ", "落ち着き", "穏やか", "しっとり"],
  "投資家向け": ["堅実", "安定", "戦略的", "効率", "価値"],
  "スタンダード": ["心地よい", "住みやすい", "快適", "毎日に寄り添う"],
};

function limitChars(s: string, max: number) {
  if (!s) return s;
  const arr = Array.from(s);
  return arr.length <= max ? s : arr.slice(0, Math.max(0, max - 1)).join("") + "…";
}
function ensureMustWords(base: string, mustWords: string[]) {
  const miss = mustWords.filter((w) => w && !base.includes(w));
  return miss.length ? `${base}｜${miss.join("・")}` : base;
}
const includesAll = (s: string, words: string[]) => words.every((w) => w && s.includes(w));

/** 画像を送信前に縮小＆JPEG圧縮（最大辺1600px, quality=0.82） */
async function toDataUrlCompressed(file: File, maxDim = 1600, quality = 0.82): Promise<string> {
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const url = URL.createObjectURL(file);
    const i = new Image();
    i.onload = () => { URL.revokeObjectURL(url); res(i); };
    i.onerror = rej;
    i.src = url;
  });
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", quality);
}

/* ========== demo synthesis ========== */
function synthesizeOne({ tone, target, mustWords, charLimit }: { tone: Tone; target: string; mustWords: string[]; charLimit: number; }) {
  const adjs = adjectivesByTone[tone] || adjectivesByTone["スタンダード"];
  const pick = (n: number) => [...adjs].sort(() => Math.random() - 0.5).slice(0, n);
  const basePhrases: ((a: string[]) => string)[] = [
    (a) => `${a[0]}な暮らし、${a[1]}な邸宅。`,
    (a) => `${a[0]}×${a[1]}、${a[2]}が満ちる住まい。`,
    (a) => `${a[0]}と${a[1]}を纏う、日常が特別になる。`,
    (a) => `${a[0]}に満ちた舞台、${a[1]}が息づく街並み。`,
    (a) => `${a[0]}の静けさ、${a[1]}の快適。`,
    (a) => `${a[0]}で暮らす、${a[1]}な毎日。`,
  ];
  const a = pick(3);
  const f = basePhrases[Math.floor(Math.random() * basePhrases.length)];
  let s = f(a);
  if (target) s = `${target}に寄り添う、` + s;
  s = ensureMustWords(s, mustWords);
  return limitChars(s, charLimit);
}
function synthesizeCandidates({ tone, target, mustWords, charLimit, count }: { tone: Tone; target: string; mustWords: string[]; charLimit: number; count: number; }) {
  const out: string[] = []; const seen = new Set<string>(); let guard = 0;
  while (out.length < count && guard < count * 12) {
    const s = synthesizeOne({ tone, target, mustWords, charLimit });
    if (!seen.has(s)) { seen.add(s); out.push(s); }
    guard++;
  }
  return out;
}
function synthesizeStrict({ tone, target, mustWords, charLimit, count }: { tone: Tone; target: string; mustWords: string[]; charLimit: number; count: number; }) {
  const out: string[] = []; let guard = 0;
  while (out.length < count && guard < count * 30) {
    let base = synthesizeOne({ tone, target, mustWords: [], charLimit: Math.max(8, charLimit - 2) });
    const mustJoin = mustWords.join("・");
    let candidate = `${mustJoin}、${base}`;
    if (Array.from(candidate).length > charLimit) candidate = `${mustJoin}`;
    candidate = limitChars(candidate, charLimit);
    if (includesAll(candidate, mustWords) && !out.includes(candidate)) out.push(candidate);
    guard++;
  }
  while (out.length < count) {
    const mustJoin = limitChars(mustWords.join("・"), charLimit);
    if (!out.includes(mustJoin)) out.push(mustJoin); else break;
  }
  return out.slice(0, count);
}

/* ========== component ========== */
function useObjectUrl(file: File | null) {
  return useMemo(() => (file ? URL.createObjectURL(file) : ""), [file]);
}

export default function App() {
  const [photo, setPhoto] = useState<File | null>(null);
  const [plan, setPlan] = useState<File | null>(null);
  const [mustWordsInput, setMustWordsInput] = useState("");
  const [tone, setTone] = useState<Tone>("ラグジュアリー");
  const [charLimit, setCharLimit] = useState(50);
  const [target, setTarget] = useState("ファミリー");
  const [mode, setMode] = useState<"mock" | "api">("mock");
  const [apiUrl, setApiUrl] = useState("/api/tagline");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [count, setCount] = useState(10);
  const [strictCount, setStrictCount] = useState(5);
  const [strictList, setStrictList] = useState<string[]>([]);
  const [freeList, setFreeList] = useState<string[]>([]);

  const photoUrl = useObjectUrl(photo);
  const planUrl = useObjectUrl(plan);
  const mustWords = useMemo(
    () => mustWordsInput.split(/[ ,、\s\n\/]+/).map((s) => s.trim()).filter(Boolean),
    [mustWordsInput]
  );

  const onDrop = (e: React.DragEvent<HTMLDivElement>, which: "photo" | "plan") => {
    e.preventDefault(); e.stopPropagation();
    const f = e.dataTransfer.files?.[0];
    if (f && f.type.startsWith("image/")) which === "photo" ? setPhoto(f) : setPlan(f);
  };

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    setErr(null); setStrictList([]); setFreeList([]);

    if (!photo) { setErr("外観写真は必須です"); return; }
    const freeCount = Math.max(0, count - strictCount);
    setBusy(true);
    try {
      if (mode === "mock") {
        const strict = synthesizeStrict({ tone, target, mustWords, charLimit, count: strictCount });
        const free   = synthesizeCandidates({ tone, target, mustWords, charLimit, count: freeCount });
        setStrictList(strict); setFreeList(free);
      } else {
        // 送信前に圧縮
        const payload: any = {
          photoDataUrl: photo ? await toDataUrlCompressed(photo) : null,
          planDataUrl:  plan  ? await toDataUrlCompressed(plan)  : null,
          mustWords: mustWordsInput,
          tone, charLimit, target,
          candidates: count, strictCount,
        };

        const resp = await fetch(apiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        const ct = resp.headers.get("content-type") || "";
        if (!ct.includes("application/json")) {
          const text = await resp.text();
          throw new Error(text.slice(0, 200));
        }
        const j = await resp.json();
        if (!resp.ok) throw new Error(j?.error || "API error");

        let sList: string[] | undefined = Array.isArray(j?.strict) ? j.strict : undefined;
        let fList: string[] | undefined = Array.isArray(j?.free)   ? j.free   : undefined;

        if (!sList || !fList) {
          const cand: string[] = Array.isArray(j?.candidates) ? j.candidates : [];
          const top: string[] = [], rest: string[] = [];
          cand.forEach((c) => (includesAll(c, mustWords) && top.length < strictCount ? top : rest).push(c));
          if (top.length < strictCount) top.push(...synthesizeStrict({ tone, target, mustWords, charLimit, count: strictCount - top.length }));
          const needRest = Math.max(0, count - top.length);
          if (rest.length < needRest) rest.push(...synthesizeCandidates({ tone, target, mustWords, charLimit, count: needRest - rest.length }));
          sList = Array.from(new Set(top)).slice(0, strictCount);
          fList = Array.from(new Set(rest)).slice(0, Math.max(0, count - strictCount));
        }
        setStrictList(sList!); setFreeList(fList!);
      }
    } catch (e: any) {
      setErr(e?.message || "failed");
    } finally {
      setBusy(false);
    }
  }

  const copy = async (txt: string) => { try { await navigator.clipboard.writeText(txt); alert("コピーしました"); } catch {} };
  const copyAll = async () => { try { await navigator.clipboard.writeText([...strictList, ...freeList].join("\n")); alert("全候補をコピーしました"); } catch {} };

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900">
      <header className="sticky top-0 z-10 backdrop-blur bg-neutral-50/70 border-b">
        <div className="max-w-7xl mx-auto px-5 py-3 flex items-center justify-between">
          <div className="text-lg font-semibold">マンション販売コピー・プレビュー</div>
          <div className="text-xs text-neutral-500">{mode === "api" ? "Demo / Frontend with API" : "Demo / Frontend only"}</div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-5 py-6 grid lg:grid-cols-[minmax(360px,520px)_1fr] gap-6 items-start">
        {/* Left */}
        <form onSubmit={handleGenerate} className="space-y-4 sticky top-[64px]">
          <section className="bg-white rounded-2xl shadow p-4 space-y-3">
            <div className="text-sm font-medium">画像アップロード</div>
            <div className="grid grid-cols-1 gap-3">
              <div onDrop={(e) => onDrop(e, "photo")} onDragOver={(e) => e.preventDefault()} className={cn("border-2 border-dashed rounded-xl p-3 min-h-[180px] flex flex-col items-center justify-center gap-2", photo ? "border-neutral-200" : "border-neutral-300 hover:border-neutral-400")}>
                <div className="text-xs text-neutral-500">外観（必須）</div>
                {photoUrl ? <img src={photoUrl} alt="exterior" className="w-full h-48 object-cover rounded-lg" /> : (<>
                  <div className="text-sm">ここにドラッグ＆ドロップ</div>
                  <div className="text-xs text-neutral-500">または</div>
                  <label className="text-xs px-2 py-1 rounded-lg bg-neutral-900 text-white cursor-pointer">ファイルを選択
                    <input type="file" accept="image/*" className="hidden" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
                  </label>
                </>)}
              </div>
              <div onDrop={(e) => onDrop(e, "plan")} onDragOver={(e) => e.preventDefault()} className={cn("border-2 border-dashed rounded-xl p-3 min-h-[140px] flex flex-col items-center justify-center gap-2", plan ? "border-neutral-200" : "border-neutral-300 hover:border-neutral-400")}>
                <div className="text-xs text-neutral-500">間取り（任意）</div>
                {planUrl ? <img src={planUrl} alt="plan" className="w-full h-40 object-contain bg-neutral-100 rounded-lg" /> : (<>
                  <div className="text-sm">ここにドラッグ＆ドロップ</div>
                  <div className="text-xs text-neutral-500">または</div>
                  <label className="text-xs px-2 py-1 rounded-lg bg-neutral-900 text-white cursor-pointer">ファイルを選択
                    <input type="file" accept="image/*" className="hidden" onChange={(e) => setPlan(e.target.files?.[0] ?? null)} />
                  </label>
                </>)}
              </div>
            </div>
          </section>

          <section className="bg-white rounded-2xl shadow p-4 space-y-3">
            <div className="grid grid-cols-1 gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-sm font-medium">マストワード</span>
                <textarea className="border rounded-lg p-2 min-h-[72px]" placeholder="例）駅徒歩3分 角部屋 ペット可／全戸南向き など" value={mustWordsInput} onChange={(e) => setMustWordsInput(e.target.value)} />
                <span className="text-xs text-neutral-500">認識語数: {mustWords.length}</span>
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1">
                  <span className="text-sm font-medium">トーン</span>
                  <select className="border rounded-lg p-2" value={tone} onChange={(e) => setTone(e.target.value as Tone)}>
                    {tones.map((t) => (<option key={t} value={t}>{t}</option>))}
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-sm font-medium">文字数上限（全角）</span>
                  <input type="number" min={8} max={80} className="border rounded-lg p-2" value={charLimit} onChange={(e) => setCharLimit(Math.max(8, Math.min(80, Number(e.target.value || 50))))} />
                </label>
                <label className="flex flex-col gap-1 col-span-2">
                  <span className="text-sm font-medium">ターゲット</span>
                  <input className="border rounded-lg p-2" placeholder="例）共働きファミリー／DINKs／都心志向" value={target} onChange={(e) => setTarget(e.target.value)} />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-sm font-medium">候補数</span>
                  <input type="number" min={6} max={20} className="border rounded-lg p-2" value={count} onChange={(e) => setCount(Math.max(6, Math.min(20, Number(e.target.value || 10))))} />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-sm font-medium">上位（必須ワード全含有）</span>
                  <input type="number" min={0} max={count} className="border rounded-lg p-2" value={strictCount} onChange={(e) => setStrictCount(Math.max(0, Math.min(count, Number(e.target.value || 5))))} />
                </label>
              </div>

              <div className="flex items-center gap-3 text-sm">
                <label className="inline-flex items-center gap-2">
                  <input type="radio" name="mode" checked={mode === "mock"} onChange={() => setMode("mock")} /> デモ（ローカル生成）
                </label>
                <label className="inline-flex items-center gap-2">
                  <input type="radio" name="mode" checked={mode === "api"} onChange={() => setMode("api")} /> API
                </label>
                {mode === "api" && (
                  <input className="border rounded-lg p-1 px-2 flex-1" placeholder="/api/tagline" value={apiUrl} onChange={(e) => setApiUrl(e.target.value)} />
                )}
              </div>

              <div className="flex gap-3">
                <button type="submit" disabled={busy} className={cn("px-4 py-2 rounded-xl text-white", busy ? "bg-neutral-400" : "bg-black hover:bg-neutral-800")}>{busy ? "生成中…" : "キャッチコピーを生成"}</button>
                <button type="button" className="px-4 py-2 rounded-xl border" onClick={() => { setStrictList([]); setFreeList([]); setMustWordsInput(""); setTarget("ファミリー"); setTone("ラグジュアリー"); setCharLimit(50); setPlan(null); setPhoto(null); setErr(null); }}>リセット</button>
              </div>
              {err && <div className="text-sm text-red-600">{err}</div>}
            </div>
          </section>
        </form>

        {/* Right */}
        <section className="space-y-4">
          <div className="bg-white rounded-2xl shadow overflow-hidden h-[72vh] min-h-[560px] flex flex-col">
            <div className="p-4 border-b flex items-center justify-between">
              <div className="text-sm font-medium">キャッチコピー候補（{strictList.length + freeList.length}/{count}）</div>
              <div className="flex items-center gap-2">
                <button className="text-xs px-3 py-1 rounded-lg border" onClick={copyAll} disabled={!strictList.length && !freeList.length}>全コピー</button>
              </div>
            </div>
            <div className="p-4 grid gap-4 flex-1 overflow-auto">
              <div>
                <div className="text-xs text-neutral-500 mb-1">上位（必須ワードすべて含有）</div>
                {strictList.length === 0 ? (
                  <div className="text-neutral-500 text-sm">— 未生成 —</div>
                ) : (
                  <ol className="space-y-2">
                    {strictList.map((txt, i) => (
                      <li key={i} className="flex items-start gap-3">
                        <div className="w-6 text-xs text-neutral-500 pt-1">{i + 1}.</div>
                        <div className="flex-1 leading-snug">{txt}</div>
                        <button className="text-xs px-2 py-0.5 rounded border" onClick={() => copy(txt)}>コピー</button>
                      </li>
                    ))}
                  </ol>
                )}
              </div>

              <div>
                <div className="text-xs text-neutral-500 mb-1">下位（自由生成／マスト不足OK）</div>
                {freeList.length === 0 ? (
                  <div className="text-neutral-500 text-sm">— 未生成 —</div>
                ) : (
                  <ol className="space-y-2" start={strictList.length + 1}>
                    {freeList.map((txt, i) => (
                      <li key={i} className="flex items-start gap-3">
                        <div className="w-6 text-xs text-neutral-500 pt-1">{strictList.length + i + 1}.</div>
                        <div className="flex-1 leading-snug">{txt}</div>
                        <button className="text-xs px-2 py-0.5 rounded border" onClick={() => copy(txt)}>コピー</button>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow p-4">
            <div className="text-xs text-neutral-500 leading-relaxed">
              ※ デモはフロントで候補を作ります。本番は API で画像（外観/間取り）を解析し、{strictCount}件は必須ワードを全て含むコピー、残りは自由生成として返すのが推奨です。<br/>
              推奨レスポンス: {"{ strict: string[], free: string[] }"}（互換で {"{ candidates: string[] }"} も可）。
            </div>
          </div>
        </section>
      </main>

      <link href="https://cdn.jsdelivr.net/npm/tailwindcss@3.4.4/dist/tailwind.min.css" rel="stylesheet" />
    </div>
  );
}
