// app/api/describe/route.ts
export const runtime = "edge";

function stripHtml(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function POST(req: Request) {
  try {
    const {
      name = "",
      url = "",
      mustWords = "",
      tone = "プロフェッショナル",
      minChars = 450,
      maxChars = 550,
    } = await req.json();

    if (!process.env.OPENAI_API_KEY) {
      return new Response(JSON.stringify({ error: "OPENAI_API_KEY 未設定です（VercelのEnvironment Variablesに追加してください）。" }), { status: 500 });
    }
    if (!name || !url) {
      return new Response(JSON.stringify({ error: "name と url は必須です。" }), { status: 400 });
    }

    // 物件ページを取得
    const resp = await fetch(url, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36",
        accept: "text/html,application/xhtml+xml",
      },
      // 本番でCORSが厳しい場合はサーバー側でのみfetchされるのでOK（Edge Runtime）
    });
    if (!resp.ok) {
      return new Response(JSON.stringify({ error: `物件URLの取得に失敗しました（${resp.status}）` }), { status: 400 });
    }
    const html = await resp.text();
    const pageText = stripHtml(html).slice(0, 50000); // トークン節約で上限

    const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

    const system = `
あなたは不動産専門のコピーライターです。
以下の制約を厳守し、日本語で自然な説明文を作成します。

- 文字数：全角で ${minChars}〜${maxChars} 文字
- マンション名を2回以上使用（不自然な連呼は避ける）
- 交通情報を1回以上使用（駅・路線・徒歩分数等。ページから抽出できる範囲で）
- 次の情報がページから読み取れれば、自然な範囲で本文に含める：
  ・階建／総戸数／建物構造／分譲会社／施工会社／管理会社
- 禁止語（例示）：完全、完ぺき、絶対、万全、100％、フルリフォーム、理想、日本一、日本初、業界一、超、当社だけ、他に類を見ない、抜群、一流、秀逸、羨望、屈指、特選、厳選、正統、由緒正しい、地域でナンバーワン、最高、最高級、極、特級、最新、最適、至便、至近、一級、絶好、買得、掘出、土地値、格安、投売り、破格、特安、激安、安値、バーゲンセール、ディズニー、ユニバーサルスタジオ
- お問い合わせ誘導、方位、面積、リフォーム内容は書かない
- 語尾は「です／ます」を基調
- トーン：${tone}
- 必須ワード（可能な範囲で自然に組み込み）：${mustWords || "（指定なし）"}
`.trim();

    const user = `
【マンション名】${name}
【参照URL】${url}
【ページ本文（抽出）】
${pageText}
`.trim();

    // Chat Completions（テキストのみ）
    const ai = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.5,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });

    const data: any = await ai.json();
    if (!ai.ok) {
      return new Response(JSON.stringify({ error: data?.error?.message || "OpenAI API error" }), { status: 400 });
    }
    const text = (data?.choices?.[0]?.message?.content || "").trim();
    if (!text) {
      return new Response(JSON.stringify({ error: "文章が生成できませんでした。" }), { status: 400 });
    }

    return new Response(JSON.stringify({ ok: true, text }), {
      headers: { "content-type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err?.message || "unexpected error" }), { status: 500 });
  }
}
