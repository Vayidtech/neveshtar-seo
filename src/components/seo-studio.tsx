import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  ArrowRight,
  Check,
  Copy,
  Download,
  FileText,
  History,
  ImageIcon,
  Loader2,
  RotateCcw,
  Settings,
  Sparkles,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  getDefaultModel,
  getModelsForProvider,
  rewriteArticle,
  type LengthMode,
  type OutputLang,
  type Provider,
  type RewriteResult,
} from "@/lib/rewrite-article";

const LENGTHS: { id: LengthMode; label: string; hint: string }[] = [
  { id: "expand", label: "بلندتر", hint: "متن کوتاه را گسترش بده" },
  { id: "medium", label: "متوسط", hint: "طول بهینه برای سئو" },
  { id: "condense", label: "کوتاه‌تر", hint: "متن خیلی بلند را جمع کن" },
];

const PROVIDERS: { id: Provider; label: string; hint: string }[] = [
  { id: "openai", label: "OpenAI", hint: "از طریق GapGPT (GPT-4o …)" },
  { id: "gemini", label: "Gemini", hint: "از طریق GapGPT" },
  { id: "grok", label: "Grok", hint: "مستقیم xAI" },
];

const HISTORY_KEY = "neveshtar-history-v1";
const SETTINGS_KEY = "neveshtar-settings-v1";

type Settings = {
  gapgptKey: string;
  xaiKey: string;
  defaultProvider: Provider;
};

type HistoryItem = {
  id: string;
  createdAt: number;
  title: string;
  keyword: string;
  provider: Provider;
  model: string;
  result: RewriteResult;
};

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return JSON.parse(raw) as Settings;
  } catch {
    /* ignore */
  }
  return { gapgptKey: "", xaiKey: "", defaultProvider: "openai" };
}

function saveSettings(s: Settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

function loadHistory(): HistoryItem[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (raw) return JSON.parse(raw) as HistoryItem[];
  } catch {
    /* ignore */
  }
  return [];
}

function saveHistory(items: HistoryItem[]) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, 40)));
}

function copy(text: string) {
  void navigator.clipboard.writeText(text);
}

function downloadText(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function buildHtml(result: RewriteResult): string {
  const imgs = result.images
    .filter((i) => i.url)
    .map(
      (i) =>
        `<figure style="margin:1.5rem 0"><img src="${i.url}" alt="${escapeHtml(i.title)}" style="max-width:100%;border-radius:8px"/><figcaption style="font-size:0.85rem;color:#666;margin-top:0.4rem">${escapeHtml(i.title)}</figcaption></figure>`,
    )
    .join("\n");

  const body = escapeHtml(result.updatedText).replace(/\n\n/g, "</p><p>").replace(/\n/g, "<br/>");

  return `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${escapeHtml(result.title)}</title>
<meta name="description" content="${escapeHtml(result.description)}"/>
<meta name="keywords" content="${escapeHtml(result.keyword)}"/>
<style>
  body{font-family:Tahoma,Vazirmatn,system-ui,sans-serif;line-height:1.8;max-width:720px;margin:2rem auto;padding:0 1rem;color:#111;background:#fff}
  h1{font-size:1.75rem;margin-bottom:0.5rem}
  .meta{color:#555;font-size:0.9rem;margin-bottom:2rem}
  p{margin:0 0 1rem}
</style>
</head>
<body>
<article>
  <h1>${escapeHtml(result.title)}</h1>
  <div class="meta">کلمه کلیدی: ${escapeHtml(result.keyword)} · مدل: ${escapeHtml(result.model)}</div>
  <p>${body}</p>
  ${imgs}
</article>
</body>
</html>`;
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildWordHtml(result: RewriteResult): string {
  return `
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><title>${escapeHtml(result.title)}</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View></w:WordDocument></xml><![endif]-->
<style>
body{font-family:Tahoma,Arial;direction:rtl;text-align:right;line-height:1.8}
h1{font-size:18pt}
p{font-size:12pt;margin:0 0 12pt}
</style>
</head>
<body>
<h1>${escapeHtml(result.title)}</h1>
<p><b>کلمه کلیدی:</b> ${escapeHtml(result.keyword)}</p>
<p><b>توضیحات متا:</b> ${escapeHtml(result.description)}</p>
<hr/>
${escapeHtml(result.updatedText)
  .split(/\n\n+/)
  .map((p) => `<p>${p.replace(/\n/g, "<br/>")}</p>`)
  .join("\n")}
</body>
</html>`;
}

export function SeoStudio() {
  const [settings, setSettings] = useState<Settings>(() =>
    typeof window !== "undefined" ? loadSettings() : { gapgptKey: "", xaiKey: "", defaultProvider: "openai" },
  );
  const [showSettings, setShowSettings] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);

  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [keyword, setKeyword] = useState("");
  const [lang, setLang] = useState<OutputLang>("fa");
  const [lengthMode, setLengthMode] = useState<LengthMode>("medium");
  const [generateImages, setGenerateImages] = useState(true);
  const [provider, setProvider] = useState<Provider>("openai");
  const [model, setModel] = useState(getDefaultModel("openai"));

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RewriteResult | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [tab, setTab] = useState<"new" | "compare">("new");
  const [original, setOriginal] = useState("");

  useEffect(() => {
    setHistory(loadHistory());
    const s = loadSettings();
    setSettings(s);
    setProvider(s.defaultProvider);
    setModel(getDefaultModel(s.defaultProvider));
  }, []);

  const models = useMemo(() => getModelsForProvider(provider), [provider]);

  const wordCount = useMemo(() => {
    if (!result) return 0;
    return result.updatedText.split(/\s+/).filter(Boolean).length;
  }, [result]);

  function markCopied(id: string) {
    setCopied(id);
    window.setTimeout(() => setCopied((c) => (c === id ? null : c)), 1600);
  }

  function onProviderChange(p: Provider) {
    setProvider(p);
    setModel(getDefaultModel(p));
  }

  function persistSettings(next: Settings) {
    setSettings(next);
    saveSettings(next);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    setResult(null);
    setOriginal(text.trim() || url.trim());

    const hasKey =
      provider === "grok" ? !!settings.xaiKey.trim() : !!settings.gapgptKey.trim();
    if (!hasKey) {
      setError(
        provider === "grok"
          ? "کلید xAI را در تنظیمات وارد کنید."
          : "کلید GapGPT را در تنظیمات وارد کنید.",
      );
      setShowSettings(true);
      setLoading(false);
      return;
    }

    try {
      const data = await rewriteArticle({
        data: {
          url,
          text,
          keyword,
          lengthMode,
          lang,
          generateImages,
          provider,
          model,
          apiKey: settings.gapgptKey,
          xaiKey: settings.xaiKey,
        },
      });
      if (!data.ok) {
        setError(data.error);
      } else {
        setResult(data);
        setTab("new");
        const item: HistoryItem = {
          id: crypto.randomUUID(),
          createdAt: Date.now(),
          title: data.title,
          keyword: data.keyword,
          provider: data.provider,
          model: data.model,
          result: data,
        };
        const next = [item, ...history].slice(0, 40);
        setHistory(next);
        saveHistory(next);
      }
    } catch {
      setError("ارتباط با سرویس برقرار نشد. دوباره تلاش کنید.");
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setResult(null);
    setError(null);
    setTab("new");
  }

  function loadFromHistory(item: HistoryItem) {
    setResult(item.result);
    setOriginal("");
    setTab("new");
    setShowHistory(false);
  }

  function clearHistory() {
    setHistory([]);
    saveHistory([]);
  }

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
      <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium tracking-wide text-muted">نوشتار</p>
          <h1 className="mt-1 font-display text-3xl font-medium tracking-tight text-fg sm:text-4xl">
            به‌روزرسانی مقاله و سئو
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">
            بازنویسی هوشمند با انتخاب Provider (OpenAI · Gemini · Grok)، تنظیم مدل، تاریخچه و دانلود.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setShowHistory(true)}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-sm text-muted transition-colors hover:text-fg"
            title="تاریخچه"
          >
            <History className="size-4" />
            <span className="hidden sm:inline">تاریخچه</span>
          </button>
          <button
            type="button"
            onClick={() => setShowSettings(true)}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-sm text-muted transition-colors hover:text-fg"
            title="تنظیمات"
          >
            <Settings className="size-4" />
            <span className="hidden sm:inline">تنظیمات</span>
          </button>
        </div>
      </header>

      {!result && (
        <form onSubmit={onSubmit} className="space-y-5 rounded-xl border border-border bg-surface p-5 sm:p-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Provider">
              <div className="grid grid-cols-3 gap-2">
                {PROVIDERS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => onProviderChange(p.id)}
                    className={cn(
                      "rounded-md border px-2 py-2.5 text-center text-xs transition-colors sm:text-sm",
                      provider === p.id
                        ? "border-border-strong bg-subtle text-fg"
                        : "border-border bg-bg text-muted hover:text-fg",
                    )}
                  >
                    <span className="block font-medium">{p.label}</span>
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-xs text-subtle-fg">
                {PROVIDERS.find((p) => p.id === provider)?.hint}
              </p>
            </Field>

            <Field label="مدل">
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="field"
              >
                {models.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="لینک مقاله (اختیاری)">
            <input
              type="url"
              dir="ltr"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/article"
              className="field"
            />
          </Field>

          <Field label="متن فعلی">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={8}
              placeholder="متن مقاله را اینجا بچسبانید…"
              className="field min-h-40 resize-y"
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="کلمه کلیدی هدف">
              <input
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="مثلاً بازاریابی محتوا"
                className="field"
              />
            </Field>
            <Field label="زبان خروجی">
              <select
                value={lang}
                onChange={(e) => setLang(e.target.value as OutputLang)}
                className="field"
              >
                <option value="fa">فارسی</option>
                <option value="en">English</option>
              </select>
            </Field>
          </div>

          <div>
            <p className="mb-2 text-xs font-medium text-muted">طول متن</p>
            <div className="grid gap-2 sm:grid-cols-3">
              {LENGTHS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setLengthMode(item.id)}
                  className={cn(
                    "rounded-md border px-3 py-3 text-right transition-colors duration-150",
                    lengthMode === item.id
                      ? "border-border-strong bg-subtle text-fg"
                      : "border-border bg-bg text-muted hover:text-fg",
                  )}
                >
                  <span className="block text-sm font-medium">{item.label}</span>
                  <span className="mt-0.5 block text-xs text-subtle-fg">{item.hint}</span>
                </button>
              ))}
            </div>
          </div>

          <label className="flex min-h-11 items-center gap-3 text-sm text-fg">
            <input
              type="checkbox"
              checked={generateImages}
              onChange={(e) => setGenerateImages(e.target.checked)}
              className="size-4 accent-fg"
            />
            سه تصویر مرتبط هم ساخته شود
          </label>

          {error && (
            <p className="rounded-md border border-border bg-bg px-3 py-2 text-sm text-danger" role="alert">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-fg transition-opacity duration-150 hover:opacity-90 disabled:opacity-50"
          >
            {loading ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                در حال بازنویسی با {provider}…
              </>
            ) : (
              <>
                <Sparkles className="size-4" />
                شروع به‌روزرسانی
              </>
            )}
          </button>
          {loading && (
            <p className="text-center text-xs text-subtle-fg">
              {generateImages
                ? "بازنویسی متن و ساخت تصاویر ممکن است حدود یک دقیقه طول بکشد."
                : "بازنویسی متن در حال انجام است."}
            </p>
          )}
        </form>
      )}

      {result && (
        <div className="space-y-5">
          <section className="rounded-xl border border-border bg-surface p-5 sm:p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-medium text-fg">عناصر سئو</h2>
              <div className="flex flex-wrap items-center gap-2">
                {result.approxCost && (
                  <span className="rounded-full border border-border bg-bg px-2.5 py-0.5 text-xs text-muted">
                    هزینه تقریبی: {result.approxCost}
                  </span>
                )}
                <span className="rounded-full border border-border bg-bg px-2.5 py-0.5 text-xs text-muted">
                  {result.provider} · {result.model}
                </span>
                <CopyBtn
                  id="seo"
                  copied={copied}
                  onCopy={() => {
                    copy(
                      `عنوان: ${result.title}\nURL: /${result.slug}\nکلمه کلیدی: ${result.keyword}\nتوضیحات: ${result.description}`,
                    );
                    markCopied("seo");
                  }}
                />
              </div>
            </div>
            <dl className="grid gap-3 sm:grid-cols-2">
              <Meta label="عنوان" value={result.title} />
              <Meta label="آدرس پیشنهادی" value={`/${result.slug}`} ltr />
              <Meta label="کلمه کلیدی" value={result.keyword} />
              <Meta label="طول توضیحات" value={`${result.description.length} کاراکتر`} />
              <div className="sm:col-span-2">
                <Meta label="توضیحات متا" value={result.description} />
              </div>
            </dl>
          </section>

          <section className="rounded-xl border border-border bg-surface p-5 sm:p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="flex items-center gap-2 text-sm font-medium text-fg">
                <FileText className="size-4 text-muted" />
                متن به‌روزشده
              </h2>
              <p className="text-xs text-subtle-fg">{wordCount} کلمه</p>
            </div>
            <div className="mb-3 flex gap-1 rounded-md border border-border bg-bg p-1">
              <TabBtn active={tab === "new"} onClick={() => setTab("new")}>
                متن جدید
              </TabBtn>
              <TabBtn active={tab === "compare"} onClick={() => setTab("compare")}>
                مقایسه
              </TabBtn>
            </div>
            {tab === "new" ? (
              <>
                <article className="max-h-96 overflow-y-auto whitespace-pre-wrap rounded-md border border-border bg-bg p-4 text-sm leading-relaxed text-fg">
                  {result.updatedText}
                </article>
                <div className="mt-3 flex flex-wrap gap-2">
                  <CopyBtn
                    id="body"
                    copied={copied}
                    onCopy={() => {
                      copy(result.updatedText);
                      markCopied("body");
                    }}
                  />
                  <button
                    type="button"
                    onClick={() =>
                      downloadText(
                        `${result.slug || "article"}.html`,
                        buildHtml(result),
                        "text/html;charset=utf-8",
                      )
                    }
                    className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-border px-3 text-xs text-muted transition-colors hover:text-fg"
                  >
                    <Download className="size-3.5" />
                    HTML
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      downloadText(
                        `${result.slug || "article"}.doc`,
                        buildWordHtml(result),
                        "application/msword;charset=utf-8",
                      )
                    }
                    className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-border px-3 text-xs text-muted transition-colors hover:text-fg"
                  >
                    <Download className="size-3.5" />
                    Word
                  </button>
                </div>
              </>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="mb-2 text-xs text-muted">ورودی</p>
                  <div className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-md border border-border bg-bg p-3 text-xs leading-relaxed text-muted">
                    {original || "—"}
                  </div>
                </div>
                <div>
                  <p className="mb-2 text-xs text-muted">خروجی</p>
                  <div className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-md border border-border bg-bg p-3 text-xs leading-relaxed text-fg">
                    {result.updatedText}
                  </div>
                </div>
              </div>
            )}
          </section>

          <section className="rounded-xl border border-border bg-surface p-5 sm:p-6">
            <h2 className="mb-4 flex items-center gap-2 text-sm font-medium text-fg">
              <ImageIcon className="size-4 text-muted" />
              تصاویر مرتبط
            </h2>
            <div className="grid gap-4 sm:grid-cols-3">
              {result.images.map((img, i) => (
                <figure key={i} className="overflow-hidden rounded-md border border-border bg-bg">
                  {img.url ? (
                    <img
                      src={img.url}
                      alt={img.title}
                      className="aspect-square w-full object-cover"
                      crossOrigin="anonymous"
                    />
                  ) : (
                    <div className="flex aspect-square items-center justify-center text-xs text-subtle-fg">
                      تصویر تولید نشد
                    </div>
                  )}
                  <figcaption className="space-y-2 p-3">
                    <p className="text-sm font-medium text-fg">{img.title}</p>
                    <p className="line-clamp-4 text-xs leading-relaxed text-muted" dir="ltr">
                      {img.prompt}
                    </p>
                    <CopyBtn
                      id={`img-${i}`}
                      copied={copied}
                      onCopy={() => {
                        copy(img.prompt);
                        markCopied(`img-${i}`);
                      }}
                    />
                  </figcaption>
                </figure>
              ))}
            </div>
          </section>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={reset}
              className="flex min-h-11 items-center gap-2 rounded-md border border-border bg-surface px-4 text-sm text-fg transition-colors duration-150 hover:bg-subtle"
            >
              <RotateCcw className="size-4" />
              مقاله جدید
            </button>
          </div>
        </div>
      )}

      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
          <div className="absolute inset-0 bg-black/60" onClick={() => setShowSettings(false)} />
          <div className="relative z-10 w-full max-w-md rounded-t-xl border border-border bg-surface p-5 shadow-xl sm:rounded-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-medium text-fg">تنظیمات API</h2>
              <button type="button" onClick={() => setShowSettings(false)} className="text-muted hover:text-fg">
                <X className="size-5" />
              </button>
            </div>
            <p className="mb-4 text-xs leading-relaxed text-muted">
              کلیدها فقط در مرورگر شما (localStorage) ذخیره می‌شوند.
            </p>
            <div className="space-y-4">
              <Field label="کلید GapGPT (برای OpenAI و Gemini)">
                <input
                  type="password"
                  dir="ltr"
                  value={settings.gapgptKey}
                  onChange={(e) =>
                    persistSettings({ ...settings, gapgptKey: e.target.value })
                  }
                  placeholder="sk-..."
                  className="field font-mono text-sm"
                />
              </Field>
              <Field label="کلید xAI / Grok (اختیاری)">
                <input
                  type="password"
                  dir="ltr"
                  value={settings.xaiKey}
                  onChange={(e) =>
                    persistSettings({ ...settings, xaiKey: e.target.value })
                  }
                  placeholder="xai-..."
                  className="field font-mono text-sm"
                />
              </Field>
            </div>
            <button
              type="button"
              onClick={() => setShowSettings(false)}
              className="mt-5 flex min-h-11 w-full items-center justify-center rounded-md bg-primary text-sm font-medium text-primary-fg"
            >
              ذخیره و بستن
            </button>
          </div>
        </div>
      )}

      {showHistory && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
          <div className="absolute inset-0 bg-black/60" onClick={() => setShowHistory(false)} />
          <div className="relative z-10 flex max-h-[80vh] w-full max-w-md flex-col rounded-t-xl border border-border bg-surface shadow-xl sm:rounded-xl">
            <div className="flex items-center justify-between border-b border-border p-4">
              <h2 className="text-base font-medium text-fg">تاریخچه مقالات</h2>
              <button type="button" onClick={() => setShowHistory(false)} className="text-muted hover:text-fg">
                <X className="size-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3">
              {history.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted">هنوز مقاله‌ای ذخیره نشده.</p>
              ) : (
                <ul className="space-y-2">
                  {history.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => loadFromHistory(item)}
                        className="w-full rounded-md border border-border bg-bg px-3 py-3 text-right transition-colors hover:bg-subtle"
                      >
                        <p className="line-clamp-1 text-sm font-medium text-fg">{item.title}</p>
                        <p className="mt-1 text-xs text-subtle-fg">
                          {item.keyword || "—"} · {item.provider}/{item.model}
                        </p>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}

function Meta({ label, value, ltr }: { label: string; value: string; ltr?: boolean }) {
  return (
    <div className="rounded-md border border-border bg-bg px-3 py-2.5">
      <dt className="text-xs text-subtle-fg">{label}</dt>
      <dd className="mt-1 text-sm text-fg" dir={ltr ? "ltr" : undefined}>
        {value || "—"}
      </dd>
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "min-h-9 flex-1 rounded-sm px-3 text-sm transition-colors duration-150",
        active ? "bg-subtle text-fg" : "text-muted hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}

function CopyBtn({
  id,
  copied,
  onCopy,
}: {
  id: string;
  copied: string | null;
  onCopy: () => void;
}) {
  const done = copied === id;
  return (
    <button
      type="button"
      onClick={onCopy}
      className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-border px-3 text-xs text-muted transition-colors duration-150 hover:text-fg"
    >
      {done ? <Check className="size-3.5 text-ok" /> : <Copy className="size-3.5" />}
      {done ? "کپی شد" : "کپی"}
    </button>
  );
}
