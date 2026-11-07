# Akkauntlar va kirish

## Xodim akkauntlari

- Faqat Egasi `Xodimlar` sahifasi yoki Mini App boshqaruv bo‘limidan Qabulxona va O‘qituvchi akkauntlarini yaratishi, tahrirlashi, faolsizlantirishi va parolini tiklashi mumkin.
- Login ism-familiyadan lotin alifbosida tayyorlanadi; band bo‘lsa raqam qo‘shiladi. Egasi loginni tahrirlashi mumkin.
- Egasi kiritgan xodim paroli kamida 12 belgidan iborat. Parol bir marta ko‘rsatiladi; bazada faqat PBKDF2 hash va salt saqlanadi. Xodim paroli qayta ochib ko‘rsatilmaydi.
- O‘qituvchi va Qabulxona website hamda Mini App’ga kira oladi. Student website login endpoint’ida rad etiladi.

## O‘quvchi akkauntlari

- Egasi va Qabulxona website yoki Mini App’dan o‘quvchi akkauntini yaratadi. Login ism-familiyadan lotincha tayyorlanadi; takrorlansa oxiriga `2`, `3` va hokazo qo‘shiladi. Loginni keyin o‘zgartirish mumkin, lekin u yagona va formatga mos bo‘lishi shart.
- Yaratishda parolni xodim kiritadi; kamida 6 belgi talab qilinadi. Parol o‘quvchining PBKDF2 hash’i sifatida tekshiriladi va Egasi/Qabulxona uchun alohida AES-GCM shifrlangan nusxada saqlanadi.
- Parol ro‘yxat yoki oddiy detail API’da qaytarilmaydi. Faqat Egasi yoki Qabulxona kartadagi **Parolni ko‘rsatish** amalini tanlaganda alohida endpoint ochadi; har bir ko‘rsatish va o‘zgartirish actor/student/vaqt bilan auditga yoziladi. Ko‘rsatilgan parol UI’da 8 soniyadan so‘ng yashiriladi. O‘qituvchi va o‘quvchiga parolni ochish taqiqlangan.
- UI eslatmasi: “Parolni boshqa joylarda ishlatmang.”
- Mini App birinchi kirishda Telegram `initData`ni tekshiradi va login/parol so‘raydi. Muvaffaqiyatli kirish Telegram ID’ni akkauntga biriktiradi; keyingi ochilishlar avtomatik bo‘ladi. Bir akkaunt yoki Telegram ID boshqa akkauntga bog‘langan bo‘lsa, ulash rad etiladi. Egasi va Qabulxona Telegram ulanishini bekor qilishi mumkin.
- Login urinishlari login, IP va Telegram ID bo‘yicha cheklanadi; muvaffaqiyatsiz urinishlar login matnini saqlamasdan auditlanadi.

## Worker siri va deploy

`STUDENT_PASSWORD_KEY` 32 bayt tasodifiy kalit bo‘lishi kerak (64 hex belgi). Bir marta yarating, hech qachon chatga, source control’ga yoki terminal log’iga yozmang. GitHub Actions deploy ishlatish uchun uni repo `Settings → Secrets and variables → Actions` ichida `STUDENT_PASSWORD_KEY` nomi bilan saqlang. PowerShell’da clipboard’ga xavfsiz tayyorlash:

```powershell
$key = [Convert]::ToHexString([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLowerInvariant()
Set-Clipboard -Value $key
Remove-Variable key
```

Clipboard’dagi qiymatni GitHub secret maydoniga joylashtirgach clipboard’ni tozalang. Local Wrangler deploy ishlatilsa, ayni kalitni yana yaratmang; `npx wrangler secret put STUDENT_PASSWORD_KEY` buyrug‘iga GitHub secret’dagi mavjud qiymatni terminal prompt’ida kiriting. Kalit almashtirilsa, oldingi ciphertext’lar ochilmaydi; avval barcha o‘quvchi parollarini xavfsiz yangilash rejasini tuzing.

GitHub deploy uchun `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_URL`, `AUTH_SECRET`, `BOT_API_SECRET`, `STUDENT_PASSWORD_KEY`, `TELEGRAM_BOT_TOKEN` va `TELEGRAM_WEBHOOK_SECRET` Actions secrets talab qilinadi. Workflow D1 migration’larni remote’ga qo‘llaydi, Worker secret’larini sozlab deploy qiladi, so‘ng `/api/health` tekshiradi. Secret qiymatlarini log’ga chiqarish yoki commit qilish mumkin emas.

Migration `0005_account_credentials.sql` profile phone, o‘quvchi credential ciphertext/IV va credential/auth audit jadvallarini qo‘shadi; Telegram link’da har bir o‘quvchi uchun unique constraint o‘rnatadi. `0004_roles_homework_questions.sql` va `0005` migration’larini tekshirilmagan DB’da qo‘lda qayta qo‘llamang; deploy workflow migration holatini boshqaradi.

## Chiqarishdan keyingi tekshiruv

Owner va Qabulxona bilan student yaratish, login/parol, nusxa olish, password reveal/change, Telegram ulash/uzish va qayta kirishni amalda tekshiring. Teacher va student sifatida password reveal rad etilishini, student website login rad etilishini hamda staff akkauntining website/Mini App’da ishlashini tasdiqlang. Real Telegram Mini App va owner hisoblari bilan sinov production deploy’dan keyin bajariladi.
