import { useState } from 'react'
import { Link } from 'react-router-dom'
import { collection, doc, getDocs, limit, query, updateDoc, where } from 'firebase/firestore'
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword, updateProfile } from 'firebase/auth'
import { auth, db } from '../firebase'
import { useAuth } from '../hooks/useAuth'
import MbtiModal from '../components/MbtiModal'
import { ALL_MBTI, EMOTION_EMOJI, getEmotionEmoji, getMbtiGroup, MBTI_NAMES } from '../utils/ai'
import { formatDateValue, getInitials, getLeaveRemaining, getLeaveUsed, toCountValue, toDisplayText } from '../utils/display'
import { mergeMessagesByNewest } from '../utils/messages'
import { getPreferenceValue, updatePreferencesMap } from '../utils/preferences'
import styles from './ProfilePage.module.css'

const DEPARTMENTS = ['Technology', 'Finance', 'Sales', 'HR', 'Marketing', 'Operations', 'Legal']
const OFFICES = ['London', 'New York', 'Hong Kong', 'Singapore', 'Sydney', 'Edinburgh', 'Frankfurt']
const LANGUAGE_OPTIONS = ['English (UK)', 'English (US)', 'French', 'German', 'Spanish', 'Chinese']
const REGION_OPTIONS = ['United Kingdom', 'United States', 'Hong Kong', 'Singapore', 'Australia', 'Germany']

export default function ProfilePage() {
  const { user, profile, refreshProfile, profileLoading } = useAuth()
  const [editing, setEditing] = useState(false)
  const [showMbti, setShowMbti] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [form, setForm] = useState(null)
  const [accountPanel, setAccountPanel] = useState('')
  const [accountError, setAccountError] = useState('')
  const [accountNotice, setAccountNotice] = useState('')
  const [accountBusy, setAccountBusy] = useState(false)
  const [pwForm, setPwForm] = useState({ current: '', next: '', confirm: '' })
  const [localeForm, setLocaleForm] = useState({ language: LANGUAGE_OPTIONS[0], region: REGION_OPTIONS[0] })

  const group = getMbtiGroup(profile?.mbti)
  const moodEmoji = getEmotionEmoji(profile?.mood)
  const initials = getInitials(profile?.displayName, 'U')
  const displayName = toDisplayText(profile?.displayName, 'Unknown user')
  const roleLine = [
    toDisplayText(profile?.role, 'Employee'),
    toDisplayText(profile?.department, 'No department'),
    toDisplayText(profile?.office, 'No office'),
  ].join(' | ')
  const moodLabel = toDisplayText(profile?.mood, 'neutral')
  const mbtiCode = typeof profile?.mbti === 'string' && ALL_MBTI.includes(profile.mbti) ? profile.mbti : null
  const mbtiName = mbtiCode ? MBTI_NAMES[mbtiCode] : null
  const languageValue = getProfileLanguage(profile)
  const regionValue = getProfileRegion(profile)
  const hasPasswordProvider = user?.providerData?.some(provider => provider.providerId === 'password')
  const providerList = user?.providerData?.map(provider => provider.providerId).filter(Boolean).join(', ') || 'unknown'

  function openAccountPanel(panel) {
    setAccountError('')
    setAccountNotice('')
    setAccountPanel(current => current === panel ? '' : panel)

    if (panel === 'password') {
      setPwForm({ current: '', next: '', confirm: '' })
    }

    if (panel === 'locale') {
      setLocaleForm({ language: languageValue, region: regionValue })
    }
  }

  function startEdit() {
    setForm({
      displayName: toDisplayText(profile?.displayName, ''),
      department: DEPARTMENTS.includes(profile?.department) ? profile.department : DEPARTMENTS[0],
      office: OFFICES.includes(profile?.office) ? profile.office : OFFICES[0],
    })
    setEditing(true)
  }

  async function saveEdit() {
    if (!user || !form) return

    setSaving(true)
    try {
      await updateDoc(doc(db, 'users', user.uid), {
        displayName: form.displayName,
        department: form.department,
        office: form.office,
      })
      if (auth.currentUser) {
        await updateProfile(auth.currentUser, { displayName: form.displayName })
      }
      await refreshProfile()
      setEditing(false)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } finally {
      setSaving(false)
    }
  }

  async function setMood(mood) {
    if (!user) return
    await updateDoc(doc(db, 'users', user.uid), { mood })
    await refreshProfile()
  }

  async function handleMbtiChange(mbti) {
    if (!user) return
    await updateDoc(doc(db, 'users', user.uid), { mbti })
    await refreshProfile()
    setShowMbti(false)
  }

  async function togglePref(key) {
    if (!user) return
    const current = getPreferenceValue(profile?.preferences, key)
    await updateDoc(doc(db, 'users', user.uid), {
      preferences: updatePreferencesMap(profile?.preferences, key, !current),
    })
    await refreshProfile()
  }

  async function handlePasswordChange(e) {
    e.preventDefault()
    if (!user) return

    setAccountError('')
    setAccountNotice('')

    if (!hasPasswordProvider) {
      setAccountError('This account uses external sign-in. Password changes are only available for email/password accounts.')
      return
    }

    if (!user.email) {
      setAccountError('This account does not have an email address available for password reset.')
      return
    }

    if (pwForm.next !== pwForm.confirm) {
      setAccountError('New password and confirmation do not match.')
      return
    }

    if (pwForm.next.length < 8) {
      setAccountError('New password must be at least 8 characters.')
      return
    }

    setAccountBusy(true)
    try {
      const credential = EmailAuthProvider.credential(user.email, pwForm.current)
      await reauthenticateWithCredential(auth.currentUser, credential)
      await updatePassword(auth.currentUser, pwForm.next)
      setPwForm({ current: '', next: '', confirm: '' })
      setAccountNotice('Password updated successfully.')
    } catch (err) {
      setAccountError(err?.code === 'auth/wrong-password'
        ? 'Current password is incorrect.'
        : 'Password update failed. Please try again.')
    } finally {
      setAccountBusy(false)
    }
  }

  async function handleLocaleSave(e) {
    e.preventDefault()
    if (!user) return

    setAccountError('')
    setAccountNotice('')
    setAccountBusy(true)
    try {
      await updateDoc(doc(db, 'users', user.uid), {
        preferences: {
          ...(profile?.preferences || {}),
          language: localeForm.language,
          region: localeForm.region,
        },
      })
      await refreshProfile()
      setAccountNotice('Language and region updated.')
    } catch {
      setAccountError('Language and region could not be updated.')
    } finally {
      setAccountBusy(false)
    }
  }

  async function handleDownloadData() {
    if (!user) return

    setAccountError('')
    setAccountNotice('')
    setAccountBusy(true)
    setAccountPanel('download')
    try {
      const [leaveSnap, notificationSnap, publicMessageSnap, privateMessageSnap, roomSnap] = await Promise.all([
        getDocs(query(collection(db, 'leaveRequests'), where('requesterId', '==', user.uid), limit(200))),
        getDocs(query(collection(db, 'notifications'), where('userId', '==', user.uid), limit(200))),
        getDocs(query(collection(db, 'messages'), where('roomType', '==', 'channel'), limit(200))),
        getDocs(query(collection(db, 'messages'), where('memberIds', 'array-contains', user.uid), limit(200))),
        getDocs(query(collection(db, 'chatRooms'), where('memberIds', 'array-contains', user.uid), limit(100))),
      ])

      const ownMessages = mergeMessagesByNewest(
        publicMessageSnap.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() })),
        privateMessageSnap.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }))
      ).filter(message => message.senderId === user.uid)

      const exportData = {
        exportedAt: new Date().toISOString(),
        account: {
          uid: user.uid,
          email: user.email || '',
          providers: user.providerData?.map(provider => provider.providerId).filter(Boolean) || [],
        },
        profile: serializeExportValue(profile || null),
        leaveRequests: leaveSnap.docs.map(docSnap => serializeExportValue({ id: docSnap.id, ...docSnap.data() })),
        notifications: notificationSnap.docs.map(docSnap => serializeExportValue({ id: docSnap.id, ...docSnap.data() })),
        messages: ownMessages.map(message => serializeExportValue(message)),
        chatRooms: roomSnap.docs.map(docSnap => serializeExportValue({ id: docSnap.id, ...docSnap.data() })),
      }

      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `fdm-portal-data-${user.uid}-${new Date().toISOString().slice(0, 10)}.json`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
      setAccountNotice('Your data export has been downloaded.')
    } catch (err) {
      console.error('Data export failed', err)
      setAccountError('Your data export could not be generated right now.')
    } finally {
      setAccountBusy(false)
    }
  }

  if (profileLoading) {
    return <div style={{ padding: 40, textAlign: 'center' }}><span className="spinner" /></div>
  }

  if (!profile) {
    return (
      <div className="card" style={{ maxWidth: 560, margin: '32px auto', textAlign: 'center' }}>
        <div className="section-label">Profile setup incomplete</div>
        <h2 style={{ margin: '8px 0 10px', fontSize: 24 }}>Your employee profile has not been created yet.</h2>
        <p style={{ color: 'var(--text2)', marginBottom: 18 }}>
          This page needs your Firestore profile document. Ask an admin to provision your employee record, then sign in again.
        </p>
        <Link className="btn" to="/login?setup=missing">Back to sign in</Link>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      {showMbti && <MbtiModal onSave={handleMbtiChange} />}

      <div className={styles.hero}>
        <div className={styles.heroLeft}>
          <div className={styles.avatar} style={group ? { background: group.bg, color: group.text } : {}}>
            {initials}
            <div className={styles.onlineDot} />
          </div>
          <div className={styles.heroInfo}>
            {editing ? (
              <input
                className="input"
                style={{ fontSize: 18, fontWeight: 700, fontFamily: 'var(--font-display)', width: 280, marginBottom: 6 }}
                value={form.displayName}
                onChange={e => setForm(current => ({ ...current, displayName: e.target.value }))}
              />
            ) : (
              <div className={styles.heroName}>{displayName}</div>
            )}

            <div className={styles.heroRole}>
              {editing ? (
                <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                  <select
                    className="input"
                    style={{ fontSize: 12, padding: '4px 8px' }}
                    value={form.department}
                    onChange={e => setForm(current => ({ ...current, department: e.target.value }))}>
                    {DEPARTMENTS.map(department => <option key={department}>{department}</option>)}
                  </select>
                  <select
                    className="input"
                    style={{ fontSize: 12, padding: '4px 8px' }}
                    value={form.office}
                    onChange={e => setForm(current => ({ ...current, office: e.target.value }))}>
                    {OFFICES.map(office => <option key={office}>{office}</option>)}
                  </select>
                </div>
              ) : (
                <>{roleLine}</>
              )}
            </div>

            <div className={styles.heroBadges}>
              {group && mbtiCode && (
                <span
                  className="mbti-badge"
                  style={{ background: group.bg, color: group.text, cursor: 'pointer' }}
                  onClick={() => setShowMbti(true)}
                  title="Click to change MBTI">
                  {mbtiCode} - {mbtiName}
                </span>
              )}
              <span className="mood-badge">{moodEmoji} {moodLabel}</span>
              <span style={{ fontSize: 11, background: 'var(--green-light)', color: 'var(--green)', borderRadius: 8, padding: '2px 8px' }}>
                Online
              </span>
            </div>
          </div>
        </div>

        <div className={styles.heroActions}>
          {saved && <span className={styles.savedMsg}>Saved</span>}
          {editing ? (
            <>
              <button className="btn secondary sm" onClick={() => setEditing(false)}>Cancel</button>
              <button className="btn sm" onClick={saveEdit} disabled={saving}>
                {saving ? <span className="spinner" style={{ width: 12, height: 12 }} /> : 'Save'}
              </button>
            </>
          ) : (
            <button className="btn secondary sm" onClick={startEdit}>Edit profile</button>
          )}
        </div>
      </div>

      <div className={styles.stats}>
        <div className="stat-card"><div className="lbl">Leave remaining</div><div className="val">{toCountValue(getLeaveRemaining(profile?.leaveBalance, profile?.leaveTaken), '-')}</div><div className="sub">days</div></div>
        <div className="stat-card"><div className="lbl">Days taken YTD</div><div className="val">{toCountValue(getLeaveUsed(profile?.leaveBalance, profile?.leaveTaken), '0')}</div><div className="sub">days</div></div>
        <div className="stat-card"><div className="lbl">Employee ID</div><div className="val" style={{ fontSize: 14 }}>{toDisplayText(profile?.employeeId, '-')}</div></div>
        <div className="stat-card"><div className="lbl">Start date</div><div className="val" style={{ fontSize: 14 }}>{formatDateValue(profile?.startDate, '-')}</div></div>
      </div>

      <div className={styles.grid}>
        <div className="card">
          <div className="section-label">Personal info</div>
          <table className={styles.infoTable}>
            <tbody>
              {[
                ['Email', toDisplayText(profile?.email, '-')],
                ['Department', toDisplayText(profile?.department, '-')],
                ['Office', toDisplayText(profile?.office, '-')],
                ['Role', toDisplayText(profile?.role, '-')],
                ['Manager', toDisplayText(profile?.manager, '-')],
              ].map(([key, value]) => (
                <tr key={key}>
                  <td className={styles.infoKey}>{key}</td>
                  <td className={styles.infoVal}>{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card" style={group ? { borderColor: group.color, borderWidth: 1.5 } : {}}>
          <div className="section-label">MBTI and mood identity</div>
          {group && mbtiCode ? (
            <>
              <div className={styles.mbtiHero} style={{ background: group.bg, borderRadius: 'var(--radius)', padding: '16px', marginBottom: 12 }}>
                <div className={styles.mbtiType} style={{ color: group.text }}>{mbtiCode}</div>
                <div className={styles.mbtiName} style={{ color: group.text }}>{mbtiName}</div>
                <div className={styles.mbtiGroup} style={{ color: group.color }}>{group.label} - {group.group} group</div>
              </div>
              <button className="btn secondary sm" style={{ marginBottom: 14 }} onClick={() => setShowMbti(true)}>Change MBTI</button>
            </>
          ) : (
            <button className="btn sm" onClick={() => setShowMbti(true)}>Set your MBTI</button>
          )}

          <div className="section-label" style={{ marginTop: 4 }}>Set today&apos;s mood</div>
          <div className={styles.moodGrid}>
            {Object.entries(EMOTION_EMOJI).map(([mood, emoji]) => (
              <button
                key={mood}
                className={styles.moodBtn + (profile?.mood === mood ? ' ' + styles.moodBtnActive : '')}
                onClick={() => setMood(mood)}
                title={mood}>
                <span style={{ fontSize: 16 }}>{emoji}</span>
                <span className={styles.moodName}>{mood}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="section-label">Preferences</div>
          {[
            ['showMoodOnMessages', 'Show mood on messages', 'Attach mood tag to every message'],
            ['showMbtiOnMessages', 'Show MBTI on messages', 'Display type badge on chat'],
            ['autoDetectMood', 'Auto-detect mood', 'AI suggests mood as you type'],
          ].map(([key, label, desc]) => (
            <div key={key} className={styles.prefRow}>
              <div>
                <div className={styles.prefLabel}>{label}</div>
                <div className={styles.prefDesc}>{desc}</div>
              </div>
              <div
                className={styles.toggle + (getPreferenceValue(profile?.preferences, key) ? ' ' + styles.toggleOn : '')}
                onClick={() => togglePref(key)}>
                <div className={styles.toggleKnob} />
              </div>
            </div>
          ))}
        </div>

        <div className="card">
          <div className="section-label">Account</div>
          {[
            ['Change password', hasPasswordProvider ? 'Security' : 'External sign-in', 'password'],
            ['Two-factor authentication', 'Security', 'twoFactor'],
            ['Language and region', `${languageValue} | ${regionValue}`, 'locale'],
            ['Download my data', accountBusy && accountPanel === 'download' ? 'Preparing...' : 'Privacy', 'download'],
          ].map(([label, meta, actionKey]) => (
            <button
              key={label}
              type="button"
              className={styles.actionRow}
              onClick={() => {
                if (actionKey === 'download') {
                  handleDownloadData()
                  return
                }
                openAccountPanel(actionKey)
              }}>
              <span className={styles.actionLabel}>{label}</span>
              <span className={styles.actionMeta}>{meta}</span>
            </button>
          ))}

          {accountError && <div className={styles.accountError}>{accountError}</div>}
          {accountNotice && <div className={styles.accountNotice}>{accountNotice}</div>}

          {accountPanel === 'password' && (
            <form className={styles.accountPanel} onSubmit={handlePasswordChange}>
              <div className={styles.accountPanelTitle}>Change password</div>
              <div className={styles.accountField}>
                <label>Current password</label>
                <input
                  className="input"
                  type="password"
                  value={pwForm.current}
                  onChange={e => setPwForm(current => ({ ...current, current: e.target.value }))}
                  placeholder="Enter current password"
                />
              </div>
              <div className={styles.accountField}>
                <label>New password</label>
                <input
                  className="input"
                  type="password"
                  value={pwForm.next}
                  onChange={e => setPwForm(current => ({ ...current, next: e.target.value }))}
                  placeholder="Minimum 8 characters"
                />
              </div>
              <div className={styles.accountField}>
                <label>Confirm new password</label>
                <input
                  className="input"
                  type="password"
                  value={pwForm.confirm}
                  onChange={e => setPwForm(current => ({ ...current, confirm: e.target.value }))}
                  placeholder="Re-enter new password"
                />
              </div>
              <div className={styles.accountActions}>
                <button className="btn secondary sm" type="button" onClick={() => setAccountPanel('')}>Close</button>
                <button className="btn sm" type="submit" disabled={accountBusy}>
                  {accountBusy ? <span className="spinner" style={{ width: 12, height: 12 }} /> : 'Update password'}
                </button>
              </div>
            </form>
          )}

          {accountPanel === 'twoFactor' && (
            <div className={styles.accountPanel}>
              <div className={styles.accountPanelTitle}>Two-factor authentication</div>
              <div className={styles.accountHint}>Current sign-in providers: {providerList}</div>
              <div className={styles.accountHint}>
                Two-factor enrolment is not implemented in this build yet. This panel now shows current account security status instead of being a dead row.
              </div>
              <div className={styles.accountActions}>
                <button className="btn secondary sm" type="button" onClick={() => setAccountPanel('')}>Close</button>
              </div>
            </div>
          )}

          {accountPanel === 'locale' && (
            <form className={styles.accountPanel} onSubmit={handleLocaleSave}>
              <div className={styles.accountPanelTitle}>Language and region</div>
              <div className={styles.accountField}>
                <label>Language</label>
                <select
                  className="input"
                  value={localeForm.language}
                  onChange={e => setLocaleForm(current => ({ ...current, language: e.target.value }))}>
                  {LANGUAGE_OPTIONS.map(option => <option key={option}>{option}</option>)}
                </select>
              </div>
              <div className={styles.accountField}>
                <label>Region</label>
                <select
                  className="input"
                  value={localeForm.region}
                  onChange={e => setLocaleForm(current => ({ ...current, region: e.target.value }))}>
                  {REGION_OPTIONS.map(option => <option key={option}>{option}</option>)}
                </select>
              </div>
              <div className={styles.accountActions}>
                <button className="btn secondary sm" type="button" onClick={() => setAccountPanel('')}>Close</button>
                <button className="btn sm" type="submit" disabled={accountBusy}>
                  {accountBusy ? <span className="spinner" style={{ width: 12, height: 12 }} /> : 'Save changes'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}

function getProfileLanguage(profile) {
  return typeof profile?.preferences?.language === 'string' && profile.preferences.language
    ? profile.preferences.language
    : LANGUAGE_OPTIONS[0]
}

function getProfileRegion(profile) {
  return typeof profile?.preferences?.region === 'string' && profile.preferences.region
    ? profile.preferences.region
    : REGION_OPTIONS[0]
}

function serializeExportValue(value) {
  if (value == null) return value
  if (Array.isArray(value)) return value.map(serializeExportValue)
  if (value?.toDate) return value.toDate().toISOString()
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, serializeExportValue(entry)])
    )
  }
  return value
}
