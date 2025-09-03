// app/api/review/route.ts
export const runtime = "nodejs";
import OpenAI from "openai";

/* ---------- helpers ---------- */
const countJa = (s: string) => Array.from(s || "").length;

function hardCapJa(s: string, max: number): string {
  const arr = Array.from(s || "");
  if (arr.length <= max) return s;
  const upto = arr.slice(0, max);
  const enders = new Set(["。","！","？","."]);
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
const stripBannedWords = (s: string) =>
  s.replace(new RegExp(`(${BANNED.map(esc).join("|")})`, "g"), "");

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
      "文体: 親しみやすく、やわらかい丁寧語。過度なカジュアルや絵文字は使わない。感嘆記号は控えめ。",
      "構成: ①立地・雰囲気 ②敷地/外観の印象 ③アクセス ④共用/サービス ⑤日常のシーンを想起させる結び。",
      "語彙例: 「〜がうれしい」「〜を感じられます」「〜にも便利」「〜に寄り添う」。",
      "文長: 30〜60字中心。"
    ].join("\n");
  }
  if (tone === "一般的") {
    return [
      "文体: 中立・説明的で読みやすい丁寧語。誇張を避け、事実ベースで記述。",
      "構成: ①全体概要 ②規模/デザイン ③アクセス ④共用/管理 ⑤まとめ。",
      "語彙例: 「〜に位置」「〜を採用」「〜を提供」「〜が整う」。",
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

    // json_object 使用の要件：「json」を含める
    const system =
      'Return ONLY a json object like {"improved": string, "issues": string[], "summary": string}. (json)\n' +
      [
        "あなたは日本語の不動産コピーの校閲/編集者です。",
        `トーン: ${tone}。次のスタイルガイドを遵守。`,
        STYLE_GUIDE,
        `文字数は【厳守】${minChars}〜${maxChars}（全角）。`,
        "価格/金額/円/万円・兆/億/万などの金額表現は禁止。",
        "電話番号・問い合わせ誘導・外部URLは書かない。",
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
        "トーンが指定スタイルに合致（誇張・感嘆の抑制）",
        "構成の流れが概ねスタイルガイドに沿う",
        "マストワードが自然に含まれる",
        "禁止語・価格/金額/円/万円・電話番号・URLがない",
        `文字数が ${minChars}〜${maxChars} に収まる（超過時は圧縮）`,
        "誤字脱字/不自然表現/重複表現を修正",
      ],
    };

    // ① 校閲/改善
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
      improved = text; // パース失敗時は元文から続行
    }

    // サニタイズ＆BAN除去
    improved = stripPriceAndSpaces(improved);
    improved = stripBannedWords(improved);

    // ② レンジ外なら再圧縮（スタイル維持）
    const len = countJa(improved);
    if (len < minChars || len > maxChars) {
      const r2 = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              'Output ONLY {"improved": string}. (json)\n' +
              `日本語・${tone}のまま。スタイルガイドを遵守。\n${STYLE_GUIDE}\n` +
              `文字数は【厳守】${minChars}〜${maxChars}（全角）。` +
              `価格・金額・円/万円/億は禁止。禁止語：${BANNED.join("、")}`,
          },
          { role: "user", content: JSON.stringify({ text: improved, request }) },
        ],
      });
      try {
        const raw2 = r2.choices?.[0]?.message?.content || "{}";
        const p2 = JSON.parse(raw2);
        improved = stripBannedWords(stripPriceAndSpaces(String(p2?.improved || improved)));
      } catch {
        improved = stripBannedWords(stripPriceAndSpaces(improved));
      }
    }

    // 最終ハード上限
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
