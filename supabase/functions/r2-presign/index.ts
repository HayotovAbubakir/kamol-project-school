import { S3Client, PutObjectCommand } from 'npm:@aws-sdk/client-s3'
import { getSignedUrl } from 'npm:@aws-sdk/s3-request-presigner'
import { createClient } from 'npm:@supabase/supabase-js@2.56.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
}

function respond(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders })
}

function requiredEnv(name: string) {
  const value = Deno.env.get(name)
  if (!value) throw new Error(`Missing ${name}`)
  return value
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return respond({ error: 'Method not allowed' }, 405)

  try {
    const authorization = req.headers.get('Authorization')
    if (!authorization?.startsWith('Bearer ')) return respond({ error: 'Login required' }, 401)

    const supabase = createClient(requiredEnv('SUPABASE_URL'), requiredEnv('SUPABASE_ANON_KEY'), {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: authData, error: authError } = await supabase.auth.getUser()
    if (authError || !authData.user) return respond({ error: 'Invalid session' }, 401)

    const { data: profile, error: profileError } = await supabase.from('profiles')
      .select('id, role, teacher_id, student_id')
      .eq('id', authData.user.id)
      .single()
    if (profileError || !profile) return respond({ error: 'Profile not found' }, 403)

    const { homework_id: homeworkId, filename, content_type: contentType, size } = await req.json()
    if (typeof filename !== 'string' || !filename.trim()) return respond({ error: 'File name required' }, 400)
    if (!Number.isFinite(size) || size <= 0 || size > 10 * 1024 * 1024) {
      return respond({ error: 'File must be smaller than 10 MB' }, 400)
    }

    const allowedTypes = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
    if (!allowedTypes.has(contentType)) return respond({ error: 'Only PDF, JPEG, PNG, and WebP files are supported' }, 415)

    const bucket = Deno.env.get('R2_BUCKET_NAME') || 'kamol-files'
    const safeName = filename.trim().replace(/[^a-zA-Z0-9._-]/g, '-').slice(-100)
    const key = `homework/${profile.id}/${crypto.randomUUID()}-${safeName}`
    if (homeworkId) {
      const { data: homework, error: homeworkError } = await supabase.from('homework')
        .select('id, group_id, teacher_id')
        .eq('id', homeworkId)
        .single()
      if (homeworkError || !homework) return respond({ error: 'Homework not found or access denied' }, 404)

      if (profile.role === 'student') {
        const { data: membership, error } = await supabase.from('group_students')
          .select('group_id')
          .eq('student_id', profile.student_id)
          .eq('group_id', homework.group_id)
          .maybeSingle()
        if (error || !membership) return respond({ error: 'This homework is not assigned to you' }, 403)
      } else if (profile.role === 'teacher' && homework.teacher_id !== profile.teacher_id) {
        return respond({ error: 'You cannot upload to this homework' }, 403)
      } else if (!['student', 'teacher', 'admin', 'reception', 'owner'].includes(profile.role)) {
        return respond({ error: 'Role not allowed' }, 403)
      }
    } else if (!['teacher', 'admin', 'reception', 'owner'].includes(profile.role)) {
      return respond({ error: 'Role not allowed' }, 403)
    }

    const accountId = requiredEnv('CF_ACCOUNT_ID')
    const publicBase = requiredEnv('R2_PUBLIC_URL').replace(/\/+$/, '')
    const s3 = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      forcePathStyle: true,
      credentials: {
        accessKeyId: requiredEnv('R2_ACCESS_KEY_ID'),
        secretAccessKey: requiredEnv('R2_SECRET_ACCESS_KEY'),
      },
    })
    const command = new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType })
    const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 60 })
    return respond({ upload_url: uploadUrl, file_url: `${publicBase}/${key}`, key })
  } catch (error) {
    return respond({ error: error instanceof Error ? error.message : String(error) }, 500)
  }
})
