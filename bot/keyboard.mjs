import { Keyboard } from 'grammy'

export const BTN = {
  holat: 'Holat',
  davomat: 'Davomat',
  tolov: "To'lovlar tarixi",
  unlink: 'Uzish',
}

export function mainKeyboard() {
  return new Keyboard()
    .text(BTN.holat).text(BTN.davomat).row()
    .text(BTN.tolov).text(BTN.unlink)
    .resized()
    .persistent()
}

export function removeKeyboard() {
  return { reply_markup: { remove_keyboard: true } }
}

export const BOT_COMMANDS = [
  { command: 'start', description: 'Boshlash / qayta ulash' },
  { command: 'holat', description: 'Shu oy to‘lov va guruhlar' },
  { command: 'davomat', description: 'Oxirgi 14 kun davomat' },
  { command: 'tolov', description: 'Jami to‘lovlar tarixi' },
  { command: 'unlink', description: 'Bog‘lashni uzish' },
]
