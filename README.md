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
   - `TELEGRAM_WEBAPP_URL` — web ilovaning deploy qilingan HTTPS manzili
4. Web ilovani (Vite build papkasi `dist`) Cloudflare Pages yoki boshqa HTTPS hostingga deploy qiling. Railway’dagi bot jarayoni web ilovani o‘zi host qilmaydi.
5. Start command: `node bot/index.mjs` (`railway.json` da bor). Bot menyusida va asosiy klaviaturada “Ilovani ochish” tugmasi paydo bo‘ladi.

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
