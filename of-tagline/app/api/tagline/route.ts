import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

export const runtime = "nodejs";

// CORS（必要なら有効化。自サイト内からの呼び出しでは不要だが念のため許可）
function cors(res: NextResponse) {
  res.headers.set("Access-Control-Allow-Origin", "*");
  res.headers.set("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", "Content-Type");
  return res;
}
export async function OPTIONS() {
  return cors(new NextResponse(null, { status: 204 }));
}

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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
    } = body || {};

    if (!photoDataUrl) {
      return cors(NextResponse.json({ error: "photoDataUrl is required" }, { status: 400 }));
    }

    const freeCount = Math.max(0, candidates - strictCount);

    const responseSchema = {
      name: "tagline_response",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          strict: { type: "array", items: { type: "string" } },
          free: { type: "array", items: { type: "string" } },
        },
        required: ["strict", "free"],
      },
    } as const;

    const input: any = [{
      role: "user",
      content: [
        {
          type: "input_text",
          text: [
            "あなたは不動産広告の日本語コピーライターです。",
            "外観写真と（あれば）間取り図から短いキャッチコピーを作ります。",
            `トーン:${tone} / ターゲット:${target} / 文字数上限:${charLimit}`,
            `マストワード:${mustWords}（上位は全て含める）`,
            `上位:${strictCount}件 / 下位:${freeCount}件`,
            "事実不明の断定（駅徒歩・築年数・価格など）は避けること。",
          ].join("\n"),
        },
        { type: "input_image", image_url: photoDataUrl },
      ],
    }];
    if (planDataUrl) {
      (input[0].content as any[]).push({ type: "input_image", image_url: planDataUrl });
    }

    const ai = await client.responses.create({
      model: "gpt-4o-mini",
      input,
      temperature: 0.9,
      response_format: { type: "json_schema", json_schema: responseSchema },
    });

    const text = (ai as any).output_text ?? "";
    const parsed = JSON.parse(text) as { strict: string[]; free: string[] };

    // サニタイズ
    const words = String(mustWords).split(/[ ,、\s\/]+/).map(s => s.trim()).filter(Boolean);
    const limit = (s: string) => (Array.from(s).length <= charLimit ? s : Array.from(s).slice(0, charLimit - 1).join("") + "…");
    const includeAll = (s: string) => words.every(w => !w || s.includes(w));

    let strict = (parsed.strict ?? []).map(limit).filter(s => (words.length ? includeAll(s) : true));
    let free = (parsed.free ?? []).map(limit);

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
