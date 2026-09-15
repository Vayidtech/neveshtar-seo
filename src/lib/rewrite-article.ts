import { createServerFn } from "@tanstack/react-start";

export type OutputLang = "fa" | "en";
export type Provider = "openai" | "grok" | "gemini";
export type LengthStrategy = "auto" | "expand" | "condense" | "custom";

export type ImageResult = {
  title: string;
  prompt: string;
  url?: string;
  altText?: string;
  type?: "hero" | "infographic" | "summary";
};

export type SeoAuditItem = {
  name: string;
  status: "pass" | "warning" | "info";
  description: string;
};

export type RewriteResult = {
  ok: true;
  title: string;
  titleAlternatives: string[];
  slug: string;
  keyword: string;
  secondaryKeywords: string[];
  description: string;
  updatedText: string;
  htmlContent: string;
  images: ImageResult[];
  provider: Provider;
  model: string;
  approxCost?: string;
  sourceChecked: boolean;
  originalWordCount: number;
  refreshedWordCount: number;
  lengthActionTaken: "expanded" | "condensed" | "balanced";
  estimatedReadingTimeMinutes: number;
  summaryOfImprovements: string[];
  seoScore: number;
  seoAudit: SeoAuditItem[];
};

export type RewriteError = { ok: false; error: string };

export type RewriteInput = {
  url: string;
  text: string;
  keyword: string;
  targetChars: number;
  lengthStrategy: LengthStrategy;
  websiteContext?: string;
  recentNotes?: string;
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

function countWords(text: string): number {
  if (!text) return 0;
  return text.trim().split(/\s+/).filter(Boolean).length;
}

const PROVIDER_CONFIG: Record<Provider, { baseUrl: string; defaultModel: string; models: string[] }> = {
  openai: {
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o",
    models: ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4.1-mini"],
  },
  gemini: {
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    defaultModel: "gemini-2.0-flash",
    models: [
      "gemini-2.0-flash",
      "gemini-2.5-flash",
      "gemini-1.5-flash",
      "gemini-1.5-pro",
      "gemini-2.5-pro",
    ],
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
  openaiKey: string,
  prompt: string,
  geminiKey?: string,
): Promise<string | undefined> {
  const modelsToTry = ["dall-e-3", "gpt-image-1", "gpt-image-1-mini", "dall-e-2"];

  if (openaiKey) {
    for (const model of modelsToTry) {
      try {
        const res = await fetch("https://api.openai.com/v1/images/generations", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${openaiKey}`,
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
    const imgMarker = line.match(/<!--\s*IMAGE_(\d)\s*-->/i);
    if (imgMarker) {
      flushList();
      const idx = Math.max(0, Number(imgMarker[1]) - 1);
      const img = images[idx];
      blocks.push({
        type: "img",
        alt: img?.altText || img?.title || `تصویر ${idx + 1}`,
        src: img?.url || "",
      });
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
      b.type !== "img" &&
      ((!insertedFirst && b.type === "p") || (b.type === "h1" && h1Count > 0 && h1Count % 3 === 0));

    if (shouldPlace) {
      const img = images[imgIdx];
      withImgs.push({
        type: "img",
        alt: img.altText || img.title || `تصویر ${imgIdx + 1}`,
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
      alt: img.altText || img.title || `تصویر ${imgIdx + 1}`,
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
    let baseUrl = cfg.baseUrl;
    const freeGeminiKey = (data.geminiKey || "").trim();
    const openaiKey = (data.apiKey || "").trim();

    if (provider === "grok") {
      chatKey = (data.xaiKey || process.env.XAI_API_KEY || "").trim();
      imageKey = openaiKey || chatKey;
      if (!chatKey) return { ok: false, error: "کلید xAI تنظیم نشده." };
    } else if (provider === "gemini") {
      if (freeGeminiKey) {
        chatKey = freeGeminiKey;
        imageKey = freeGeminiKey;
        baseUrl = "https://generativelanguage.googleapis.com/v1beta/openai";
      } else {
        return {
          ok: false,
          error: "برای Gemini کلید رایگان Google AI Studio (AIza...) را در تنظیمات بگذارید.",
        };
      }
    } else {
      chatKey = openaiKey;
      imageKey = openaiKey;
      baseUrl = "https://api.openai.com/v1";
      if (!chatKey) return { ok: false, error: "کلید OpenAI (ChatGPT) تنظیم نشده." };
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
    const originalWordCount = countWords(source);
    const lengthStrategy = data.lengthStrategy || "custom";
    const websiteContext = (data.websiteContext || "").trim();
    const recentNotes = (data.recentNotes || "").trim();

    let lengthGuidance = "";
    if (lengthStrategy === "expand" || (lengthStrategy === "auto" && originalWordCount < 350)) {
      lengthGuidance = `متن کوتاه است (${originalWordCount} کلمه). با بخش‌های عمیق، H2/H3، آمار به‌روز، مثال و FAQ به حدود 800–1400 کلمه گسترش دهید.`;
    } else if (lengthStrategy === "condense" || (lengthStrategy === "auto" && originalWordCount > 1400)) {
      lengthGuidance = `متن طولانی است (${originalWordCount} کلمه). زوائد را حذف و به حدود 650–950 کلمه متمرکز کنید.`;
    } else if (lengthStrategy === "custom") {
      lengthGuidance = `طول هدف حدود ${targetChars} کاراکتر (±12%) است.`;
    } else {
      lengthGuidance = `طول فعلی (${originalWordCount} کلمه) مناسب است؛ به حدود 750–1000 کلمه بهینه کنید.`;
    }

    const langHint =
      data.lang === "fa"
        ? "Write ALL body text, titles, headings, list items in Persian (Farsi)."
        : "Write ALL body text in English.";

    const prompt = `You are a senior SEO editor for a Persian parenting magazine (gahvarak.com style).
Update with CURRENT research (2024-2026, CDC/AAP when relevant). Do NOT recycle outdated advice.

${langHint}
Length strategy: ${lengthGuidance}
Primary keyword: ${data.keyword || "(infer)"}
Website context: ${websiteContext || "parenting / baby care magazine (گهوارک)"}
Recent site direction: ${recentNotes || "latest standards and trends"}

Structure updatedText:
1. Short intro paragraph (no heading).
2. Many # H1 sections, ## H2, ### H3.
3. Use - for bullets and **bold** for key terms.
4. Include # فهرست مطالب early.
5. End with # سوالات متداول and # جمع‌بندی.
6. Place markers <!-- IMAGE_1 -->, <!-- IMAGE_2 -->, <!-- IMAGE_3 --> where images should appear.

Return ONLY one valid JSON object (no markdown fences):
{
  "title": "SEO title max 60 chars",
  "titleAlternatives": ["alt1","alt2","alt3"],
  "slug": "english-only-hyphenated-slug",
  "keyword": "primary keyword",
  "secondaryKeywords": ["kw1","kw2","kw3","kw4","kw5"],
  "description": "meta 130-155 chars with CTA",
  "updatedText": "full body with # ## ### - **bold** and IMAGE markers. No HTML tags.",
  "summaryOfImprovements": ["improvement 1","improvement 2","improvement 3"],
  "seoScore": 90,
  "seoAudit": [
    {"name":"کلمه کلیدی در عنوان","status":"pass","description":"..."},
    {"name":"طول متا","status":"pass","description":"..."},
    {"name":"ساختار تیترها","status":"pass","description":"..."},
    {"name":"کیفیت اسلاگ","status":"pass","description":"..."},
    {"name":"تصاویر و alt","status":"pass","description":"..."}
  ],
  "images": [
    {"title":"عنوان فارسی","altText":"alt فارسی با کلمه کلیدی","prompt":"ENGLISH hero 16:9 editorial photo, no text","type":"hero"},
    {"title":"...","altText":"...","prompt":"ENGLISH infographic 4:3","type":"infographic"},
    {"title":"...","altText":"...","prompt":"ENGLISH summary visual","type":"summary"}
  ]
}

slug MUST be pure English kebab-case. Never Finglish or Persian letters.

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

    const res = await fetch(`${baseUrl}/chat/completions`, {
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
      titleAlternatives?: string[];
      slug?: string;
      keyword?: string;
      secondaryKeywords?: string[];
      description?: string;
      updatedText?: string;
      summaryOfImprovements?: string[];
      seoScore?: number;
      seoAudit?: SeoAuditItem[];
      images?: { title?: string; altText?: string; prompt?: string; type?: string }[];
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
        altText: img.altText?.trim() || img.title?.trim() || `تصویر ${i + 1}`,
        prompt: img.prompt?.trim() || "",
        type: (img.type as ImageResult["type"]) || (i === 0 ? "hero" : i === 1 ? "infographic" : "summary"),
      }))
      .filter((img) => img.prompt);

    while (images.length < 3) {
      const i = images.length;
      images.push({
        title: `تصویر مرتبط با ${parsed.keyword || data.keyword || "موضوع مقاله"}`,
        altText: `تصویر مرتبط با ${parsed.keyword || data.keyword || "موضوع مقاله"}`,
        prompt: `Professional editorial photograph about ${parsed.keyword || data.keyword || "baby complementary feeding"}, soft natural light, realistic, no text, no watermark`,
        type: i === 0 ? "hero" : i === 1 ? "infographic" : "summary",
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

    const refreshedWordCount = countWords(plain || rawText);
    let lengthActionTaken: "expanded" | "condensed" | "balanced" = "balanced";
    if (refreshedWordCount > originalWordCount + 150) lengthActionTaken = "expanded";
    else if (refreshedWordCount < originalWordCount - 150) lengthActionTaken = "condensed";

    return {
      ok: true,
      title: parsed.title?.trim() || "مقاله به‌روز",
      titleAlternatives: (parsed.titleAlternatives || []).filter(Boolean).slice(0, 5),
      slug: slug || "updated-article",
      keyword: parsed.keyword?.trim() || data.keyword || "",
      secondaryKeywords: (parsed.secondaryKeywords || []).filter(Boolean).slice(0, 8),
      description: parsed.description?.trim() || "",
      updatedText: plain || rawText,
      htmlContent,
      images,
      provider,
      model,
      approxCost: undefined,
      sourceChecked,
      originalWordCount,
      refreshedWordCount,
      lengthActionTaken,
      estimatedReadingTimeMinutes: Math.max(1, Math.round(refreshedWordCount / 180)),
      summaryOfImprovements: (parsed.summaryOfImprovements || []).filter(Boolean).slice(0, 8),
      seoScore: typeof parsed.seoScore === "number" ? parsed.seoScore : 0,
      seoAudit: Array.isArray(parsed.seoAudit) ? parsed.seoAudit.slice(0, 10) : [],
    };
  });
