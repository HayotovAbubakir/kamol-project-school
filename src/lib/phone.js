/** O‘zbekiston mobil: +998 (XX) XXX-XX-XX — 9 milliy raqam. */

const COUNTRY = '998'
const LOCAL_LEN = 9
const PARENT_SEP = '|'

export function digitsOnly(value = '') {
  return String(value).replace(/\D/g, '')
}

/** Saqlash uchun: +998XXXXXXXXX yoki bo‘sh. */
export function normalizePhone(value) {
  // Bitta maydonga ikkita raqam yoki "a|b" tushib qolsa — faqat birinchisini olamiz
  const first = String(value || '').split(PARENT_SEP)[0]
  let digits = digitsOnly(first)
  if (!digits) return ''

  if (digits.startsWith('998')) digits = digits.slice(3)
  else if (digits.startsWith('8') && digits.length > 9) digits = digits.slice(1)

  digits = digits.slice(0, LOCAL_LEN)
  if (!digits) return ''
  return `+${COUNTRY}${digits}`
}

/** Input / ko‘rsatish: +998 (XX) XXX-XX-XX */
export function formatPhoneDisplay(value) {
  const normalized = normalizePhone(value)
  if (!normalized) return ''

  const local = digitsOnly(normalized).slice(3)
  const a = local.slice(0, 2)
  const b = local.slice(2, 5)
  const c = local.slice(5, 7)
  const d = local.slice(7, 9)

  let out = `+${COUNTRY}`
  if (!a) return out
  out += ` (${a}`
  if (a.length < 2) return out
  out += ')'
  if (!b) return out
  out += ` ${b}`
  if (!c) return out
  out += `-${c}`
  if (!d) return out
  out += `-${d}`
  return out
}

/** Inputdan faqat milliy 9 raqamni ajratadi (998 dan keyin). */
export function phoneLocalDigits(value) {
  return digitsOnly(normalizePhone(value)).slice(3)
}

export function isCompletePhone(value) {
  return phoneLocalDigits(value).length === LOCAL_LEN
}

export function isEmptyPhone(value) {
  return phoneLocalDigits(value).length === 0
}

/** empty | incomplete | complete */
export function phoneFieldState(value) {
  const len = phoneLocalDigits(value).length
  if (len === 0) return 'empty'
  if (len === LOCAL_LEN) return 'complete'
  return 'incomplete'
}

/** parent_phone: "father|mother" yoki eski bitta raqam. */
export function parseParentPhones(stored = '') {
  const raw = String(stored || '')
  if (!raw) return { fatherPhone: '', motherPhone: '' }

  if (raw.includes(PARENT_SEP)) {
    const [father = '', mother = ''] = raw.split(PARENT_SEP)
    return {
      fatherPhone: normalizePhone(father),
      motherPhone: normalizePhone(mother),
    }
  }

  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object') {
      return {
        fatherPhone: normalizePhone(parsed.father || parsed.f || ''),
        motherPhone: normalizePhone(parsed.mother || parsed.m || ''),
      }
    }
  } catch {
    // legacy single number
  }

  return { fatherPhone: normalizePhone(raw), motherPhone: '' }
}

export function packParentPhones(fatherPhone, motherPhone) {
  const father = normalizePhone(fatherPhone)
  const mother = normalizePhone(motherPhone)
  if (!father && !mother) return ''
  if (father && !mother) return father
  if (!father && mother) return `${PARENT_SEP}${mother}`
  return `${father}${PARENT_SEP}${mother}`
}

/** Ko‘rsatish: ota va ona alohida, chiroyli formatda. */
export function formatParentPhonesDisplay(stored) {
  const { fatherPhone, motherPhone } = parseParentPhones(stored)
  const parts = []
  if (fatherPhone) parts.push(formatPhoneDisplay(fatherPhone))
  if (motherPhone) parts.push(formatPhoneDisplay(motherPhone))
  return parts
}
