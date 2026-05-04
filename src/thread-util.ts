/* eslint-disable @typescript-eslint/ban-ts-comment */

const ensureFileUrl = (url: string) => {
	if (process.platform === 'win32' && !url.startsWith('file://')) {
		// Windows is picky about import paths, this is a crude hack to 'fix' it
		return `file://${url}`
	} else {
		return url
	}
}

export async function importModuleFromPath(modulePath: string): Promise<any> {
	// Future: Once webpacked, the dynamic import() doesn't work, so fallback to require()
	// @ts-ignore suppress error about __non_webpack_require__ not existing, since it only exists at runtime when webpacked
	return typeof __non_webpack_require__ === 'function'
		? // @ts-ignore suppress error about __non_webpack_require__ not existing, since it only exists at runtime when webpacked
			__non_webpack_require__(modulePath)
		: await import(ensureFileUrl(modulePath))
}
