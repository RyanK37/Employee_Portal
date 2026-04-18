import { useEffect, useState } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { signOut } from 'firebase/auth'
import { auth } from '../firebase'
import { useAuth } from '../hooks/useAuth'
import { useTheme } from '../hooks/useTheme'
import { useWeeklyMbtiRefresh } from '../hooks/useWeeklyMbtiRefresh'
import { getEmotionEmoji, getMbtiGroup } from '../utils/ai'
import { getInitials, toDisplayText } from '../utils/display'
import styles from './DashboardLayout.module.css'

const NAV = [
  { to: '/', icon: '🏠', label: 'Dashboard' },
  { to: '/leave', icon: '🗓️', label: 'Leave' },
  { to: '/chat', icon: '💬', label: 'Messages' },
  { to: '/directory', icon: '👥', label: 'Directory' },
  { to: '/reports', icon: '📊', label: 'Reports' },
  { to: '/payroll', icon: '💷', label: 'Payroll' },
  { to: '/documents', icon: '📄', label: 'Documents' },
]

const ACCOUNT_NAV = [
  { to: '/settings', icon: '⚙️', label: 'Settings' },
]

const LAST_SEEN_MBTI_KEY_PREFIX = 'fdm-last-seen-mbti:'

export default function DashboardLayout() {
  const { user, profile } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const navigate = useNavigate()
  const [loggingOut, setLoggingOut] = useState(false)
  const [mbtiChangeModal, setMbtiChangeModal] = useState(null)

  useWeeklyMbtiRefresh(user, profile)

  useEffect(() => {
    if (!user?.uid || !profile?.mbti) return

    const storageKey = `${LAST_SEEN_MBTI_KEY_PREFIX}${user.uid}`
    const currentMbti = String(profile.mbti).toUpperCase()
    const previousMbti = window.localStorage.getItem(storageKey)

    if (previousMbti && previousMbti !== currentMbti) {
      setMbtiChangeModal({
        previousMbti,
        currentMbti,
        source: profile?.mbtiSource || '',
      })
    }

    window.localStorage.setItem(storageKey, currentMbti)
  }, [profile?.mbti, profile?.mbtiSource, user?.uid])

  const mbtiGroup = getMbtiGroup(profile?.mbti)
  const previousMbtiGroup = getMbtiGroup(mbtiChangeModal?.previousMbti)
  const moodEmoji = getEmotionEmoji(profile?.mood)
  const initials = getInitials(profile?.displayName, 'U')

  async function handleLogout() {
    if (!window.confirm('Are you sure you want to log out?')) return
    setLoggingOut(true)
    try {
      await signOut(auth)
      navigate('/login')
    } finally {
      setLoggingOut(false)
    }
  }

  return (
    <div className={styles.shell}>
      {mbtiChangeModal && (
        <div className={styles.mbtiOverlay}>
          <div className={styles.mbtiCard}>
            <div className={styles.mbtiEyebrow}>MBTI updated</div>
            <div className={styles.mbtiTitle}>Your personality badge changed to {mbtiChangeModal.currentMbti}</div>
            <div className={styles.mbtiText}>
              {mbtiChangeModal.source === 'weekly-classifier'
                ? 'The weekly message classifier updated your MBTI based on recent conversations.'
                : 'Your MBTI value was updated in your employee profile.'}
            </div>
            <div className={styles.mbtiPair}>
              <span
                className="mbti-badge"
                style={previousMbtiGroup ? { background: previousMbtiGroup.bg, color: previousMbtiGroup.text } : {}}>
                {mbtiChangeModal.previousMbti}
              </span>
              <span className={styles.mbtiArrow}>-&gt;</span>
              <span
                className="mbti-badge"
                style={mbtiGroup ? { background: mbtiGroup.bg, color: mbtiGroup.text } : {}}>
                {mbtiChangeModal.currentMbti}
              </span>
            </div>
            <div className={styles.mbtiActions}>
              <button className="btn sm" type="button" onClick={() => setMbtiChangeModal(null)}>
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      <aside className={styles.sidebar}>
        <div className={styles.logo}>
          <div className={styles.logoMark}>F</div>
          <div>
            <div className={styles.logoName}>FDM Group</div>
            <div className={styles.logoSub}>Employee Portal</div>
          </div>
        </div>

        <nav className={styles.nav}>
          <div className={styles.navSection}>
            <div className={styles.navLabel}>Workspace</div>
            {NAV.map(item => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) => styles.navItem + (isActive ? ' ' + styles.navActive : '')}>
                <span className={styles.navIcon}>{item.icon}</span>
                {item.label}
              </NavLink>
            ))}
          </div>

          <div className={styles.navSection} style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>
            <div className={styles.navLabel}>Account</div>
            {ACCOUNT_NAV.map(item => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) => styles.navItem + (isActive ? ' ' + styles.navActive : '')}>
                <span className={styles.navIcon}>{item.icon}</span>
                {item.label}
              </NavLink>
            ))}
          </div>
        </nav>

        <div className={styles.userCard} onClick={() => navigate('/profile')}>
          <div className={styles.userAvatar} style={mbtiGroup ? { background: mbtiGroup.bg, color: mbtiGroup.text } : {}}>
            {initials}
            <div className={styles.onlineDot} />
          </div>
          <div className={styles.userInfo}>
            <div className={styles.userName}>{toDisplayText(profile?.displayName, 'Loading...')}</div>
            <div className={styles.userRole}>{toDisplayText(profile?.role, 'Employee')}</div>
          </div>
          {mbtiGroup && (
            <span className="mbti-badge" style={{ background: mbtiGroup.bg, color: mbtiGroup.text, fontSize: 10 }}>
              {profile.mbti}
            </span>
          )}
        </div>
      </aside>

      <div className={styles.main}>
        <header className={styles.topbar}>
          <div className={styles.topbarLeft} />
          <div className={styles.topbarRight}>
            <button className={styles.themeBtn} onClick={toggleTheme} title="Toggle theme">
              {theme === 'dark' ? 'Light mode' : 'Dark mode'}
            </button>
            {mbtiGroup && (
              <span className="mbti-badge" style={{ background: mbtiGroup.bg, color: mbtiGroup.text }}>
                {profile.mbti}
              </span>
            )}
            <span style={{ fontSize: 18 }}>{moodEmoji}</span>

            <div className={styles.accountMenu}>
              <button
                type="button"
                className={styles.topbarAvatar}
                style={mbtiGroup ? { background: mbtiGroup.bg, color: mbtiGroup.text } : {}}
                title="Open account menu"
                aria-haspopup="menu">
                {initials}
              </button>

              <div className={styles.accountDropdown} role="menu">
                <button type="button" className={styles.accountItem} onClick={() => navigate('/profile')}>Profile</button>
                <button type="button" className={styles.accountItem} onClick={() => navigate('/settings')}>Settings</button>
                <button
                  type="button"
                  className={styles.accountItem + ' ' + styles.accountDanger}
                  onClick={handleLogout}
                  disabled={loggingOut}>
                  {loggingOut ? 'Logging out...' : 'Log out'}
                </button>
              </div>
            </div>
          </div>
        </header>

        <main className={styles.content}>
          <Outlet />
        </main>
      </div>
    </div>
  )
}
