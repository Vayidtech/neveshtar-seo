import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  Check, Copy, Download, FileText, History, ImageIcon, Loader2, RotateCcw, Settings, Sparkles, X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  getDefaultModel, getModelsForProvider, rewriteArticle,
  type OutputLang, type Provider, type RewriteResult,
} from "@/lib/rewrite-article";

const PROVIDERS: { id: Provider; label: string }[] = [
  { id: "openai", label: "OpenAI" },
  { id: "gemini", label: "Gemini" },
  { id: "grok", label: "Grok" },
];

const HISTORY_KEY = "neveshtar-history-v2";
const SETTINGS_KEY = "neveshtar-settings-v2";

type Settings = {
  gapgptKey: string;
  xaiKey: string;
  defaultProvider: Provider;
  backlinkSite: string;
  backlinkLabel: string;
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
  } catch { /* */ }
  return {
    gapgptKey: "",
    xaiKey: "",
    defaultProvider: "openai",
    backlinkSite: "https://gahvarak.com/",
    backlinkLabel: "گهوارک",
  };
}

function saveSettings(s: Settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

function loadHistory(): HistoryItem[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (raw) return JSON.parse(raw) as HistoryItem[];
  } catch { /* */ }
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

export function SeoStudio() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [showSettings, setShowSettings] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);

  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [keyword, setKeyword] = useState("");
  const [lang, setLang] = useState<OutputLang>("fa");
  const [targetChars, setTargetChars] = useState(5000);
  const [generateImages, setGenerateImages] = useState(true);
  const [provider, setProvider] = useState<Provider>("openai");
  const [model, setModel] = useState(getDefaultModel("openai"));

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RewriteResult | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [tab, setTab] = useState<"preview" | "html" | "text">("preview");

  useEffect(() => {
    setHistory(loadHistory());
    const s = loadSettings();
    setSettings(s);
    setProvider(s.defaultProvider);
    setModel(getDefaultModel(s.defaultProvider));
  }, []);

  const models = useMemo(() => getModelsForProvider(provider), [provider]);
  const charCount = result?.updatedText?.length ?? 0;

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

    const hasKey = provider === "grok" ? !!settings.xaiKey.trim() : !!settings.gapgptKey.trim();
    if (!hasKey) {
      setError(provider === "grok" ? "کلید xAI را در تنظیمات وارد کنید." : "کلید GapGPT را در تنظیمات وارد کنید.");
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
          targetChars,
          lang,
          generateImages,
          provider,
          model,
          apiKey: settings.gapgptKey,
          xaiKey: settings.xaiKey,
          backlinkSite: settings.backlinkSite || "https://gahvarak.com/",
          backlinkLabel: settings.backlinkLabel || "گهوارک",
        },
      });
      if (!data.ok) {
        setError(data.error);
      } else {
        setResult(data);
        setTab("preview");
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
      setError("ارتباط با سرویس برقرار نشد.");
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setResult(null);
    setError(null);
  }

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
      <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium tracking-wide text-muted">نوشتار · گهوارک</p>
          <h1 className="mt-1 font-display text-3xl font-medium tracking-tight text-fg sm:text-4xl">
            به‌روزرسانی مقاله و سئو
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">
            اسلاگ انگلیسی · طول کاراکتر · HTML آماده سایت · بک‌لینک گهوارک · تصویر Gemini
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => setShowHistory(true)} className="inline-flex min-h-10 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-sm text-muted hover:text-fg">
            <History className="size-4" /> تاریخچه
          </button>
          <button type="button" onClick={() => setShowSettings(true)} className="inline-flex min-h-10 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-sm text-muted hover:text-fg">
            <Settings className="size-4" /> تنظیمات
          </button>
        </div>
      </header>

      {!result && (
        <form onSubmit={onSubmit} className="space-y-5 rounded-xl border border-border bg-surface p-5 sm:p-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Provider">
              <div className="grid grid-cols-3 gap-2">
                {PROVIDERS.map((p) => (
                  <button key={p.id} type="button" onClick={() => onProviderChange(p.id)}
                    className={cn("rounded-md border px-2 py-2.5 text-center text-xs sm:text-sm",
                      provider === p.id ? "border-border-strong bg-subtle text-fg" : "border-border bg-bg text-muted hover:text-fg")}>
                    {p.label}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="مدل">
              <select value={model} onChange={(e) => setModel(e.target.value)} className="field">
                {models.map((m) => (<option key={m} value={m}>{m}</option>))}
              </select>
            </Field>
          </div>

          <Field label="لینک مقاله (دو بار بررسی می‌شود)">
            <input type="url" dir="ltr" value={url} onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/article" className="field" />
          </Field>

          <Field label="متن فعلی (اختیاری)">
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={7}
              placeholder="متن مقاله…" className="field min-h-36 resize-y" />
          </Field>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="کلمه کلیدی">
              <input value={keyword} onChange={(e) => setKeyword(e.target.value)} className="field" placeholder="غذای کمکی نوزاد" />
            </Field>
            <Field label="زبان">
              <select value={lang} onChange={(e) => setLang(e.target.value as OutputLang)} className="field">
                <option value="fa">فارسی</option>
                <option value="en">English</option>
              </select>
            </Field>
            <Field label="طول هدف (کاراکتر)">
              <input type="number" min={500} max={25000} step={500} value={targetChars}
                onChange={(e) => setTargetChars(Number(e.target.value) || 5000)} className="field" dir="ltr" />
            </Field>
          </div>

          <label className="flex min-h-11 items-center gap-3 text-sm text-fg">
            <input type="checkbox" checked={generateImages} onChange={(e) => setGenerateImages(e.target.checked)} className="size-4 accent-fg" />
            تولید تصویر با Gemini / GapGPT
          </label>

          {error && (
            <p className="rounded-md border border-border bg-bg px-3 py-2 text-sm text-danger" role="alert">{error}</p>
          )}

          <button type="submit" disabled={loading}
            className="flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-fg hover:opacity-90 disabled:opacity-50">
            {loading ? (<><Loader2 className="size-4 animate-spin" /> در حال بازنویسی…</>) : (<><Sparkles className="size-4" /> شروع به‌روزرسانی</>)}
          </button>
        </form>
      )}

      {result && (
        <div className="space-y-5">
          <section className="rounded-xl border border-border bg-surface p-5 sm:p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-medium text-fg">عناصر سئو</h2>
              <div className="flex flex-wrap gap-2 text-xs text-muted">
                {result.sourceChecked && <span className="rounded-full border border-border bg-bg px-2 py-0.5">لینک تأیید شد ✓</span>}
                <span className="rounded-full border border-border bg-bg px-2 py-0.5">{result.provider} · {result.model}</span>
              </div>
            </div>
            <dl className="grid gap-3 sm:grid-cols-2">
              <Meta label="عنوان" value={result.title} />
              <Meta label="اسلاگ انگلیسی" value={result.slug} ltr />
              <Meta label="کلمه کلیدی" value={result.keyword} />
              <Meta label="تعداد کاراکتر" value={String(charCount)} />
              <div className="sm:col-span-2"><Meta label="توضیحات متا" value={result.description} /></div>
            </dl>
            <div className="mt-3">
              <CopyBtn id="seo" copied={copied} onCopy={() => { copy(`عنوان: ${result.title}\nSlug: ${result.slug}\nKeyword: ${result.keyword}\nDesc: ${result.description}`); markCopied("seo"); }} />
            </div>
          </section>

          <section className="rounded-xl border border-border bg-surface p-5 sm:p-6">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 text-sm font-medium text-fg"><FileText className="size-4 text-muted" /> خروجی</h2>
              <div className="flex gap-1 rounded-md border border-border bg-bg p-1">
                {([["preview", "پیش‌نمایش"], ["html", "HTML"], ["text", "متن"]] as const).map(([id, label]) => (
                  <button key={id} type="button" onClick={() => setTab(id)}
                    className={cn("min-h-8 rounded-sm px-3 text-xs", tab === id ? "bg-subtle text-fg" : "text-muted hover:text-fg")}>
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {tab === "preview" && (
              <div className="max-h-[32rem] overflow-y-auto rounded-md border border-border bg-white p-4 text-sm text-black" dir="rtl"
                dangerouslySetInnerHTML={{ __html: result.htmlContent }} />
            )}
            {tab === "html" && (
              <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap rounded-md border border-border bg-bg p-3 text-xs text-fg" dir="ltr">{result.htmlContent}</pre>
            )}
            {tab === "text" && (
              <article className="max-h-[32rem] overflow-y-auto whitespace-pre-wrap rounded-md border border-border bg-bg p-4 text-sm text-fg">{result.updatedText}</article>
            )}

            <div className="mt-3 flex flex-wrap gap-2">
              <CopyBtn id="html" copied={copied} onCopy={() => { copy(result.htmlContent); markCopied("html"); }} />
              <button type="button" onClick={() => downloadText(`${result.slug || "article"}.html`, result.htmlContent, "text/html;charset=utf-8")}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-border px-3 text-xs text-muted hover:text-fg">
                <Download className="size-3.5" /> دانلود HTML
              </button>
            </div>
          </section>

          <section className="rounded-xl border border-border bg-surface p-5 sm:p-6">
            <h2 className="mb-4 flex items-center gap-2 text-sm font-medium text-fg"><ImageIcon className="size-4 text-muted" /> تصاویر</h2>
            <div className="grid gap-4 sm:grid-cols-3">
              {result.images.map((img, i) => (
                <figure key={i} className="overflow-hidden rounded-md border border-border bg-bg">
                  {img.url ? (
                    <img src={img.url} alt={img.title} className="aspect-square w-full object-cover" />
                  ) : (
                    <div className="flex aspect-square items-center justify-center text-xs text-subtle-fg">تولید نشد</div>
                  )}
                  <figcaption className="p-3 text-sm text-fg">{img.title}</figcaption>
                </figure>
              ))}
            </div>
          </section>

          <button type="button" onClick={reset} className="flex min-h-11 items-center gap-2 rounded-md border border-border bg-surface px-4 text-sm text-fg hover:bg-subtle">
            <RotateCcw className="size-4" /> مقاله جدید
          </button>
        </div>
      )}

      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
          <div className="absolute inset-0 bg-black/60" onClick={() => setShowSettings(false)} />
          <div className="relative z-10 w-full max-w-md rounded-t-xl border border-border bg-surface p-5 sm:rounded-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-medium text-fg">تنظیمات</h2>
              <button type="button" onClick={() => setShowSettings(false)}><X className="size-5 text-muted" /></button>
            </div>
            <div className="space-y-4">
              <Field label="کلید GapGPT">
                <input type="password" dir="ltr" value={settings.gapgptKey}
                  onChange={(e) => persistSettings({ ...settings, gapgptKey: e.target.value })}
                  className="field font-mono text-sm" placeholder="sk-..." />
              </Field>
              <Field label="کلید xAI (اختیاری)">
                <input type="password" dir="ltr" value={settings.xaiKey}
                  onChange={(e) => persistSettings({ ...settings, xaiKey: e.target.value })}
                  className="field font-mono text-sm" />
              </Field>
              <Field label="آدرس بک‌لینک">
                <input dir="ltr" value={settings.backlinkSite}
                  onChange={(e) => persistSettings({ ...settings, backlinkSite: e.target.value })}
                  className="field" placeholder="https://gahvarak.com/" />
              </Field>
              <Field label="نام بک‌لینک">
                <input value={settings.backlinkLabel}
                  onChange={(e) => persistSettings({ ...settings, backlinkLabel: e.target.value })}
                  className="field" placeholder="گهوارک" />
              </Field>
            </div>
            <button type="button" onClick={() => setShowSettings(false)}
              className="mt-5 flex min-h-11 w-full items-center justify-center rounded-md bg-primary text-sm font-medium text-primary-fg">ذخیره</button>
          </div>
        </div>
      )}

      {showHistory && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
          <div className="absolute inset-0 bg-black/60" onClick={() => setShowHistory(false)} />
          <div className="relative z-10 max-h-[80vh] w-full max-w-md overflow-y-auto rounded-t-xl border border-border bg-surface p-4 sm:rounded-xl">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-medium text-fg">تاریخچه</h2>
              <button type="button" onClick={() => setShowHistory(false)}><X className="size-5 text-muted" /></button>
            </div>
            {history.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted">خالی</p>
            ) : (
              <ul className="space-y-2">
                {history.map((item) => (
                  <li key={item.id}>
                    <button type="button" onClick={() => { setResult(item.result); setShowHistory(false); }}
                      className="w-full rounded-md border border-border bg-bg px-3 py-3 text-right hover:bg-subtle">
                      <p className="line-clamp-1 text-sm font-medium text-fg">{item.title}</p>
                      <p className="mt-1 text-xs text-subtle-fg">{item.keyword} · {item.provider}</p>
                    </button>
                  </li>
                ))}
              </ul>
            )}
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
      <dd className="mt-1 text-sm text-fg" dir={ltr ? "ltr" : undefined}>{value || "—"}</dd>
    </div>
  );
}

function CopyBtn({ id, copied, onCopy }: { id: string; copied: string | null; onCopy: () => void }) {
  const done = copied === id;
  return (
    <button type="button" onClick={onCopy}
      className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-border px-3 text-xs text-muted hover:text-fg">
      {done ? <Check className="size-3.5 text-ok" /> : <Copy className="size-3.5" />}
      {done ? "کپی شد" : "کپی"}
    </button>
  );
}
