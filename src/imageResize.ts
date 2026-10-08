// Yüklənən loqo/ikon şəkillərini brauzerdə kiçildir: data URL bazada saxlanır və
// hər sorğuda gedir, ona görə 4–5 MB-lıq foto əvəzinə ~30–80 KB göndərilir.
// Şəffaflıq qorunur (WEBP, dəstəklənməsə PNG). SVG/GIF olduğu kimi qalır.
export function readImageResized(file: File, maxSide = 512): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error)
    reader.onload = () => {
      const src = reader.result as string
      if (/^image\/(svg\+xml|gif)$/.test(file.type)) { resolve(src); return }
      const img = new Image()
      img.onerror = () => resolve(src)
      img.onload = () => {
        const k = Math.min(1, maxSide / Math.max(img.width, img.height))
        const w = Math.max(1, Math.round(img.width * k)), h = Math.max(1, Math.round(img.height * k))
        const c = document.createElement('canvas')
        c.width = w; c.height = h
        const ctx = c.getContext('2d')
        if (!ctx) { resolve(src); return }
        ctx.imageSmoothingQuality = 'high'
        ctx.drawImage(img, 0, 0, w, h)
        let out = c.toDataURL('image/webp', 0.9)
        if (!out.startsWith('data:image/webp')) out = c.toDataURL('image/png')
        resolve(out.length < src.length ? out : src)
      }
      img.src = src
    }
    reader.readAsDataURL(file)
  })
}
