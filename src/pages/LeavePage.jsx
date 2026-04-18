import { useEffect, useState } from 'react'
import { addDoc, collection, doc, getDoc, onSnapshot, orderBy, query, serverTimestamp, updateDoc, where, writeBatch } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../hooks/useAuth'
import { getMbtiGroup } from '../utils/ai'
import { formatDateValue, getInitials, getLeaveRemaining, getLeaveUsed, toCountValue, toDisplayText } from '../utils/display'
import { getManagerAdminUserIds, notifyUsers } from '../utils/notifications'
import { canReviewLeave } from '../utils/roles'
import styles from './LeavePage.module.css'

const LEAVE_TYPES = ['Sick leave', 'Annual leave', 'Compassionate leave', 'Unpaid leave', 'Maternity/Paternity', 'Study leave']

export default function LeavePage() {
  const { user, profile } = useAuth()
  const [myRequests, setMyRequests] = useState([])
  const [teamRequests, setTeamRequests] = useState([])
  const [activeTab, setActiveTab] = useState('submit')
  const [form, setForm] = useState({
    type: 'Annual leave',
    startDate: '',
    endDate: '',
    startTime: '',
    endTime: '',
    description: '',
    partialDay: false,
  })
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [actionError, setActionError] = useState('')
  const [actingOnId, setActingOnId] = useState('')
  const canApproveLeave = canReviewLeave(profile)

  useEffect(() => {
    if (!user) return
    setLoadError('')
    const q = query(collection(db, 'leaveRequests'), where('requesterId', '==', user.uid), orderBy('createdAt', 'desc'))
    return onSnapshot(
      q,
      snap => setMyRequests(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      err => {
        console.error('Leave request query failed', err)
        setLoadError(getLoadError(err))
      }
    )
  }, [user])

  useEffect(() => {
    if (!user || !canApproveLeave) {
      setTeamRequests([])
      return
    }
    setLoadError('')
    const q = query(collection(db, 'leaveRequests'), where('status', '==', 'pending'), orderBy('createdAt', 'desc'))
    return onSnapshot(
      q,
      snap => setTeamRequests(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      err => {
        console.error('Pending leave query failed', err)
        setLoadError(getLoadError(err))
      }
    )
  }, [user, canApproveLeave])

  useEffect(() => {
    if (!canApproveLeave && activeTab === 'team') {
      setActiveTab('submit')
    }
  }, [activeTab, canApproveLeave])

  function calcDays() {
    if (!form.startDate || !form.endDate) return null
    const diff = (new Date(form.endDate) - new Date(form.startDate)) / 86400000 + 1
    return diff > 0 ? diff : null
  }

  async function notifyUsersSafely(userIds, notification) {
    try {
      await notifyUsers(db, userIds, notification)
    } catch (err) {
      console.error('Notification write failed', err)
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.startDate || !form.endDate || !user) return

    setSubmitting(true)
    try {
      const days = calcDays()
      const requesterName = toDisplayText(profile?.displayName, user.email || 'Employee')
      const leaveType = form.type
      await addDoc(collection(db, 'leaveRequests'), {
        requesterId: user.uid,
        requesterName,
        requesterMbti: typeof profile?.mbti === 'string' ? profile.mbti : null,
        type: leaveType,
        startDate: form.startDate,
        endDate: form.endDate,
        startTime: form.partialDay ? form.startTime : null,
        endTime: form.partialDay ? form.endTime : null,
        partialDay: form.partialDay,
        description: form.description,
        days: days || 1,
        status: 'pending',
        createdAt: serverTimestamp(),
      })

      const reviewers = await getManagerAdminUserIds(db)
      await notifyUsersSafely(reviewers, {
        type: 'leave',
        text: `${requesterName} submitted a ${leaveType.toLowerCase()} request`,
        sub: `${form.startDate} to ${form.endDate}`,
      })

      setSuccess(true)
      setForm({
        type: 'Annual leave',
        startDate: '',
        endDate: '',
        startTime: '',
        endTime: '',
        description: '',
        partialDay: false,
      })
      setTimeout(() => setSuccess(false), 3000)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleApprove(request) {
    if (!canApproveLeave || !user) return
    setActionError('')
    setActingOnId(request.id)
    try {
      await reviewLeaveRequest(request, 'approved')
      await notifyUsersSafely([request.requesterId], {
        type: 'leave',
        text: `Your ${toDisplayText(request.type, 'leave').toLowerCase()} request was approved`,
        sub: `Reviewed by ${toDisplayText(profile?.displayName, user.email || 'manager')}`,
      })
    } catch (err) {
      console.error('Approve leave failed', err)
      setActionError(getApprovalError(err))
    } finally {
      setActingOnId('')
    }
  }

  async function handleDeny(request) {
    if (!canApproveLeave || !user) return
    setActionError('')
    setActingOnId(request.id)
    try {
      await reviewLeaveRequest(request, 'denied')
      await notifyUsersSafely([request.requesterId], {
        type: 'leave',
        text: `Your ${toDisplayText(request.type, 'leave').toLowerCase()} request was denied`,
        sub: `Reviewed by ${toDisplayText(profile?.displayName, user.email || 'manager')}`,
      })
    } catch (err) {
      console.error('Deny leave failed', err)
      setActionError(getApprovalError(err))
    } finally {
      setActingOnId('')
    }
  }

  async function reviewLeaveRequest(request, nextStatus) {
    const requestRef = doc(db, 'leaveRequests', request.id)
    const requestSnap = await getDoc(requestRef)
    if (!requestSnap.exists()) throw createLeaveActionError('not-found')

    const currentRequest = requestSnap.data()
    const currentStatus = toDisplayText(currentRequest?.status, 'pending').toLowerCase()
    if (currentStatus !== 'pending') throw createLeaveActionError('already-reviewed')

    const reviewUpdate = {
      status: nextStatus,
      reviewedBy: user.uid,
      reviewedAt: serverTimestamp(),
    }

    if (nextStatus !== 'approved') {
      await updateDoc(requestRef, reviewUpdate)
      return
    }

    const requesterId = toDisplayText(currentRequest?.requesterId)
    if (!requesterId) throw createLeaveActionError('requester-missing')

    const requesterRef = doc(db, 'users', requesterId)
    const requesterSnap = await getDoc(requesterRef)
    if (!requesterSnap.exists()) throw createLeaveActionError('requester-missing')

    const requestDays = normalizeLeaveDays(currentRequest?.days)
    const requesterUpdate = buildRequesterLeaveUpdate(requesterSnap.data(), requestDays)

    const batch = writeBatch(db)
    batch.update(requestRef, reviewUpdate)
    batch.update(requesterRef, requesterUpdate)
    await batch.commit()
  }

  const days = calcDays()
  const tabs = [
    ['submit', 'Submit request'],
    ['mine', 'My requests'],
    ...(canApproveLeave ? [['team', 'Pending approvals']] : []),
  ]

  return (
    <div className={styles.page}>
      <div className={styles.tabs}>
        {tabs.map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={styles.tab + (activeTab === key ? ' ' + styles.tabActive : '')}
            onClick={() => setActiveTab(key)}>
            {label}
          </button>
        ))}
      </div>

      {activeTab === 'submit' && (
        <div className={styles.formWrap}>
          <div className="card" style={{ maxWidth: 540 }}>
            <div className={styles.formTitle}>New leave request</div>
            {success && <div className={styles.successMsg}>Request submitted successfully</div>}

            <form onSubmit={handleSubmit} className={styles.form}>
              <div className={styles.field}>
                <label>Leave type</label>
                <select className="input" value={form.type} onChange={e => setForm(current => ({ ...current, type: e.target.value }))}>
                  {LEAVE_TYPES.map(type => <option key={type}>{type}</option>)}
                </select>
              </div>

              <div className={styles.row2}>
                <div className={styles.field}>
                  <label>Start date</label>
                  <input className="input" type="date" value={form.startDate} onChange={e => setForm(current => ({ ...current, startDate: e.target.value }))} required />
                </div>
                <div className={styles.field}>
                  <label>End date</label>
                  <input className="input" type="date" value={form.endDate} onChange={e => setForm(current => ({ ...current, endDate: e.target.value }))} required />
                </div>
              </div>

              <label className={styles.checkRow}>
                <input type="checkbox" checked={form.partialDay} onChange={e => setForm(current => ({ ...current, partialDay: e.target.checked }))} />
                Partial day
              </label>

              {form.partialDay && (
                <div className={styles.row2}>
                  <div className={styles.field}>
                    <label>From</label>
                    <input className="input" type="time" value={form.startTime} onChange={e => setForm(current => ({ ...current, startTime: e.target.value }))} />
                  </div>
                  <div className={styles.field}>
                    <label>Until</label>
                    <input className="input" type="time" value={form.endTime} onChange={e => setForm(current => ({ ...current, endTime: e.target.value }))} />
                  </div>
                </div>
              )}

              <div className={styles.field}>
                <label>Description</label>
                <textarea
                  className="input"
                  rows={3}
                  style={{ resize: 'none' }}
                  value={form.description}
                  placeholder="Brief reason for leave..."
                  onChange={e => setForm(current => ({ ...current, description: e.target.value }))}
                />
              </div>

              <div className={styles.formFooter}>
                {days && <span className={styles.daysCalc}>{days} day{days !== 1 ? 's' : ''} calculated</span>}
                <button className="btn" type="submit" disabled={submitting}>
                  {submitting ? <span className="spinner" /> : 'Submit request'}
                </button>
              </div>
            </form>
          </div>

          <div style={{ maxWidth: 540 }}>
            <div className={styles.balanceCard}>
              <div className={styles.balanceItem}>
                <div className={styles.balanceVal}>{toCountValue(getLeaveRemaining(profile?.leaveBalance, profile?.leaveTaken), '-')}</div>
                <div className={styles.balanceLbl}>Days remaining</div>
              </div>
              <div className={styles.balanceItem}>
                <div className={styles.balanceVal}>{toCountValue(getLeaveUsed(profile?.leaveBalance, profile?.leaveTaken), '0')}</div>
                <div className={styles.balanceLbl}>Days taken (YTD)</div>
              </div>
              <div className={styles.balanceItem}>
                <div className={styles.balanceVal}>{String(myRequests.filter(request => request.status === 'pending').length)}</div>
                <div className={styles.balanceLbl}>Pending</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'mine' && (
        <div className={styles.listWrap}>
          {loadError && <div className={styles.errorMsg}>{loadError}</div>}
          {myRequests.length === 0 && <div className={styles.empty}>No leave requests yet</div>}
          {myRequests.map(request => <LeaveRow key={request.id} req={request} />)}
        </div>
      )}

      {activeTab === 'team' && canApproveLeave && (
        <div className={styles.listWrap}>
          <div className={styles.sectionHead}>Pending requests requiring manager or admin action</div>
          {loadError && <div className={styles.errorMsg}>{loadError}</div>}
          {actionError && <div className={styles.errorMsg}>{actionError}</div>}
          {teamRequests.length === 0 && <div className={styles.empty}>No pending requests</div>}
          {teamRequests.map(request => (
            <LeaveRow
              key={request.id}
              req={request}
              showActions
              busy={actingOnId === request.id}
              onApprove={() => handleApprove(request)}
              onDeny={() => handleDeny(request)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function LeaveRow({ req, showActions, onApprove, onDeny, busy }) {
  const group = getMbtiGroup(req?.requesterMbti)
  const status = toDisplayText(req?.status, 'pending').toLowerCase()
  const statusMap = { pending: 'amber', approved: 'green', denied: 'red' }
  const dayCount = typeof req?.days === 'number' && Number.isFinite(req.days) ? req.days : null
  const timeRange = req?.partialDay && req?.startTime
    ? `${toDisplayText(req.startTime, '')}${req?.endTime ? `-${toDisplayText(req.endTime, '')}` : ''}`
    : ''
  const metaParts = [
    `${toDisplayText(req?.type, 'Leave')} | ${formatDateValue(req?.startDate)} - ${formatDateValue(req?.endDate)}`,
    timeRange || null,
    dayCount != null ? `${dayCount} day${dayCount !== 1 ? 's' : ''}` : null,
  ].filter(Boolean)

  return (
    <div className="card" style={{ marginBottom: 9 }}>
      <div className={styles.leaveRowInner}>
        <div className={styles.leaveAvatar} style={{ background: group?.bg || 'var(--surface2)', color: group?.text || 'var(--text2)' }}>
          {getInitials(req?.requesterName)}
        </div>
        <div className={styles.leaveInfo}>
          <div className={styles.leaveName}>
            {toDisplayText(req?.requesterName, 'Unknown')}
            <span className={`pill ${statusMap[status] || 'amber'}`} style={{ marginLeft: 6, textTransform: 'capitalize' }}>{status}</span>
          </div>
          <div className={styles.leaveMeta}>{metaParts.join(' | ')}</div>
          {req?.description && <div className={styles.leaveDesc}>{toDisplayText(req.description)}</div>}
        </div>
        {showActions && status === 'pending' && (
          <div className={styles.leaveActions}>
            <button className="btn success sm" type="button" onClick={onApprove} disabled={busy}>{busy ? 'Saving...' : 'Approve'}</button>
            <button className="btn danger sm" type="button" onClick={onDeny} disabled={busy}>{busy ? 'Saving...' : 'Deny'}</button>
          </div>
        )}
      </div>
    </div>
  )
}

function getApprovalError(err) {
  if (err?.code === 'already-reviewed') {
    return 'This leave request has already been reviewed. Refresh the page to see its latest status.'
  }
  if (err?.code === 'not-found') {
    return 'This leave request no longer exists.'
  }
  if (err?.code === 'requester-missing') {
    return 'Approval failed because the requester profile is missing.'
  }
  if (err?.code === 'failed-precondition') {
    return 'Approval failed because the required Firestore index has not been deployed yet.'
  }
  if (err?.code === 'permission-denied') {
    return 'Approval failed. Your Firestore user profile role must contain "manager" or "admin", and the latest Firestore rules must be deployed.'
  }
  return 'Approval failed. Please try again.'
}

function getLoadError(err) {
  if (err?.code === 'failed-precondition') {
    return 'Leave requests could not be loaded because the required Firestore indexes have not been deployed yet.'
  }
  if (err?.code === 'permission-denied') {
    return 'Leave requests could not be loaded because your Firestore rules or role permissions do not allow this query.'
  }
  return 'Leave requests could not be loaded right now. Please try again.'
}

function createLeaveActionError(code) {
  const err = new Error(code)
  err.code = code
  return err
}

function normalizeCounter(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function normalizeLeaveDays(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value
  return 1
}

function buildRequesterLeaveUpdate(requester, requestDays) {
  const nextTaken = normalizeCounter(requester?.leaveTaken) + requestDays
  const leaveBalance = requester?.leaveBalance

  if (typeof leaveBalance === 'number' && Number.isFinite(leaveBalance)) {
    return {
      leaveTaken: nextTaken,
      leaveBalance: Math.max(leaveBalance - requestDays, 0),
    }
  }

  const annual = normalizeOptionalCounter(leaveBalance?.annual)
  const used = normalizeOptionalCounter(leaveBalance?.used)
  const remaining = normalizeOptionalCounter(leaveBalance?.remaining)

  if (annual != null || used != null || remaining != null) {
    const currentUsed = used ?? (
      annual != null && remaining != null
        ? Math.max(annual - remaining, 0)
        : normalizeCounter(requester?.leaveTaken)
    )

    const nextUpdate = { leaveTaken: nextTaken }
    nextUpdate['leaveBalance.used'] = currentUsed + requestDays

    if (remaining != null) {
      nextUpdate['leaveBalance.remaining'] = Math.max(remaining - requestDays, 0)
    }

    return nextUpdate
  }

  return { leaveTaken: nextTaken }
}

function normalizeOptionalCounter(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
