import { createServerFn } from "@tanstack/react-start";

export type OutputLang = "fa" | "en";
export type Provider = "openai" | "grok" | "gemini";

export type ImageResult = { title: string; prompt: string; url?: string };

export type RewriteResult = {
  ok: true;
  title: string;
  slug: string;
  keyword: string;
  description: string;
  updatedText: string;
  htmlContent: string;
  images: ImageResult[];
  provider: Provider;
  model: string;
  approxCost?: string;
  sourceChecked: boolean;
};

export type RewriteError = { ok: false; error: string };

export type RewriteInput = {
  url: string;
  text: string;
  keyword: string;
  targetChars: number;
  lang: OutputLang;
  generateImages: boolean;
  provider: Provider;
  model: string;
  apiKey?: string;
  xaiKey?: string;
  geminiKey?: string;
};

const MAX_SOURCE = 14_000;
const MAX_FETCH = 400_000;

const PROVIDER_CONFIG: Record<Provider, { baseUrl: string; defaultModel: string; models: string[] }> = {
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
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchUrlTextTwice(url: string): Promise<{ text: string; checked: boolean }> {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("فقط لینک http/https مجاز است");
  }
  async function once(): Promise<string> {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 14_000);
    try {
      const res = await fetch(parsed.toString(), {
        signal: controller.signal,
        headers: { "User-Agent": "NeveshtarSEO/2.0", Accept: "text/html,application/xhtml+xml" },
        redirect: "follow",
      });
      if (!res.ok) throw new Error(`خواندن صفحه ناموفق بود (${res.status})`);
      const text = stripHtml((await res.text()).slice(0, MAX_FETCH));
      if (text.length < 40) throw new Error("متن قابل استخراج پیدا نشد");
      return text.slice(0, MAX_SOURCE);
    } finally {
      clearTimeout(t);
    }
  }
  let first: string;
  try {
    first = await once();
  } catch {
    try {
      first = await once();
    } catch (e2) {
      const msg = e2 instanceof Error ? e2.message : "خطا";
      throw new Error(`لینک بعد از دو بار تلاش قابل خواندن نبود: ${msg}`);
    }
  }
  try {
    const second = await once();
    return { text: second.length >= first.length ? second : first, checked: true };
  } catch {
    return { text: first, checked: true };
  }
}

function extractJson(raw: string): unknown {
  const trimmed = (raw || "").trim();
  if (!trimmed) throw new Error("empty");
  const candidates: string[] = [];
  const fenceRe = /```(?:json)?\s*([\s\S]*?)```/gi;
  let m: RegExpExecArray | null;
  while ((m = fenceRe.exec(trimmed)) !== null) {
    if (m[1]?.trim()) candidates.push(m[1].trim());
  }
  candidates.push(trimmed);
  const start0 = trimmed.indexOf("{");
  const end0 = trimmed.lastIndexOf("}");
  if (start0 !== -1 && end0 > start0) candidates.push(trimmed.slice(start0, end0 + 1));

  const tried = new Set<string>();
  for (let cand of candidates) {
    cand = cand.trim();
    if (!cand || tried.has(cand)) continue;
    tried.add(cand);
    let slice = cand;
    const s = slice.indexOf("{");
    if (s === -1) continue;
    slice = slice.slice(s);
    let depth = 0;
    let endIdx = -1;
    for (let i = 0; i < slice.length; i++) {
      if (slice[i] === "{") depth++;
      else if (slice[i] === "}") {
        depth--;
        if (depth === 0) {
          endIdx = i;
          break;
        }
      }
    }
    if (endIdx !== -1) slice = slice.slice(0, endIdx + 1);
    const variants = [
      slice,
      slice.replace(/,\s*([}\]])/g, "$1"),
      slice.replace(/[\u201C\u201D]/g, '"').replace(/[\u2018\u2019]/g, "'"),
    ];
    for (const v of variants) {
      try {
        return JSON.parse(v);
      } catch {
        /* next */
      }
    }
  }
  throw new Error("parse failed");
}

function toEnglishSlug(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

async function generateImage(
  gapKey: string,
  prompt: string,
  geminiKey?: string,
): Promise<string | undefined> {
  const modelsToTry = [
    "gemini-2.0-flash-preview-image-generation",
    "gemini-2.5-flash-image",
    "imagen-3.0-generate-002",
    "imagen-3",
    "dall-e-3",
    "gpt-image-1",
  ];

  if (gapKey) {
    for (const model of modelsToTry) {
      try {
        const res = await fetch("https://api.gapgpt.app/v1/images/generations", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${gapKey}`,
          },
          body: JSON.stringify({ model, prompt, n: 1, size: "1024x1024" }),
        });
        if (!res.ok) continue;
        const body = (await res.json()) as { data?: { url?: string; b64_json?: string }[] };
        const item = body.data?.[0];
        if (item?.url) return item.url;
        if (item?.b64_json) return `data:image/png;base64,${item.b64_json}`;
      } catch {
        /* next */
      }
    }
  }

  const gKey = (geminiKey || "").trim();
  if (gKey) {
    const endpoints = [
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-preview-image-generation:generateContent?key=${gKey}`,
      `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${gKey}`,
    ];
    for (const url of endpoints) {
      try {
        const isImagen = url.includes("imagen");
        const body = isImagen
          ? { instances: [{ prompt }], parameters: { sampleCount: 1 } }
          : {
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
            };
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) continue;
        const data = (await res.json()) as {
          candidates?: { content?: { parts?: { inlineData?: { data?: string; mimeType?: string } }[] } }[];
          predictions?: { bytesBase64Encoded?: string }[];
        };
        const part = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
        if (part?.inlineData?.data) {
          const mime = part.inlineData.mimeType || "image/png";
          return `data:${mime};base64,${part.inlineData.data}`;
        }
        const pred = data.predictions?.[0]?.bytesBase64Encoded;
        if (pred) return `data:image/png;base64,${pred}`;
      } catch {
        /* next */
      }
    }
  }

  return undefined;
}

function escapeHtml(s: string): string {
  return s
    .split("&")
    .join("&" + "amp;")
    .split("<")
    .join("&" + "lt;")
    .split(">")
    .join("&" + "gt;")
    .split('"')
    .join("&" + "quot;");
}

type Block =
  | { type: "h1"; text: string }
  | { type: "h2"; text: string }
  | { type: "h3"; text: string }
  | { type: "p"; text: string }
  | { type: "ul"; items: string[] }
  | { type: "img"; alt: string; src: string };

function buildGahvarakHtml(blocks: Block[]): string {
  const out: string[] = [];
  for (const b of blocks) {
    if (b.type === "h1") {
      out.push(`<h1>${escapeHtml(b.text)}</h1>`);
    } else if (b.type === "h2") {
      out.push(`<h2>${escapeHtml(b.text)}</h2>`);
    } else if (b.type === "h3") {
      out.push(`<h3>${escapeHtml(b.text)}</h3>`);
    } else if (b.type === "p") {
      const html = escapeHtml(b.text)
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        .replace(/\n/g, "<br />");
      out.push(`<p style="text-align:start">${html}</p>`);
    } else if (b.type === "ul") {
      const items = b.items.map((i) => `<li>${escapeHtml(i)}</li>`).join("");
      out.push(`<ul>${items}</ul>`);
    } else if (b.type === "img") {
      const src = b.src || "";
      out.push(
        `<p style="text-align:center"><img alt="${escapeHtml(b.alt)}" src="${escapeHtml(src)}" /></p>`,
      );
    }
  }
  return out.join("\n");
}

function parseBlocks(text: string, images: ImageResult[]): { blocks: Block[]; plain: string } {
  const lines = text.split(/\n/);
  const blocks: Block[] = [];
  let listBuf: string[] = [];

  const flushList = () => {
    if (listBuf.length) {
      blocks.push({ type: "ul", items: [...listBuf] });
      listBuf = [];
    }
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flushList();
      continue;
    }
    if (line.startsWith("### ") || /^H3:\s*/i.test(line)) {
      flushList();
      blocks.push({
        type: "h3",
        text: line.replace(/^###\s+/, "").replace(/^H3:\s*/i, "").trim(),
      });
    } else if (line.startsWith("## ") || /^H2:\s*/i.test(line)) {
      flushList();
      blocks.push({
        type: "h2",
        text: line.replace(/^##\s+/, "").replace(/^H2:\s*/i, "").trim(),
      });
    } else if (line.startsWith("# ") || /^H1:\s*/i.test(line)) {
      flushList();
      blocks.push({
        type: "h1",
        text: line.replace(/^#\s+/, "").replace(/^H1:\s*/i, "").trim(),
      });
    } else if (line.startsWith("- ") || line.startsWith("* ") || line.startsWith("• ")) {
      listBuf.push(line.replace(/^[-*•]\s+/, "").trim());
    } else if (/^\d+\)\s+/.test(line) || /^\d+\.\s+/.test(line)) {
      listBuf.push(line.replace(/^\d+[).]\s+/, "").trim());
    } else {
      flushList();
      blocks.push({ type: "p", text: line });
    }
  }
  flushList();

  const withImgs: Block[] = [];
  let imgIdx = 0;
  let h1Count = 0;
  let insertedFirst = false;

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    withImgs.push(b);
    if (b.type === "h1") h1Count++;

    const shouldPlace =
      imgIdx < images.length &&
      ((!insertedFirst && b.type === "p") || (b.type === "h1" && h1Count > 0 && h1Count % 3 === 0));

    if (shouldPlace) {
      const img = images[imgIdx];
      withImgs.push({
        type: "img",
        alt: img.title || `تصویر ${imgIdx + 1}`,
        src: img.url || "",
      });
      if (!insertedFirst) insertedFirst = true;
      imgIdx++;
    }
  }

  while (imgIdx < images.length) {
    const img = images[imgIdx];
    withImgs.push({
      type: "img",
      alt: img.title || `تصویر ${imgIdx + 1}`,
      src: img.url || "",
    });
    imgIdx++;
  }

  const plain = withImgs
    .filter((b) => b.type !== "img")
    .map((b) => {
      if (b.type === "h1") return `# ${b.text}`;
      if (b.type === "h2") return `## ${b.text}`;
      if (b.type === "h3") return `### ${b.text}`;
      if (b.type === "p") return b.text;
      if (b.type === "ul") return b.items.map((i) => `- ${i}`).join("\n");
      return "";
    })
    .join("\n\n");

  return { blocks: withImgs, plain };
}

export const rewriteArticle = createServerFn({ method: "POST" })
  .validator((input: RewriteInput) => input)
  .handler(async ({ data }): Promise<RewriteResult | RewriteError> => {
    const provider = data.provider || "openai";
    const cfg = PROVIDER_CONFIG[provider];
    const model = data.model || cfg.defaultModel;
    const targetChars = Math.min(25000, Math.max(500, data.targetChars || 4000));

    let chatKey = "";
    let imageKey = "";
    if (provider === "grok") {
      chatKey = (data.xaiKey || process.env.XAI_API_KEY || "").trim();
      imageKey = (data.apiKey || chatKey).trim();
      if (!chatKey) return { ok: false, error: "کلید xAI تنظیم نشده." };
    } else {
      chatKey = (data.apiKey || "").trim();
      imageKey = chatKey;
      if (!chatKey) return { ok: false, error: "کلید GapGPT تنظیم نشده." };
    }

    let source = (data.text || "").trim();
    let sourceChecked = false;
    if (data.url.trim()) {
      try {
        const r = await fetchUrlTextTwice(data.url.trim());
        sourceChecked = r.checked;
        source = source ? `${source}\n\n${r.text}` : r.text;
      } catch (e) {
        const msg = e instanceof Error ? e.message : "خطا در لینک";
        if (!source) return { ok: false, error: msg };
      }
    }
    if (!source) return { ok: false, error: "متن یا لینک را وارد کنید" };
    source = source.slice(0, MAX_SOURCE);

    const langHint =
      data.lang === "fa"
        ? "Write ALL body text, titles, headings, list items in Persian (Farsi)."
        : "Write ALL body text in English.";

    const prompt = `You are a senior SEO editor writing for a Persian parenting magazine (style of gahvarak.com).
UPDATE this article with CURRENT research (2024-2026, CDC/AAP when relevant). Do NOT recycle outdated advice.

${langHint}
Target length: about ${targetChars} CHARACTERS (±12%).
Keyword: ${data.keyword || "(infer)"}

Structure the article EXACTLY like a comprehensive guide:
1. Start updatedText with a short intro paragraph (no heading).
2. Then many sections with # for main H1 titles.
3. Use ## for H2 subsections (e.g. under FAQ).
4. Use ### for H3 if needed.
5. Use - for bullet lists.
6. Use **bold** for key terms.
7. Include a # فهرست مطالب section early with numbered list of all H1 topics.
8. End with # سوالات متداول (FAQ with ## questions) and # جمع‌بندی.

Return ONLY one valid JSON object (no markdown fences):
{
  "title": "SEO title max 70 chars",
  "slug": "english-only-hyphenated-slug",
  "keyword": "keyword",
  "description": "meta 140-160 chars",
  "updatedText": "full body with # ## ### - and **bold** only. No HTML tags.",
  "images": [
    {"title": "Persian alt text for image 1", "prompt": "detailed ENGLISH photo prompt, realistic editorial parenting, no text watermark"},
    {"title": "Persian alt text for image 2", "prompt": "..."},
    {"title": "Persian alt text for image 3", "prompt": "..."}
  ]
}

slug MUST be pure English (e.g. complementary-feeding-baby). Never Finglish or Persian letters in slug.

SOURCE:
${source}`;

    const payload: Record<string, unknown> = {
      model,
      messages: [
        {
          role: "system",
          content:
            "You are a JSON API. Respond with a single valid JSON object only. No markdown fences, no commentary.",
        },
        { role: "user", content: prompt },
      ],
      max_tokens: 8000,
      temperature: 0.25,
    };
    if (provider !== "grok") {
      payload.response_format = { type: "json_object" };
    }

    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${chatKey}` },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      let detail = "";
      try {
        detail = (await res.text()).slice(0, 200);
      } catch {
        /* */
      }
      return {
        ok: false,
        error: `خطای سرویس ${provider} (${res.status})${detail ? ": " + detail : ""}`,
      };
    }

    const body = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
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
      const snippet = (content || "").replace(/\s+/g, " ").slice(0, 120);
      return {
        ok: false,
        error: snippet
          ? `پاسخ مدل قابل استفاده نبود. نمونه: ${snippet}`
          : "پاسخ مدل خالی بود. مدل یا کلید را بررسی کنید.",
      };
    }

    if (!parsed.updatedText && !parsed.title) {
      return { ok: false, error: "مدل فیلدهای ضروری (title/updatedText) را برنگرداند." };
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
        title: `تصویر مرتبط با ${parsed.keyword || data.keyword || "موضوع مقاله"}`,
        prompt: `Professional editorial photograph about ${parsed.keyword || data.keyword || "baby complementary feeding"}, soft natural light, realistic, no text, no watermark`,
      });
    }

    if (data.generateImages) {
      const urls = await Promise.all(
        images.map((img) =>
          generateImage(imageKey, img.prompt, data.geminiKey).catch(() => undefined),
        ),
      );
      urls.forEach((url, i) => {
        if (url) images[i].url = url;
      });
    }

    const rawText = parsed.updatedText?.trim() || "";
    const { blocks, plain } = parseBlocks(rawText, images);
    const htmlContent = buildGahvarakHtml(blocks);
    const slug = toEnglishSlug(parsed.slug || parsed.title || "updated-article");

    return {
      ok: true,
      title: parsed.title?.trim() || "مقاله به‌روز",
      slug: slug || "updated-article",
      keyword: parsed.keyword?.trim() || data.keyword || "",
      description: parsed.description?.trim() || "",
      updatedText: plain || rawText,
      htmlContent,
      images,
      provider,
      model,
      approxCost: undefined,
      sourceChecked,
    };
  });
