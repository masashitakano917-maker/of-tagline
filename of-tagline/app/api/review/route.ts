// app/api/review/route.ts
export const runtime = "edge";

export async function POST(req: Request) {
  try {
    const {
      text = "",
      name = "",
      url = "",
      mustWords = "",
      tone = "プロフェッショナル",
      minChars = 450,
      maxChars = 550,
    } = await req.json();

    if (!process.env.OPENAI_API_KEY) {
      return new Response(JSON.stringify({ error: "OPENAI_API_KEY 未設定です。" }), { status: 500 });
    }
    if (!text) {
      return new Response(JSON.stringify({ error: "text は必須です。" }), { status: 400 });
    }

    const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

    const system = `
あなたは不動産専門の校正者／コピーライターです。
以下の項目を点検し、必要なら改善版を出してください。

必須チェック：
- 文字数：全角で ${minChars}〜${maxChars} 文字
- マンション名：2回以上
- 交通情報：1回以上（駅・路線・徒歩分数等）
- 以下の情報は可能なら言及（自然な範囲）：階建／総戸数／建物構造／分譲会社／施工会社／管理会社
- 禁止語は一切使わない（一覧は後述）
- 方位・面積・リフォーム内容・お問い合わせ誘導は入れない
- トーン：${tone}
- 必須ワード（自然に反映）：${mustWords || "（指定なし）"}

出力形式はJSONのみ：
{
  "ok": boolean,
  "issues": string[],        // 見つかった問題の説明（なければ空配列）
  "improved": string         // 改善後の本文（問題なければ元のままでも可）
}

禁止語：完全、完ぺき、絶対、万全、100％、フルリフォーム、理想、日本一、日本初、業界一、超、当社だけ、他に類を見ない、抜群、一流、秀逸、羨望、屈指、特選、厳選、正統、由緒正しい、地域でナンバーワン、最高、最高級、極、特級、最新、最適、至便、至近、一級、絶好、買得、掘出、土地値、格安、投売り、破格、特安、激安、安値、バーゲンセール、ディズニー、ユニバーサルスタジオ
`.trim();

    const user = `
【マンション名】${name}
【参照URL】${url}
【本文（校正対象）】
${text}
`.trim();

    const ai = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        response_format: { type: "json_object" },
      }),
    });

    const data: any = await ai.json();
    if (!ai.ok) {
      return new Response(JSON.stringify({ error: data?.error?.message || "OpenAI API error" }), { status: 400 });
    }

    let payload: any = {};
    try {
      payload = JSON.parse(data?.choices?.[0]?.message?.content || "{}");
    } catch {
      payload = { ok: false, issues: ["AI応答のJSON解析に失敗しました。"], improved: text };
    }

    // 保険：最低限の形に整える
    if (typeof payload.ok !== "boolean") payload.ok = true;
    if (!Array.isArray(payload.issues)) payload.issues = [];
    if (typeof payload.improved !== "string") payload.improved = text;

    return new Response(JSON.stringify(payload), {
      headers: { "content-type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err?.message || "unexpected error" }), { status: 500 });
  }
}
