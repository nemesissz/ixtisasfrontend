/**
 * InstIcon — müəssisə ikonunu render edir.
 * icon sahəsi ya emoji string, ya da base64/URL data URL ola bilər.
 */
export function isImageIcon(icon: string | undefined): boolean {
  if (!icon) return false
  return icon.startsWith('data:') || icon.startsWith('http') || icon.startsWith('blob:')
}

export default function InstIcon({
  icon,
  size = 22,
  style = {},
}: {
  icon: string | undefined
  size?: number
  style?: React.CSSProperties
}) {
  if (!icon) return <span style={{ fontSize: size, ...style }}>🏫</span>

  if (isImageIcon(icon)) {
    return (
      <img
        src={icon}
        alt="logo"
        style={{
          width:      size,
          height:     size,
          objectFit:  'contain',
          borderRadius: 4,
          display:    'inline-block',
          verticalAlign: 'middle',
          flexShrink: 0,
          ...style,
        }}
      />
    )
  }

  return <span style={{ fontSize: size, lineHeight: 1, ...style }}>{icon}</span>
}
