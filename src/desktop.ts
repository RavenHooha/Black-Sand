// Native file IO when running inside the Tauri desktop shell; the web build
// falls back to browser download / <input type=file>. The Tauri plugin modules
// are imported lazily so the web bundle never touches them.

export const isDesktop =
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in (window as unknown as Record<string, unknown>)

/** Save text via a native dialog. Returns true if handled here (desktop), false to fall back. */
export async function saveTextNative(text: string, defaultName: string, ext: string, label: string): Promise<boolean> {
  if (!isDesktop) return false
  const { save } = await import('@tauri-apps/plugin-dialog')
  const { writeTextFile } = await import('@tauri-apps/plugin-fs')
  const path = await save({ defaultPath: defaultName, filters: [{ name: label, extensions: [ext] }] })
  if (path) await writeTextFile(path, text)
  return true // handled (written, or the user cancelled — either way don't fall back)
}

/** Save bytes via a native dialog. Returns true if handled here (desktop), false to fall back. */
export async function saveBytesNative(data: Uint8Array, defaultName: string, ext: string, label: string): Promise<boolean> {
  if (!isDesktop) return false
  const { save } = await import('@tauri-apps/plugin-dialog')
  const { writeFile } = await import('@tauri-apps/plugin-fs')
  const path = await save({ defaultPath: defaultName, filters: [{ name: label, extensions: [ext] }] })
  if (path) await writeFile(path, data)
  return true
}

/**
 * Open a text file via a native dialog.
 * Returns the file text, or null if not desktop / the user cancelled.
 */
export async function openTextNative(ext: string, label: string): Promise<string | null> {
  if (!isDesktop) return null
  const { open } = await import('@tauri-apps/plugin-dialog')
  const { readTextFile } = await import('@tauri-apps/plugin-fs')
  const path = await open({ multiple: false, directory: false, filters: [{ name: label, extensions: [ext] }] })
  if (!path || Array.isArray(path)) return null
  return await readTextFile(path)
}
