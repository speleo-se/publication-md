import type { ImageRef, Region } from './types.ts'

/**
 * Image paths carry their own extraction parameters, so the same string is both a real
 * file in the content repo (written by `extract-images`) and a URL an endpoint can serve:
 *
 *     img/p012_pct-8,31,84,43.jpg
 *
 * `p012` is the 0-based pageIndex (same numbering as `pageIndex-012.md`); `pct-x,y,w,h` is
 * the IIIF Image API `pct:` region — percentages of the page, origin top-left, up to two
 * decimals. Any leading directory is ignored when parsing.
 */
const RE =
	/(?:^|\/)p(\d{3,})_pct-(\d+(?:\.\d{1,2})?),(\d+(?:\.\d{1,2})?),(\d+(?:\.\d{1,2})?),(\d+(?:\.\d{1,2})?)\.jpg$/

export function parseImagePath(path: string): ImageRef | null {
	const m = RE.exec(path)
	if (!m) return null
	const [x, y, w, h] = [m[2], m[3], m[4], m[5]].map(Number) as [number, number, number, number]
	if (w <= 0 || h <= 0 || x + w > 100 || y + h > 100) return null
	return { pageIndex: Number(m[1]), region: { x, y, w, h } }
}

const num = (n: number): string => String(Math.round(n * 100) / 100)

export function formatImagePath(ref: ImageRef, dir = 'img'): string {
	const { x, y, w, h } = ref.region
	const name = `p${String(ref.pageIndex).padStart(3, '0')}_pct-${[x, y, w, h].map(num).join(',')}.jpg`
	return dir ? `${dir}/${name}` : name
}

/** Intersection-over-union of two regions (same coordinate space). */
export function iou(a: Region, b: Region): number {
	const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x))
	const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))
	const inter = ix * iy
	const union = a.w * a.h + b.w * b.h - inter
	return union > 0 ? inter / union : 0
}
