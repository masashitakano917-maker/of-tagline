export const runtime = "nodejs";
import OpenAI from "openai";

const countJa = (s: string) => Array.from(s || "").length;
const normMustWords = (src: string | string[]) =>
  (Array.isArray(src) ? src : String(src))
    .split(/[ ,、\s\n/]+/)
    .map((w) => w.trim())
    .filter(Boolean);

// あなたのBAN（describeと同じ内容を維持）
const BANNED = [
  "完全","完ぺき","絶対","万全","100％","フルリフォーム","理想","日本一","日本初","業界一","超","当社だけ","他に類を見ない",
  "抜群","一流","秀逸","羨望","屈指","特選","厳選","正統","由緒正しい","地域でナンバーワン","最高","最高級","極","特級","最新",
  "最適","至便","至近","一級","絶好","買得","掘出","土地値","格安","投売り","破格","特安","激安","安値","バーゲンセール",
  "ディズニー","ユニバーサルスタジオ"
];

export async function POST(req: Request) {
  try {
    const {
      text = "",
      name = "",
      url = "",
      mustWords = [],
      minChars = 450,
      maxChars = 550,
      request = "",
    } = await req.json();

    if (!text) {
      return new Response(JSON.stringify({ error: "text は必須です" }), { status: 400 });
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // “json” を明記
    const sys =
      'Return ONLY a json object like {"improved": string, "issues": string[], "summary": string}. (json)\n' +
      [
        "あなたは日本語の不動産コピーの校閲/編集者です。",
        `文字数は【厳守】${minChars}〜${maxChars}（全角）。`,
        "価格/金額/円/万円などの金額表現は禁止。",
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
        "マストワードが自然に含まれるか",
        "交通・周辺の具体性が過不足なく1回以上あるか",
        "禁止語（上記）・価格/金額/円/万円・電話番号・URLが含まれていないか",
        `文字数が ${minChars}〜${maxChars} に収まっているか`,
        "誤字脱字/不自然表現/重複表現がないか",
      ],
    };

    const r = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: sys },
        { role: "user", content: JSON.stringify(payload) },
      ],
    });

    let improved = text;
    let issues: string[] = [];
    let summary = "";
    try {
      const p = JSON.parse(r.choices?.[0]?.message?.content || "{}");
      improved = String(p?.improved ?? text);
      issues = Array.isArray(p?.issues) ? p.issues : [];
      summary = String(p?.summary ?? "");
    } catch {}

    // 価格の最終サニタイズ（保険）
    const strip = (s: string) =>
      s.replace(/(価格|金額|[\d０-９,，\.]+(?:万)?円)/g, "").replace(/\s{2,}/g, " ").trim();
    improved = strip(improved);

    // レンジ外なら再圧縮
    if (countJa(improved) < minChars || countJa(improved) > maxChars) {
      const r2 = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              'Output ONLY {"improved": string}. (json)\n' +
              `日本語で、文字数は【厳守】${minChars}〜${maxChars}（全角）。価格/金額/円/万円は禁止。` +
              `禁止語：${BANNED.join("、")}`,
          },
          { role: "user", content: JSON.stringify({ text: improved, request }) },
        ],
      });
      try {
        const p2 = JSON.parse(r2.choices?.[0]?.message?.content || "{}");
        improved = strip(String(p2?.improved || improved));
      } catch {}
    }

    return new Response(
      JSON.stringify({ improved, issues, summary: summary || (issues.length ? issues.join(" / ") : "") }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || "server error" }), { status: 500 });
  }
}
