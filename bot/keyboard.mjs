import { Keyboard } from 'grammy'

export const BTN = {
  holat: 'Holat',
  jadval: 'Jadval',
  davomat: 'Davomat',
  tolov: 'To‘lovlar tarixi',
  unlink: 'Bog‘lanishni uzish',
}

/** Foydalanuvchilarda saqlanib qolgan eski klaviatura yozuvlari ham ishlashi uchun. */
export const LEGACY_BTN = {
  tolov: "To'lovlar tarixi",
  unlink: 'Uzish',
}

export function mainKeyboard(webAppUrl) {
  const keyboard = new Keyboard()
    .text(BTN.holat).text(BTN.jadval).text(BTN.davomat).row()
    .text(BTN.tolov).text(BTN.unlink)

  if (webAppUrl) keyboard.row().webApp('Ilovani ochish', webAppUrl)

  return keyboard.resized().persistent()
}

export function staffKeyboard(webAppUrl) {
  const keyboard = new Keyboard()
  if (webAppUrl) keyboard.webApp('Ilovani ochish', webAppUrl)
  return keyboard.resized().persistent()
}

export function keyboardForRole(role, webAppUrl) {
  return role && role !== 'student' ? staffKeyboard(webAppUrl) : mainKeyboard(webAppUrl)
}

export function removeKeyboard() {
  return { reply_markup: { remove_keyboard: true } }
}

export const BOT_COMMANDS = [
  { command: 'start', description: 'Boshlash yoki qayta ulash' },
  { command: 'menu', description: 'Asosiy menyu' },
  { command: 'holat', description: 'Shu oy to‘lov holati va guruhlar' },
  { command: 'jadval', description: 'Yaqin 14 kunlik dars jadvali' },
  { command: 'davomat', description: 'Oxirgi 14 kunlik davomat' },
  { command: 'tolov', description: 'To‘lovlar tarixi' },
  { command: 'savol', description: 'Qabulxonaga savol yuborish' },
  { command: 'login', description: 'Xodimlar uchun kod bilan kirish' },
  { command: 'unlink', description: 'Bog‘lanishni uzish' },
]
