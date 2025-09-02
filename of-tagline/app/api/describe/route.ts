export const runtime = "nodejs";
import OpenAI from "openai";

/* --- helpers --- */
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
const normMustWords = (src: string | string[]): string[] => {
  const s = Array.isArray(src) ? src.join(" ") : String(src); // ← まず必ず string に寄せる
  return s
    .split(/[ ,、\s\n/]+/)
    .map((w) => w.trim())
    .filter(Boolean);
};

/* --- あなたのNGワード（維持） --- */
const BANNED = [
  "完全","完ぺき","絶対","万全","100％","フルリフォーム","理想","日本一","日本初","業界一","超","当社だけ","他に類を見ない",
  "抜群","一流","秀逸","羨望","屈指","特選","厳選","正統","由緒正しい","地域でナンバーワン","最高","最高級","極","特級","最新",
  "最適","至便","至近","一級","絶好","買得","掘出","土地値","格安","投売り","破格","特安","激安","安値","バーゲンセール",
  "ディズニー","ユニバーサルスタジオ"
];

export async function POST(req: Request) {
  try {
    const {
      name,
      url,
      mustWords = [],
      tone = "プロフェッショナル",
      minChars = 450,
      maxChars = 550,
    } = await req.json();

    if (!name || !url) {
      return new Response(JSON.stringify({ error: "name / url は必須です" }), { status: 400 });
    }

    // 物件ページをざっくりテキスト化
    const resp = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } });
    if (!resp.ok) {
      return new Response(JSON.stringify({ error: `URL取得失敗 (${resp.status})` }), { status: 400 });
    }
    const extracted = htmlToText(await resp.text()).slice(0, 40000);

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // ☆ IMPORTANT: “json” を明記（json_object使用時の要件）
    const sys =
      'Return ONLY a json object like {"text": string}. No markdown, no explanation. (json)\n' +
      [
        "あなたは日本語の不動産コピーライターです。",
        `文字数は【厳守】${minChars}〜${maxChars}（全角ベース）。`,
        "価格/金額/円/万円などの金額表現は書かない。",
        "電話番号・会社の問い合わせ文言・外部URLは書かない。",
        `次の禁止語は使わない：${BANNED.join("、")}`,
      ].join("\n");

    const userPayload = {
      name,
      url,
      tone, // 送られてきたら受ける（UIで使っていなくてもOK）
      extracted_text: extracted,
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
        { role: "system", content: sys },
        { role: "user", content: JSON.stringify(userPayload) },
      ],
    });

    let text = "";
    try {
      text = String(JSON.parse(r1.choices?.[0]?.message?.content || "{}")?.text || "");
    } catch {
      text = "";
    }

    // 金額など最終サニタイズ（保険）
    const strip = (s: string) =>
      s
        // 価格・金額・円/万円の明示を除去
        .replace(/(価格|金額|[\d０-９,，\.]+(?:万)?円)/g, "")
        // 連続空白を整形
        .replace(/\s{2,}/g, " ")
        .trim();

    text = strip(text);

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
              `日本語。文字数は【厳守】${minChars}〜${maxChars}（全角）。価格/金額/円/万円は禁止。` +
              `禁止語：${BANNED.join("、")}`,
          },
          { role: "user", content: JSON.stringify({ text, name }) },
        ],
      });
      try {
        text = strip(String(JSON.parse(r2.choices?.[0]?.message?.content || "{}")?.text || text));
      } catch {}
    }

    return new Response(JSON.stringify({ text }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || "server error" }), { status: 500 });
  }
}
