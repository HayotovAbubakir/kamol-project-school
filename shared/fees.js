// Guruh narxini oy bo‘yicha aniqlash: sayt, Mini App, bot va Worker bir xil qoidadan foydalanadi.

export function monthKey(month, year) {
  return `${String(Number(year)).padStart(4, '0')}-${String(Number(month)).padStart(2, '0')}`
}

/**
 * `history` — shu guruhning `{ monthly_fee, valid_from: 'YYYY-MM' }` qatorlari.
 * Tarix bo‘lmasa (eski baza) — guruhning hozirgi narxi.
 * Tarix bor, lekin oy undan oldin bo‘lsa — guruh hali yo‘q edi, narx 0.
 */
export function groupFeeForMonth(currentFee, history, month, year) {
  const rows = Array.isArray(history) ? history : []
  if (!rows.length) return Number(currentFee) || 0
  const key = monthKey(month, year)
  let match = null
  for (const row of rows) {
    const from = String(row.valid_from || row.validFrom || '')
    if (from <= key && (!match || from > match.from)) match = { from, fee: row.monthly_fee ?? row.monthlyFee }
  }
  return match ? Number(match.fee) || 0 : 0
}

/** Tarix qatorlarini guruh bo‘yicha guruhlash. */
export function groupFeeHistoryByGroup(rows = []) {
  const byGroup = new Map()
  for (const row of rows) {
    const groupId = row.group_id || row.groupId
    if (!groupId) continue
    const list = byGroup.get(groupId) || []
    list.push(row)
    byGroup.set(groupId, list)
  }
  return byGroup
}
