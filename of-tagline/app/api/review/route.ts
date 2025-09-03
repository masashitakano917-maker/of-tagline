export const runtime = "nodejs";
import OpenAI from "openai";

/* ---------- helpers ---------- */
const countJa = (s: string) => Array.from(s || "").length;

function hardCapJa(s: string, max: number): string {
  const arr = Array.from(s || "");
  if (arr.length <= max) return s;
  const upto = arr.slice(0, max);
  const enders = new Set(["。", "！", "？", "."]);
  let cut = -1;
  for (let i = upto.length - 1; i >= 0; i--) {
    if (enders.has(upto[i])) { cut = i + 1; break; }
  }
  return upto.slice(0, cut > 0 ? cut : max).join("").trim();
}

const normMustWords = (src: unknown): string[] => {
  const s: string = Array.isArray(src) ? (src as unknown[]).map(String).join(" ") : String(src ?? "");
  return s.split(/[ ,、\s\n/]+/).map(w => w.trim()).filter(Boolean);
};

const stripPriceAndSpaces = (s: string) =>
  s
    .replace(/(価格|金額|[一二三四五六七八九十百千万億兆\d０-９,，\.]+(?:億|万)?円)/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();

const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const stripWords = (s: string, words: string[]) =>
  s.replace(new RegExp(`(${words.map(esc).join("|")})`, "g"), "");

/* ---------- BAN ---------- */
const BANNED = [
  "完全","完ぺき","絶対","万全","100％","フルリフォーム","理想","日本一","日本初","業界一","超","当社だけ","他に類を見ない",
  "抜群","一流","秀逸","羨望","屈指","特選","厳選","正統","由緒正しい","地域でナンバーワン","最高","最高級","極","特級","最新",
  "最適","至便","至近","一級","絶好","買得","掘出","土地値","格安","投売り","破格","特安","激安","安値","バーゲンセール",
  "ディズニー","ユニバーサルスタジオ",
  "歴史ある","歴史的","歴史的建造物","由緒ある"
];

/* ---------- STYLE PRESETS（3トーン） ---------- */
function styleGuide(tone: string): string {
  if (tone === "親しみやすい") {
    return [
      "文体: 親しみやすく、やわらかい丁寧語。誇張・絵文字・感嘆記号は抑制。",
      "構成: ①立地・雰囲気 ②敷地/外観の印象 ③アクセス ④共用/サービス ⑤日常シーンを想起させる結び。",
      "語彙例: 「〜がうれしい」「〜を感じられます」「〜にも便利」「〜に寄り添う」。",
      "文長: 30〜60字中心。"
    ].join("\n");
  }
  if (tone === "一般的") {
    return [
      "文体: 中立・説明的で読みやすい丁寧語。事実ベースで誇張を避ける。",
      "構成: ①全体概要 ②規模/デザイン ③アクセス ④共用/管理 ⑤まとめ。",
      "語彙例: 「〜に位置」「〜を採用」「〜が整う」「〜を提供」。",
      "文長: 40〜70字中心。"
    ].join("\n");
  }
  return [
    "文体: 上品・落ち着いた・事実ベース。過度な誇張や感嘆記号は避ける。",
    "構成: ①全体コンセプト/立地 ②敷地規模・ランドスケープ ③建築/保存・デザイン ④交通アクセス ⑤共用/サービス ⑥結び。",
    "語彙例: 「〜という全体コンセプトのもと」「〜を実現」「〜に相応しい」「〜がひろがる」「〜を提供します」。",
    "文長: 40〜70字中心。体言止めは1〜2文に留める。"
  ].join("\n");
}

/** 改稿文を min〜max に収める矯正（最大3回） */
async function ensureLengthReview(opts: {
  openai: OpenAI; draft: string; min: number; max: number; tone: string; style: string; request?: string;
}) {
  let out = opts.draft;
  for (let i = 0; i < 3; i++) {
    const len = countJa(out);
    if (len >= opts.min && len <= opts.max) return out;

    const need = len < opts.min ? "expand" : "condense";
    const r = await opts.openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            'Return ONLY {"improved": string}. (json)\n' +
            `日本語・トーン:${opts.tone}。次のスタイルガイドを遵守：\n${opts.style}\n` +
            `目的: 文字数を${opts.min}〜${opts.max}（全角）に${need === "expand" ? "増やし" : "収め"}る。\n` +
            "事実が不足する場合は一般的で安全な叙述で補い、固有の事実を創作しない。価格/金額/円/万円・電話番号・URLは禁止。"
        },
        {
          role: "user",
          content: JSON.stringify({
            text: out,
            request: opts.request || "",
            action: need
          })
        }
      ]
    });
    try {
      out = String(JSON.parse(r.choices?.[0]?.message?.content || "{}")?.improved || out);
    } catch { /* keep out */ }
    out = stripPriceAndSpaces(out);
    out = stripWords(out, BANNED);
    if (countJa(out) > opts.max) out = hardCapJa(out, opts.max);
  }
  return out;
}

/* ---------- handler ---------- */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      text = "",
      name = "",
      url = "",
      mustWords = [],
      minChars = 450,
      maxChars = 550,
      request = "",
      tone = "上品・落ち着いた",
    } = body || {};

    if (!text) {
      return new Response(JSON.stringify({ error: "text は必須です" }), { status: 400 });
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const STYLE_GUIDE = styleGuide(tone);

    // ① 校閲/改善
    const system =
      'Return ONLY a json object like {"improved": string, "issues": string[], "summary": string}. (json)\n' +
      [
        "あなたは日本語の不動産コピーの校閲/編集者です。",
        `トーン: ${tone}。次のスタイルガイドを遵守。`,
        STYLE_GUIDE,
        `文字数は【厳守】${minChars}〜${maxChars}（全角）。`,
        "価格/金額/円/万円・電話番号・外部URLは禁止。",
        `禁止語：${BANNED.join("、")}`,
      ].join("\n");

    const payload = {
      mode: request ? "apply_request" : "check",
      name,
      url,
      must_words: normMustWords(mustWords),
      char_range: { min: minChars, max: maxChars },
      request,
      text_original: text,
      checks: [
        "指定トーン・スタイルに合致",
        "マストワードが自然に含まれる",
        "禁止語・価格/金額・電話番号・URLなし",
        `文字数が ${minChars}〜${maxChars} に収まる`,
        "誤字脱字/不自然表現の修正",
      ],
    };

    const r1 = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: JSON.stringify(payload) },
      ],
    });

    let improved = text;
    let issues: string[] = [];
    let summary = "";

    try {
      const raw = r1.choices?.[0]?.message?.content || "{}";
      const p = JSON.parse(raw);
      improved = String(p?.improved ?? text);
      issues = Array.isArray(p?.issues) ? p.issues : [];
      summary = String(p?.summary ?? "");
    } catch {
      improved = text;
    }

    // サニタイズ
    improved = stripPriceAndSpaces(improved);
    improved = stripWords(improved, BANNED);

    // ② 長さ矯正（最大3回）
    improved = await ensureLengthReview({
      openai,
      draft: improved,
      min: minChars,
      max: maxChars,
      tone,
      style: STYLE_GUIDE,
      request,
    });

    // ③ 上限は最終カット
    if (countJa(improved) > maxChars) improved = hardCapJa(improved, maxChars);

    return new Response(
      JSON.stringify({
        improved,
        issues,
        summary: summary || (issues.length ? issues.join(" / ") : ""),
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || "server error" }), { status: 500 });
  }
}
