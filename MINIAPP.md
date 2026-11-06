# Telegram Mini App — holat va qarorlar

## Arxitektura holati

Cloudflare Worker + D1 + R2 kodi repoda bor; Mini App shu backendda ishlashga mo‘ljallangan. Production Worker/D1 deploy va Supabase ma’lumotlarini ko‘chirish bu ish davomida tasdiqlanmadi. GitHub Actions uchun Cloudflare va Telegram secrets mavjudligi ham tasdiqlanmagan, shuning uchun jonli deploy deb hisoblamang.

Ma’lumot oqimi: React UI → `src/lib/data/` fasadi → Cloudflare API adapteri → Worker → D1/R2. UI komponentlari backendga bevosita `fetch` yoki DB so‘rovi yubormaydi. ERP’dagi biznes amallari mavjud `src/lib/api.js` orqali, Mini App vazifa amallari adapter orqali ishlaydi.

## Aniqlangan sabablar va tuzatishlar

- Telegram `telegram-web-app.js` va Vite’dagi `miniapp.html` build entry avvaldan bor edi; ular asosiy muammo emas.
- Mini App login/parol so‘rar, `Telegram.WebApp.initData`ni Worker’ga yubormas edi. Endi Telegram initData orqali kiradi; ulanmagan foydalanuvchiga o‘zbekcha ko‘rsatma beriladi.
- Worker’da Telegram HMAC tekshiruvi, initData’ning bir soatlik muddati va Telegram ID orqali profil topish yo‘q edi. `/api/auth/telegram` va tekshiruvchi modul qo‘shildi.
- Bir martalik ulash kodi yo‘q edi. Endi 15 daqiqalik tasodifiy kodning faqat SHA-256 xeshi D1’da saqlanadi; student va teacher uchun `/start CODE`, staff uchun `/login CODE` ishlaydi.
- Bot’da `/start CODE`, `/login CODE`, bir nechta homework bo‘lganda tanlash tugmalari va tanlangan vazifani vaqtincha saqlash oqimi yo‘q edi. Worker webhook uchun qo‘shildi.
- Bot yuklagan faylda homework ID yuborilmas, submission/review xabarlari to‘liq ishlamas edi. Endi D1 event trigger + cron orqali teacher/student’ga Telegram xabari yuboriladi.
- Student’ning payment so‘rovida server-side qator egaligi tekshiruvi yo‘q edi. Endi student faqat o‘z `student_id`-siga tegishli to‘lovni o‘qiydi.
- Mini App UI’da faqat homework va student ro‘yxatga olish bo‘limi bor edi. Telegram theme, safe-area, 44px touch target, BackButton/MainButton, refresh, ilovaga qaytganda yangilash va error boundary qo‘shildi.

## Roli bo‘yicha imkoniyatlar

| Amal | Student | Teacher | Reception | Owner |
|---|---|---|---|---|
| Telegram orqali kirish | Bor | Bor | Bor | Bor |
| O‘ziga/mas’ul guruhiga tegishli homework | Bor | Bor | Bor | Bor |
| Homework topshirish, rasm/PDF | Bor | — | — | — |
| Topshiriqni tekshirish, izoh yozish | — | Bor | Faqat ko‘rish | Faqat ko‘rish |
| O‘quvchi qo‘shish/tahrirlash, login ko‘rish | — | — | Bor | Bor |
| Telegram invite yaratish | — | — | Bor (student/teacher) | Bor |
| Homework bo‘yicha oylik hisobot | — | — | Bor | Bor |
| O‘z guruhlari va o‘quvchilar ro‘yxati | — | Bor | — | — |
| Moliyaviy umumiy ko‘rsatkich | — | — | — | Bor (oylik) |
| O‘z to‘lovi/davomatini ko‘rish | Bor | — | — | — |
| O‘qituvchi qo‘shish/tahrirlash va invite | — | — | Bor | Bor |
| Guruh yaratish/tahrirlash/o‘chirish, jadval ziddiyatini tekshirish | — | — | Bor | Bor |
| To‘lov kiritish, oxirgi to‘lovlarni ko‘rish | — | — | Bor | Bor |
| Qarzdorlar ro‘yxati | — | — | UI yo‘q | UI yo‘q |
| Davomat belgilash va ko‘rish | O‘zini ko‘rish | Bor | Bor | Bor |
| Xarajat kiritish/ko‘rish | — | — | — | Bor |
| Ish haqi kiritish/ko‘rish | — | — | — | Bor |
| Staff/admin boshqaruvi | — | — | — | UI yo‘q |

O‘quvchini faolsizlantirish amali, qarzdorlar ro‘yxati va 500 dan ortiq o‘quvchi uchun server pagination hali yo‘q. Guruhni o‘chirish tasdiq oynasi bilan bajariladi; o‘qituvchini o‘chirish ham tasdiq talab qiladi.

Staff/admin akkauntlarini boshqarish Mini App’da hali yo‘q. Grafik talab qiladigan hisobot oylik yig‘indi ko‘rinishida soddalashtirilgan; shu sabab Mini App hali ERP bilan to‘liq teng emas.

## UI/UX va ma’lumot oqimi

- Telegram theme parameters’dan light/dark rang olinadi; safe-area hisobga olinadi, touch target’lar kamida 44px.
- Telegram BackButton dashboard’ga qaytaradi. Student yaratish va homework topshirishda MainButton formani yuboradi.
- Yangilash tugmasi, pastga tortib yangilash va `visibilitychange` refetch mavjud. O‘zgarishdan so‘ng ma’lumot serverdan qayta olinadi.
- Student fayl tanlaganda rasm/PDF oldindan ko‘rinadi. PDF/JPEG/PNG/WebP turi va 10 MB cheklovini client hamda Worker tekshiradi. Bot fayllari uchun tasodifiy R2 key ishlatiladi.
- Pul miqdori `uz-UZ` locale’da ko‘rsatiladi. 360×640, 390×844, 430×932 Telegram WebView o‘lchamlarida real Telegram-client tekshiruvi hamda Playwright e2e bajarilmagan.
- Oylik to‘lov formasida oy nomlari o‘zbekcha ro‘yxatdan olinadi; brauzer locale fallback’i ishlatilmaydi.

## Tekshiruv va qolgan ishlar

- Avtomatik testlar: Telegram HMAC (to‘g‘ri/o‘zgartirilgan/muddati o‘tgan/kelajakdagi ma’lumot), invite xeshi va bir martalik ishlatish, role ruxsatlari, Worker auth va biznes logikasi.
- `npm.cmd run lint` — muvaffaqiyatli.
- `npm.cmd test` — 2 test fayli, 13 test muvaffaqiyatli.
- `npm.cmd run build` — muvaffaqiyatli; `miniapp.html` build tarkibida bor, Mini App JavaScript gzip hajmi 12.57 KB.
- Brauzerda Telegram auth mock bilan 360×640 o‘lchamda boshqaruv panelini, 430×932 o‘lchamda dashboard’ni ko‘rdim; ikkala holatda ham gorizontal overflow yo‘q. 360×640, 390×844, 430×932 o‘lchamlarida kirish sahifasida ham overflow kuzatilmadi. Bu real Telegram auth yoki Playwright e2e sinovi emas.
- 360×640 mock boshqaruv ekranida o‘quvchi, o‘qituvchi va bir nechta haftalik dars vaqti bor guruh tahrirlash formalarini ochib ko‘rdim; gorizontal overflow kuzatilmadi.
- Secrets bo‘lmagani uchun live URL, webhook va GitHub Actions deploy’ni tekshirib bo‘lmaydi. Haqiqiy Telegram klientidagi oqimni qo‘lda sinash kerak.
- Deploy’dan oldin GitHub secrets’ni `MIGRATION.md` ko‘rsatmasiga ko‘ra sozlab, D1 `0003_telegram_miniapp.sql` migratsiyasi va Worker deploy workflow’ni ishga tushiring.
- O‘quvchi yoki staff akkaunti yaratilgach, Reception/Owner invite yaratib 15 daqiqa ichida yuboradi. Yangi tizim to‘liq tekshirilmaguncha Supabase’ni o‘chirmang.
