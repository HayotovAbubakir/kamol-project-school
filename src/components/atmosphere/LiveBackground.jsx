import { useEffect, useRef } from 'react'
import { useWallpaper } from '../../context/WallpaperContext'

export default function LiveBackground() {
  const { url, kind, activePreset, customActive } = useWallpaper()
  const videoRef = useRef(null)
  const hasMedia = Boolean(customActive && url && kind !== 'none')
  const showVideo = hasMedia && kind === 'video'
  const showImage = hasMedia && kind === 'image'

  useEffect(() => {
    const video = videoRef.current
    if (!video || !showVideo) return undefined

    let scrollPauseUntil = 0
    let resumeTimer = 0

    const playSafe = () => {
      if (document.hidden || performance.now() < scrollPauseUntil) return
      const play = video.play()
      if (play?.catch) play.catch(() => {})
    }

    const pauseForScroll = () => {
      scrollPauseUntil = performance.now() + 240
      if (!video.paused) video.pause()
      window.clearTimeout(resumeTimer)
      resumeTimer = window.setTimeout(playSafe, 260)
    }

    const onVisibility = () => {
      if (document.hidden) video.pause()
      else playSafe()
    }

    playSafe()
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('scroll', pauseForScroll, { passive: true, capture: true })
    const scroller = document.querySelector('.content-area')
    scroller?.addEventListener('scroll', pauseForScroll, { passive: true })

    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('scroll', pauseForScroll, true)
      scroller?.removeEventListener('scroll', pauseForScroll)
      window.clearTimeout(resumeTimer)
      video.pause()
    }
  }, [showVideo, url])

  return (
    <div
      id="app-wallpaper"
      className={`live-bg${hasMedia ? ' live-bg-media' : ` live-bg-default live-bg-preset-${activePreset}`}${showVideo ? ' live-bg-video' : ''}`}
      aria-hidden="true"
    >
      {showVideo ? (
        <video
          ref={videoRef}
          src={url}
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          disablePictureInPicture
          disableRemotePlayback
          controlsList="nodownload noplaybackrate noremoteplayback"
        />
      ) : null}
      {showImage ? (
        <img src={url} alt="" />
      ) : null}
      {!hasMedia ? (
        <>
          <span className="live-bg-spot live-bg-spot-a" />
          <span className="live-bg-spot live-bg-spot-b" />
          <span className="live-bg-spot live-bg-spot-c" />
        </>
      ) : null}
    </div>
  )
}
