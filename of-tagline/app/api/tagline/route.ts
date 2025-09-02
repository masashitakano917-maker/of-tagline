import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

export const runtime = "nodejs";

// CORS（必要なら有効）
function cors(res: NextResponse) {
  res.headers.set("Access-Control-Allow-Origin", "*");
  res.headers.set("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", "Content-Type");
  return res;
}
export async function OPTIONS() {
  return cors(new NextResponse(null, { status: 204 }));
}

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      photoDataUrl,
      planDataUrl,
      mustWords = "",
      tone = "ラグジュアリー",
      charLimit = 50,
      target = "ファミリー",
      candidates = 10,
      strictCount = 5,
    } = body ?? {};

    if (!photoDataUrl) {
      return cors(NextResponse.json({ error: "photoDataUrl is required" }, { status: 400 }));
    }

    const freeCount = Math.max(0, candidates - strictCount);
    const prompt = [
      "あなたは不動産広告の日本語コピーライターです。",
      "外観写真と（あれば）間取り図から短いキャッチコピーを作ります。",
      `トーン:${tone} / ターゲット:${target} / 文字数上限:${charLimit}`,
      `マストワード:${mustWords}（上位は全て含める）`,
      `上位:${strictCount}件 / 下位:${freeCount}件`,
      "事実不明の断定（駅徒歩・築年数・価格など）は避けること。",
      "出力は次のJSONのみ: {\"strict\": string[], \"free\": string[]}",
    ].join("\n");

    // Chat Completions（画像+テキスト）
    const messages: any = [
      { role: "system", content: "You are a helpful Japanese real-estate copywriter. Return only JSON." },
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: photoDataUrl },
          ...(planDataUrl ? [{ type: "image_url", image_url: planDataUrl }] : []),
        ],
      },
    ];

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
      temperature: 0.9,
      response_format: { type: "json_object" }, // TS的に安全
    });

    const content = completion.choices[0]?.message?.content || "{}";
    let parsed: any;
    try { parsed = JSON.parse(content); } catch { parsed = {}; }

    // 期待スキーマ { strict, free } を整える
    let strict: string[] = Array.isArray(parsed?.strict) ? parsed.strict : [];
    let free: string[]   = Array.isArray(parsed?.free)   ? parsed.free   : [];

    // サニタイズ & 補完
    const words = String(mustWords).split(/[ ,、\s/]+/).map(s => s.trim()).filter(Boolean);
    const limit = (s: string) => (Array.from(s).length <= charLimit ? s : Array.from(s).slice(0, charLimit - 1).join("") + "…");
    const includeAll = (s: string) => words.every(w => !w || s.includes(w));

    strict = strict.map(limit).filter(s => (words.length ? includeAll(s) : true));
    free   = free.map(limit);

    while (strict.length < strictCount && words.length) {
      const joined = limit(words.join("・"));
      if (!strict.includes(joined)) strict.push(joined); else break;
    }
    while (strict.length + free.length < candidates) {
      free.push(limit(`${tone}に寄り添う、日常が特別になる。`));
    }

    return cors(NextResponse.json({
      strict: strict.slice(0, strictCount),
      free: free.slice(0, Math.max(0, candidates - strictCount)),
    }));
  } catch (e: any) {
    return cors(NextResponse.json({ error: e?.message ?? "server_error" }, { status: 500 }));
  }
}
