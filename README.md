# KAMOL PROJECT SCHOOL — O'quv Markazini Boshqarish ERP Tizimi

**KAMOL PROJECT SCHOOL** — o'quvchilar, o'qituvchilar, guruhlar, oylik to'lovlar va davomatni markazlashtirilgan holda boshqarish uchun mo'ljallangan ichki CRM/ERP platformasi.

---

## Hozirgi holat

| Modul | Holat |
|-------|--------|
| Owner / Admin / Teacher rollari | Tayyor |
| Login (Supabase Auth) | Tayyor |
| O'quvchilar, o'qituvchilar, guruhlar | Tayyor |
| Guruh vaqt/o'qituvchi to'qnashuvi | Tayyor |
| To'lovlar, maosh, xarajatlar | Tayyor |
| Moliya va davomat chartlari | Tayyor |
| **Supabase (Auth + Postgres)** | Tayyor |
| Telegram Mini App (login, vazifalar, topshiriqlar) | Tayyorlanmoqda |
| Cloudflare R2 uy vazifasi fayllari | Sozlash talab qilinadi |
| Face ID biometrik | Keyingi bosqich |

---

## Supabase ulash (birinchi marta)

### 1. Project oching

1. [supabase.com](https://supabase.com) da yangi project yarating
2. **Authentication → Providers → Email**: *Confirm email* ni o‘chiring (dev uchun)
3. **Project Settings → API** dan `Project URL` va `anon public` key ni nusxalang

### 2. Schema

SQL Editor da [`supabase/schema.sql`](supabase/schema.sql) ni to‘liq ishga tushiring (full cleanup + schema — yagona SQL fayl).

### 3. Test userlar

**Authentication → Users → Add user:**

| Email | Password |
|-------|----------|
| `owner@kamol.school` | `owner123` |
| `admin@kamol.school` | `admin123` |

Keyin `schema.sql` oxiridagi SEED qismini (yoki butun faylni) yana ishga tushiring — rollar `owner` / `admin` bo‘ladi.

### 4. Env

```bash
cp .env.example .env
```

`.env` ichiga:

```env
VITE_SUPABASE_URL=https://XXXX.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

### 5. Ishga tushirish

```bash
npm install
npm run dev
```

Login: `owner` / `owner123` (username — ichida `owner@kamol.school` ga map qilinadi).

---

## O'rnatish

```bash
npm install
npm run dev
```

Brauzer: [http://localhost:5173](http://localhost:5173)

```bash
npm run build
npm run preview
npm run lint
```

---

## Rollar

| Rol | Huquq |
|-----|-------|
| **Owner** | To‘liq: adminlar, moliya, xarajatlar |
| **Admin** | Operatsion: o‘quvchi/o‘qituvchi/guruh, to‘lovlar |
| **O'qituvchi** | O‘z guruhlari, davomat |

---

## Loyiha tuzilmasi

```
src/
├── components/
├── context/          # AuthContext (Supabase Auth), DataContext (API)
├── lib/
│   ├── api.js        # Supabase CRUD
│   ├── supabase.js   # Client
│   ├── store.js      # Pure helpers (finance, schedule validation)
│   └── ...
├── pages/
supabase/
└── schema.sql        # Full cleanup + tables + RLS + seed
```

---

## Telegram bot (Railway)

Noutbuk o‘chiq bo‘lsa ham bot ishlashi uchun Railway da deploy qilinadi.

1. GitHubga push qiling
2. [railway.app](https://railway.app) → New Project → Deploy from GitHub
3. Variables qo‘ying:
   - `TELEGRAM_BOT_TOKEN`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `VITE_SUPABASE_URL` (yoki `SUPABASE_URL`)
   - `TELEGRAM_WEBAPP_URL` — Cloudflare Worker bergan public HTTPS URL va `/miniapp.html` yo‘li.
4. Vite `miniapp.html` ni ERP saytidan alohida, yengil Telegram Mini App sifatida build qiladi (`/miniapp.html`). GitHub Actions `.github/workflows/deploy-worker.yml` orqali Cloudflare Worker'ga deploy qiladi. GitHub repository secrets sifatida `CLOUDFLARE_API_TOKEN` (Workers Scripts Edit ruxsati) va `CLOUDFLARE_ACCOUNT_ID` qo‘ying; Variables ichida `VITE_SUPABASE_URL` va `VITE_SUPABASE_ANON_KEY` bo‘lishi kerak.
5. Start command: `node bot/index.mjs` (`railway.json` da bor). Bot menyusida va asosiy klaviaturada “Ilovani ochish” tugmasi paydo bo‘ladi.

### Mini App va Cloudflare R2 sozlamalari

- `supabase/schema.sql` ni Supabase SQL Editor’da ishga tushiring; u Mini App jadvallari, view va RLS siyosatlarini o‘rnatadi.
- Supabase Auth’da email confirmation’ni o‘chiring, chunki yangi o‘quvchi login/paroli bilan darhol kirishi kerak.
- `supabase/functions/r2-presign` Edge Function’ni deploy qiling va `CF_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_PUBLIC_URL` qiymatlarini Supabase Function secrets’da sozlang.
- Bot serveri uchun ham shu R2 qiymatlarini environment variables sifatida bering. `R2_PUBLIC_URL` HTTPS orqali o‘qiladigan R2 custom domain yoki public bucket URL bo‘lishi kerak.
- `kamol-files` bucket CORS sozlamasida deployed Mini App origin’iga `PUT` va `OPTIONS` metodlarini, `Content-Type` header’ini ruxsat qiling.
- O‘quvchi paroli faqat yangi akkaunt yaratilganda bir marta ko‘rsatiladi; xavfsizlik uchun qayta ko‘rish imkoniyati yo‘q.

Lokal PM2 ni o‘chirish: `npm run bot:uninstall-local`

---

## Texnologiyalar

| Qatlam | Texnologiya |
|--------|-------------|
| Frontend | React 19, Vite 8, React Router |
| Auth / DB | Supabase Auth + PostgreSQL |
| Chartlar | Recharts |
| Ikonlar | Lucide React |

---

© 2026 **KAMOL PROJECT SCHOOL**. Barcha huquqlar himoyalangan.
