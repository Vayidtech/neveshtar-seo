import { createServerFn } from "@tanstack/react-start";

export type LengthMode = "expand" | "medium" | "condense";
export type OutputLang = "fa" | "en";
export type Provider = "openai" | "grok" | "gemini";

export type ImageResult = {
  title: string;
  prompt: string;
  url?: string;
};

export type RewriteResult = {
  ok: true;
  title: string;
  slug: string;
  keyword: string;
  description: string;
  updatedText: string;
  images: ImageResult[];
  provider: Provider;
  model: string;
  approxCost?: string;
};

export type RewriteError = { ok: false; error: string };

export type RewriteInput = {
  url: string;
  text: string;
  keyword: string;
  lengthMode: LengthMode;
  lang: OutputLang;
  generateImages: boolean;
  provider: Provider;
  model: string;
  /** GapGPT or OpenAI-compatible key (for openai & gemini) */
  apiKey?: string;
  /** xAI key for Grok text + images */
  xaiKey?: string;
};

const MAX_SOURCE = 12_000;
const MAX_FETCH = 400_000;

const PROVIDER_CONFIG: Record<
  Provider,
  { baseUrl: string; defaultModel: string; models: string[] }
> = {
  openai: {
    baseUrl: "https://api.gapgpt.app/v1",
    defaultModel: "gpt-4o",
    models: ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4.1-mini"],
  },
  gemini: {
    baseUrl: "https://api.gapgpt.app/v1",
    defaultModel: "gemini-2.0-flash",
    models: ["gemini-2.0-flash", "gemini-2.5-pro", "gemini-1.5-pro", "gemini-1.5-flash"],
  },
  grok: {
    baseUrl: "https://api.x.ai/v1",
    defaultModel: "grok-4.5",
    models: ["grok-4.5", "grok-3", "grok-2"],
  },
};

export function getModelsForProvider(p: Provider): string[] {
  return PROVIDER_CONFIG[p].models;
}

export function getDefaultModel(p: Provider): string {
  return PROVIDER_CONFIG[p].defaultModel;
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&/g, "&")
    .replace(/</g, "<")
    .replace(/>/g, ">")
    .replace(/"/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchUrlText(url: string): Promise<string> {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("فقط لینک http/https مجاز است");
  }
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 12_000);
  try {
    const res = await fetch(parsed.toString(), {
      signal: controller.signal,
      headers: { "User-Agent": "NeveshtarSEO/1.0" },
    });
    if (!res.ok) throw new Error(`خواندن صفحه ناموفق بود (${res.status})`);
    const raw = await res.text();
    const clipped = raw.slice(0, MAX_FETCH);
    const text = stripHtml(clipped);
    if (text.length < 40) throw new Error("متن قابل استخراج از این صفحه پیدا نشد");
    return text.slice(0, MAX_SOURCE);
  } finally {
    clearTimeout(t);
  }
}

function extractJson(raw: string): unknown {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("پاسخ مدل قابل پارس نبود");
  return JSON.parse(candidate.slice(start, end + 1));
}

async function generateOneImage(
  provider: Provider,
  apiKey: string,
  prompt: string,
): Promise<string | undefined> {
  // GapGPT / OpenAI-compatible image
  try {
    const res = await fetch("https://api.gapgpt.app/v1/images/generations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "dall-e-3",
        prompt,
        n: 1,
        size: "1024x1024",
      }),
    });
    if (res.ok) {
      const body = (await res.json()) as { data?: { url?: string }[] };
      return body.data?.[0]?.url;
    }
  } catch {
    // fall through
  }

  // xAI fallback
  try {
    const res = await fetch("https://api.x.ai/v1/images/generations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "grok-imagine-image",
        prompt,
        n: 1,
        resolution: "1k",
      }),
    });
    if (res.ok) {
      const body = (await res.json()) as { data?: { url?: string }[] };
      return body.data?.[0]?.url;
    }
  } catch {
    // ignore
  }
  return undefined;
}

function roughTokenEstimate(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.ceil(words * 1.4);
}

function estimateCost(
  provider: Provider,
  model: string,
  inputTokens: number,
  outputTokens: number,
): string {
  const rates: Record<string, { in: number; out: number }> = {
    "gpt-4o": { in: 0.005, out: 0.015 },
    "gpt-4o-mini": { in: 0.00015, out: 0.0006 },
    "gpt-4.1": { in: 0.002, out: 0.008 },
    "gemini-2.0-flash": { in: 0.0001, out: 0.0004 },
    "gemini-2.5-pro": { in: 0.00125, out: 0.005 },
    "gemini-1.5-pro": { in: 0.00125, out: 0.005 },
    "grok-4.5": { in: 0.003, out: 0.015 },
    "grok-3": { in: 0.003, out: 0.015 },
    "grok-2": { in: 0.002, out: 0.01 },
  };
  const r = rates[model] || { in: 0.002, out: 0.008 };
  const usd = (inputTokens / 1000) * r.in + (outputTokens / 1000) * r.out;
  if (usd < 0.01) return `≈ $${usd.toFixed(4)}`;
  return `≈ $${usd.toFixed(3)}`;
}

export const rewriteArticle = createServerFn({ method: "POST" })
  .validator((input: RewriteInput) => input)
  .handler(async ({ data }): Promise<RewriteResult | RewriteError> => {
    const provider = data.provider || "openai";
    const cfg = PROVIDER_CONFIG[provider];
    const model = data.model || cfg.defaultModel;

    let chatKey = "";
    let imageKey = "";

    if (provider === "grok") {
      chatKey = (data.xaiKey || process.env.XAI_API_KEY || "").trim();
      imageKey = chatKey;
      if (!chatKey) {
        return {
          ok: false,
          error: "کلید xAI (Grok) تنظیم نشده. از صفحه تنظیمات وارد کنید.",
        };
      }
    } else {
      chatKey = (data.apiKey || "").trim();
      imageKey = chatKey || (data.xaiKey || process.env.XAI_API_KEY || "").trim();
      if (!chatKey) {
        return {
          ok: false,
          error:
            "کلید GapGPT / OpenAI-compatible تنظیم نشده. از صفحه تنظیمات کلید را وارد کنید.",
        };
      }
    }

    let source = (data.text || "").trim();
    if (data.url.trim()) {
      try {
        const fromUrl = await fetchUrlText(data.url.trim());
        source = source ? `${source}\n\n${fromUrl}` : fromUrl;
      } catch (e) {
        const msg = e instanceof Error ? e.message : "خطا در خواندن لینک";
        if (!source) return { ok: false, error: msg };
      }
    }
    if (!source) return { ok: false, error: "متن مقاله یا لینک را وارد کنید" };
    source = source.slice(0, MAX_SOURCE);

    const lengthHint =
      data.lengthMode === "expand"
        ? "If the source is short, expand it substantially with useful, factual-feeling detail while staying on topic. Target ~900–1400 words."
        : data.lengthMode === "condense"
          ? "If the source is long, condense to a medium article (~500–800 words) keeping key points."
          : "Rewrite to an optimal medium length (~700–1000 words). Expand short sources; trim rambling long sources.";

    const langHint =
      data.lang === "fa"
        ? "Write ALL output fields in Persian (Farsi). Slug must be ASCII lowercase hyphenated (transliterate if needed)."
        : "Write ALL output fields in English. Slug ASCII lowercase hyphenated.";

    const prompt = `You are a senior SEO editor. Update this article so it feels current and useful.

${langHint}
${lengthHint}
Target keyword (use naturally, do not stuff): ${data.keyword || "(infer from content)"}

Return ONLY a JSON object with:
- title: compelling SEO title (max 65 chars)
- slug: url path without leading slash
- keyword: primary keyword
- description: meta description 140–160 chars
- updatedText: full rewritten article, paragraphs separated by blank lines, no markdown headings except optional short H2 lines
- images: array of exactly 3 objects { "title": short label, "prompt": detailed English image-generation prompt for a professional editorial photo/illustration related to the article }

Do not mention that you are an AI. Keep claims cautious if the source is thin.

SOURCE:
${source}`;

    const chatUrl = `${cfg.baseUrl}/chat/completions`;

    const res = await fetch(chatUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${chatKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 3500,
        temperature: 0.5,
      }),
    });

    if (!res.ok) {
      let detail = "";
      try {
        const errBody = await res.text();
        detail = errBody.slice(0, 200);
      } catch {
        /* ignore */
      }
      return {
        ok: false,
        error: `خطای سرویس ${provider} (${res.status})${detail ? `: ${detail}` : ""}`,
      };
    }

    const body = (await res.json()) as {
      choices?: { message?: { content?: string }[] };
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const content = body.choices?.[0]?.message?.content ?? "";

    let parsed: {
      title?: string;
      slug?: string;
      keyword?: string;
      description?: string;
      updatedText?: string;
      images?: { title?: string; prompt?: string }[];
    };
    try {
      parsed = extractJson(content) as typeof parsed;
    } catch {
      return { ok: false, error: "پاسخ مدل قابل استفاده نبود. دوباره تلاش کنید." };
    }

    const images: ImageResult[] = (parsed.images ?? [])
      .slice(0, 3)
      .map((img, i) => ({
        title: img.title?.trim() || `تصویر ${i + 1}`,
        prompt: img.prompt?.trim() || "",
      }))
      .filter((img) => img.prompt);

    while (images.length < 3) {
      images.push({
        title: `تصویر ${images.length + 1}`,
        prompt: `Editorial photograph related to ${parsed.keyword || data.keyword || "the article topic"}, cinematic lighting, realistic, no text`,
      });
    }

    if (data.generateImages && imageKey) {
      const urls = await Promise.all(
        images.map((img) =>
          generateOneImage(provider, imageKey, img.prompt).catch(() => undefined),
        ),
      );
      urls.forEach((url, i) => {
        if (url) images[i].url = url;
      });
    }

    const inTok = body.usage?.prompt_tokens ?? roughTokenEstimate(source + prompt.slice(0, 500));
    const outTok =
      body.usage?.completion_tokens ?? roughTokenEstimate(parsed.updatedText || "");
    const approxCost = estimateCost(provider, model, inTok, outTok);

    return {
      ok: true,
      title: parsed.title?.trim() || "مقاله به‌روز",
      slug: (parsed.slug || "updated-article")
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 70),
      keyword: parsed.keyword?.trim() || data.keyword || "",
      description: parsed.description?.trim() || "",
      updatedText: parsed.updatedText?.trim() || "",
      images,
      provider,
      model,
      approxCost,
    };
  });
