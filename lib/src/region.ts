import jpeg from 'jpeg-js'
import { iou } from './imagePath.ts'
import type { Region } from './types.ts'

/**
 * Produce the image for an `img/pNNN_pct-x,y,w,h.jpg` reference.
 *
 * Environment-agnostic like `@repo/pdf-thumb`: the caller supplies an initialised
 * `@hyzyla/pdfium` library (Node: `PDFiumLibrary.init()`; workerd: browser build +
 * `instantiateWasm`). This is the single implementation behind both the content repo's
 * `extract-images` script and the Speleotastic endpoint, so they produce the same bytes.
 *
 * Strategy:
 * 1. Born-digital: if an embedded image object covers the region (IoU ≥ `minIou`) and is
 *    stored as JPEG (`DCTDecode`), return its original bytes untouched.
 * 2. Otherwise render the region from the page — at the native pixel density of the
 *    densest image containing the region (a page scan, a non-JPEG photo), so nothing is
 *    up/down-sampled; else at `dpi` (vector art, text).
 */
export interface PdfiumLibraryLike {
	loadDocument(bytes: Uint8Array): Promise<PdfiumDocLike>
}
interface PdfiumDocLike {
	getPageCount(): number
	getPage(index: number): PdfiumPageLike
	destroy(): void
}
interface PdfiumPageLike {
	getOriginalSize(): { originalWidth: number; originalHeight: number }
	render(opts: {
		scale: number
		render: 'bitmap'
	}): Promise<{ data: Uint8Array; width: number; height: number }>
	objects(): Iterable<PdfiumObjectLike>
}
interface PdfiumObjectLike {
	type: string
	getImageDataRaw?(): Promise<{ width: number; height: number; data: Uint8Array; filters: string[] }>
}

/** The parts of the emscripten module we call directly (not wrapped by @hyzyla/pdfium). */
interface PdfiumModule {
	HEAPU8: Uint8Array
	wasmExports: { malloc(n: number): number; free(p: number): void }
	_FPDFPageObj_GetBounds(obj: number, l: number, b: number, r: number, t: number): number
	_FPDFPage_GetRotation(page: number): number
	_FPDFImageObj_GetImagePixelSize(obj: number, w: number, h: number): number
}

export interface RegionImageOptions {
	/** Minimum IoU between region and an image object to count as "that image". Default 0.9. */
	minIou?: number
	/** Render resolution when no embedded image matched. Default 300. */
	dpi?: number
	/** Cap on rendered page pixels (memory guard for workerd). Default 40 MP. */
	maxPixels?: number
	/** JPEG quality for rendered output. Default 88. */
	quality?: number
}

export interface RegionImage {
	bytes: Uint8Array
	width: number
	height: number
	/** `embedded`: original bytes; `rendered`: page region rendered. */
	source: 'embedded' | 'rendered'
}

interface Match {
	/** Best image object by IoU (≥ minIou), with its raw stream, if any. */
	raw: { data: Uint8Array; width: number; height: number; filters: string[] } | null
	/** Pixels per PDF point of the densest image fully containing the region (e.g. a page scan). */
	density: number | null
}

/** Page-space bounds of an object, as a top-left-origin percentage region. */
function objectRegion(mod: PdfiumModule, handle: number, W: number, H: number): Region | null {
	const ptr = mod.wasmExports.malloc(16)
	try {
		if (!mod._FPDFPageObj_GetBounds(handle, ptr, ptr + 4, ptr + 8, ptr + 12)) return null
		const v = new DataView(mod.HEAPU8.buffer, ptr, 16)
		const [l, b, r, t] = [0, 4, 8, 12].map((o) => v.getFloat32(o, true)) as [
			number,
			number,
			number,
			number,
		]
		return {
			x: (l / W) * 100,
			y: ((H - t) / H) * 100,
			w: ((r - l) / W) * 100,
			h: ((t - b) / H) * 100,
		}
	} finally {
		mod.wasmExports.free(ptr)
	}
}

function pixelWidth(mod: PdfiumModule, handle: number): number {
	const ptr = mod.wasmExports.malloc(8)
	try {
		if (!mod._FPDFImageObj_GetImagePixelSize(handle, ptr, ptr + 4)) return 0
		return new DataView(mod.HEAPU8.buffer, ptr, 8).getUint32(0, true)
	} finally {
		mod.wasmExports.free(ptr)
	}
}

const contains = (outer: Region, inner: Region, eps = 0.5) =>
	outer.x <= inner.x + eps &&
	outer.y <= inner.y + eps &&
	outer.x + outer.w >= inner.x + inner.w - eps &&
	outer.y + outer.h >= inner.y + inner.h - eps

async function findEmbedded(
	page: PdfiumPageLike,
	region: Region,
	minIou: number,
): Promise<Match | null> {
	// The wrapper keeps the module + raw handles in (TS-)protected fields; read them at runtime.
	const internals = page as unknown as { module?: PdfiumModule; pageIdx?: number }
	const mod = internals.module
	if (!mod?._FPDFPageObj_GetBounds || internals.pageIdx === undefined) return null
	// Object bounds are in unrotated page space; the region is in displayed space.
	if (mod._FPDFPage_GetRotation(internals.pageIdx) !== 0) return null

	const { originalWidth: W, originalHeight: H } = page.getOriginalSize()
	let best: { score: number; obj: PdfiumObjectLike } | null = null
	let density: number | null = null
	for (const obj of page.objects()) {
		if (obj.type !== 'image') continue
		const handle = (obj as unknown as { objectIdx: number }).objectIdx
		const r = objectRegion(mod, handle, W, H)
		if (!r) continue
		const score = iou(r, region)
		if (score >= minIou && (!best || score > best.score)) best = { score, obj }
		if (contains(r, region) && r.w > 0) {
			const d = pixelWidth(mod, handle) / ((r.w / 100) * W)
			if (d > 0 && (density === null || d > density)) density = d
		}
	}
	const raw = best?.obj.getImageDataRaw ? await best.obj.getImageDataRaw().catch(() => null) : null
	return { raw, density }
}

const isJpeg = (b: Uint8Array) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff

export async function extractRegionImage(
	library: PdfiumLibraryLike,
	pdfBytes: Uint8Array,
	pageIndex: number,
	region: Region,
	opts: RegionImageOptions = {},
): Promise<RegionImage> {
	const minIou = opts.minIou ?? 0.9
	const maxPixels = opts.maxPixels ?? 40_000_000
	const doc = await library.loadDocument(pdfBytes)
	try {
		if (pageIndex < 0 || pageIndex >= doc.getPageCount()) {
			throw new Error(`page ${pageIndex} out of range (0..${doc.getPageCount() - 1})`)
		}
		const page = doc.getPage(pageIndex)
		const match = await findEmbedded(page, region, minIou)
		const raw = match?.raw
		if (raw && raw.filters.length === 1 && raw.filters[0] === 'DCTDecode' && isJpeg(raw.data)) {
			return { bytes: raw.data, width: raw.width, height: raw.height, source: 'embedded' }
		}

		const { originalWidth: W, originalHeight: H } = page.getOriginalSize()
		let scale = match?.density ?? (opts.dpi ?? 300) / 72
		scale = Math.min(scale, Math.sqrt(maxPixels / (W * H)))
		const bmp = await page.render({ scale, render: 'bitmap' })
		const x0 = Math.max(0, Math.round((region.x / 100) * bmp.width))
		const y0 = Math.max(0, Math.round((region.y / 100) * bmp.height))
		const w = Math.max(1, Math.min(bmp.width - x0, Math.round((region.w / 100) * bmp.width)))
		const h = Math.max(1, Math.min(bmp.height - y0, Math.round((region.h / 100) * bmp.height)))
		// @hyzyla/pdfium returns RGBA (see @repo/pdf-thumb); copy the crop, force opaque.
		const rgba = new Uint8Array(w * h * 4)
		for (let row = 0; row < h; row++) {
			const src = ((y0 + row) * bmp.width + x0) * 4
			rgba.set(bmp.data.subarray(src, src + w * 4), row * w * 4)
		}
		for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255
		const out = jpeg.encode({ data: rgba, width: w, height: h }, opts.quality ?? 88)
		return { bytes: new Uint8Array(out.data), width: w, height: h, source: 'rendered' }
	} finally {
		doc.destroy()
	}
}
