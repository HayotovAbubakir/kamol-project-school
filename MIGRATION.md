# Cloudflare migratsiyasi — holat va qo‘lda bajariladigan ishlar

## Maqsadli arxitektura

- React ERP va Mini App statik fayllari Cloudflare Worker assets orqali beriladi.
- API, autentifikatsiya, rol tekshiruvi va Telegram webhook `worker/index.js` ichida.
- Relatsion ma’lumotlar Cloudflare D1 `kamol-school-db` bazasida, sxema esa `migrations/` ichida.
- Uy vazifasi fayllari `kamol-files` maxfiy R2 bucket'ida.
- Supabase runtime kodi olib tashlangan. `scripts/migrate-supabase-to-cloudflare.mjs` faqat bir martalik import uchun eski Supabase manbasiga ulanadi; manbani o‘zgartirmaydi yoki o‘chirmaydi.

## Bajarilgan ishlar

- Supabase client, schema va Edge Functions olib tashlandi; frontend va bot Worker API’ga o‘tkazildi.
- D1 schema migration’lari, Worker API, PBKDF2 parol xeshlash, login rate limit, sessiya/refresh, parolni majburiy yangilash hamda server-side rol va qator ruxsatlari qo‘shildi.
- Worker R2 upload/download, fayl hajmi va MIME/imzo tekshiruvi, himoyalangan response header’larini qo‘llaydi.
- Telegram bot polling’dan webhook’ga ko‘chirildi; cron trigger bildirishnoma vazifalarini bajaradi.
- Supabase import script’i D1 yozuv sonlarini manba bilan taqqoslaydi hamda homework jadvalidagi havola qilingan fayllarni R2’ga ko‘chirishga urinadi.
- ESLint, Vitest va build GitHub Actions tekshiruviga ulangan.

## Deploy qilish uchun GitHub secrets

Repository → **Settings → Secrets and variables → Actions** ichida quyidagilar bo‘lishi kerak:

| Secret | Kerakli qiymat |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Worker deploy, D1 va R2 boshqarish ruxsatiga ega token |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID |
| `CLOUDFLARE_API_URL` | Worker’ning haqiqiy HTTPS manzili, masalan `https://<worker>.<subdomain>.workers.dev` |
| `AUTH_SECRET` | Uzun, tasodifiy va boshqa tokenlardan alohida qiymat |
| `BOT_API_SECRET` | Bot/Worker API uchun alohida tasodifiy qiymat |
| `MIGRATION_SECRET` | Ma’lumot import API’si uchun alohida tasodifiy qiymat |
| `TELEGRAM_BOT_TOKEN` | BotFather bergan token |
| `TELEGRAM_WEBHOOK_SECRET` | Telegram talablariga mos 1–256 belgili tasodifiy qiymat |

`main` yoki `master` branch'iga push qilinganda workflow lint/test/build bajaradi, D1/R2 mavjudligini tekshiradi yoki yaratadi, D1 migratsiyalarini qo‘llaydi, Worker secrets’ni o‘rnatadi, deploy qiladi, Telegram webhook’ni sozlaydi va `/api/health` HTTP 200 qaytarishini tekshiradi. Deploy muvaffaqiyati faqat GitHub Actions amalda yashil bo‘lsa va live health check 200 qaytarsa tasdiqlanadi.

> Hozirgi muhitdan GitHub secrets qiymatlarini o‘qib bo‘lmaydi. Ular kiritilmagan yoki noto‘g‘ri bo‘lsa workflow deploy bosqichida ochiq xato bilan to‘xtaydi; muvaffaqiyatli deploy deb hisoblamang.

## Yangi, bo‘sh tizimda birinchi Owner

1. D1 migration va Worker deploy tugaganidan keyin Worker secrets sifatida `OWNER_SEED_SECRET` va `OWNER_SEED_PASSWORD` ni alohida qo‘lda o‘rnating. `OWNER_SEED_PASSWORD` kamida 12 belgidan iborat bo‘lsin.
2. `.env.example` asosida `.env` yarating va `CLOUDFLARE_API_URL`, `OWNER_SEED_SECRET`, `OWNER_SEED_PASSWORD` ni kiriting.
3. `npm run owner:seed` buyrug‘ini bir marta bajaring. Script mavjud Owner’ning parolini o‘zgartirmaydi.
4. Saytga Owner sifatida kira olishingizni tekshiring. Seed qiymatlarini xavfsiz joyda saqlang yoki ishlatilgach olib tashlang.

## Eski Supabase ma’lumotlarini xavfsiz ko‘chirish

### Muhim cheklovlar

- Supabase manbasida schema yoki ma’lumotlarni o‘zgartirmang. Ko‘chirish tugamaguncha loyiha va backup’ni o‘chirmang.
- Supabase Auth parol xeshlarini qayta ishlatib bo‘lmaydi. Migratsiya vaqtida Owner uchun `CLOUDFLARE_OWNER_PASSWORD` beriladi; qolgan import qilingan akkauntlar birinchi kirishda parolni yangilashi shart.
- Migration script faqat `homework.file_url` va `homework_submissions.file_url` ichidagi havolalarni ko‘chiradi; boshqa Storage bucket/object’larni to‘liq skan qilmaydi. Qo‘llab-quvvatlanadigan fayllar PDF/JPEG/PNG/WebP va 10 MB gacha.
- Import batch’lari D1’da upsert qilinadi, shuning uchun xatodan keyin script’ni qayta bajarish mumkin. Biroq qator soni mos kelmasa ko‘chirishni muvaffaqiyatli deb hisoblamang.

### Tartib

1. Supabase’da to‘liq backup/export oling. Joriy production ma’lumotlariga ta’sir qilmaslik uchun D1’ga migration qilinmaguncha eski tizimni ishlatishda davom eting.
2. GitHub Actions yordamida Cloudflare Worker’ni deploy qiling. D1 migration’lar qo‘llangani va `/api/health` HTTP 200 qaytarganini tekshiring.
3. `.env` fayliga source va target qiymatlarini vaqtincha kiriting. Service role key’ni chat, source control, frontend env yoki build log’ga kiritmang:

   ```powershell
   $env:SUPABASE_URL = "https://<project-ref>.supabase.co"
   $env:SUPABASE_SERVICE_ROLE_KEY = "<source-service-role-key>"
   $env:CLOUDFLARE_API_URL = "https://<worker>.<subdomain>.workers.dev"
   $env:MIGRATION_SECRET = "<Worker-ga o'rnatilgan MIGRATION_SECRET>"
   $env:CLOUDFLARE_OWNER_PASSWORD = "<yangi, kuchli Owner paroli>"
   node scripts/migrate-supabase-to-cloudflare.mjs
   ```

4. Script oxiridagi `source_counts`, `target_counts`, `storage_files_copied` va `password_reset_required` qiymatlarini tekshiring. Har bir jadvaldagi qatorlar soni teng bo‘lishi kerak; tafovut yoki xato bo‘lsa, production’ga o‘tmang va manbani o‘zgarishsiz qoldiring.
5. Migratsiya qilingan Owner bilan ERP va Mini App’da login qilib ko‘ring. O‘quvchi/o‘qituvchi profillari, guruhlar, to‘lovlar, davomat, homework fayllari va bot xabarlari real foydalanuvchi huquqlari bilan tekshirilsin.
6. Import qilingan akkauntlarning parollari eski Supabase Auth’dan olinmaydi. Birinchi login’dagi majburiy yangilash oqimini tekshiring; kerak bo‘lsa admin/owner tegishli boshqaruv sahifasidan o‘quvchi, o‘qituvchi yoki admin uchun vaqtinchalik parol chiqaradi.
7. Yangi Cloudflare tizimi, webhook, fayllar va hisoblar egasi tomonidan tasdiqlanmaguncha Supabase’ni o‘chirmang. Tasdiqlangandan so‘ng Supabase loyihasini o‘chirish egasining qo‘lda bajaradigan alohida amali; bu repository script yoki GitHub workflow tomonidan qilinmaydi.
8. Migratsiya tugagach lokal shell environment’dagi vaqtinchalik credential’larni olib tashlang va service role key’ni bekor qiling yoki almashtiring.

## Tekshiruv va qolgan tasdiqlar

### Joriy bajarilish holati

- Uchta funksional commit va holat hujjati `master` branch'iga push qilindi: `2e3e549`, `a48f426`, `7de5352`, `06cad01`.
- Toza `npm ci`, `npm run lint`, `npm test` (**8 test passed**), `npm run build` va `npm audit` muvaffaqiyatli; dependency audit **0 vulnerability** qaytardi.
- `migrations/` ichidagi ikkala SQL migratsiya SQLite’da xatosiz qo‘llandi; 19 jadval va `monthly_homework_report` view yaratildi.
- [GitHub Actions run 42267602045](https://github.com/HayotovAbubakir/kamol-project-school/actions/runs/42267602045): `verify` job muvaffaqiyatli tugadi. `deploy` job `Validate deploy secrets` bosqichida to‘xtadi, chunki repository’da quyidagilar yo‘q: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_URL`, `AUTH_SECRET`, `BOT_API_SECRET`, `MIGRATION_SECRET`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`.
- Shu sabab D1/R2 resurslari, Worker deployment, webhook, data import va live health check bajarilmadi. Live URL mavjud emas yoki bu ishda tekshirilmagan; deploy muvaffaqiyati da’vo qilinmaydi.

### Egasi bajarishi kerak bo‘lgan aniq qadamlar

1. Yuqoridagi 8 ta secret’ni GitHub repository secrets bo‘limiga qo‘shing. `AUTH_SECRET`, `BOT_API_SECRET`, `MIGRATION_SECRET` va `TELEGRAM_WEBHOOK_SECRET` alohida, kuchli qiymat bo‘lishi kerak. `CLOUDFLARE_API_URL` haqiqiy HTTPS Worker manzili bo‘lsin.
2. `master` branch'iga o‘zgartirish yuboring yoki **Actions → Verify and deploy Cloudflare Worker → Run workflow** orqali deploy’ni qayta ishga tushiring. Barcha job’lar yashil bo‘lishi va sozlangan `/api/health` HTTP 200 qaytarishini tekshiring.
3. Eski Supabase ma’lumotlari bo‘lsa, backup oling va yuqoridagi deploy muvaffaqiyatli tugagach “Eski Supabase ma’lumotlarini xavfsiz ko‘chirish” bo‘limiga amal qiling. Owner uchun yangi parolni faqat lokal muhitdagi `CLOUDFLARE_OWNER_PASSWORD` orqali bering.
4. Qatorlar soni, R2 fayllari, Owner va foydalanuvchi loginlari hamda bot webhook’ni qo‘lda tekshiring. Faqat egasi bularni tasdiqlagandan keyin Supabase loyihasini qo‘lda o‘chiring.

Deploy, Cloudflare account resurslari, ma’lumotlar importi va live URL ushbu muhitda tasdiqlanmagan bo‘lsa, ularni bajarilgan deb hisoblamang. Ish yakunlanganini tasdiqlash mezonlari:

1. `npm run lint`, `npm test`, `npm run build` buyruqlarining barchasi muvaffaqiyatli.
2. GitHub Actions deploy workflow yashil.
3. Sozlangan `CLOUDFLARE_API_URL/api/health` HTTP 200 qaytaradi.
4. Eski ma’lumotlar bo‘lsa, D1’dagi barcha jadvallar soni manbaga teng; R2 fayllari va real login tekshirilgan.
5. Supabase faqat egasi yangi tizimni tasdiqlaganidan keyin qo‘lda o‘chiriladi.
