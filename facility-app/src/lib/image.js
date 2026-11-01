// Shrink phone photos before they are saved, so storage stays small and
// pages load fast on site. Keeps trying smaller quality, then a smaller size,
// until the photo is under the target.

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => { URL.revokeObjectURL(url); resolve(img) }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image. Try a JPG or PNG photo.')) }
    img.src = url
  })
}

const toBlob = (canvas, quality) => new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', quality))

// Returns { blob, width, height, bytes, originalBytes }
export async function compressImage(file, { maxSide = 800, targetBytes = 120 * 1024, minQuality = 0.45 } = {}) {
  const img = await loadImage(file)
  let side = maxSide
  for (let attempt = 0; attempt < 4; attempt++) {
    const scale = Math.min(1, side / Math.max(img.naturalWidth, img.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#fff' // transparent PNGs become white, not black
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    for (let q = 0.78; q >= minQuality - 0.001; q -= 0.08) {
      const blob = await toBlob(canvas, q)
      if (blob && blob.size <= targetBytes) return { blob, width: canvas.width, height: canvas.height, bytes: blob.size, originalBytes: file.size }
    }
    side = Math.round(side * 0.8)
  }
  // Very detailed photo: use the smallest version we made.
  const scale = Math.min(1, side / Math.max(img.naturalWidth, img.naturalHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(img.naturalWidth * scale); canvas.height = Math.round(img.naturalHeight * scale)
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
  const blob = await toBlob(canvas, minQuality)
  return { blob, width: canvas.width, height: canvas.height, bytes: blob.size, originalBytes: file.size }
}

export async function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => reject(r.error); r.readAsDataURL(blob) })
}

export function formatBytes(n) {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${Math.max(1, Math.round(n / 1024))} KB`
}
