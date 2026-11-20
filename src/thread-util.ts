/* eslint-disable @typescript-eslint/ban-ts-comment */
import { isAbsolute } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * Convert an absolute file path into a `file://` url for `import()`.
 * This is needed on windows (where `C:\...` isn't a valid specifier), and on every platform for paths containing
 * characters such as `#` or `%` which would otherwise be interpreted as url syntax.
 * Anything else (urls, relative or bare specifiers) is passed through untouched.
 */
function toImportSpecifier(modulePath: string): string {
	return isAbsolute(modulePath) ? pathToFileURL(modulePath).href : modulePath
}

export async function importModuleFromPath(modulePath: string): Promise<any> {
	// Future: Once webpacked, the dynamic import() doesn't work, so fallback to require()
	// @ts-ignore suppress error about __non_webpack_require__ not existing, since it only exists at runtime when webpacked
	return typeof __non_webpack_require__ === 'function'
		? // @ts-ignore suppress error about __non_webpack_require__ not existing, since it only exists at runtime when webpacked
			__non_webpack_require__(modulePath)
		: await import(toImportSpecifier(modulePath))
}
