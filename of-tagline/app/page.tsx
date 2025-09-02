'use client';
import { useMemo, useState } from "react";


/* ========== helpers ========== */
const cn = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(' ');
const BANNED = [
'完全','完ぺき','絶対','万全','100％','フルリフォーム','理想','日本一','日本初','業界一','超','当社だけ','他に類を見ない','抜群','一流','秀逸','羨望','屈指','特選','厳選','正統','由緒正しい','地域でナンバーワン','最高','最高級','極','特級','最新','最適','至便','至近','一級','絶好','買得','掘出','土地値','格安','投売り','破格','特安','激安','安値','バーゲンセール','ディズニー','ユニバーサルスタジオ'
];


const toneOptions = ['プロフェッショナル','フレンドリー','ニュートラル'] as const;
type Tone = typeof toneOptions[number];


// LCS で簡易差分（fixed の挿入・変更を赤字表示）
function diffHtml(original: string, fixed: string) {
const A = Array.from(original);
const B = Array.from(fixed);
const m = A.length, n = B.length;
const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
for (let i = m - 1; i >= 0; i--) {
for (let j = n - 1; j >= 0; j--) {
dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
}
}
let i = 0, j = 0, out = '';
while (i < m && j < n) {
if (A[i] === B[j]) { out += B[j]; i++; j++; }
else if (dp[i + 1][j] >= dp[i][j + 1]) { i++; /* deletion in B: 何も足さない */ }
else { out += `<span class="text-red-600">${escapeHtml(B[j])}</span>`; j++; }
}
if (j < n) out += `<span class="text-red-600">${escapeHtml(B.slice(j).join(''))}</span>`;
return out;
}
function escapeHtml(s: string){ return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c] as string)); }


export default function App(){
// 入力
const [name, setName] = useState('');
const [url, setUrl] = useState('');
const [mustWordsInput, setMustWordsInput] = useState('');
const [tone, setTone] = useState<Tone>('プロフェッショナル');
const [minChars, setMinChars] = useState(450);
const [maxChars, setMaxChars] = useState(550);


// 状態
const [busy, setBusy] = useState(false);
const [err, setErr] = useState<string | null>(null);
const [text, setText] = useState('');
const [issues, setIssues] = useState<string[]>([]);
const [fixed, setFixed] = useState('');
const [diff, setDiff] = useState('');
const [feedback, setFeedback] = useState('');


const mustWords = useMemo(() => mustWordsInput.split(/[ ,、\s\n\/]+/).map(s=>s.trim()).filter(Boolean), [mustWordsInput]);


async function generate(e?: React.FormEvent){
e?.preventDefault(); setErr(null); setBusy(true);
setIssues([]); setFixed(''); setDiff('');
try{
if(!name.trim()) throw new Error('物件名を入力してください');
if(!/^https?:\/\//.test(url.trim())) throw new Error('正しい物件URLを入力してください');
}
