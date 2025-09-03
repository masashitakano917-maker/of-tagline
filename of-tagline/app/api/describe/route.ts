// app/api/describe/route.ts
export const runtime = "nodejs";
import OpenAI from "openai";

/* ---------- helpers ---------- */
function htmlToText(html: string) {
  return (html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
const countJa = (s: string) => Array.from(s || "").length;

/** 文末をできるだけ保ちながら max 文字以内にカット（句点優先） */
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

/** 配列/文字列/その他を安全に語リストへ正規化 */
const normMustWords = (src: unknown): string[] => {
  const s: string = Array.isArray(src) ? (src as unknown[]).map(String).join(" ") : String(src ?? "");
  return s.split(/[ ,、\s\n/]+/).map(w => w.trim()).filter(Boolean);
};

/** 価格・金額表現を除去（保険）＋余分な空白整理 */
const stripPriceAndSpaces = (s: string) =>
  s
    .replace(/(価格|金額|[一二三四五六七八九十百千万億兆\d０-９,，\.]+(?:億|万)?円)/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();

/** BANワードの除去（保険） */
const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const stripBannedWords = (s: string) =>
  s.replace(new RegExp(`(${BANNED.map(esc).join("|")})`, "g"), "");

/* ---------- BAN（維持＋履歴系も追加） ---------- */
const BANNED = [
  "完全","完ぺき","絶対","万全","100％","フルリフォーム","理想","日本一","日本初","業界一","超","当社だけ","他に類を見ない",
  "抜群","一流","秀逸","羨望","屈指","特選","厳選","正統","由緒正しい","地域でナンバーワン","最高","最高級","極","特級","最新",
  "最適","至便","至近","一級","絶好","買得","掘出","土地値","格安","投売り","破格","特安","激安","安値","バーゲンセール",
  "ディズニー","ユニバーサルスタジオ",
  // 追加（歴史系の誤解を招く表現）
  "歴史ある","歴史的","歴史的建造物","由緒ある"
];

/* ---------- STYLE PRESETS（3トーン） ---------- */
function styleGuide(tone: string): string {
  if (tone === "親しみやすい") {
    return [
      "文体: 親しみやすく、やわらかい丁寧語。過度なカジュアルや絵文字は使わない。感嘆記号は控えめ（!は非推奨）。",
      "構成: ①立地・雰囲気 ②敷地/外観の印象 ③アクセス ④共用/サービス ⑤日常のシーンを想起させる結び。",
      "語彙例: 「〜がうれしい」「〜を感じられます」「〜にも便利」「〜に寄り添う」など。二人称の多用は避けつつ、温度感は保つ。",
      "文長: 短め〜中庸（30〜60字）。接続詞を使い回ししない。"
    ].join("\n");
  }
  if (tone === "一般的") {
    return [
      "文体: 中立・説明的で読みやすい丁寧語。誇張を避け、事実ベースで記述。",
      "構成: ①全体概要 ②規模/デザイン ③アクセス ④共用/管理 ⑤まとめ。",
      "語彙例: 「〜に位置」「〜を採用」「〜を提供」「〜が整う」。",
      "文長: 中庸（40〜70字）。体言止めは連続させない。"
    ].join("\n");
  }
  // デフォルト：上品・落ち着いた
  return [
    "文体: 上品・落ち着いた・事実ベース。過度な誇張や感嘆記号は避ける。",
    "構成: ①全体コンセプト/立地 ②敷地規模・ランドスケープ ③建築/保存・デザイン ④交通アクセス ⑤共用/サービス ⑥結び。",
    "語彙例: 「〜という全体コンセプトのもと」「〜を実現」「〜に相応しい」「〜がひろがる」「〜を提供します」。",
    "文長: 中庸（40〜70字）。体言止めは1〜2文に留める。固有名詞は正確に。"
  ].join("\n");
}

/* ---------- handler ---------- */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      name,
      url,
      mustWords = [],
      tone = "上品・落ち着いた",
      minChars = 450,
      maxChars = 550,
    } = body || {};

    if (!name || !url) {
      return new Response(JSON.stringify({ error: "name / url は必須です" }), { status: 400 });
    }

    // 物件ページを取得→テキスト化
    const resp = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } });
    if (!resp.ok) {
      return new Response(JSON.stringify({ error: `URL取得失敗 (${resp.status})` }), { status: 400 });
    }
    const extracted_text = htmlToText(await resp.text()).slice(0, 40000);

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const STYLE_GUIDE = styleGuide(tone);

    // json_object の要件：「json」という語を含める
    const system =
      'Return ONLY a json object like {"text": string}. No markdown, no explanation. (json)\n' +
      [
        "あなたは日本語の不動産コピーライターです。",
        `トーン: ${tone}。次のスタイルガイドに従う。`,
        STYLE_GUIDE,
        `文字数は【厳守】${minChars}〜${maxChars}（全角ベース）。`,
        "価格/金額/円/万円・兆/億/万などの金額表現は書かない。",
        "電話番号・問い合わせ誘導・外部URLは書かない。",
        `禁止語を使わない：${BANNED.join("、")}`,
      ].join("\n");

    const payload = {
      name,
      url,
      tone,
      extracted_text,
      must_words: normMustWords(mustWords),
      char_range: { min: minChars, max: maxChars },
      must_include: {
        name_times: 2,
        transport_times: 1,
        fields: ["階建","総戸数","建物構造","分譲会社","施工会社","管理会社"],
      },
      do_not_include: ["リフォーム内容","方位","面積","お問い合わせ文言", ...BANNED],
    };

    // ① 生成
    const r1 = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: JSON.stringify(payload) },
      ],
    });

    let text = "";
    try {
      const raw = r1.choices?.[0]?.message?.content || "{}";
      text = String(JSON.parse(raw)?.text || "");
    } catch { text = ""; }

    // サニタイズ＆BAN除去
    text = stripPriceAndSpaces(text);
    text = stripBannedWords(text);

    // レンジ外は再圧縮（スタイル維持）
    if (!text || countJa(text) < minChars || countJa(text) > maxChars) {
      const r2 = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              'Rewrite and output ONLY {"text": string}. (json)\n' +
              `日本語・${tone}のまま。スタイルガイドを遵守。\n${STYLE_GUIDE}\n` +
              `文字数は【厳守】${minChars}〜${maxChars}（全角）。価格/金額/円/万円は禁止。` +
              `禁止語：${BANNED.join("、")}`,
          },
          { role: "user", content: JSON.stringify({ text, name }) },
        ],
      });
      try {
        const raw2 = r2.choices?.[0]?.message?.content || "{}";
        text = stripBannedWords(stripPriceAndSpaces(String(JSON.parse(raw2)?.text || text)));
      } catch {}
    }

    // 最終ハード上限（句点優先でカット）
    if (countJa(text) > maxChars) text = hardCapJa(text, maxChars);

    return new Response(JSON.stringify({ text }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || "server error" }), { status: 500 });
  }
}
