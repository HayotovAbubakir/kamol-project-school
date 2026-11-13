export const FACE_MAX_SIDE = 640
export const FACE_TARGET_BYTES = 200 * 1024

function canvasToBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('JPEG yaratilmadi.'))), 'image/jpeg', quality)
  })
}

/**
 * Manbani (video kadr yoki rasm) 3:4 portretga markazdan qirqib, uzun tomoni 640px bo‘lgan JPEG ga aylantiradi.
 * Hajm ~200 KB dan oshsa sifat pasaytiriladi.
 */
export async function sourceToFaceJpeg(source, sourceWidth, sourceHeight) {
  const targetRatio = 3 / 4
  let cropWidth = sourceWidth
  let cropHeight = sourceHeight
  if (sourceWidth / sourceHeight > targetRatio) cropWidth = Math.round(sourceHeight * targetRatio)
  else cropHeight = Math.round(sourceWidth / targetRatio)
  const scale = Math.min(1, FACE_MAX_SIDE / cropHeight)
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(cropWidth * scale)
  canvas.height = Math.round(cropHeight * scale)
  const context = canvas.getContext('2d')
  context.drawImage(source, (sourceWidth - cropWidth) / 2, (sourceHeight - cropHeight) / 2, cropWidth, cropHeight, 0, 0, canvas.width, canvas.height)
  let blob = null
  for (const quality of [0.88, 0.8, 0.7, 0.6, 0.5]) {
    blob = await canvasToBlob(canvas, quality)
    if (blob.size <= FACE_TARGET_BYTES) break
  }
  return blob
}

export function videoFrameToFaceJpeg(video) {
  return sourceToFaceJpeg(video, video.videoWidth, video.videoHeight)
}

export async function fileToFaceJpeg(file) {
  const url = URL.createObjectURL(file)
  try {
    const image = await new Promise((resolve, reject) => {
      const element = new Image()
      element.onload = () => resolve(element)
      element.onerror = () => reject(new Error('Rasmni o‘qib bo‘lmadi.'))
      element.src = url
    })
    return await sourceToFaceJpeg(image, image.naturalWidth, image.naturalHeight)
  } finally {
    URL.revokeObjectURL(url)
  }
}
