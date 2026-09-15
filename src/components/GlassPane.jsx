export default function GlassPane({
  children,
  className = '',
  radius = 22,
  style,
  ...props
}) {
  return (
    <div
      className={`glass-pane ${className}`.trim()}
      style={{ borderRadius: radius, ...style }}
      {...props}
    >
      {children}
    </div>
  )
}
