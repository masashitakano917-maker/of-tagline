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
  const enders = new Set(["。", "！", "？", "."]);
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

/* ---------- あなたのBAN（維持） ---------- */
const BANNED = [
  "完全","完ぺき","絶対","万全","100％","フルリフォーム","理想","日本一","日本初","業界一","超","当社だけ","他に類を見ない",
  "抜群","一流","秀逸","羨望","屈指","特選","厳選","正統","由緒正しい","地域でナンバーワン","最高","最高級","極","特級","最新",
  "最適","至便","至近","一級","絶好","買得","掘出","土地値","格安","投売り","破格","特安","激安","安値","バーゲンセール",
  "ディズニー","ユニバーサルスタジオ"
];

/* ---------- handler ---------- */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      name,
      url,
      mustWords = [],
      tone = "プロフェッショナル",
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

    // json_object 使用時の要件：「json」という語を含める
    const system =
      'Return ONLY a json object like {"text": string}. No markdown, no explanation. (json)\n' +
      [
        "あなたは日本語の不動産コピーライターです。",
        `文字数は【厳守】${minChars}〜${maxChars}（全角ベース）。`,
        "価格/金額/円/万円・兆/億/万などの金額表現は書かない。",
        "電話番号・問い合わせ誘導・外部URLは書かない。",
        `禁止語を使わない：${BANNED.join("、")}`,
        "事実ベースで、読みやすい自然な日本語で。",
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
        fields: ["階建", "総戸数", "建物構造", "分譲会社", "施工会社", "管理会社"],
      },
      do_not_include: ["リフォーム内容", "方位", "面積", "お問い合わせ文言", ...BANNED],
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

    text = stripPriceAndSpaces(text);

    // レンジ外は再圧縮
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
              `日本語で、文字数は【厳守】${minChars}〜${maxChars}（全角）。` +
              `価格・金額・円/万円/億などの表現は禁止。禁止語：${BANNED.join("、")}`,
          },
          { role: "user", content: JSON.stringify({ text, name }) },
        ],
      });
      try {
        const raw2 = r2.choices?.[0]?.message?.content || "{}";
        text = stripPriceAndSpaces(String(JSON.parse(raw2)?.text || text));
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
