import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { createUserWithEmailAndPassword, updateProfile } from 'firebase/auth'
import { doc, setDoc, serverTimestamp } from 'firebase/firestore'
import { auth, db } from '../firebase'
import { useAuth } from '../hooks/useAuth'
import MbtiModal from '../components/MbtiModal'
import styles from './AuthPage.module.css'

export default function SignupPage() {
  const [name, setName]         = useState('')
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [dept, setDept]         = useState('Technology')
  const [office, setOffice]     = useState('London')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)
  const [showMbti, setShowMbti] = useState(false)
  const [pendingUser, setPendingUser] = useState(null)
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { user } = useAuth()
  const isProfileCompletion = Boolean(user)
  const isGoogleSetup = params.get('google') === '1' || user?.providerData?.some(provider => provider.providerId === 'google.com')

  useEffect(() => {
    if (!user) return
    setName(current => current || user.displayName || '')
    setEmail(current => current || user.email || '')
  }, [user])

  async function handleSignup(e) {
    e.preventDefault()
    setError('')
    if (!name.trim()) { setError('Please enter your full name.'); return }

    if (isProfileCompletion) {
      setPendingUser(user)
      setShowMbti(true)
      return
    }

    if (password.length < 8) { setError('Password must be at least 8 characters.'); return }
    setLoading(true)
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, password)
      await updateProfile(cred.user, { displayName: name })
      setPendingUser(cred.user)
      setShowMbti(true)
    } catch (err) {
      setError(friendlyError(err.code))
    } finally {
      setLoading(false)
    }
  }

  async function handleMbtiSave(mbti) {
    const activeUser = pendingUser || auth.currentUser
    const uid = activeUser?.uid
    if (!uid) {
      setError('Unable to finish setup. Please sign in again.')
      return
    }

    await updateProfile(activeUser, { displayName: name || activeUser.displayName || '' })
    await setDoc(doc(db, 'users', uid), {
      uid,
      displayName: name || activeUser.displayName || '',
      email: email || activeUser.email || '',
      department: dept,
      office,
      role: 'Employee',
      mbti,
      mood: 'neutral',
      leaveBalance: 25,
      leaveTaken: 0,
      startDate: new Date().toISOString().split('T')[0],
      manager: '',
      employeeId: 'FDM-' + Math.floor(1000 + Math.random() * 9000),
      preferences: {
        showMoodOnMessages: true,
        showMbtiOnMessages: true,
        autoDetectMood: true,
      },
      createdAt: serverTimestamp(),
    })
    setShowMbti(false)
    navigate('/')
  }

  return (
    <div className={styles.page}>
      {showMbti && <MbtiModal onSave={handleMbtiSave} />}

      <div className={styles.panel}>
        <div className={styles.logo}>
          <div className={styles.logoMark}>F</div>
          <div>
            <div className={styles.logoName}>FDM Group</div>
            <div className={styles.logoSub}>Employee Portal</div>
          </div>
        </div>

        <h1 className={styles.heading}>{isProfileCompletion ? 'Complete your profile' : 'Create account'}</h1>
        <p className={styles.sub}>
          {isProfileCompletion
            ? (isGoogleSetup ? 'Finish setting up your Google sign-in account' : 'Finish setting up your employee profile')
            : 'Join your FDM team portal'}
        </p>

        {error && <div className={styles.errorBanner}>{error}</div>}

        <form onSubmit={handleSignup} className={styles.form}>
          <div className={styles.field}>
            <label>Full name</label>
            <input className="input" value={name} onChange={e => setName(e.target.value)}
              placeholder="Jamie Kendrick" required />
          </div>
          <div className={styles.field}>
            <label>Work email</label>
            <input className="input" type="email" value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@fdmgroup.com" required disabled={isProfileCompletion} />
          </div>
          {!isProfileCompletion && (
            <div className={styles.field}>
              <label>Password</label>
              <input className="input" type="password" value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Min. 8 characters" required />
            </div>
          )}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
            <div className={styles.field}>
              <label>Department</label>
              <select className="input" value={dept} onChange={e => setDept(e.target.value)}>
                {['Technology','Finance','Sales','HR','Marketing','Operations','Legal'].map(d =>
                  <option key={d}>{d}</option>)}
              </select>
            </div>
            <div className={styles.field}>
              <label>Office</label>
              <select className="input" value={office} onChange={e => setOffice(e.target.value)}>
                {['London','New York','Hong Kong','Singapore','Sydney','Edinburgh','Frankfurt'].map(o =>
                  <option key={o}>{o}</option>)}
              </select>
            </div>
          </div>
          <button className="btn lg" type="submit" disabled={loading}
            style={{ width:'100%', justifyContent:'center', marginTop:4 }}>
            {loading ? <span className="spinner" /> : (isProfileCompletion ? 'Continue setup' : 'Create account')}
          </button>
        </form>

        {!isProfileCompletion && (
          <p className={styles.switch}>
            Already have an account? <Link to="/login" className={styles.link}>Sign in</Link>
          </p>
        )}
      </div>
      <div className={styles.art}>
        <div className={styles.artInner}>
          <div className={styles.artTitle}>Built for how<br/>teams think.</div>
          <div className={styles.artSub}>Every message carries context — your mood, your personality. Because communication is more than words.</div>
          <div className={styles.mbtiBadges}>
            {[['ENFJ','NF'],['ISTJ','SJ'],['ENTP','NT'],['ESFP','SP']].map(([t,g]) => (
              <span key={t} className={styles.artBadge} data-group={g}>{t}</span>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function friendlyError(code) {
  const map = {
    'auth/email-already-in-use': 'An account with this email already exists.',
    'auth/invalid-email': 'Please enter a valid email address.',
    'auth/weak-password': 'Password must be at least 6 characters.',
    'auth/network-request-failed': 'Network error. Check your connection.',
  }
  return map[code] || 'Something went wrong. Please try again.'
}
