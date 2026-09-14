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
  backlinkSite: string;
  backlinkLabel: string;
};

const MAX_SOURCE = 14_000;
const MAX_FETCH = 400_000;

const PROVIDER_CONFIG: Record<Provider, { baseUrl: string; defaultModel: string; models: string[] }> = {
  openai: { baseUrl: "https://api.gapgpt.app/v1", defaultModel: "gpt-4o", models: ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4.1-mini"] },
  gemini: { baseUrl: "https://api.gapgpt.app/v1", defaultModel: "gemini-2.0-flash", models: ["gemini-2.0-flash", "gemini-2.5-pro", "gemini-1.5-pro", "gemini-1.5-flash"] },
  grok: { baseUrl: "https://api.x.ai/v1", defaultModel: "grok-4.5", models: ["grok-4.5", "grok-3", "grok-2"] },
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
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("پاسخ مدل قابل پارس نبود");
  return JSON.parse(candidate.slice(start, end + 1));
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

async function generateImage(apiKey: string, prompt: string): Promise<string | undefined> {
  const modelsToTry = [
    "gemini-2.5-flash-image",
    "gemini-2.0-flash-preview-image-generation",
    "imagen-3.0-generate-002",
    "dall-e-3",
    "gpt-image-1",
  ];
  for (const model of modelsToTry) {
    try {
      const res = await fetch("https://api.gapgpt.app/v1/images/generations", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
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
  return undefined;
}

/** Escape HTML special chars without writing entity literals that get decoded in transit */
function escapeHtml(s: string): string {
  return s
    .split("&").join("&" + "amp;")
    .split("<").join("&" + "lt;")
    .split(">").join("&" + "gt;")
    .split('"').join("&" + "quot;");
}

type Block =
  | { type: "h1"; text: string }
  | { type: "h2"; text: string }
  | { type: "p"; text: string }
  | { type: "ul"; items: string[] }
  | { type: "img"; alt: string; src: string };

function buildGahvarakHtml(blocks: Block[]): string {
  const out: string[] = [];
  for (const b of blocks) {
    if (b.type === "h1") out.push(`<h1>${escapeHtml(b.text)}</h1>`);
    else if (b.type === "h2") out.push(`<h2>${escapeHtml(b.text)}</h2>`);
    else if (b.type === "p") {
      const html = escapeHtml(b.text).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\n/g, "<br />");
      out.push(`<p style="text-align:start">${html}</p>`);
    } else if (b.type === "ul") {
      out.push(`<ul>${b.items.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>`);
    } else if (b.type === "img" && b.src) {
      out.push(`<p style="text-align:center"><img alt="${escapeHtml(b.alt)}" src="${escapeHtml(b.src)}" /></p>`);
    }
  }
  return out.join("");
}

function parseBlocks(text: string, images: ImageResult[], backlinkSite: string, backlinkLabel: string): { blocks: Block[]; plain: string } {
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
    if (line.startsWith("# ") || /^H1:\s*/i.test(line)) {
      flushList();
      blocks.push({ type: "h1", text: line.replace(/^#\s+/, "").replace(/^H1:\s*/i, "").trim() });
    } else if (line.startsWith("## ") || /^H2:\s*/i.test(line)) {
      flushList();
      blocks.push({ type: "h2", text: line.replace(/^##\s+/, "").replace(/^H2:\s*/i, "").trim() });
    } else if (line.startsWith("- ") || line.startsWith("• ")) {
      listBuf.push(line.replace(/^[-•]\s+/, "").trim());
    } else {
      flushList();
      blocks.push({ type: "p", text: line });
    }
  }
  flushList();

  const withImgs: Block[] = [];
  let imgIdx = 0;
  let h1Count = 0;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    withImgs.push(b);
    if (b.type === "h1") h1Count++;
    if (imgIdx < images.length && images[imgIdx]?.url) {
      if ((i === 0 && b.type === "p") || (b.type === "h1" && h1Count % 2 === 0)) {
        withImgs.push({ type: "img", alt: images[imgIdx].title, src: images[imgIdx].url! });
        imgIdx++;
      }
    }
  }
  while (imgIdx < images.length && images[imgIdx]?.url) {
    withImgs.push({ type: "img", alt: images[imgIdx].title, src: images[imgIdx].url! });
    imgIdx++;
  }

  if (backlinkSite) {
    let pCount = 0;
    for (const b of withImgs) {
      if (b.type === "p") {
        pCount++;
        if (pCount === 2) {
          b.text = `${b.text} برای راهنمایی بیشتر می‌توانید به سایت ${backlinkLabel || "گهوارک"} (${backlinkSite}) مراجعه کنید.`;
          break;
        }
      }
    }
  }

  const plain = withImgs
    .filter((b) => b.type !== "img")
    .map((b) => {
      if (b.type === "h1" || b.type === "h2" || b.type === "p") return b.text;
      if (b.type === "ul") return b.items.map((i) => `• ${i}`).join("\n");
      return "";
    })
    .join("\n\n");

  return { blocks: withImgs, plain };
}

function injectBacklink(html: string, site: string, label: string): string {
  if (!site) return html;
  const L = escapeHtml(label || "گهوارک");
  const H = escapeHtml(site);
  const re = new RegExp(
    L.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
      " \\(" +
      H.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
      "\\)",
    "g",
  );
  return html.replace(re, `<a href="${H}" target="_blank" rel="noopener noreferrer">${L}</a>`);
}

export const rewriteArticle = createServerFn({ method: "POST" })
  .validator((input: RewriteInput) => input)
  .handler(async ({ data }): Promise<RewriteResult | RewriteError> => {
    const provider = data.provider || "openai";
    const cfg = PROVIDER_CONFIG[provider];
    const model = data.model || cfg.defaultModel;
    const targetChars = Math.min(25000, Math.max(500, data.targetChars || 4000));
    const backlinkSite = (data.backlinkSite || "https://gahvarak.com/").trim();
    const backlinkLabel = (data.backlinkLabel || "گهوارک").trim();

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

    const prompt = `You are a senior SEO editor. UPDATE this article with CURRENT research (2024-2026, CDC/AAP when relevant). Do NOT recycle outdated advice.

${langHint}
Target length: about ${targetChars} CHARACTERS (±12%).
Keyword: ${data.keyword || "(infer)"}
Naturally mention "${backlinkLabel}" (${backlinkSite}) 1-2 times.

Return ONLY JSON:
{
  "title": "SEO title max 70 chars",
  "slug": "english-only-hyphenated-slug",
  "keyword": "keyword",
  "description": "meta 140-160 chars",
  "updatedText": "body using # for H1, ## for H2, - for bullets, **bold**, blank lines between paragraphs. No HTML.",
  "images": [{"title": "Persian alt", "prompt": "ENGLISH photo prompt, realistic, no text"}, {"title": "...", "prompt": "..."}, {"title": "...", "prompt": "..."}]
}

slug MUST be pure English (e.g. baby-complementary-feeding-guide). Never Finglish or Persian in slug.
Use many # H1 sections + FAQ with ##.

SOURCE:
${source}`;

    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${chatKey}` },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 6000,
        temperature: 0.4,
      }),
    });

    if (!res.ok) {
      let detail = "";
      try {
        detail = (await res.text()).slice(0, 200);
      } catch {
        /* */
      }
      return { ok: false, error: `خطای سرویس ${provider} (${res.status})${detail ? ": " + detail : ""}` };
    }

    const body = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
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
      return { ok: false, error: "پاسخ مدل قابل استفاده نبود." };
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
        prompt: `Professional editorial photo about ${parsed.keyword || data.keyword || "baby feeding"}, natural light, no text`,
      });
    }

    if (data.generateImages && imageKey) {
      const urls = await Promise.all(images.map((img) => generateImage(imageKey, img.prompt).catch(() => undefined)));
      urls.forEach((url, i) => {
        if (url) images[i].url = url;
      });
    }

    const rawText = parsed.updatedText?.trim() || "";
    const { blocks, plain } = parseBlocks(rawText, images, backlinkSite, backlinkLabel);
    let htmlContent = buildGahvarakHtml(blocks);
    htmlContent = injectBacklink(htmlContent, backlinkSite, backlinkLabel);

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
