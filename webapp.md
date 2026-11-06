# Telegram Mini App — ishlash tartibi

## Foydalanuvchi oqimi

Botdagi **Ilovani ochish** menyusi `miniapp.html` sahifasini ochadi. Foydalanuvchi ERP bilan bir xil Worker orqali login va parol kiritadi. Telegram ID o‘rniga hisobning Worker sessiyasi asosiy identifikatsiya hisoblanadi.

Mini App foydalanuvchi roliga qarab quyidagilarni ko‘rsatadi:

- o‘quvchiga o‘z uy vazifalari, topshiriq yuborish va natijalari;
- o‘qituvchiga o‘z guruhlari, vazifa berish va topshiriqlarni ko‘rib chiqish;
- reception/admin va owner’ga vakolat berilgan boshqaruv imkoniyatlari.

## Texnik arxitektura

- React frontend: `src/miniapp/`; Vite build uchun `miniapp.html` entry point.
- API, login, parolni yangilash va rol tekshiruvi: Cloudflare Worker.
- Relatsion ma’lumotlar: D1 (`migrations/`).
- Fayllar: `kamol-files` maxfiy R2 bucket'ida; yuklash va muddati cheklangan havolalar Worker orqali.
- Telegram bot: Worker webhook; polling runner kerak emas.
- Production ishlashi Supabase yoki uning Auth xizmatiga bog‘liq emas. Faqat eski ma’lumotlarni ko‘chirish migration script’i Supabase manbasiga ulanadi.

Batafsil ishlash, sozlash va migratsiya tartibi [README.md](./README.md) hamda [MIGRATION.md](./MIGRATION.md) fayllarida.
