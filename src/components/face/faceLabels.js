// Face ID matnlari: [o‘zbekcha, ruscha, inglizcha]. Sayt `face.<kalit>` sifatida, Mini App o‘zbekcha matn bo‘yicha ishlatadi.
export const FACE_TEXT = {
  title: ['Face ID rasmlari', 'Фото для Face ID', 'Face ID photos'],
  hint: ['3 ta rasm: to‘g‘ri, biroz chapga va biroz o‘ngga.', '3 фото: прямо, чуть влево и чуть вправо.', '3 photos: straight, slightly left and slightly right.'],
  front: ['To‘g‘ri', 'Прямо', 'Front'],
  frontHint: ['Kameraga to‘g‘ri qarang', 'Смотрите прямо в камеру', 'Look straight at the camera'],
  left: ['Biroz chapga', 'Чуть влево', 'Slightly left'],
  leftHint: ['Boshni biroz chapga buring', 'Слегка поверните голову влево', 'Turn your head slightly left'],
  right: ['Biroz o‘ngga', 'Чуть вправо', 'Slightly right'],
  rightHint: ['Boshni biroz o‘ngga buring', 'Слегка поверните голову вправо', 'Turn your head slightly right'],
  startCamera: ['Kamerani yoqish', 'Включить камеру', 'Turn on camera'],
  stopCamera: ['Kamerani o‘chirish', 'Выключить камеру', 'Turn off camera'],
  capture: ['Rasmga olish', 'Сделать снимок', 'Take photo'],
  retake: ['Qayta olish', 'Переснять', 'Retake'],
  upload: ['Galereyadan yuklash', 'Загрузить из галереи', 'Upload from gallery'],
  cameraError: ['Kamerani ochib bo‘lmadi. Galereyadan yuklang.', 'Не удалось открыть камеру. Загрузите из галереи.', 'Could not open the camera. Upload from the gallery.'],
  imageError: ['Rasmni o‘qib bo‘lmadi. JPEG yoki PNG tanlang.', 'Не удалось прочитать фото. Выберите JPEG или PNG.', 'Could not read the image. Choose a JPEG or PNG.'],
  save: ['Rasmlarni saqlash', 'Сохранить фото', 'Save photos'],
  saving: ['Saqlanmoqda…', 'Сохранение…', 'Saving…'],
  saved: ['Rasmlar saqlandi.', 'Фото сохранены.', 'Photos saved.'],
  addOrUpdate: ['Rasm qo‘shish / yangilash', 'Добавить / обновить фото', 'Add / update photos'],
  cancel: ['Bekor qilish', 'Отмена', 'Cancel'],
  delete: ['O‘chirish', 'Удалить', 'Delete'],
  deletePhotoConfirm: ['Bu rasm o‘chirilsinmi? Qurilmadagi yuz ham yangilanadi.', 'Удалить это фото? Лицо в терминале тоже обновится.', 'Delete this photo? The face on the terminal will be updated too.'],
  retry: ['Qayta yuborish', 'Отправить снова', 'Send again'],
  noPhotos: ['Rasm yo‘q', 'Нет фото', 'No photos'],
  statusSynced: ['Qurilmaga yuklandi', 'Загружено в терминал', 'Synced to terminal'],
  statusPending: ['Qurilmaga yuklanmoqda', 'Ожидает загрузки в терминал', 'Waiting for terminal sync'],
  statusError: ['Qurilmaga yuklashda xato', 'Ошибка загрузки в терминал', 'Terminal sync error'],
  noDevice: ['Face ID qurilmasi hali ulanmagan', 'Терминал Face ID ещё не подключён', 'No Face ID terminal connected yet'],
  uploadFailed: ['O‘quvchi saqlandi, lekin rasmlar yuklanmadi', 'Ученик сохранён, но фото не загрузились', 'Student saved, but photos were not uploaded'],
  optional: ['ixtiyoriy, keyin ham qo‘shish mumkin', 'необязательно, можно добавить позже', 'optional, can be added later'],
  sourceFace: ['Face ID', 'Face ID', 'Face ID'],
  sourceManual: ['Qo‘lda', 'Вручную', 'Manual'],
  lateMinutes: ['{minutes} daqiqa kechikdi', 'Опоздание {minutes} мин', '{minutes} min late'],
  arrivedAt: ['Kelgan: {time}', 'Пришёл: {time}', 'Arrived: {time}'],
  manualTitle: ['Qo‘lda belgilash (zaxira)', 'Ручная отметка (резерв)', 'Manual marking (fallback)'],
  manualHint: ['Davomatni Face ID terminali belgilaydi. Qo‘lda faqat qurilma ishlamasa yoki xato bo‘lsa belgilang.', 'Посещаемость отмечает терминал Face ID. Отмечайте вручную только если терминал не работает или ошибся.', 'Attendance is marked by the Face ID terminal. Mark manually only if the terminal is down or wrong.'],
  showManual: ['Qo‘lda belgilashni ochish', 'Открыть ручную отметку', 'Open manual marking'],
  hideManual: ['Qo‘lda belgilashni yopish', 'Скрыть ручную отметку', 'Hide manual marking'],
  overrideConfirm: ['Bu o‘quvchi Face ID orqali belgilangan. Qo‘lda o‘zgartirasizmi?', 'Ученик отмечен через Face ID. Изменить вручную?', 'This student was marked by Face ID. Change it manually?'],
  overrideAction: ['Ha, o‘zgartirish', 'Да, изменить', 'Yes, change'],
  devicesTitle: ['Face ID qurilmalari', 'Терминалы Face ID', 'Face ID terminals'],
  devicesHint: ['Hikvision terminalini ulash uchun qurilma qo‘shing va tokenni bridge sozlamasiga yozing.', 'Добавьте терминал Hikvision и укажите токен в настройках моста.', 'Add the Hikvision terminal and put the token into the bridge settings.'],
  deviceName: ['Qurilma nomi', 'Название терминала', 'Terminal name'],
  deviceSerial: ['Seriya raqami', 'Серийный номер', 'Serial number'],
  addDevice: ['Qurilma qo‘shish', 'Добавить терминал', 'Add terminal'],
  tokenOnce: ['Token faqat hozir ko‘rsatiladi. Nusxalab bridge sozlamasiga yozing.', 'Токен показывается только сейчас. Скопируйте его в настройки моста.', 'The token is shown only now. Copy it into the bridge settings.'],
  copy: ['Nusxalash', 'Копировать', 'Copy'],
  rotateToken: ['Yangi token', 'Новый токен', 'New token'],
  rotateConfirm: ['Eski token ishlamay qoladi. Yangi token yaratilsinmi?', 'Старый токен перестанет работать. Создать новый?', 'The old token will stop working. Create a new one?'],
  disable: ['O‘chirib qo‘yish', 'Отключить', 'Disable'],
  enable: ['Yoqish', 'Включить', 'Enable'],
  deleteDeviceConfirm: ['Qurilma o‘chirilsinmi? Uning sinxronlash holati ham o‘chadi.', 'Удалить терминал? Его статус синхронизации тоже удалится.', 'Delete the terminal? Its sync state will be removed too.'],
  lastSeen: ['Oxirgi aloqa', 'Последняя связь', 'Last seen'],
  lastEvent: ['Oxirgi skan', 'Последнее сканирование', 'Last scan'],
  never: ['hali yo‘q', 'ещё нет', 'never'],
  active: ['Faol', 'Активен', 'Active'],
  inactive: ['O‘chirilgan', 'Отключён', 'Disabled'],
  syncCounts: ['Yuklangan: {synced} · Navbatda: {pending} · Xato: {errors}', 'Загружено: {synced} · В очереди: {pending} · Ошибки: {errors}', 'Synced: {synced} · Queued: {pending} · Errors: {errors}'],
  noDevices: ['Hali qurilma qo‘shilmagan.', 'Терминалы ещё не добавлены.', 'No terminals added yet.'],
  finalize: ['Kelmaganlarni hozir belgilash', 'Отметить отсутствующих сейчас', 'Mark absentees now'],
  finalizeDone: ['Yopilgan darslar: {closed}, kelmadi: {absent}', 'Закрыто уроков: {closed}, отсутствуют: {absent}', 'Lessons closed: {closed}, absent: {absent}'],
}

export const FACE_ANGLES = ['front', 'left', 'right']

export function faceLabel(labels, key, vars) {
  const custom = labels?.[key]
  if (typeof custom === 'function') return custom(vars)
  const fallback = FACE_TEXT[key]?.[0] || key
  return vars ? fallback.replace(/\{(\w+)\}/g, (match, name) => (vars[name] === undefined ? match : String(vars[name]))) : fallback
}

/** Kalit → tarjima. `translate` o‘zbekcha matnni (Mini App) yoki `face.<kalit>` ni (sayt) qabul qiladi. */
export function buildFaceLabels(translate, mode = 'source') {
  return Object.fromEntries(Object.entries(FACE_TEXT).map(([key, [uz]]) => [
    key,
    (vars) => (mode === 'key' ? translate(`face.${key}`, vars) : translate(uz, vars)),
  ]))
}

export function faceSiteTranslations() {
  const build = (index) => Object.fromEntries(Object.entries(FACE_TEXT).map(([key, values]) => [`face.${key}`, values[index]
    .replace(/\{(\w+)\}/g, '{{$1}}')]))
  return { uz: build(0), ru: build(1), en: build(2) }
}

export const FACE_MINI_ROWS = Object.values(FACE_TEXT)
