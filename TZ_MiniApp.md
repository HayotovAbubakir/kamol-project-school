# KAMOL PROJECT SCHOOL — Telegram Mini App va ERP Integratsiyasi Texnik Topshiriq (TZ)

## 1. Loyihaning maqsadi
Mavjud ERP tizimi va Telegram botni yagona ekotizimga birlashtirish. Mini App o'quvchilar, o'qituvchilar, Reception va Owner uchun mobil qurilmalarda ishlaydigan yengil ofis bo'ladi. Asosiy kirish usuli login va parol bo'ladi.

## 2. Rollar
1. **O'quvchi:** o'z vazifalarini ko'radi va matn, rasm yoki PDF bilan topshiradi; baholari va oylik statistikasini ko'radi.
2. **O'qituvchi:** o'z guruhlariga vazifa beradi, topshiriqlarni qabul qiladi yoki qaytaradi va izoh yozadi.
3. **Reception:** o'quvchi yaratadi, login/parolni yetkazadi, guruhlarga biriktiradi va vazifalarni boshqaradi.
4. **Owner:** barcha huquqlarga, o'quv va moliyaviy hisobotlarga ega.

## 3. Avtorizatsiya
- Mini App va ERP yagona Supabase Auth login/parol tizimidan foydalanadi.
- O'quvchi yaratilganda ism-familiyadan takrorlanmaydigan login (`login`, zarur bo'lsa sonli qo'shimcha) va `kp` + 5 raqam + `s` shaklidagi parol yaratiladi.
- Login va parol Reception/Owner'ga faqat akkaunt yaratilgan paytda ko'rsatiladi; parol ochiq holda bazada saqlanmaydi.
- Telegram `initData` ixtiyoriy qulaylik bo'lib qoladi; asosiy kirish login va parol bilan.
- RLS har bir foydalanuvchining roli va guruhiga mos ma'lumotlargagina ruxsat beradi.

## 4. Mini App sahifalari
1. Login: logo, login va parol.
2. Dashboard: rolga mos salomlashish va vazifalar, baholar yoki boshqaruv kartalari.
3. Uy vazifalari: o'quvchiga biriktirilgan yoki o'qituvchi yaratgan vazifalar va statuslar.
4. Vazifa tafsiloti: shart/fayl, o'quvchi javobi, o'qituvchining qabul qilish/qaytarish va izoh berish amallari.
5. Boshqaruv (Reception/Owner): o'quvchi yaratish, login ma'lumotlarini ko'rsatish va guruhga biriktirish.
6. Hisobotlar (Reception/Owner): har o'quvchining oylik topshiriq va baholash statistikasi.

## 5. Uy vazifalari jarayoni
1. O'qituvchi guruh, sarlavha, izoh, muddat va fayl bilan vazifa yaratadi.
2. O'quvchi Mini App'da matn yoki fayl yuboradi. Fayl imzolangan URL orqali Cloudflare R2'ga yuklanadi; topshiriq `pending` statusi bilan saqlanadi. Bot ham Telegram'dan qabul qilgan fayllarni R2'ga yuklay oladi.
3. O'qituvchi topshiriqni `approved` yoki `rejected` qiladi va izoh saqlaydi.
4. `monthly_homework_report` view oylik statistikani taqdim etadi.

## 6. Ma'lumotlar va xotira
- Supabase Auth va PostgreSQL foydalanuvchi hamda o'quv jarayoni ma'lumotlarini saqlaydi.
- `students` jadvalida login va Auth profiliga bog'lanish bo'ladi; `homework`, `homework_submissions`, `staff_codes` va `monthly_homework_report` ishlatiladi.
- Supabase Storage ishlatilmaydi. Uy vazifasi fayllari Cloudflare R2'da saqlanadi.
- R2 uchun `CF_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_PUBLIC_URL`, `R2_BUCKET_NAME` sozlanadi.

## 7. Texnik talablar
1. Mini App alohida `src/miniapp/` entry point bo'ladi; mavjud ERP `App.jsx`-ga tegilmaydi.
2. Bot grammY orqali shaxsiy chatda Web App tugmasini ko'rsatadi va rasm/PDF fayllarni R2'ga yuklaydi.
3. Mini App React va Tailwind CSS bilan, mobile-first va og'ir qo'shimcha UI kutubxonalarisiz quriladi.
4. Auth sessiyasi JWT asosida bo'ladi; R2 presign Edge Function sessiyani tekshiradi.
5. Barcha jadvallarda role/group access RLS bilan cheklanadi.
