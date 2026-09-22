import { createContext, useContext, useEffect, useState } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import { doc, getDoc, onSnapshot } from 'firebase/firestore'
import { auth, db } from '../firebase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined) // undefined = loading
  const [profile, setProfile] = useState(undefined)

  useEffect(() => {
    let unsubProfile = null

    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      if (unsubProfile) {
        unsubProfile()
        unsubProfile = null
      }

      if (firebaseUser) {
        setUser(firebaseUser)
        setProfile(undefined)
        unsubProfile = onSnapshot(doc(db, 'users', firebaseUser.uid), snap => {
          setProfile(snap.exists() ? snap.data() : null)
        }, () => {
          setProfile(null)
        })
      } else {
        setUser(null)
        setProfile(null)
      }
    })

    return () => {
      if (unsubProfile) unsubProfile()
      unsub()
    }
  }, [])

  const refreshProfile = async () => {
    if (!user) return
    setProfile(undefined)
    const snap = await getDoc(doc(db, 'users', user.uid))
    setProfile(snap.exists() ? snap.data() : null)
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        setProfile,
        refreshProfile,
        loading: user === undefined,
        profileLoading: user != null && profile === undefined,
        hasProfile: profile != null,
      }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}

