const CYRILLIC = Object.freeze({
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh',
  з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o',
  п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts',
  ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'i', ь: '', э: 'e', ю: 'yu',
  я: 'ya', ў: 'o', қ: 'q', ғ: 'g', ҳ: 'h',
})

export function transliterate(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[oʻо’']/g, (letter) => letter === 'o' || letter === 'о' ? 'o' : '')
    .replace(/[gʻғ’']/g, (letter) => letter === 'g' || letter === 'г' || letter === 'ғ' ? 'g' : '')
    .replace(/[а-яёўқғҳ]/g, (letter, index, input) => (
      letter === 'е' && index > 0 && /[аеёиоуыэюя]/.test(input[index - 1])
        ? 'ye'
        : CYRILLIC[letter] ?? letter
    ))
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

export function loginBaseFromName(name) {
  const words = transliterate(name)
    .replace(/[’'`]/g, '')
    .split(/[\s-]+/)
    .map((word) => word.replace(/[^a-z0-9]/g, ''))
    .filter(Boolean)
  if (!words.length) return 'user'
  const first = words[0]
  const last = words.length > 1 ? words[words.length - 1] : first
  return `${first}.${last}`.slice(0, 64).replace(/\.+$/, '') || 'user'
}

export function isValidLogin(value) {
  return typeof value === 'string'
    && value.length >= 2
    && value.length <= 64
    && /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/i.test(value)
}
