# Rollar va ruxsatlar

## Yagona manba

Rollar va ruxsatlarning yagona matritsasi [`shared/role-permissions.js`](./shared/role-permissions.js). Worker API, website `AuthGuard` va Mini App navigatsiyasi shu matritsadan foydalanadi. O‘qituvchining guruh darajasidagi scope’i Worker’da qo‘shimcha tekshiriladi.

## Rollar

- **Egasi (`owner`)** — barcha sahifa, API, ma’lumot va amallar.
- **Qabulxona (`reception`)** — o‘quvchilar va guruh/jadvalni yaratish-tahrirlash, o‘qituvchilar/guruhlar/davomat/homework holatini ko‘rish, to‘lov kiritish va tarix/debitor holatini ko‘rish, savol ticket’lariga javob berish. Xarajat, maosh, umumiy moliya, staff akkauntlari, rollar sahifasi hamda mavjud to‘lovni o‘zgartirish/o‘chirish huquqi yo‘q.
- **O‘qituvchi (`teacher`)** — o‘z guruhlari doirasida davomat, homework yaratish va topshiriqlarni ko‘rib chiqish. Savol ticket’ini faqat o‘z guruhi uchun belgilangan bo‘lsa ko‘radi.
- **O‘quvchi (`student`)** — website login yoki website route yo‘q. Telegram `initData` orqali Mini App session oladi; faqat o‘z homework, davomat/to‘lov ko‘rinishlari, savollari va ruxsatli fayl endpointlaridan foydalanadi. Umumiy `/api/db` endpointi taqiqlangan.

`/owner/*` UI route’lari UX guard bilan, maxfiy amallar va ma’lumotlar esa Worker’da server-side tekshiruv bilan himoyalanadi. Egasi bo‘lmagan sessiya owner endpoint’lariga ruxsat olmaydi. Student website login endpoint’i umumiy login xabari bilan rad etiladi; student uchun parol yaratish yoki ko‘rsatish yo‘q.

## Xodimlar, o‘quvchilar va audit

Egasi `Xodimlar` sahifasi yoki Mini App’dan Qabulxona va O‘qituvchi akkauntlarini username, telefon va kamida 12 belgili parol bilan yaratadi, tahrirlaydi, faolsizlantiradi/yoqadi va parolini tiklaydi. Xodim parollari faqat PBKDF2 hash va salt ko‘rinishida saqlanadi; parol yaratgan Egaga bir marta ko‘rsatiladi. Egasi hamda Qabulxona o‘quvchini website yoki Mini App’dan kamida 6 belgili kiritilgan parol bilan yaratadi; login ism-familiyadan transliteratsiya qilinadi va band bo‘lsa raqamli suffiks oladi.

Student paroli ham hash bilan tekshiriladi; Egasi va Qabulxona uchun alohida AES-GCM ciphertext saqlanadi. Parol ro‘yxat/detail javoblariga kirmaydi; faqat alohida, role-checked reveal amalida ochiladi va UI’da 8 soniyadan so‘ng yashiriladi. Reveal va o‘zgartirish auditlanadi. Teacher, student va anonymous foydalanuvchiga bu amal taqiqlangan. `STUDENT_PASSWORD_KEY` Cloudflare Worker secret bo‘lib qolishi shart.

O‘quvchi Mini App’ga Telegram `initData` hamda login/parol bilan birinchi marta kiradi; Telegram ID akkauntga bog‘lanadi va keyingi ochilishlarda sessiya avtomatik tiklanadi. Website login student rolini server-side rad etadi. Egasi va Qabulxona student Telegram bog‘lanishini uzishi mumkin. Eski Telegram invite oqimi mavjud bo‘lsa, bir martalik ulash mexanizmi sifatida qoladi.

To‘lov insert/update/delete audit’ida actor, vaqt, old/new qiymatlar saqlanadi; credential audit va homework event jadvallari tegishli audit ma’lumotlarini append-only saqlaydi.

## Tekshiruv holati

Vitest/Miniflare role/table/action juftliklari, Egasi superset’i, reception moliya cheklovi, website student login rad etilishi, finance/staff/homework/Mini App/questions endpoint guruhlari uchun rollar va unauthenticated so‘rovlarni tekshiradi. Production migration, deploy va live role verification alohida bajariladi; real owner loginini faqat Egasi o‘z paroli bilan sinashi mumkin.
