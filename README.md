# نوشتار — SEO Article Updater

ابزار بازنویسی و بهینه‌سازی سئوی مقالات با پشتیبانی از چند Provider هوش مصنوعی:

- **OpenAI** و **Gemini** از طریق GapGPT (`api.gapgpt.app`)
- **Grok** از طریق xAI

## ویژگی‌ها

- انتخاب Provider و مدل از داخل رابط کاربری
- صفحه تنظیمات برای ذخیره امن کلید API (localStorage)
- نمایش هزینه تقریبی
- تاریخچه مقالات
- دانلود HTML و Word
- کپی سریع

## اجرا

```bash
npm install
npm run dev
```

سپس از بخش **تنظیمات** کلید GapGPT خود را وارد کنید.

## ساختار اصلی

- `src/components/seo-studio.tsx` — رابط کاربری اصلی
- `src/lib/rewrite-article.ts` — منطق فراخوانی مدل‌ها و تولید محتوا
