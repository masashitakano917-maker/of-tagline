export const runtime = "nodejs";
import OpenAI from "openai";

export async function POST(req: Request) {
  try {
    const { mode = "check", name = "", text = "", request = "", mustWords = [], minChars = 450, maxChars = 550 } = await req.json();
    if (!text) return new Response(JSON.stringify({ error: "text は必須です" }), { status: 400 });

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const r = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "あなたは不動産の校閲者/コピー改善の専門家です。禁止語を避け、事実ベースの自然な日本語に整えます。" },
        { role: "user", content: JSON.stringify({
          mode, name, text, request, must_words: mustWords, char_range: { min: minChars, max: maxChars },
          checks: [
            "物件名を2回以上/交通情報を1回以上含むか",
            "階建・総戸数・建物構造・分譲会社・施工会社・管理会社を可能な範囲で含むか",
            "誤字脱字/不自然表現/冗長/重複/誇大表現がないか"
          ]
        }) }
      ],
    });

    const raw = r.choices?.[0]?.message?.content || "{}";
    let parsed: any = {};
    try { parsed = JSON.parse(raw); } catch {}
    const issues: string[] = Array.isArray(parsed?.issues) ? parsed.issues : [];
    const improved: string = typeof parsed?.improved === "string" ? parsed.improved : (parsed?.text || "");

    return new Response(JSON.stringify({ issues, improved }), { headers: { "content-type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || "server error" }), { status: 500 });
  }
}
