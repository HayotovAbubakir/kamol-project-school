import crypto from 'node:crypto'
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'

function getRequiredEnv(name) {
  const value = process.env[name]
  if (!value || !String(value).trim()) {
    throw new Error(`Missing env: ${name}`)
  }
  return String(value).trim()
}

export function getR2PublicUrl(objectKey) {
  const publicUrl = process.env.R2_PUBLIC_URL || process.env.R2_PUBLIC_ID || ''
  if (!publicUrl) {
    throw new Error('R2_PUBLIC_URL sozlanmagan: R2 bucket uchun public URL yoki custom domain kiriting')
  }

  const base = publicUrl.includes('://') ? publicUrl : `https://${publicUrl}`
  const url = new URL(base)
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('R2_PUBLIC_URL HTTPS manzil bo‘lishi kerak')
  }

  const key = String(objectKey || '').split('/').filter(Boolean).map(encodeURIComponent).join('/')
  const path = url.pathname.replace(/\/+$/, '')
  url.pathname = [path, key].filter(Boolean).join('/')
  return url.toString().replace(/\/$/, '')
}

export async function uploadBytesToR2({ bucketName, objectKey, body, contentType = 'application/octet-stream' }) {
  const accountId = process.env.CF_ACCOUNT_ID || getRequiredEnv('CF_ACCOUNT_ID')
  const accessKeyId = process.env.R2_ACCESS_KEY_ID || getRequiredEnv('R2_ACCESS_KEY_ID')
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY || getRequiredEnv('R2_SECRET_ACCESS_KEY')
  const bucket = bucketName || process.env.R2_BUCKET_NAME || 'kamol-files'
  const key = String(objectKey || '').replace(/^\//, '')
  if (!key) throw new Error('objectKey is required')
  const publicUrl = getR2PublicUrl(key)

  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
  })

  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: Buffer.isBuffer(body) ? body : Buffer.from(body),
    ContentType: contentType,
  }))

  return { key, bucket, url: publicUrl }
}

export async function uploadTelegramFileToR2({ fileStream, fileName, bucketName, mimeType = 'application/octet-stream' }) {
  const buffer = Buffer.from(await new Response(fileStream).arrayBuffer())
  const safeName = String(fileName || 'homework-file').replace(/[^a-zA-Z0-9._-]/g, '-')
  const objectKey = `homework/${Date.now()}-${crypto.randomUUID()}-${safeName}`
  return uploadBytesToR2({
    bucketName,
    objectKey,
    body: buffer,
    contentType: mimeType,
  })
}
