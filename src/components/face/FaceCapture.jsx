import { Camera, CameraOff, ImagePlus, RotateCcw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { FACE_ANGLES, faceLabel } from './faceLabels.js'
import { fileToFaceJpeg, videoFrameToFaceJpeg } from './faceImage.js'
import './face.css'

/**
 * Face ID uchun 3 ta yo‘naltirilgan rasm (to‘g‘ri, chapga, o‘ngga). Kamera ishlamasa galereyadan yuklanadi.
 * `onChange({ front: { blob, url }, ... })` — har bir o‘zgarishda.
 */
export default function FaceCapture({ labels, onChange, disabled = false }) {
  const label = (key, vars) => faceLabel(labels, key, vars)
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const fileRef = useRef(null)
  const shotsRef = useRef({})
  const [shots, setShots] = useState({})
  const [active, setActive] = useState('front')
  const [cameraOn, setCameraOn] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    Object.values(shotsRef.current).forEach((shot) => shot?.url && URL.revokeObjectURL(shot.url))
  }, [])

  useEffect(() => {
    const video = videoRef.current
    if (!cameraOn || !video || !streamRef.current) return
    video.srcObject = streamRef.current
    video.play().catch(() => {})
  }, [cameraOn])

  const publish = (next) => {
    shotsRef.current = next
    setShots(next)
    onChange?.(next)
  }

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    setCameraOn(false)
  }

  const startCamera = async () => {
    setError('')
    if (!navigator.mediaDevices?.getUserMedia) {
      setError(label('cameraError'))
      return
    }
    try {
      streamRef.current = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 960 } },
        audio: false,
      })
      setCameraOn(true)
    } catch {
      setError(label('cameraError'))
    }
  }

  const store = (angle, blob) => {
    const next = { ...shotsRef.current }
    if (next[angle]?.url) URL.revokeObjectURL(next[angle].url)
    next[angle] = { blob, url: URL.createObjectURL(blob) }
    publish(next)
    const missing = FACE_ANGLES.find((item) => !next[item])
    if (missing) setActive(missing)
    else stopCamera()
  }

  const capture = async () => {
    const video = videoRef.current
    if (!video?.videoWidth) return
    setBusy(true)
    try {
      store(active, await videoFrameToFaceJpeg(video))
    } catch {
      setError(label('imageError'))
    } finally {
      setBusy(false)
    }
  }

  const onFile = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setBusy(true)
    setError('')
    try {
      store(active, await fileToFaceJpeg(file))
    } catch {
      setError(label('imageError'))
    } finally {
      setBusy(false)
    }
  }

  const retake = (angle) => {
    const next = { ...shotsRef.current }
    if (next[angle]?.url) URL.revokeObjectURL(next[angle].url)
    delete next[angle]
    publish(next)
    setActive(angle)
  }

  const doneCount = FACE_ANGLES.filter((angle) => shots[angle]).length

  return (
    <div className="face-capture">
      <div className="face-capture-steps" role="tablist" aria-label={label('title')}>
        {FACE_ANGLES.map((angle) => (
          <button
            key={angle}
            type="button"
            role="tab"
            aria-selected={active === angle}
            className={`face-capture-step${active === angle ? ' is-active' : ''}${shots[angle] ? ' is-done' : ''}`}
            onClick={() => setActive(angle)}
            disabled={disabled}
          >
            {shots[angle]
              ? <img src={shots[angle].url} alt={label(angle)} />
              : <span className="face-capture-step-empty"><Camera size={18} /></span>}
            <span>{label(angle)}</span>
          </button>
        ))}
      </div>
      <p className="face-capture-instruction"><strong>{label(active)}</strong> — {label(`${active}Hint`)} · {doneCount}/3</p>
      {cameraOn ? (
        <div className="face-capture-stage">
          <video ref={videoRef} playsInline muted autoPlay />
          <div className={`face-capture-oval is-${active}`} aria-hidden="true" />
        </div>
      ) : shots[active] ? (
        <div className="face-capture-stage"><img src={shots[active].url} alt={label(active)} /></div>
      ) : null}
      {error ? <p className="face-capture-error" role="alert">{error}</p> : null}
      <div className="face-capture-actions">
        {cameraOn ? (
          <>
            <button type="button" className="face-btn face-btn-primary" onClick={capture} disabled={busy || disabled}>
              <Camera size={16} /> {label('capture')}
            </button>
            <button type="button" className="face-btn" onClick={stopCamera}><CameraOff size={16} /> {label('stopCamera')}</button>
          </>
        ) : (
          <button type="button" className="face-btn face-btn-primary" onClick={startCamera} disabled={disabled}>
            <Camera size={16} /> {label('startCamera')}
          </button>
        )}
        {shots[active] ? (
          <button type="button" className="face-btn" onClick={() => retake(active)} disabled={disabled}>
            <RotateCcw size={16} /> {label('retake')}
          </button>
        ) : null}
        <button type="button" className="face-btn" onClick={() => fileRef.current?.click()} disabled={busy || disabled}>
          <ImagePlus size={16} /> {label('upload')}
        </button>
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={onFile} />
      </div>
    </div>
  )
}
