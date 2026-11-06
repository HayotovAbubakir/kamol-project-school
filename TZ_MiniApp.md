# KAMOL PROJECT SCHOOL — Telegram Mini App va ERP texnik talablari

## 1. Maqsad

ERP, Telegram bot va Mini App yagona tizim bo‘lib ishlaydi. Mini App o‘quvchi, o‘qituvchi, reception va owner uchun mobil qurilmaga mos yengil ofis vazifasini bajaradi. Asosiy kirish usuli — login va parol.

## 2. Rollar

- **O‘quvchi:** o‘z vazifalarini ko‘radi, matn yoki fayl topshiradi, baho va statistikani ko‘radi.
- **O‘qituvchi:** o‘z guruhlariga vazifa beradi, topshiriqlarni tekshiradi, qabul qiladi yoki qaytarib izoh yozadi.
- **Reception/Admin:** o‘quvchilar va guruhlarni boshqaradi, login ma’lumotlarini beradi, vazifalarni taqsimlaydi.
- **Owner:** barcha o‘quv va moliyaviy ma’lumotlarni hamda hisobotlarni ko‘rish huquqiga ega.

## 3. Kirish va hisoblar

- ERP va Mini App bitta Cloudflare Worker autentifikatsiya xizmatidan foydalanadi.
- Login ism-familiyadan takrorlanmaydigan shaklda yaratiladi; vaqtinchalik parol `kp` + 5 raqam + `s` shaklida bo‘ladi.
- Parol D1’da ochiq saqlanmaydi: Worker PBKDF2 xeshini saqlaydi.
- Vaqtinchalik parol faqat yaratilgan yoki qayta o‘rnatilgan paytda ko‘rsatiladi. Import qilingan akkauntlar birinchi kirishda parolni yangilashi shart.
- Telegram `initData` asosiy autentifikatsiya emas. Bot menyusi Mini App’ni ochish uchun ishlatiladi.
- API har bir so‘rovda foydalanuvchini aniqlab, rol va tegishli yozuvlar bo‘yicha ruxsatni serverda tekshiradi. Frontend route guard xavfsizlik chegarasi hisoblanmaydi.

## 4. Mini App sahifalari

1. **Kirish:** tizim nomi, login va parol.
2. **Dashboard:** rolga mos salomlashish, vazifalar, baholar yoki boshqaruv kartalari.
3. **Vazifalar:** o‘quvchining vazifalari va ularning holati yoki o‘qituvchi yaratgan vazifalar.
4. **Vazifa tafsiloti:** shart va fayl; o‘quvchi javobi; o‘qituvchining tasdiqlash/qaytarish amali va izohi.
5. **Boshqaruv:** reception/owner uchun o‘quvchi yaratish, login ma’lumotlari va guruhga biriktirish.
6. **Hisobotlar:** vakolatli rollar uchun oylik topshiriq va baholash statistikasi.

## 5. Uy vazifasi va fayllar

- Vazifada guruh, sarlavha, izoh, muddat va ixtiyoriy fayl bo‘ladi.
- O‘quvchi matn yoki qo‘llab-quvvatlanadigan fayl yuboradi; javob `pending` holatida saqlanadi.
- O‘qituvchi topshiriqni `approved` yoki `rejected` qiladi va izoh qoldirishi mumkin.
- Ilova ma’lumotlari Cloudflare D1’da; fayllar maxfiy Cloudflare R2 bucket’da saqlanadi.
- Fayl yuklash Worker orqali amalga oshadi, hajm va format cheklanadi. Faylga kirish muddati cheklangan URL orqali beriladi.
- Telegram bot Worker webhook sifatida ishlaydi; polling jarayoni production’da yoqilmaydi.

## 6. Arxitektura

- Frontend: React va Tailwind CSS, mobile-first.
- API va autentifikatsiya: Cloudflare Worker.
- Ma’lumotlar: D1 migratsiyalari `migrations/` ichida.
- Fayllar: R2 `kamol-files` binding.
- Bot: Worker webhook; D1 va R2 bilan ishlash uchun Worker API’dan foydalanadi.
- D1’da PostgreSQL RLS o‘rniga har bir route’da server-side rol va qator ruxsatlari qo‘llanadi.
- Supabase faqat avvalgi ma’lumotlarni bir marta eksport qilish manbasi bo‘lishi mumkin; production runtime unga bog‘liq emas.

## 7. Deploy va sifat talablari

- GitHub Actions har bir push va pull request uchun ESLint, Vitest hamda production build'ni ishga tushiradi.
- `main`/`master` branch'iga push qilinganda secrets mavjud bo‘lsa D1 migratsiyasi, Worker deploy, Telegram webhook sozlamasi va health check (`/api/health`, HTTP 200) bajariladi.
- Cloudflare secrets va migratsiyani qo‘lda bajarish tartibi [MIGRATION.md](./MIGRATION.md) da.
