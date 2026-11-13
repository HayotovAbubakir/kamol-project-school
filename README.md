# Kamol School

Kamol School — o‘quv markazi uchun ERP, Telegram Mini App va bot. Ishlayotgan tizim Cloudflare Workers, D1 va R2’dan foydalanadi:

- **Workers** — ERP/Mini App statik fayllari va API.
- **D1** — akkauntlar, o‘quvchilar, guruhlar, to‘lovlar, davomat va uy vazifalari.
- **R2** — uy vazifalariga biriktirilgan fayllar.
- **Telegram bot** — Worker webhook’i va D1/R2 API’lari orqali ishlaydi.

Ilova runtime’ida Supabase ishlatilmaydi. Cloudflare D1 yangi, bo‘sh baza sifatida ishga tushiriladi; eski Supabase’dagi test ma’lumotlari ko‘chirilmaydi. Eski Supabase loyihasini egasi istalgan vaqtda alohida o‘chirishi mumkin; bu loyiha u tomon o‘zgartirish kiritmaydi.

## Mahalliy ishga tushirish

Node.js 22 va npm kerak.

```sh
npm ci
npm run dev
```

`.env.example` faqat o‘zgaruvchilar ro‘yxati. Maxfiy lokal Worker qiymatlarini `.dev.vars` faylida saqlang; `.env*` (namuna faylidan tashqari) va `.dev.vars` Git tomonidan kuzatilmaydi. Frontend uchun `CLOUDFLARE_API_URL` Worker API manzili bo‘lishi kerak. To‘liq Worker’ni lokal sinash uchun:

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

`.github/workflows/deploy-worker.yml` har bir push va pull request uchun lint, test hamda build'ni ishga tushiradi. `main` yoki `master` branch'iga push qilinganda `CLOUDFLARE_API_TOKEN` bo‘lsa deploy bajariladi; token bo‘lmasa deploy qismi aniq xabar bilan muvaffaqiyatli o‘tkazib yuboriladi.

GitHub repository’dagi **Settings → Secrets and variables → Actions** bo‘limida quyidagi secrets’ni yarating:

| Secret | Vazifasi |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Worker deploy hamda D1/R2 sozlamalari |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID |
| `CLOUDFLARE_API_URL` | Deploy qilingan Worker’ning HTTPS manzili |
| `AUTH_SECRET` | Sessiya tokeniga imzo qo‘yish |
| `BOT_API_SECRET` | Bot va Worker o‘rtasidagi API |
| `TELEGRAM_BOT_TOKEN` | Telegram bot tokeni |
| `TELEGRAM_WEBHOOK_SECRET` | Telegram webhook siri |

Workflow D1 `kamol-school-db` va R2 `kamol-files` resurslarini yaratadi yoki tekshiradi, D1 migratsiyalarini qo‘llaydi va Worker’ni deploy qiladi. Deploy muvaffaqiyatli deb faqat GitHub Actions yashil bo‘lsa va `/api/health` HTTP 200 qaytarsa aytish mumkin. Batafsil tartib [MIGRATION.md](./MIGRATION.md) faylida.

## Birinchi Owner va yangi baza

- D1 bo‘sh yaratiladi va faqat repository migrations qo‘llanadi; oldingi test yozuvlari va fayllar import qilinmaydi.
- Birinchi Owner uchun `OWNER_SEED_SECRET` qiymatini Worker secret sifatida o‘rnating. `OWNER_SEED_PASSWORD` ni faqat lokal PowerShell sessiyasida vaqtincha belgilang va `npm run owner:seed` ni ishga tushiring; parolni source control yoki chatga yozmang.
- Eski Supabase loyihasi alohida resurs bo‘lib qoladi. Uni o‘chirish yoki saqlashni egasi o‘zi tanlaydi; bu deploy Supabase’ga tegmaydi. Tartibni [MIGRATION.md](./MIGRATION.md) faylidan ko‘ring.

## Bot buyruqlari

Deploy vaqtida GitHub Actions bot webhook va Web App menyusini sozlaydi. Qo‘lda qayta sozlash kerak bo‘lsa, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` va `CLOUDFLARE_API_URL` environment qiymatlarini kiriting:

```sh
npm run bot:webhook:set
```

Fayl Telegram’dan Worker API’ga uzatiladi va R2’da saqlanadi. Bot polling jarayonini webhook bilan bir vaqtda ishga tushirmang.

## Face ID davomat (Hikvision DS-K1T)

Yuzni terminalning o‘zi taniydi; Worker faqat o‘quvchi rasmlarini terminalga yuboradi va skan hodisalarini davomatga aylantiradi. `migrations/0009_face_id.sql` qo‘llangan bo‘lishi kerak.

1. Owner: Akkaunt sozlamalari → Face ID qurilmalari → qurilma qo‘shing. Token (`kfd_…`) faqat bir marta ko‘rsatiladi.
2. O‘quvchi qo‘shishda yoki keyin “Rasm qo‘shish / yangilash” orqali 3 ta rasm (old, chap, o‘ng) oling.
3. Terminal bilan bir tarmoqdagi kompyuterda ko‘prikni ishga tushiring:

```sh
HIK_HOST=192.168.1.64 HIK_USER=admin HIK_PASSWORD=... \
WORKER_URL=https://<worker-domeni> DEVICE_TOKEN=kfd_... \
node scripts/hikvision-bridge.mjs --check   # ulanishni tekshirish
node scripts/hikvision-bridge.mjs           # doimiy ishlash
```

Ko‘prik rasmlarni terminalga yuklaydi (`UserInfo` + `FDLib`) va har `POLL_SECONDS` (standart 10) soniyada `AcsEvent` hodisalarini Worker’ga yuboradi. Sozlamalarni `--config bridge.json` fayli orqali ham berish mumkin.

Muqobil (kompyutersiz) yo‘l — terminalning “HTTP Listening” funksiyasi: Network → Advanced → HTTP Listening manziliga `https://<worker-domeni>/api/face/device/events?token=kfd_...` ni yozing. Bu holatda skanlar to‘g‘ridan-to‘g‘ri keladi, lekin rasmlarni terminalga yuborish uchun baribir ko‘prikni vaqti-vaqti bilan (`--once`) ishga tushirish kerak.

Qoida: dars boshlanishigacha (60 daqiqa oldindan ham) skan — “Keldi”; keyin — “Kechikdi” (daqiqasi bilan); dars tugaganidan 5 daqiqa o‘tib skan bo‘lmasa — “Kelmagan”. Kechikish va kelmaslik haqida o‘quvchi va ota-onaga Telegram xabari boradi. O‘qituvchining qo‘lda belgilashi zaxira usul; Face ID yozuvini faqat tasdiqlab o‘zgartirish mumkin.
