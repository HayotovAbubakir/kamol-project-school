# Kamol School — boshlang‘ich audit

Audit kod o‘zgartirilishidan oldin `src/`, `bot/`, `scripts/`, `supabase/`, Worker, D1 migration, Vite/Wrangler va GitHub workflow fayllari bo‘yicha o‘tkazildi. O‘sha paytdagi `HEAD` da mavjud bo‘lgan, lekin ishchi nusxadan oldin o‘chirilgan Supabase fayllari ham tekshirildi. Quyidagi bandlar boshlang‘ich holatni qayd etadi; keyingi arxitektura va bajarilgan ishlar [MIGRATION.md](./MIGRATION.md) da.

## Kritik va yuqori xavf

1. **Kritik — ma’lumotlarga ruxsatsiz kirish ehtimoli.** Frontend `loadAll()` barcha rollar uchun profillar, o‘quvchilar, to‘lovlar va davomatni cheklovsiz so‘ragan; UI route guard server xavfsizligi emas (`src/lib/api.js`, `src/App.jsx`, `src/components/AuthGuard.jsx`). Worker’da owner, admin va reception rollari umumiy staff ruxsatidan foydalangan; guruh jadvali/to‘qnashuvlari serverda tekshirilmagan.
2. **Yuqori — API input validatsiyasi to‘liq emas.** `/api/db` jadval nomini cheklagan, lekin ustunlarda sintaktik regex bilan cheklangan; maydon turi, uzunligi, qiymatlar va request hajmiga yagona schema bo‘lmagan. Signup, RPC, bot va migratsiya endpointlarida validatsiya bir xil bo‘lmagan.
3. **Yuqori — autentifikatsiya himoyasi yetarli emas.** Login rate limit, qisqa muddatli sessiya, refresh/invalidatsiya va majburiy parol yangilash oqimi bo‘lmagan; parol minimumi zaif bo‘lgan.
4. **Yuqori — rol eskalatsiyasi va ortiqcha vakolat.** Umumiy staff roli admin/reception’ga owner darajasidagi moliyaviy CRUD bergan. O‘qituvchi homework, davomat va o‘quvchi topshiriqlarini faqat vakolatli guruhlar doirasida o‘zgartirishiga doir tekshiruvlar to‘liq bo‘lmagan.
5. **Yuqori — guruh a’zoligi qisman yozilib qolishi mumkin.** Frontend avval eski guruh-o‘quvchi bog‘lanishlarini o‘chirib, keyin yangisini qo‘shgan; tranzaksiya bo‘lmasa xatoda a’zolik yo‘qolishi mumkin bo‘lgan.
6. **Yuqori — ma’lumot migratsiyasi ishonchsiz.** Dastlabki script natijani D1 bilan taqqoslab tekshirmagan va Supabase Storage fayllarini ko‘chirmagan. Supabase Auth parol xeshlarini qayta ishlatib bo‘lmaydi; vaqtinchalik parol va majburiy reset oqimi yetishmagan.
7. **Yuqori — standart/test parollar.** Eski Supabase schema o‘rnatish ko‘rsatmasi `owner123`/`admin123` parollarini tavsiya qilgan; eski seed script mavjud akkauntlar parolini shu qiymatlarga o‘zgartirgan.
8. **Yuqori — CORS va brauzer xavfsizlik sarlavhalari.** Worker barcha origin’lar uchun ochiq CORS qaytargan, CSP, HSTS, clickjacking’dan himoya va boshqa xavfsizlik sarlavhalarini izchil qo‘llamagan. R2 havolalari muddatsiz bo‘lgan.

## O‘rta xavf va funksional kamchiliklar

9. **Bot ishlashi va bildirishnoma yo‘qolishi.** Bot polling’dan foydalangan va ishga tushganda webhook’ni o‘chirgan. Bot o‘chiq bo‘lgan paytdagi eventlar o‘tib ketishi, qayta ishlash xatosida cursor oldinga siljib bildirishnoma yo‘qolishi mumkin bo‘lgan.
10. **Fayl yuklash va ma’lumot bog‘liqligi.** Yuklash faqat MIME sarlavhasini tekshirgan, fayl imzosini tekshirmagan. Eski Supabase Storage havolalari D1’da qolsa, private R2 bilan ishlamasligi mumkin bo‘lgan.
11. **Cheklanmagan so‘rovlar va N+1.** `loadAll()` jadval ma’lumotlarini cheklovsiz yuklagan va har o‘zgarishdan so‘ng qayta yuklagan. UI/API sahifalash yo‘q; Worker natijani standart 1 000 qator bilan cheklagan.
12. **UX va xato boshqaruvi.** Login sahifasi tarmoq/server/profil xatolarini noto‘g‘ri parol deb ko‘rsatgan. O‘qituvchi davomatni saqlash xatosi ko‘rinmagan; logout’dan keyin eski `loadAll()` javobi state’ni qayta to‘ldirishi mumkin bo‘lgan. Umumiy modalda focus trap va focus qaytarish bo‘lmagan.
13. **Moliya, jadval va testlar.** Server-side schedule overlap/teacher conflict tekshiruvi va endpoint’lar bo‘ylab rol matriksasi bo‘lmagan. Testlar yo‘q, ESLint dastlab 19 xato va 3 ogohlantirish bergan. Dastlabki dependency tekshiruvida 16 zaiflik (11 high, 5 moderate) qayd etilgan.
14. **Ishlatilmaydigan kod va deploy sozlamalari.** Ayrim komponentlar route’ga ulanmagan; Railway/Nixpacks/PM2 sozlamalari Cloudflare bot yo‘nalishiga mos kelmagan. Deploy workflow’da CI test bosqichi bo‘lmagan va deploy repository secrets’ga bog‘liq bo‘lgan.
15. **Hujjat va source cleanup.** README, `TZ_MiniApp.md`, `webapp.md` hamda Supabase schema/functions bir-biriga mos kelmaydigan arxitekturani ta’riflagan. Eski Supabase cleanup script `staff_codes` jadvalini o‘chirmagan.

## Audit chegarasi

- `.env` ichidagi qiymatlar chiqarilmadi; faqat secret nomlari bor-yo‘qligi tekshirildi.
- Audit vaqtida Supabase manbasi yoki Cloudflare production ma’lumotlari o‘zgartirilmadi.
- Bu boshlang‘ich kod auditi bo‘lib, production penetration testi emas.
