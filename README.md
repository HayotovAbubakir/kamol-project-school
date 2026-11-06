# Kamol School

Kamol School — o‘quv markazi uchun ERP, Telegram Mini App va bot. Ishlayotgan tizim Cloudflare Workers, D1 va R2’dan foydalanadi:

- **Workers** — ERP/Mini App statik fayllari va API.
- **D1** — akkauntlar, o‘quvchilar, guruhlar, to‘lovlar, davomat va uy vazifalari.
- **R2** — uy vazifalariga biriktirilgan fayllar.
- **Telegram bot** — Worker webhook’i va D1/R2 API’lari orqali ishlaydi.

Ilova runtime’ida Supabase ishlatilmaydi. Eski Supabase loyihasi ma’lumotlarni bir martalik ko‘chirish manbai sifatida, faqat egasi tasdiqlaguncha o‘zgarishsiz saqlanadi.

## Mahalliy ishga tushirish

Node.js 22 va npm kerak.

```sh
npm ci
npm run dev
```

`.env.example` asosida `.env` yarating. Frontend uchun `CLOUDFLARE_API_URL` Worker API manzili bo‘lishi kerak. To‘liq Worker’ni lokal sinash uchun:

```sh
npm run build
npm start
```

Asosiy tekshiruvlar:

```sh
npm run lint
npm test
npm run build
```

`npm start` Wrangler Local Development muhitida Worker’ni ishga tushiradi. Telegram bot alohida polling jarayoni sifatida ishlamaydi; deploy qilingan Worker webhook so‘rovlarini qabul qiladi.

## Cloudflare va GitHub Actions

`.github/workflows/deploy-worker.yml` har bir push va pull request uchun lint, test hamda build'ni ishga tushiradi. `main` yoki `master` branch'iga push qilinganda deploy ham bajariladi.

GitHub repository’dagi **Settings → Secrets and variables → Actions** bo‘limida quyidagi secrets’ni yarating:

| Secret | Vazifasi |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Worker deploy hamda D1/R2 sozlamalari |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID |
| `CLOUDFLARE_API_URL` | Deploy qilingan Worker’ning HTTPS manzili |
| `AUTH_SECRET` | Sessiya tokeniga imzo qo‘yish |
| `BOT_API_SECRET` | Bot va Worker o‘rtasidagi API |
| `MIGRATION_SECRET` | Bir martalik ma’lumot importi |
| `TELEGRAM_BOT_TOKEN` | Telegram bot tokeni |
| `TELEGRAM_WEBHOOK_SECRET` | Telegram webhook siri |

Workflow D1 `kamol-school-db` va R2 `kamol-files` resurslarini yaratadi yoki tekshiradi, D1 migratsiyalarini qo‘llaydi va Worker’ni deploy qiladi. Deploy muvaffaqiyatli deb faqat GitHub Actions yashil bo‘lsa va `/api/health` HTTP 200 qaytarsa aytish mumkin. Batafsil tartib [MIGRATION.md](./MIGRATION.md) faylida.

## Birinchi Owner va eski ma’lumotlar

- Yangi, bo‘sh tizimda Owner yaratish uchun `OWNER_SEED_SECRET` va `OWNER_SEED_PASSWORD` qiymatlarini Worker secrets sifatida o‘rnating va lokal muhitda `npm run owner:seed` buyrug‘ini bajaring. Parolni source control yoki chatda saqlamang.
- Eski Supabase ma’lumotlari bo‘lsa, avval backup oling. Cloudflare D1 migratsiyasi tugagandan keyingina `node scripts/migrate-supabase-to-cloudflare.mjs` ni bajaring.
- Manba va D1 jadvallaridagi qatorlar sonini solishtirib, fayllar hamda Owner loginini tekshiring. Ko‘chirilgan boshqa foydalanuvchilar birinchi kirishda parolni yangilashi kerak; Owner/Admin/Reception o‘quvchi, o‘qituvchi yoki admin uchun vaqtinchalik parol chiqarishi mumkin.
- Yangi tizim tasdiqlanmaguncha Supabase’ni o‘chirmang. Xavfsiz tartib [MIGRATION.md](./MIGRATION.md) da.

## Bot buyruqlari

Deploy vaqtida GitHub Actions bot webhook va Web App menyusini sozlaydi. Qo‘lda qayta sozlash kerak bo‘lsa, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` va `CLOUDFLARE_API_URL` environment qiymatlarini kiriting:

```sh
npm run bot:webhook:set
```

Fayl Telegram’dan Worker API’ga uzatiladi va R2’da saqlanadi. Bot polling jarayonini webhook bilan bir vaqtda ishga tushirmang.
