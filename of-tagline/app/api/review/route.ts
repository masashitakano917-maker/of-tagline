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

/* ---------- BAN（維持） ---------- */
const BANNED = [
  "完全","完ぺき","絶対","万全","100％","フルリフォーム","理想","日本一","日本初","業界一","超","当社だけ","他に類を見ない",
  "抜群","一流","秀逸","羨望","屈指","特選","厳選","正統","由緒正しい","地域でナンバーワン","最高","最高級","極","特級","最新",
  "最適","至便","至近","一級","絶好","買得","掘出","土地値","格安","投売り","破格","特安","激安","安値","バーゲンセール",
  "ディズニー","ユニバーサルスタジオ"
];

/* ---------- STYLE GUIDE（describe と同じ） ---------- */
const STYLE_GUIDE = [
  "文体: 上質・落ち着いた・事実ベース。過度な誇張や感嘆記号は避ける。",
  "構成（目安）: ①全体コンセプト/立地 ②敷地規模・ランドスケープ ③建築/保存・デザイン ④交通アクセス ⑤共用施設/サービス ⑥結び。",
  "語彙例: 「〜という全体コンセプトのもと」「〜を実現」「〜を望む立地」「〜に相応しい」「〜がひろがる」「〜を提供します」。",
  "体裁: 体言止めは1〜2文。文長は40〜70字程度で読みやすく。固有名詞は正確に。",
  "制約: 価格/金額/円/万円・電話番号・問い合わせ誘導・外部URLは不可。禁止語NG。"
].join("\n");

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
      tone = "上質・落ち着いた",
    } = body || {};

    if (!text) {
      return new Response(JSON.stringify({ error: "text は必須です" }), { status: 400 });
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // json_object 使用時の要件：「json」という語を含める
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
        "トーンが上質・落ち着いたになるよう整っているか（誇張/感嘆の抑制）",
        "構成の流れが概ねスタイルガイドに沿っているか",
        "マストワードが自然に含まれるか",
        "禁止語（上記）・価格/金額/円/万円・電話番号・URLが含まれていないか",
        `文字数が ${minChars}〜${maxChars} に収まっているか（超過時は要圧縮）`,
        "誤字脱字/不自然表現/重複表現がないか",
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

    improved = stripPriceAndSpaces(improved);

    // ② レンジ外なら再圧縮して矯正（スタイル維持）
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
              `日本語・${tone}のまま。スタイルガイドを遵守。` + "\n" + STYLE_GUIDE + "\n" +
              `文字数は【厳守】${minChars}〜${maxChars}（全角）。` +
              `価格・金額・円/万円/億は禁止。禁止語：${BANNED.join("、")}`,
          },
          { role: "user", content: JSON.stringify({ text: improved, request }) },
        ],
      });
      try {
        const raw2 = r2.choices?.[0]?.message?.content || "{}";
        const p2 = JSON.parse(raw2);
        improved = stripPriceAndSpaces(String(p2?.improved || improved));
      } catch {
        improved = stripPriceAndSpaces(improved);
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
