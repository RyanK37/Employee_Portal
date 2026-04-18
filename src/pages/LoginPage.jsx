import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { signInWithEmailAndPassword, signOut, updateProfile } from 'firebase/auth'
import { doc, getDoc, setDoc, serverTimestamp, updateDoc } from 'firebase/firestore'
import { auth, db } from '../firebase'
import { useAuth } from '../hooks/useAuth'
import MbtiModal from '../components/MbtiModal'
import styles from './AuthPage.module.css'

const WORK_EMAIL_DOMAIN = 'fdmgroup.com'
const DEPARTMENTS = ['Technology', 'Finance', 'Sales', 'HR', 'Marketing', 'Operations', 'Legal']
const OFFICES = ['London', 'New York', 'Hong Kong', 'Singapore', 'Sydney', 'Edinburgh', 'Frankfurt']

export default function LoginPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const shellRef = useRef(null)
  const { user, profile, loading: authLoading, profileLoading, refreshProfile } = useAuth()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [svgSize, setSvgSize] = useState({ w: 460, h: 100 })
  const [stage, setStage] = useState('signIn')
  const [detailsBusy, setDetailsBusy] = useState(false)
  const [detailsError, setDetailsError] = useState('')
  const [detailsForm, setDetailsForm] = useState({
    displayName: '',
    department: DEPARTMENTS[0],
    office: OFFICES[0],
  })

  const setupMissing = searchParams.get('setup') === 'missing'
  const waitingForProfile = stage === 'waitingProfile'
  const showingDetails = stage === 'details'
  const showingMbti = stage === 'mbti'

  useEffect(() => {
    if (!shellRef.current) return
    const obs = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setSvgSize({ w: Math.round(width), h: Math.round(height) })
    })
    obs.observe(shellRef.current)
    return () => obs.disconnect()
  }, [])

  useEffect(() => {
    if (authLoading) return

    if (!user) {
      setStage(current => (current === 'signIn' ? current : 'signIn'))
      return
    }

    if (profileLoading) return

    if (profile == null) {
      setStage(current => (current === 'mbti' || current === 'details' ? current : 'waitingProfile'))
      return
    }

    if (stage === 'waitingProfile' || (stage === 'signIn' && shouldCompleteOnboarding(profile))) {
      setDetailsForm(createDetailsForm(profile, user?.email))
      setDetailsError('')
      setStage('details')
      return
    }

    if (stage === 'signIn') {
      navigate('/', { replace: true })
    }
  }, [authLoading, navigate, profile, profileLoading, stage, user])

  async function handleLogin(e) {
    e.preventDefault()
    setError('')

    const normalizedEmail = email.trim().toLowerCase()

    if (!isWorkEmail(normalizedEmail)) {
      setError(`Use your @${WORK_EMAIL_DOMAIN} workplace email.`)
      return
    }

    setLoading(true)

    try {
      const credential = await signInWithEmailAndPassword(auth, normalizedEmail, password)
      const firebaseUser = credential.user
      const userRef = doc(db, 'users', firebaseUser.uid)
      const profileSnap = await getDoc(userRef)

      if (profileSnap.exists()) {
        navigate('/', { replace: true })
        return
      }

      const displayName = getDefaultDisplayName(firebaseUser.displayName, firebaseUser.email)

      if (!firebaseUser.displayName && displayName) {
        await updateProfile(firebaseUser, { displayName })
      }

      await setDoc(userRef, {
        uid: firebaseUser.uid,
        displayName,
        email: firebaseUser.email || normalizedEmail,
        role: 'Employee',
        department: DEPARTMENTS[0],
        office: OFFICES[0],
        mood: 'neutral',
        mbti: '',
        leaveBalance: {
          annual: 25,
          used: 0,
          remaining: 25,
        },
        leaveTaken: 0,
        startDate: new Date().toISOString().split('T')[0],
        manager: '',
        employeeId: createEmployeeId(),
        preferences: {
          showMoodOnMessages: true,
          showMbtiOnMessages: true,
          autoDetectMood: true,
          language: 'English (UK)',
          region: 'United Kingdom',
        },
        createdAt: serverTimestamp(),
      })

      await refreshProfile()
      setStage('waitingProfile')
    } catch (err) {
      setError(friendlyError(err.code))
    } finally {
      setLoading(false)
    }
  }

  async function handleDetailsSubmit(e) {
    e.preventDefault()

    if (!user) return

    const nextName = detailsForm.displayName.trim()
    if (!nextName) {
      setDetailsError('Please enter your full name.')
      return
    }

    setDetailsBusy(true)
    setDetailsError('')

    try {
      await updateDoc(doc(db, 'users', user.uid), {
        displayName: nextName,
        department: detailsForm.department,
        office: detailsForm.office,
      })

      if (auth.currentUser) {
        await updateProfile(auth.currentUser, { displayName: nextName })
      }

      await refreshProfile()
      setStage('mbti')
    } catch (err) {
      console.error('Profile details update failed', err)
      setDetailsError('Your profile details could not be saved. Please try again.')
    } finally {
      setDetailsBusy(false)
    }
  }

  async function handleMbtiSave(mbti) {
    if (!user) return

    setDetailsBusy(true)
    setError('')

    try {
      await updateDoc(doc(db, 'users', user.uid), { mbti })
      await refreshProfile()
      setStage('signIn')
      navigate('/', { replace: true })
    } catch (err) {
      console.error('MBTI setup failed', err)
      setError('Your MBTI could not be saved. Please try again.')
      setStage('details')
    } finally {
      setDetailsBusy(false)
    }
  }

  async function handleSignOut() {
    setSigningOut(true)
    try {
      await signOut(auth)
      setPassword('')
      setStage('signIn')
    } finally {
      setSigningOut(false)
    }
  }

  const { w, h } = svgSize
  const rx = 27

  return (
    <div className={styles.page}>
      {showingDetails && (
        <div className={styles.setupOverlay}>
          <div className={styles.setupCard}>
            <div className={styles.setupEyebrow}>Step 1 of 2</div>
            <h2 className={styles.setupTitle}>Complete your employee details</h2>
            <p className={styles.setupText}>
              Your profile is ready. Confirm the details below before entering the portal.
            </p>

            {detailsError && <div className={styles.errorBanner}>{detailsError}</div>}

            <form className={styles.setupForm} onSubmit={handleDetailsSubmit}>
              <div className={styles.field}>
                <label htmlFor="setup-display-name">Full name</label>
                <input
                  id="setup-display-name"
                  className="input"
                  value={detailsForm.displayName}
                  onChange={e => setDetailsForm(current => ({ ...current, displayName: e.target.value }))}
                  placeholder="Jamie Kendrick"
                  required
                />
              </div>

              <div className={styles.setupGrid}>
                <div className={styles.field}>
                  <label htmlFor="setup-department">Department</label>
                  <select
                    id="setup-department"
                    className="input"
                    value={detailsForm.department}
                    onChange={e => setDetailsForm(current => ({ ...current, department: e.target.value }))}>
                    {DEPARTMENTS.map(option => <option key={option}>{option}</option>)}
                  </select>
                </div>

                <div className={styles.field}>
                  <label htmlFor="setup-office">Office</label>
                  <select
                    id="setup-office"
                    className="input"
                    value={detailsForm.office}
                    onChange={e => setDetailsForm(current => ({ ...current, office: e.target.value }))}>
                    {OFFICES.map(option => <option key={option}>{option}</option>)}
                  </select>
                </div>
              </div>

              <div className={styles.setupMeta}>
                Signed in as <strong>{user?.email || email}</strong>
              </div>

              <div className={styles.setupActions}>
                <button type="button" className="btn secondary sm" onClick={handleSignOut} disabled={detailsBusy || signingOut}>
                  {signingOut ? 'Signing out...' : 'Sign out'}
                </button>
                <button type="submit" className="btn sm" disabled={detailsBusy}>
                  {detailsBusy ? <span className="spinner" style={{ width: 12, height: 12 }} /> : 'Continue'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showingMbti && <MbtiModal onSave={handleMbtiSave} />}

      <div className={styles.backdropGlow} />
      <div className={styles.backdropGrid} />

      <div className={styles.modalShell} ref={shellRef}>
        <div className={styles.modalAura} />

        <svg
          className={styles.borderSvg}
          viewBox={`0 0 ${w} ${h}`}
          preserveAspectRatio="none"
          aria-hidden="true">
          <rect
            className={styles.borderBase}
            x="1"
            y="1"
            width={w - 2}
            height={h - 2}
            rx={rx}
            pathLength="100"
          />
          <rect
            className={styles.borderSweep}
            x="1"
            y="1"
            width={w - 2}
            height={h - 2}
            rx={rx}
            pathLength="100"
          />
          <rect
            className={styles.borderTip}
            x="1"
            y="1"
            width={w - 2}
            height={h - 2}
            rx={rx}
            pathLength="100"
          />
        </svg>

        <div className={styles.modalCard}>
          <div className={styles.content}>
            <div className={styles.logoRow}>
              <div className={styles.logoMark}>F</div>
              <div>
                <div className={styles.logoName}>FDM Group</div>
                <div className={styles.logoSub}>Employee Portal</div>
              </div>
            </div>

            <span className={styles.eyebrow}>
              {waitingForProfile ? 'Provisioning profile' : 'Internal Access'}
            </span>

            <h1 className={styles.heading}>
              {waitingForProfile ? 'Preparing your employee profile' : 'Sign in to continue'}
            </h1>
            <p className={styles.sub}>
              {waitingForProfile
                ? 'Your account is authenticated. The portal is waiting for your employee profile to be created before continuing.'
                : 'Use your workplace email and password.'}
            </p>

            {error && !waitingForProfile && (
              <div className={styles.errorBanner}>
                {error}
              </div>
            )}

            {waitingForProfile ? (
              <div className={styles.loadingCard}>
                <div className={styles.loadingSpinnerWrap}>
                  <span className="spinner" style={{ width: 28, height: 28 }} />
                </div>
                <div className={styles.loadingTitle}>Waiting for profile setup</div>
                <div className={styles.loadingText}>
                  Signed in as <strong>{user?.email || email}</strong>. This page will continue automatically when the profile document appears.
                </div>
                {setupMissing && (
                  <div className={styles.loadingHint}>
                    The app redirected you here because your account exists in Authentication but the `users/{'{uid}'}` profile was still missing.
                  </div>
                )}
                <div className={styles.setupActions}>
                  <button type="button" className="btn secondary sm" onClick={handleSignOut} disabled={signingOut}>
                    {signingOut ? 'Signing out...' : 'Sign out'}
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleLogin} className={styles.form}>
                <div className={styles.field}>
                  <label htmlFor="email">Work email</label>
                  <input
                    id="email"
                    className="input"
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder={`you@${WORK_EMAIL_DOMAIN}`}
                    autoComplete="username"
                    required
                  />
                </div>

                <div className={styles.field}>
                  <label htmlFor="password">Password</label>
                  <input
                    id="password"
                    className="input"
                    type="password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    autoComplete="current-password"
                    required
                  />
                </div>

                <button
                  className="btn lg"
                  type="submit"
                  disabled={loading}
                  style={{ width: '100%', justifyContent: 'center' }}>
                  {loading ? <span className="spinner" /> : 'Sign in'}
                </button>
              </form>
            )}

            <p className={styles.footerNote}>
              Allowed domain: <strong>@{WORK_EMAIL_DOMAIN}</strong>. Access is provisioned internally.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

function isWorkEmail(value) {
  return String(value || '').trim().toLowerCase().endsWith(`@${WORK_EMAIL_DOMAIN}`)
}

function createDetailsForm(profile, email) {
  return {
    displayName: getDefaultDisplayName(profile?.displayName, email),
    department: DEPARTMENTS.includes(profile?.department) ? profile.department : DEPARTMENTS[0],
    office: OFFICES.includes(profile?.office) ? profile.office : OFFICES[0],
  }
}

function shouldCompleteOnboarding(profile) {
  return !String(profile?.mbti || '').trim()
}

function getDefaultDisplayName(displayName, email) {
  return String(displayName || '').trim() || deriveNameFromEmail(email) || ''
}

function deriveNameFromEmail(email) {
  if (!email) return ''
  const local = email.split('@')[0]
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function createEmployeeId() {
  return `FDM-${1000 + Math.floor(Math.random() * 9000)}`
}

function friendlyError(code) {
  const map = {
    'auth/invalid-credential': 'Invalid email or password.',
    'auth/user-not-found': 'No account found with this email.',
    'auth/wrong-password': 'Incorrect password.',
    'auth/too-many-requests': 'Too many attempts. Please wait before trying again.',
    'auth/network-request-failed': 'Network error. Check your connection.',
  }
  return map[code] ?? 'Something went wrong. Please try again.'
}
