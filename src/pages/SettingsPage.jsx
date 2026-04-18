import { useState } from 'react'
import { doc, updateDoc } from 'firebase/firestore'
import { updatePassword, EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth'
import { db, auth } from '../firebase'
import { useAuth } from '../hooks/useAuth'
import { useTheme } from '../hooks/useTheme'
import { ALL_MBTI, MBTI_NAMES, getMbtiGroup } from '../utils/ai'
import { getPreferenceValue, updatePreferencesMap } from '../utils/preferences'
import MbtiModal from '../components/MbtiModal'
import styles from './SettingsPage.module.css'

export default function SettingsPage() {
  const { user, profile, refreshProfile } = useAuth()
  const { theme, setTheme } = useTheme()
  const [showMbti, setShowMbti]   = useState(false)
  const [pwForm, setPwForm]       = useState({ current:'', next:'', confirm:'' })
  const [pwError, setPwError]     = useState('')
  const [pwSuccess, setPwSuccess] = useState(false)
  const [saving, setSaving]       = useState(false)

  async function togglePref(key) {
    const current = getPreferenceValue(profile?.preferences, key)
    await updateDoc(doc(db,'users',user.uid), { preferences: updatePreferencesMap(profile?.preferences, key, !current) })
    await refreshProfile()
  }

  async function handleMbtiSave(mbti) {
    await updateDoc(doc(db,'users',user.uid), { mbti })
    await refreshProfile()
    setShowMbti(false)
  }

  async function handlePasswordChange(e) {
    e.preventDefault()
    setPwError(''); setPwSuccess(false)
    if (pwForm.next !== pwForm.confirm) { setPwError('Passwords do not match.'); return }
    if (pwForm.next.length < 8) { setPwError('Password must be at least 8 characters.'); return }
    setSaving(true)
    try {
      const cred = EmailAuthProvider.credential(user.email, pwForm.current)
      await reauthenticateWithCredential(auth.currentUser, cred)
      await updatePassword(auth.currentUser, pwForm.next)
      setPwSuccess(true)
      setPwForm({ current:'', next:'', confirm:'' })
    } catch (err) {
      setPwError(err.code === 'auth/wrong-password' ? 'Current password is incorrect.' : 'Failed to change password.')
    } finally {
      setSaving(false)
    }
  }

  const group = profile?.mbti ? getMbtiGroup(profile.mbti) : null

  return (
    <div className={styles.page}>
      {showMbti && <MbtiModal onSave={handleMbtiSave} />}

      <div className={styles.grid}>
        <div className="card">
          <div className="section-label">Appearance</div>
          <div className={styles.themeRow}>
            {[
              ['light', 'Light'],
              ['dark', 'Dark'],
            ].map(([value, label]) => (
              <button
                key={value}
                className={styles.themeOption + (theme === value ? ' ' + styles.themeOptionActive : '')}
                onClick={() => setTheme(value)}>
                {label}
              </button>
            ))}
          </div>
          <div className={styles.themeHelp}>Theme preference is saved on this device and applied across the app.</div>
        </div>

        {/* Preferences */}
        <div className="card">
          <div className="section-label">Message preferences</div>
          {[
            ['showMoodOnMessages','Show mood on messages','Attach mood tag to every message sent'],
            ['showMbtiOnMessages','Show MBTI on messages','Display your type badge on chat bubbles'],
            ['autoDetectMood','Auto-detect mood from text','AI analyses your message and suggests a mood tag'],
          ].map(([key,label,desc]) => (
            <div key={key} className={styles.prefRow}>
              <div>
                <div className={styles.prefLabel}>{label}</div>
              <div className={styles.prefDesc}>{desc}</div>
              </div>
              <div className={styles.toggle+(getPreferenceValue(profile?.preferences, key)?' '+styles.on:'')} onClick={()=>togglePref(key)}>
                <div className={styles.knob} />
              </div>
            </div>
          ))}
        </div>

        {/* MBTI */}
        <div className="card">
          <div className="section-label">MBTI type</div>
          <div className={styles.mbtiRow}>
            {group ? (
              <span className="mbti-badge" style={{ background:group.bg, color:group.text, fontSize:13, padding:'4px 12px' }}>
                {profile.mbti} — {MBTI_NAMES[profile.mbti]}
              </span>
            ) : (
              <span style={{ fontSize:13, color:'var(--text3)' }}>Not set</span>
            )}
            <button className="btn secondary sm" onClick={() => setShowMbti(true)}>Change</button>
          </div>
          <div className={styles.mbtiGrid}>
            {ALL_MBTI.map(t => {
              const g = getMbtiGroup(t)
              return (
                <div key={t} className={styles.typeItem+(profile?.mbti===t?' '+styles.typeActive:'')}
                  style={profile?.mbti===t ? { background:g?.bg, borderColor:g?.color } : {}}
                  onClick={() => handleMbtiSave(t)}>
                  <span style={profile?.mbti===t ? { color:g?.text } : {}}>{t}</span>
                </div>
              )
            })}
          </div>
        </div>

        {/* Change password */}
        <div className="card">
          <div className="section-label">Change password</div>
          {pwSuccess && <div className={styles.success}>✓ Password updated successfully</div>}
          {pwError  && <div className={styles.error}>{pwError}</div>}
          <form onSubmit={handlePasswordChange} className={styles.pwForm}>
            <div className={styles.field}><label>Current password</label>
              <input className="input" type="password" value={pwForm.current} onChange={e=>setPwForm(f=>({...f,current:e.target.value}))} placeholder="••••••••" /></div>
            <div className={styles.field}><label>New password</label>
              <input className="input" type="password" value={pwForm.next} onChange={e=>setPwForm(f=>({...f,next:e.target.value}))} placeholder="Min. 8 characters" /></div>
            <div className={styles.field}><label>Confirm new password</label>
              <input className="input" type="password" value={pwForm.confirm} onChange={e=>setPwForm(f=>({...f,confirm:e.target.value}))} placeholder="••••••••" /></div>
            <button className="btn sm" type="submit" disabled={saving} style={{ alignSelf:'flex-start' }}>
              {saving ? <span className="spinner" style={{width:12,height:12}} /> : 'Update password'}
            </button>
          </form>
        </div>

        {/* Account info */}
        <div className="card">
          <div className="section-label">Account info</div>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
            <tbody>
              {[
                ['Email', user?.email],
                ['Employee ID', profile?.employeeId],
                ['Department', profile?.department],
                ['Office', profile?.office],
                ['Member since', profile?.startDate],
              ].map(([k,v]) => (
                <tr key={k} style={{ borderBottom:'1px solid var(--border)' }}>
                  <td style={{ padding:'7px 0', color:'var(--text3)', width:130 }}>{k}</td>
                  <td style={{ padding:'7px 0', color:'var(--text)', fontWeight:500 }}>{v||'—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
