import { addDoc, collection, getDocs, serverTimestamp } from 'firebase/firestore'
import { isManagerOrAdmin } from './roles'

export async function createNotification(db, notification) {
  if (!notification?.userId) return
  await addDoc(collection(db, 'notifications'), {
    read: false,
    createdAt: serverTimestamp(),
    ...notification,
  })
}

export async function notifyUsers(db, userIds, notification) {
  const uniqueIds = Array.from(new Set((userIds || []).filter(Boolean)))
  await Promise.all(uniqueIds.map(userId => createNotification(db, { ...notification, userId })))
}

export async function getManagerAdminUserIds(db) {
  const snapshot = await getDocs(collection(db, 'users'))
  return snapshot.docs
    .map(docSnap => docSnap.data())
    .filter(user => isManagerOrAdmin(user?.role) && user?.uid)
    .map(user => user.uid)
}

export async function getAllUserIds(db, excludeUserIds = []) {
  const excluded = new Set(excludeUserIds.filter(Boolean))
  const snapshot = await getDocs(collection(db, 'users'))
  return snapshot.docs
    .map(docSnap => docSnap.data()?.uid)
    .filter(uid => uid && !excluded.has(uid))
}
