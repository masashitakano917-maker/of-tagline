export const runtime = "nodejs";
import OpenAI from "openai";

function htmlToText(html: string) {
  return (html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const BANNED = [
  "完全","完ぺき","絶対","万全","100％","フルリフォーム","理想","日本一","日本初","業界一","超","当社だけ","他に類を見ない",
  "抜群","一流","秀逸","羨望","屈指","特選","厳選","正統","由緒正しい","地域でナンバーワン","最高","最高級","極","特級","最新",
  "最適","至便","至近","一級","絶好","買得","掘出","土地値","格安","投売り","破格","特安","激安","安値","バーゲンセール",
  "ディズニー","ユニバーサルスタジオ"
];

export async function POST(req: Request) {
  try {
    const { name, url, mustWords = [], tone = "プロフェッショナル", minChars = 450, maxChars = 550 } = await req.json();
    if (!name || !url) return new Response(JSON.stringify({ error: "name / url は必須です" }), { status: 400 });

    const resp = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } });
    if (!resp.ok) return new Response(JSON.stringify({ error: `URL取得失敗 (${resp.status})` }), { status: 400 });
    const text = htmlToText(await resp.text()).slice(0, 40000);

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const r = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.4,
      messages: [
        { role: "system", content: `あなたは不動産専門のコピーライターです。禁止語: ${BANNED.join("、")} を使わず、自然で事実ベースの日本語で書いてください。` },
        { role: "user", content: JSON.stringify({
          name,
          url,
          extracted_text: text,
          must_words: mustWords,
          tone,
          char_range: { min: minChars, max: maxChars },
          must_include: {
            name_times: 2,
            transport_times: 1,
            fields: ["階建","総戸数","建物構造","分譲会社","施工会社","管理会社"],
          },
          do_not_include: ["リフォーム内容","方位","面積","お問い合わせ文言", ...BANNED]
        })},
      ],
    });

    return new Response(JSON.stringify({ text: r.choices?.[0]?.message?.content || "" }), {
      headers: { "content-type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || "server error" }), { status: 500 });
  }
}
