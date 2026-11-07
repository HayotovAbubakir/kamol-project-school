import { Keyboard } from 'grammy'

export const BTN = {
  holat: 'Holat',
  jadval: 'Jadval',
  davomat: 'Davomat',
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

export function removeKeyboard() {
  return { reply_markup: { remove_keyboard: true } }
}

export const BOT_COMMANDS = [
  { command: 'start', description: 'Boshlash / qayta ulash' },
  { command: 'login', description: 'Staff kod bilan kirish' },
  { command: 'holat', description: 'Shu oy to‘lov va guruhlar' },
  { command: 'jadval', description: 'Yaqin 14 kun dars jadvali' },
  { command: 'davomat', description: 'Oxirgi 14 kun davomat' },
  { command: 'tolov', description: 'Jami to‘lovlar tarixi' },
  { command: 'unlink', description: 'Bog‘lashni uzish' },
]
