const listeners = new Set()

/** DataContext’dan tashqarida yozilgan o‘zgarishlar (masalan xodim akkaunti) uchun obuna. */
export function onDataChanged(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function notifyDataChanged(scopes) {
  for (const listener of listeners) listener(scopes)
}
