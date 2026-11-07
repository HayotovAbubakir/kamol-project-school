# Uy vazifasi: qarorlar va amalga oshirish

## Mahsulot qoidalari

- Holatlar: `open`, `draft`, `submitted`, `checked` va `expired`. Draft 24 soat ichida yuborilmasa, muddati tugaydi va o‘quvchiga eslatma yuboriladi.
- Draft o‘qituvchiga ko‘rsatilmaydi va topshirilgan hisoblanmaydi. Yuborish uchun kamida bitta fayl yoki matn hamda aynan bitta kamida 3 soniyalik voice yoki dumaloq video proof talab qilinadi. Telegram bot oqimi `material → proof → Yuborish` tartibida ishlaydi.
- Mini App bir faylni 100 MB gacha R2’ga bevosita yuklaydi; bot Telegram `getFile` cheklovi sababli 20 MB gacha fayl qabul qiladi. `MediaRecorder` mavjud bo‘lsa, Mini App’da ovoz yozish taklif qilinadi; qo‘llab-quvvatlanmagan yoki mikrofonga ruxsat berilmagan qurilmada botga o‘tish havolasi qoladi.
- O‘quvchining “Bajardim/Bajarolmadim” belgisi o‘qituvchining “Bajardi/Bajarmadi” yakuniy bahosidan alohida. “Bajardim” faqat to‘liq yuborilgan topshiriq bilan belgilanadi. Rad etilgan ish qayta topshirilganda yangi urinish yaratiladi; oldingi urinishlar saqlanadi.
- Muddat o‘tib yuborilmagan ish Mini App’da “Topshirilmadi” deb ko‘rsatiladi. Oylik hisobot topshiriq berilgan oy bo‘yicha assignment, vaqtida/kech topshirish, bajarilmagan hamda o‘qituvchi baholarini sanaydi.
- Uy vazifasi voqealari `homework_events` jadvalida append-only saqlanadi. Har bir submission urinish uchun alohida `homework_submissions` qatori bo‘ladi.
- Fayllar tasodifiy R2 kalitida saqlanadi, asl nom faqat metadata’da qoladi. Yuklab olish `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff` va `default-src 'none'; sandbox` CSP bilan beriladi. Ruxsat faqat o‘quvchi, tegishli guruh o‘qituvchisi, Qabulxona va Egaga beriladi. Bajariladigan kengaytmalar uchun o‘qituvchiga “faqat yuklab oling” ogohlantirishi ko‘rsatiladi.

## Savollar

- O‘quvchi botdagi `/savol` yoki Mini App’dan matn va ixtiyoriy ilova yuborishi mumkin.
- Ticket va xabarlar `question_tickets` / `question_messages` da to‘liq saqlanadi. Egasi va Qabulxona inbox’dan qidiradi, holat bo‘yicha filtrlaydi, javob beradi va ticket’ni yopadi. Javob bot orqali o‘quvchiga yuboriladi.
- O‘qituvchi faqat o‘z guruhi bilan belgilangan ticket’larni ko‘rishi mumkin. Savol va homework ilovalari authenticated download orqali beriladi.

## Tekshiruv

Vitest/Miniflare quyidagilarni tekshiradi: proof yo‘q yoki 3 soniyadan qisqa bo‘lsa yuborish rad qilinishi, to‘liq topshirish, urinishlar, draft muddati, tarixning append-only bo‘lishi, hisobot hisoblari, fayl javob headerlari, savol ticket oqimi va teacher xabari matni. Worker’dagi Telegram webhook hamda real telefondagi voice/video note oqimi Cloudflare deploy’dan keyin amaliy tekshiruvni talab qiladi.
