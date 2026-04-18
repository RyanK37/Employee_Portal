import { useEffect, useState } from 'react'
import { collection, getDocs } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../hooks/useAuth'
import { getMbtiGroup, getEmotionEmoji, MBTI_NAMES } from '../utils/ai'
import styles from './DirectoryPage.module.css'

export default function DirectoryPage() {
  const { user } = useAuth()
  const [users, setUsers]   = useState([])
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')

  useEffect(() => {
    getDocs(collection(db,'users')).then(snap => {
      setUsers(snap.docs.map(d => ({ id:d.id, ...d.data() })))
    })
  }, [])

  const filtered = users.filter(u => {
    const q = search.toLowerCase()
    const matchSearch = !q || u.displayName?.toLowerCase().includes(q) || u.department?.toLowerCase().includes(q) || u.mbti?.toLowerCase().includes(q)
    const matchFilter = filter === 'all' || u.department === filter
    return matchSearch && matchFilter
  })

  const departments = [...new Set(users.map(u => u.department).filter(Boolean))]

  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <input className="input" style={{ width:260 }} placeholder="Search by name, department, MBTI…"
          value={search} onChange={e => setSearch(e.target.value)} />
        <div className={styles.filters}>
          {['all', ...departments].map(d => (
            <button key={d} className={styles.filterBtn + (filter===d ? ' '+styles.filterActive : '')}
              onClick={() => setFilter(d)}>
              {d === 'all' ? 'All' : d}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.grid}>
        {filtered.map(u => <UserCard key={u.uid||u.id} u={u} isMe={u.uid === user?.uid} />)}
        {filtered.length === 0 && <div className={styles.empty}>No team members found</div>}
      </div>
    </div>
  )
}

function UserCard({ u, isMe }) {
  const group = u.mbti ? getMbtiGroup(u.mbti) : null
  const emoji = getEmotionEmoji(u.mood)
  const initials = (u.displayName||'?').split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase()

  return (
    <div className={styles.card + (isMe ? ' '+styles.cardMe : '')}>
      <div className={styles.cardAvatar} style={{ background:group?.bg||'var(--surface2)', color:group?.text||'var(--text2)' }}>
        {initials}
      </div>
      <div className={styles.cardName}>{u.displayName}{isMe && <span className={styles.youBadge}>you</span>}</div>
      <div className={styles.cardRole}>{u.role} · {u.department}</div>
      <div className={styles.cardOffice}>{u.office}</div>
      <div className={styles.cardBadges}>
        {group && (
          <span className="mbti-badge" style={{ background:group.bg, color:group.text }}>
            {u.mbti}
          </span>
        )}
        {u.mood && <span className="mood-badge">{emoji}</span>}
      </div>
      {group && u.mbti && (
        <div className={styles.mbtiDesc}>{MBTI_NAMES[u.mbti]} · {group.label}</div>
      )}
    </div>
  )
}
