/**
 * 统一文件保存：桌面端走系统“另存为”，Web 端回退到浏览器下载。
 * Blob 先转 Uint8Array 再过 IPC，避免 Electron structured clone 对 Blob 的兼容差异。
 */
export async function saveBlob(blob, defaultName, filters) {
  if (typeof window !== 'undefined' && window.mnDesktop?.saveFile) {
    const data = new Uint8Array(await blob.arrayBuffer())
    return window.mnDesktop.saveFile({ defaultName, data, filters })
  }

  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = defaultName || 'download'
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  return { saved: true }
}

