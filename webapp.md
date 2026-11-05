# KAMOL PROJECT SCHOOL — Telegram Mini App Texnik Topshiriq (TZ)

## 1. Loyihaning Maqsadi
Hozirgi kunda loyihada Telegram bot mavjud bo'lib, u faqat ota-onalarga davomat va to'lovlar haqida xabar yuboradi.
**Yangi maqsad:** Botni "Telegram Mini App" (Telegram ichida ochiladigan yengil veb-ilova) ga aylantirish. Ilova asosiy ERP saytning og'ir qismlaridan xoli, faqatgina ta'lim jarayoniga (uy vazifalari) moslashgan, tez va qulay bo'lishi kerak.

## 2. Foydalanuvchi Rollari va Huquqlari
Tizimda 4 xil rol bo'ladi. Foydalanuvchi Mini App'ga kirganda Telegram orqali avtomatik aniqlanadi.

1. **O'quvchi (Student):**
   - O'ziga berilgan uy vazifalarini ko'radi.
   - Vazifani bajarib, botga fayl (rasm, PDF) yoki matn ko'rinishida yuboradi.
   - O'zining oylik statistikasini (qancha topshirgan, qanchasi baholangan) ko'radi.
2. **O'qituvchi (Teacher):**
   - O'z guruhlariga uy vazifasini beradi (matn va fayl biriktirish orqali).
   - O'quvchilar topshirgan ishlarni ko'radi va tekshiradi (To'g'ri / Noto'g'ri deb belgilaydi, izoh yozadi).
3. **Reception (Qabulxona):**
   - O'quvchilar va o'qituvchilarni tizimga qo'shadi (Telegram ID larini bog'laydi).
   - Guruhlar jadvalini boshqaradi.
   - Tizimga maxsus ID yoki kod orqali kiradi.
4. **Owner (Ega):**
   - Barcha huquqlarga ega. Umumiy moliya va oylik hisobotlarni ko'radi.

## 3. Avtorizatsiya (Kirish Tizimi)
- Mini App va ERP Supabase Auth orqali login/parol bilan tizimga kiradi.
- Reception/Owner yangi o'quvchi yaratganda tizim takrorlanmaydigan login va vaqtinchalik parol yaratadi. Parol faqat yaratilgan paytda ko'rsatiladi, uning xavfsiz xeshi Supabase Auth'da saqlanadi.
- Telegram `initData` majburiy emas; Mini App kirilgan Supabase sessiyasidan foydalanuvchi roli va o'quvchi profilini aniqlaydi.
- Reception va Owner o'quvchini guruhga biriktiradi; RLS o'qituvchi huquqini faqat o'z guruhlaridagi vazifa va topshiriqlar bilan cheklaydi.

## 4. Uy Vazifalari (Homework) Jarayoni
1. **Yaratish:** O'qituvchi Mini App orqali vazifa yaratadi (Guruh, Sarlavha, Izoh, Muddat, Fayl). `homework` jadvaliga yoziladi.
2. **Yuborish:** O'quvchi Mini App'da matn, rasm yoki PDF yuboradi. Fayl qisqa muddatli, imzolangan URL orqali **Cloudflare R2** ga yuklanadi; havola `homework_submissions` jadvaliga `pending` statusi bilan yoziladi. Bot ham Telegram'dan qabul qilgan fayllarni R2'ga yuklay oladi.
3. **Tekshirish:** O'qituvchi Mini App'da vazifani ko'rib, `approved` (to'g'ri) yoki `rejected` (noto'g'ri) deb belgilaydi.
4. **Hisobot:** Har oy oxirida `monthly_homework_report` SQL View orqali har bir o'quvchining qancha ish topshirgani va qanday baholangani avtomatik hisoblanadi.

## 5. Fayl Xotirasi (Storage)
- Sayt xotirasi (frontend) Cloudflare Pages'da saqlanadi.
- Yuklangan uy vazifalari (rasm, PDF) **Cloudflare R2** da saqlanadi. Supabase Storage ishlatilmaydi.
- Kerakli env: `CF_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_PUBLIC_URL`, `R2_BUCKET_NAME`. Supabase fayl ombori ishlatilmaydi; Supabase faqat relational ma’lumotlar bazasi sifatida qoladi.

## 6. Texnik Ko'rsatmalar (Copilot Agent uchun)
Loyihada quyidagi o'zgarishlarni amalga oshir:
1. **Database (Supabase):** `homework`, `homework_submissions`, `staff_codes` jadvallarini va `monthly_homework_report` view sini qo'sh. Mavjud jadvallarga `telegram_id` ustunini qo'sh.
2. **Bot (grammy):** `/start` da faqatgina shaxsiy chatda ko'rinadigan `web_app` tugmasini qo'sh (Mini App URL bilan). `/login` buyrug'ini va fayl qabul qilish (document/photo) logikasini yoz.
3. **Cloudflare R2:** `bot/r2.mjs` faylini yaratib, fayllarni Telegram serveridan yuklab olib, R2 ga yuklovchi funksiya yoz.
4. **Mini App UI (React):** Asosiy ERP saytga tegmasdan, alohida yengil `src/miniapp/` qismini yarat. Unda faqat rolga qarab (O'quvchi, O'qituvchi) kerakli interfeys (ro'yxatlar, tugmalar) chiqadigan qilib yasang. Dizayn mobilga to'liq moslashgan (responsive) va zamonaviy bo'lsin.
5. **Auth Integratsiyasi:** Mini App Supabase Auth login/session'ini ishlatadi; RLS foydalanuvchining roli va guruhiga qarab ma'lumotlarni cheklaydi. R2 presign Edge Function Supabase JWT'ni tekshiradi.