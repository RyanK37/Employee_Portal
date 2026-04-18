import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { arrayRemove, arrayUnion, collection, doc, limit, limitToLast, onSnapshot, orderBy, query, updateDoc, where } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../hooks/useAuth'
import AnnouncementCard from '../components/AnnouncementCard'
import { getMbtiGroup, getEmotionEmoji } from '../utils/ai'
import { ANNOUNCEMENTS_ROOM_ID, CHANNELS, canManageAnnouncements, getDmId } from '../utils/chat'
import { getLeaveRemaining } from '../utils/display'
import { getMessageTimestampMs, mergeMessagesByNewest } from '../utils/messages'
import styles from './DashboardPage.module.css'

export default function DashboardPage() {
  const { user, profile } = useAuth()
  const navigate = useNavigate()
  const [announcements, setAnnouncements] = useState([])
  const [pendingLeave, setPendingLeave] = useState([])
  const [recentMessages, setRecentMessages] = useState([])
  const [unreadCount, setUnreadCount] = useState(0)
  const greeting = getGreeting()
  const canPostAnnouncements = canManageAnnouncements(profile)

  useEffect(() => {
    if (!user) return
    const q = query(
      collection(db, 'leaveRequests'),
      where('status', '==', 'pending'),
      orderBy('createdAt', 'desc'),
      limit(3)
    )
    const unsub = onSnapshot(q, snap => setPendingLeave(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
    return unsub
  }, [user])

  useEffect(() => {
    if (!user) return

    const readMap = profile?.preferences?.lastReadByRoom || {}
    let publicMessages = []
    let privateMessages = []

    function syncUnread() {
      const allMessages = mergeMessagesByNewest(publicMessages, privateMessages)
        .filter(message => message.roomId !== ANNOUNCEMENTS_ROOM_ID)

      const unread = allMessages.filter(message => {
        if (!message?.id || message.senderId === user.uid) return false
        const roomId = String(message.roomId || '')
        if (!roomId) return false
        const readAtMs = getReadTimestampMs(readMap[roomId])
        return getMessageTimestampMs(message.createdAt) > readAtMs
      })

      setUnreadCount(unread.length)
    }

    const publicRoomIds = CHANNELS
      .filter(channel => channel.id !== 'announcements')
      .map(channel => `channel_${channel.id}`)

    const publicQuery = query(
      collection(db, 'messages'),
      where('roomType', '==', 'channel'),
      orderBy('createdAt', 'desc'),
      limit(40)
    )

    const privateQuery = query(
      collection(db, 'messages'),
      where('memberIds', 'array-contains', user.uid),
      orderBy('createdAt', 'desc'),
      limit(40)
    )

    const unsubPublic = onSnapshot(publicQuery, snap => {
      publicMessages = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(message => publicRoomIds.includes(String(message.roomId || '')))
      syncUnread()
    })

    const unsubPrivate = onSnapshot(privateQuery, snap => {
      privateMessages = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(message => {
          if (message.roomType === 'group') return true
          if (message.roomType !== 'dm') return false
          return String(message.roomId || '') === getDmId(user.uid, message.senderId)
            || Array.isArray(message.memberIds) && message.memberIds.includes(user.uid)
        })
      syncUnread()
    })

    return () => {
      unsubPublic()
      unsubPrivate()
    }
  }, [profile?.preferences?.lastReadByRoom, user])

  useEffect(() => {
    if (!user) return
    let publicMessages = []
    let privateMessages = []

    function syncMessages() {
      const nextMessages = mergeMessagesByNewest(publicMessages, privateMessages)
        .filter(message => message.roomId !== ANNOUNCEMENTS_ROOM_ID)
        .slice(0, 4)
      setRecentMessages(nextMessages)
    }

    const publicQuery = query(
      collection(db, 'messages'),
      where('roomType', '==', 'channel'),
      orderBy('createdAt', 'desc'),
      limit(12)
    )

    const privateQuery = query(
      collection(db, 'messages'),
      where('memberIds', 'array-contains', user.uid),
      orderBy('createdAt', 'desc'),
      limit(12)
    )

    const unsubPublic = onSnapshot(publicQuery, snap => {
      publicMessages = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      syncMessages()
    })

    const unsubPrivate = onSnapshot(privateQuery, snap => {
      privateMessages = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      syncMessages()
    })

    return () => {
      unsubPublic()
      unsubPrivate()
    }
  }, [user])

  useEffect(() => {
    if (!user) return
    const q = query(
      collection(db, 'messages'),
      where('roomType', '==', 'channel'),
      where('roomId', '==', ANNOUNCEMENTS_ROOM_ID),
      orderBy('createdAt', 'asc'),
      limitToLast(4)
    )
    const unsub = onSnapshot(q, snap => {
      const nextAnnouncements = snap.docs.map(d => ({ id: d.id, ...d.data() })).reverse()
      setAnnouncements(nextAnnouncements)
    })
    return unsub
  }, [user])

  async function handleAnnouncementReaction(announcement, reaction) {
    if (!user) return

    const likedBy = Array.isArray(announcement?.likedBy) ? announcement.likedBy : []
    const dislikedBy = Array.isArray(announcement?.dislikedBy) ? announcement.dislikedBy : []
    const hasLike = likedBy.includes(user.uid)
    const hasDislike = dislikedBy.includes(user.uid)
    const updates = {}

    if (reaction === 'like') {
      updates.likedBy = hasLike ? arrayRemove(user.uid) : arrayUnion(user.uid)
      if (hasDislike) updates.dislikedBy = arrayRemove(user.uid)
    } else {
      updates.dislikedBy = hasDislike ? arrayRemove(user.uid) : arrayUnion(user.uid)
      if (hasLike) updates.likedBy = arrayRemove(user.uid)
    }

    await updateDoc(doc(db, 'messages', announcement.id), updates)
  }

  return (
    <div className={styles.page}>
      <div className={styles.greet}>
        {greeting}, <strong>{firstName(profile?.displayName) || 'there'}</strong>{' '}
        <span role="img" aria-label="wave">👋</span>
        <span className={styles.date}>
          {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
        </span>
      </div>

      <div className={styles.stats}>
        {[
          { lbl: 'Leave balance', val: toDisplayText(getLeaveRemaining(profile?.leaveBalance, profile?.leaveTaken), '-'), sub: 'days remaining' },
          { lbl: 'Pending approvals', val: String(pendingLeave.length), sub: 'need your action', accent: 'var(--amber-dark)' },
          { lbl: 'Messages', val: String(unreadCount), sub: 'unread', accent: 'var(--purple)' },
        ].map((stat, index) => (
          <div key={index} className="stat-card">
            <div className="lbl">{stat.lbl}</div>
            <div className="val" style={stat.accent ? { color: stat.accent } : {}}>{stat.val}</div>
            <div className="sub">{stat.sub}</div>
          </div>
        ))}
      </div>

      <div className={styles.grid}>
        <div>
          <div className={styles.sectionRow}>
            <span className={styles.sectionTitle}>Announcements</span>
            <button
              className={'btn secondary sm ' + styles.sectionAction}
              onClick={() => navigate('/chat', { state: { room: 'announcements' } })}>
              {canPostAnnouncements ? 'Manage' : 'Open channel'}
            </button>
          </div>
          <div className={styles.annList}>
            {announcements.length === 0 && (
              <div className={styles.emptyCard}>
                <div className={styles.emptyTitle}>No announcements yet</div>
                <div className={styles.emptySub}>
                  {canPostAnnouncements
                    ? 'Open the announcements channel to publish the first update.'
                    : 'Managers and admins will post company updates here.'}
                </div>
              </div>
            )}
            {announcements.map(announcement => (
              <AnnouncementCard
                key={announcement.id}
                announcement={announcement}
                currentUid={user?.uid}
                onReact={handleAnnouncementReaction}
                compact
              />
            ))}
          </div>
        </div>

        <div>
          <div className={styles.sectionRow}>
            <span className={styles.sectionTitle}>Pending leave</span>
            <button className={'btn secondary sm ' + styles.sectionAction} onClick={() => navigate('/leave')}>Manage</button>
          </div>
          <div className={styles.list}>
            {pendingLeave.length === 0 && <div className={styles.empty}>No pending requests</div>}
            {pendingLeave.map(req => (
              <LeaveCard key={req.id} req={req} />
            ))}
          </div>
        </div>

        <div>
          <div className={styles.sectionRow}>
            <span className={styles.sectionTitle}>Recent messages</span>
            <button className={'btn secondary sm ' + styles.sectionAction} onClick={() => navigate('/chat')}>Open</button>
          </div>
          <div className={styles.list}>
            {recentMessages.length === 0 && <div className={styles.empty}>No recent messages</div>}
            {recentMessages.map(msg => (
              <MessagePreview key={msg.id} msg={msg} currentUid={user?.uid} />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function LeaveCard({ req }) {
  const group = req.requesterMbti ? getMbtiGroup(req.requesterMbti) : null
  return (
    <div className={'card ' + styles.stackCard}>
      <div className={styles.infoRow}>
        <div
          className={styles.avatar}
          style={{
            background: group?.bg || 'var(--surface2)',
            color: group?.text || 'var(--text2)',
          }}>
          {getInitials(req.requesterName)}
        </div>
        <div className={styles.infoBody}>
          <div className={styles.titleLine}>
            {toDisplayText(req.requesterName, 'Unknown')}
            <span className="pill amber">Pending</span>
          </div>
          <div className={styles.metaLine}>
            {toDisplayText(req.type, 'Leave')} · {formatDateValue(req.startDate)} to {formatDateValue(req.endDate)}
          </div>
          <div className={styles.descLine}>
            {toDisplayText(req.description, 'No description')}
          </div>
        </div>
      </div>
    </div>
  )
}

function MessagePreview({ msg, currentUid }) {
  const isMe = msg.senderId === currentUid
  const group = msg.senderMbti ? getMbtiGroup(msg.senderMbti) : null
  const showMood = Boolean(msg.mood) && msg.showMoodOnMessages !== false
  const emoji = showMood ? getEmotionEmoji(msg.mood) : null

  return (
    <div className={'card ' + styles.messageCard}>
      <div
        className={styles.avatar + ' ' + styles.messageAvatar}
        style={{
          background: group?.bg || 'var(--surface2)',
          color: group?.text || 'var(--text2)',
        }}>
        {getInitials(msg.senderName)}
      </div>
      <div className={styles.messageBody}>
        <div className={styles.messageSender}>
          {isMe ? 'You' : toDisplayText(msg.senderName, 'Unknown')}
        </div>
        <div className={styles.messageText}>
          {toDisplayText(msg.text, '[empty message]')}
        </div>
      </div>
      {showMood && <span className={'mood-badge ' + styles.messageMood}>{emoji}</span>}
    </div>
  )
}

function getGreeting() {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

function toDisplayText(value, fallback = '') {
  if (value == null || value === '') return fallback
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (value?.toDate) return value.toDate().toLocaleDateString('en-GB')
  return fallback || String(value)
}

function formatDateValue(value) {
  if (value?.toDate) return value.toDate().toLocaleDateString('en-GB')
  return toDisplayText(value, '-')
}

function getInitials(value) {
  return toDisplayText(value, '?')
    .split(' ')
    .map(part => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

function firstName(value) {
  return toDisplayText(value, '').split(' ')[0]
}

function getReadTimestampMs(value) {
  if (!value) return 0
  const parsed = Date.parse(String(value))
  return Number.isFinite(parsed) ? parsed : 0
}
