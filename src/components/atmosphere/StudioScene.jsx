import { Canvas, useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import * as THREE from 'three'

function GlassPanel({ position, rotation, scale }) {
  const ref = useRef()
  useFrame((state) => {
    if (!ref.current) return
    ref.current.position.y = position[1] + Math.sin(state.clock.elapsedTime * 0.6 + position[0]) * 0.08
  })
  return (
    <mesh ref={ref} position={position} rotation={rotation} scale={scale}>
      <planeGeometry args={[2.4, 3.2, 1, 1]} />
      <meshPhysicalMaterial
        color="#1a3d2e"
        transparent
        opacity={0.12}
        roughness={0.05}
        metalness={0.1}
        transmission={0.85}
        thickness={0.5}
        ior={1.4}
      />
    </mesh>
  )
}

function NeonRing({ position, radius }) {
  const ref = useRef()
  useFrame((state) => {
    if (!ref.current) return
    ref.current.rotation.z = state.clock.elapsedTime * 0.3
    ref.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.5) * 0.2
  })
  return (
    <mesh ref={ref} position={position} rotation={[Math.PI / 2, 0, 0]}>
      <torusGeometry args={[radius, 0.04, 16, 64]} />
      <meshStandardMaterial color="#39ff88" emissive="#4ade80" emissiveIntensity={0.8} roughness={0.2} metalness={0.6} />
    </mesh>
  )
}

function GeoShape({ position, type, color, emissive }) {
  const ref = useRef()
  useFrame((state) => {
    if (!ref.current) return
    ref.current.rotation.y = state.clock.elapsedTime * 0.4
    ref.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.7) * 0.15
    ref.current.position.y = position[1] + Math.sin(state.clock.elapsedTime * 0.9) * 0.12
  })
  const geo =
    type === 'octa' ? <octahedronGeometry args={[0.55, 0]} /> :
    type === 'tetra' ? <tetrahedronGeometry args={[0.55, 0]} /> :
    <icosahedronGeometry args={[0.55, 0]} />
  return (
    <mesh ref={ref} position={position}>
      {geo}
      <meshStandardMaterial color={color} emissive={emissive} emissiveIntensity={0.5} roughness={0.3} metalness={0.7} />
    </mesh>
  )
}

const pointer = { x: 0, y: 0 }

function MouseParallax({ children }) {
  const ref = useRef()
  useFrame(() => {
    if (!ref.current) return
    ref.current.rotation.y = THREE.MathUtils.lerp(ref.current.rotation.y, pointer.x * 0.12, 0.04)
    ref.current.rotation.x = THREE.MathUtils.lerp(ref.current.rotation.x, -pointer.y * 0.06, 0.04)
  })
  return <group ref={ref}>{children}</group>
}

function Scene() {
  const glassPanels = useMemo(
    () => [
      { position: [-3.5, 1.2, -2], rotation: [0, 0.4, 0.08], scale: [1, 1, 1] },
      { position: [2.8, 0.6, -1.5], rotation: [0, -0.3, -0.12], scale: [0.85, 0.85, 1] },
      { position: [0.5, 2, -3], rotation: [0.1, 0.15, 0.05], scale: [1.1, 1.1, 1] },
      { position: [-1.2, -0.3, -1], rotation: [0, 0.6, -0.06], scale: [0.7, 0.7, 1] },
    ],
    [],
  )

  return (
    <>
      <color attach="background" args={['#0a0e0c']} />
      <fog attach="fog" args={['#0a0e0c', 10, 28]} />
      <ambientLight intensity={0.25} />
      <directionalLight position={[6, 10, 4]} intensity={0.6} color="#6ee7a0" />
      <pointLight position={[-4, 3, 2]} intensity={1.8} color="#39ff88" distance={18} />
      <pointLight position={[5, 1, -2]} intensity={1.2} color="#1e5a3c" distance={14} />
      <pointLight position={[0, -2, 3]} intensity={0.8} color="#4ade80" distance={12} />
      <MouseParallax>
        {glassPanels.map((panel, i) => (
          <GlassPanel key={i} {...panel} />
        ))}
        <NeonRing position={[2.2, 1.5, 0.5]} radius={0.9} />
        <NeonRing position={[-2.5, 0.8, -0.8]} radius={0.6} />
        <GeoShape position={[-1.5, 1.8, 0.2]} type="ico" color="#1e3d2f" emissive="#39ff88" />
        <GeoShape position={[3, 0.4, -0.5]} type="octa" color="#152821" emissive="#4ade80" />
        <GeoShape position={[0, -0.5, 1]} type="tetra" color="#0f1612" emissive="#6ee7a0" />
      </MouseParallax>
    </>
  )
}

export default function StudioScene() {
  useEffect(() => {
    const onMove = (e) => {
      pointer.x = (e.clientX / window.innerWidth) * 2 - 1
      pointer.y = -(e.clientY / window.innerHeight) * 2 + 1
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    return () => window.removeEventListener('pointermove', onMove)
  }, [])

  return createPortal(
    <div className="studio-scene" aria-hidden="true">
      <Canvas
        dpr={[1, 1.25]}
        camera={{ position: [0, 1.5, 7], fov: 38, near: 0.1, far: 40 }}
        gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
      >
        <Scene />
      </Canvas>
      <div className="studio-grain" />
      <div className="studio-vignette" />
    </div>,
    document.body,
  )
}
