# Dars jadvalidagi o‘zgarishlar

## Ma’lumotlar modeli

- `groups.schedule` guruh yaratilgandagi haftalik jadvalni saqlaydi. `schedule_versions` shu jadvalni sanalar bo‘yicha versiyalaydi: `valid_from` jadval kuchga kiradigan sana, `valid_to` esa amal qilish tugaydigan sana.
- `0007_schedule_changes.sql` migratsiyasi mavjud guruhlarga boshlang‘ich versiya qo‘shadi. Keyin yaratilgan guruhlar uchun ham trigger boshlang‘ich versiya yaratadi. D1 triggerlari versiya tarixidagi jadval va boshlanish sanasini o‘zgartirish yoki tarixiy qatorlarni o‘chirishni taqiqlaydi.
- `schedule_overrides` muayyan sanadagi o‘zgarish yoki bekor qilishni, eski va yangi vaqt/sanani, sababni, kim va qachon o‘zgartirganini hamda qaytarilgan vaqtni saqlaydi.
- `schedule_changes` va faqat qo‘shiladigan `schedule_change_events` o‘zgarish, qaytarish, ijrochi va sabab tarixini saqlaydi.
- `schedule_notification_outbox` qabul qiluvchilar, kanallar, yuborish holatlari va qayta urinishlarni saqlaydi. O‘zgarish/qabul qiluvchi/kanal/tur bo‘yicha takroriy yozuvga yo‘l qo‘ymaydi.

## Samarali dars jadvali

`shared/schedule.js` ichidagi `getEffectiveLesson(groupId, date, ...)` tanlangan sanadagi haftalik versiya va qaytarilmagan override’larni birlashtiradi. Qaytarilgan override amaldagi jadvalga ta’sir qilmaydi. Boshqa sanaga ko‘chirilgan dars eski sanada `rescheduled`, yangi sanada `changed`; bekor qilingan dars `cancelled` holatida qaytadi.

Shu funksiya Worker’ning bot uchun `/jadval` ma’lumotida, Website’dagi kunlik darslar va hisobotlarda hamda Mini App jadvali va bosh sahifasida ishlatiladi. Mini App’da o‘qituvchi, qabulxona va egasining guruh sahifasida ham keyingi 14 kun ichidagi o‘zgargan, ko‘chirilgan yoki bekor qilingan darslar ko‘rinadi. Sana va vaqt Asia/Tashkent bo‘yicha hisoblanadi.

## O‘zgartirish, tekshirish va ruxsatlar

- `POST /api/schedule/preview` eski va yangi darsni, xabarnoma oluvchilar sonini va ziddiyatlarni saqlashdan oldin tekshiradi.
- `POST /api/schedule/changes` o‘zgarishni `requestId` orqali takroriy yuborishdan himoyalab saqlaydi. Bir kunlik o‘zgarish yoki bekor qilish override yaratadi; doimiy o‘zgarish yangi jadval versiyasini yaratadi.
- `POST /api/schedule/changes/:id/undo` override’ni qaytaradi yoki oldingi jadvalni yangi versiya orqali tiklaydi. Keyinroq boshqa versiya yaratilgan bo‘lsa, eskisini qaytarib yangi jadvalni bosib ketmaslik uchun `409` javobi qaytadi.
- `GET /api/schedule/state` foydalanuvchi ko‘rishi mumkin bo‘lgan guruhlar jadvalini beradi. `GET /api/schedule/history?group_id=...` o‘zgarishlar tarixi va xabarnomalar yetkazilish holatini qaytaradi.
- Egasi va qabulxona istalgan guruh jadvalini o‘zgartiradi. O‘qituvchi faqat o‘zi dars beradigan guruhni o‘zgartirishi mumkin; o‘qituvchi boshlagan o‘zgarish haqida qabulxonaga ham xabar beriladi. O‘quvchi va tizimga kirmagan foydalanuvchi o‘zgartirish qila olmaydi.
- Umumiy `/api/db` orqali `groups.schedule` yoki `groups.teacher_id` yangilash taqiqlangan. D1 triggeri `groups.schedule`ni bevosita yangilashni ham to‘sadi.
- Vaqt formati, tugash vaqtining boshlanishdan keyin bo‘lishi, guruh ichidagi ustma-ust darslar va o‘qituvchining boshqa guruhlardagi darslari tekshiriladi. Doimiy jadval ziddiyatlari haftaning har bir tegishli kunida, jadval versiyasi yoki sana bo‘yicha override boshlanadigan/tugaydigan chegaralar atrofida tekshiriladi.

## Xabarnomalar

Server o‘zgarish yaratilayotgan paytda guruhdagi faol o‘quvchilar, eski va yangi o‘qituvchini aniqlaydi. Faol bo‘lmagan o‘quvchi akkauntlari chiqarib tashlanadi. Telegram akkaunti ulangan qabul qiluvchiga bot xabari, profili mavjud qabul qiluvchiga ilova ichidagi bildirishnoma yoziladi. O‘qituvchi o‘zgarish kiritgan bo‘lsa, faol qabulxona xodimlari ham qabul qiluvchilar ro‘yxatiga qo‘shiladi.

`scheduled()` cron outbox xabarlarini har daqiqada qayta ishlaydi. Takroriy yuborilishning oldini olish uchun qator vaqtincha `sending` lease holatida band qilinadi; muddati tugagan lease keyingi urinishda qayta navbatga olinadi. Vaqtinchalik xatolarda exponential backoff qo‘llanadi va Telegram qaytargan `retry_after` qiymatiga amal qilinadi. Bot bloklangani haqidagi 403 xatosi qayta urinilmaydi; 8 urinishdan keyin xabar xato holatiga o‘tadi. Bir martalik kelajakdagi o‘zgarish hamda doimiy o‘zgarishdan keyingi ilk kelajak darsidan oldingi kechqurun eslatma rejalashtiriladi; bekor qilingan darsga eslatma yuborilmaydi. Egasi va qabulxona yetkazilish holatini tarixdan ko‘rib, yuborilmagan Telegram xabarini qayta jo‘natishi mumkin.

## Sinovlar va hali tekshirilmagan jihatlar

Unit/Worker testlari boshlang‘ich jadval, override, bekor qilish, yangi versiya, qaytarish, sana bo‘yicha ziddiyat, ruxsatlar, so‘rov takrorlanishi, xabarnoma tarqatilishi va jadvalni bevosita yangilash taqiqini tekshiradi. `tests/miniapp.e2e.js` faylida qabulxona ertangi darsni ko‘chirishi, o‘qituvchi va o‘quvchi o‘zgarish hamda xabarnomani ko‘rishi uchun Playwright oqimi bor.

Playwright oqimi API javoblarini mock qiladi; Worker/API va D1 xatti-harakatlarini Miniflare testlari tekshiradi. Haqiqiy Telegram xabari telefonda tekshirilgani tasdiqlanmagan.
