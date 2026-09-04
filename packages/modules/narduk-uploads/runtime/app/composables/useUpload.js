/**
 * Client-side composable for uploading images to R2 through `/api/upload`.
 */
export function useUpload() {
  const nuxtApp = useNuxtApp()
  const csrfFetch = typeof nuxtApp.$csrfFetch === 'function' ? nuxtApp.$csrfFetch : $fetch

  const uploading = ref(false)
  const uploadError = ref('')

  async function uploadFile(file) {
    uploadError.value = ''
    uploading.value = true
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await csrfFetch('/api/upload', {
        method: 'POST',
        body: formData,
      })
      return res.url
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed. Is R2 configured?'
      uploadError.value = message
      return null
    } finally {
      uploading.value = false
    }
  }

  async function uploadFiles(files) {
    uploadError.value = ''
    uploading.value = true
    try {
      const formData = new FormData()
      for (const file of files) {
        formData.append('file', file)
      }
      const res = await csrfFetch('/api/upload', {
        method: 'POST',
        body: formData,
      })
      const items = Array.isArray(res) ? res : [res]
      return items.map((r) => r.url)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed. Is R2 configured?'
      uploadError.value = message
      return []
    } finally {
      uploading.value = false
    }
  }

  return { uploadFile, uploadFiles, uploading, uploadError }
}
