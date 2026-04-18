import { useEffect, useRef, useState } from 'react'
import { addDoc, collection, deleteDoc, doc, getDocs, orderBy, query, serverTimestamp } from 'firebase/firestore'
import { deleteObject, getDownloadURL, ref, uploadBytesResumable } from 'firebase/storage'
import { db, storage } from '../firebase'
import { useAuth } from '../hooks/useAuth'
import { toDisplayText } from '../utils/display'
import { getAllUserIds, notifyUsers } from '../utils/notifications'
import { isManagerOrAdmin } from '../utils/roles'
import styles from './DocumentsPage.module.css'

export default function DocumentsPage() {
  const { user, profile } = useAuth()
  const canDeleteDocuments = isManagerOrAdmin(profile?.role)
  const [docs, setDocs] = useState([])
  const [search, setSearch] = useState('')
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState('')
  const [deleteBusyId, setDeleteBusyId] = useState('')
  const fileRef = useRef()

  useEffect(() => {
    const q = query(collection(db, 'documents'), orderBy('createdAt', 'desc'))
    getDocs(q)
      .then(snapshot => {
        const uploaded = snapshot.docs.map(d => ({ id: d.id, ...d.data(), uploaded: true }))
        setDocs(uploaded)
      })
      .catch(() => setDocs([]))
  }, [])

  async function handleUpload(e) {
    const file = e.target.files?.[0]
    if (!file || !user) return

    setUploading(true)
    setProgress(0)
    setError('')

    try {
      const storageRef = ref(storage, `documents/${Date.now()}_${file.name}`)
      const task = uploadBytesResumable(storageRef, file)

      task.on('state_changed', snapshot => {
        setProgress(Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100))
      })

      await task
      const url = await getDownloadURL(storageRef)
      const ext = file.name.split('.').pop()?.toUpperCase() || 'FILE'
      const uploaderName = toDisplayText(profile?.displayName, user.email || 'A team member')
      const newDoc = {
        name: file.name.replace(/\.[^.]+$/, ''),
        category: 'Uploaded',
        type: ext,
        size: formatBytes(file.size),
        url,
        storagePath: storageRef.fullPath,
        icon: 'DOC',
        uploadedBy: uploaderName,
        createdAt: serverTimestamp(),
      }

      const created = await addDoc(collection(db, 'documents'), newDoc)
      setDocs(prev => [{ ...newDoc, id: created.id, uploaded: true }, ...prev])

      const otherUsers = await getAllUserIds(db, [user.uid])
      await notifyUsers(db, otherUsers, {
        type: 'system',
        text: `${uploaderName} uploaded a document`,
        sub: file.name,
      })
    } catch (err) {
      setError(friendlyUploadError(err))
    } finally {
      setUploading(false)
      setProgress(0)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function handleDelete(docItem) {
    if (!canDeleteDocuments || !docItem?.id) return
    if (!window.confirm(`Delete "${toDisplayText(docItem.name, 'this document')}"?`)) return

    setDeleteBusyId(docItem.id)
    setError('')

    try {
      if (docItem.storagePath) {
        await deleteObject(ref(storage, docItem.storagePath))
      } else if (docItem.url) {
        await deleteObject(ref(storage, docItem.url))
      }
    } catch (err) {
      if (err?.code !== 'storage/object-not-found') {
        setDeleteBusyId('')
        setError(friendlyDeleteError(err))
        return
      }
    }

    try {
      await deleteDoc(doc(db, 'documents', docItem.id))
      setDocs(prev => prev.filter(item => item.id !== docItem.id))
    } catch (err) {
      setError(friendlyDeleteError(err))
    } finally {
      setDeleteBusyId('')
    }
  }

  const filtered = docs.filter(docItem => {
    if (!search) return true
    const queryText = search.toLowerCase()
    return toDisplayText(docItem.name).toLowerCase().includes(queryText)
      || toDisplayText(docItem.category).toLowerCase().includes(queryText)
  })

  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <input
          className="input"
          style={{ width: 260 }}
          placeholder="Search documents..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <input type="file" ref={fileRef} style={{ display: 'none' }} onChange={handleUpload} />
        <button className="btn" onClick={() => fileRef.current?.click()} disabled={uploading}>
          {uploading ? `Uploading ${progress}%` : '+ Upload'}
        </button>
      </div>

      {error && <div className={styles.errorBanner}>{error}</div>}

      <div className={styles.list}>
        {filtered.length === 0 ? (
          <div className={styles.emptyState}>No uploaded documents yet.</div>
        ) : filtered.map(docItem => (
          <div key={docItem.id} className={styles.docRow}>
            <div className={styles.docIcon}>{docItem.icon || 'DOC'}</div>
            <div className={styles.docInfo}>
              <div className={styles.docName}>{toDisplayText(docItem.name, 'Untitled document')}</div>
              <div className={styles.docMeta}>
                {toDisplayText(docItem.category, 'General')} | {toDisplayText(docItem.type, 'FILE')} | {toDisplayText(docItem.size, '-')}
              </div>
              {docItem.uploadedBy && <div className={styles.docUploader}>Uploaded by {toDisplayText(docItem.uploadedBy)}</div>}
            </div>
            <span className={styles.typeBadge}>{toDisplayText(docItem.type, 'FILE')}</span>
            <div className={styles.docActions}>
              {docItem.url ? (
                <a href={docItem.url} target="_blank" rel="noreferrer" className="btn secondary sm">Download</a>
              ) : (
                <button className="btn secondary sm" disabled>Download</button>
              )}
              {canDeleteDocuments && (
                <button
                  type="button"
                  className="btn secondary sm"
                  disabled={deleteBusyId === docItem.id}
                  onClick={() => handleDelete(docItem)}>
                  {deleteBusyId === docItem.id ? 'Deleting...' : 'Delete'}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function friendlyUploadError(err) {
  if (err?.code === 'storage/unauthorized') {
    return 'Upload blocked by Firebase Storage rules. Make sure your account is signed in and Storage rules are deployed.'
  }
  if (err?.code === 'storage/canceled') {
    return 'Upload canceled.'
  }
  if (err?.message?.includes('CORS') || err?.message?.includes('preflight')) {
    return 'Upload failed before Firebase accepted the request. This usually means the Storage bucket in Firebase config is wrong or Firebase Storage is not fully enabled for this project.'
  }
  return 'Document upload failed. Check Firebase Storage setup and try again.'
}

function friendlyDeleteError(err) {
  if (err?.code === 'permission-denied' || err?.code === 'storage/unauthorized') {
    return 'Delete blocked by Firebase rules. Only managers and admins can remove uploaded documents.'
  }
  return 'Document delete failed. Try again.'
}
