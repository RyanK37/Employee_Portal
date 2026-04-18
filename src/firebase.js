import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
import { getStorage } from 'firebase/storage'

const STORAGE_BUCKET = 'employee-portal-v2-bbe68.firebasestorage.app'

const firebaseConfig = {
  apiKey: "AIzaSyBKZrr5IgKZMmL5fqBzHuonQywpnGN5eq4",
  authDomain: "employee-portal-v2-bbe68.firebaseapp.com",
  projectId: "employee-portal-v2-bbe68",
  storageBucket: STORAGE_BUCKET,
  messagingSenderId: "185021229735",
  appId: "1:185021229735:web:3bf40a06ec651ed5180982",
  measurementId: "G-DL9KTMCF28"
}

const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)
export const db = getFirestore(app)
export const storage = getStorage(app, `gs://${STORAGE_BUCKET}`)
export default app
