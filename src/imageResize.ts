// Yüklənən loqo/ikon şəkillərini brauzerdə kiçildir: data URL bazada saxlanır və
// hər sorğuda gedir, ona görə 4–5 MB-lıq foto əvəzinə ~30–80 KB göndərilir.
// Şəffaflıq qorunur (WEBP, dəstəklənməsə PNG). SVG/GIF olduğu kimi qalır.
// Şəkildə şəffaflıq yoxdursa və kənarları ağ/boz (və ya «şəffaf» damalı naxış
// kimi çəkilmiş) fondursa, həmin fon kənarlardan başlayaraq silinir.
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
        try { clearEdgeBackground(ctx, w, h) } catch { /* CORS və s. — olduğu kimi qalır */ }
        let out = c.toDataURL('image/webp', 0.9)
        if (!out.startsWith('data:image/webp')) out = c.toDataURL('image/png')
        resolve(out)
      }
      img.src = src
    }
    reader.readAsDataURL(file)
  })
}

// Açıq, rəngsiz (ağ/boz) piksel — fon və ya damalı naxış
function isLightNeutral(d: Uint8ClampedArray, i: number) {
  const r = d[i], g = d[i + 1], b = d[i + 2]
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b)
  return mn >= 180 && mx - mn <= 28
}

function clearEdgeBackground(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const im = ctx.getImageData(0, 0, w, h)
  const d = im.data
  // Artıq şəffaf pikseli varsa (düzgün PNG) — toxunmuruq
  for (let i = 3; i < d.length; i += 4) if (d[i] < 250) return
  // Dörd küncün hamısı açıq-neytral deyilsə, fon yoxdur
  const corner = (x: number, y: number) => isLightNeutral(d, (y * w + x) * 4)
  if (!(corner(0, 0) && corner(w - 1, 0) && corner(0, h - 1) && corner(w - 1, h - 1))) return
  // Kənarlardan flood-fill: yalnız kənara bitişik açıq-neytral sahə silinir,
  // loqonun içindəki ağ hissələr (kitab və s.) qalır
  const seen = new Uint8Array(w * h)
  const stack: number[] = []
  const push = (p: number) => { if (!seen[p] && isLightNeutral(d, p * 4)) { seen[p] = 1; stack.push(p) } }
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x) }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1) }
  while (stack.length) {
    const p = stack.pop()!
    d[p * 4 + 3] = 0
    const x = p % w, y = (p - x) / w
    if (x > 0) push(p - 1)
    if (x < w - 1) push(p + 1)
    if (y > 0) push(p - w)
    if (y < h - 1) push(p + w)
  }
  ctx.putImageData(im, 0, 0)
}
