import { useEffect, useMemo, useState } from 'react'
import { collection, getDocs, orderBy, query, where } from 'firebase/firestore'
import { db } from '../firebase'
import { getEmotionEmoji } from '../utils/ai'
import { useAuth } from '../hooks/useAuth'
import { isAnnouncementMessage } from '../utils/chat'
import { toDisplayText } from '../utils/display'
import { getMessageTimestampMs, mergeMessagesByNewest } from '../utils/messages'
import { formatCurrency } from '../utils/payroll'
import { canReviewLeave, canViewAllPayroll, isManagerOrAdmin } from '../utils/roles'
import styles from './ReportsPage.module.css'

const DAY_MS = 24 * 60 * 60 * 1000
const RANGE_OPTIONS = [
  { key: '30', label: '30 days', days: 30 },
  { key: '90', label: '90 days', days: 90 },
  { key: '365', label: '12 months', days: 365 },
]
const POSITIVE_MOODS = new Set(['joy', 'excitement', 'gratitude', 'love', 'admiration', 'amusement', 'caring', 'approval', 'optimism', 'pride', 'relief'])
const NEGATIVE_MOODS = new Set(['anger', 'sadness', 'fear', 'disgust', 'grief', 'disappointment', 'nervousness', 'remorse', 'annoyance', 'disapproval', 'embarrassment'])
const LEAVE_STATUS_COLORS = {
  approved: '#3e7d63',
  pending: '#8b7b3f',
  denied: '#e24b4a',
}
const MOOD_SERIES = [
  { key: 'positive', label: 'Positive', color: '#3e7d63' },
  { key: 'neutral', label: 'Neutral', color: '#70817a' },
  { key: 'negative', label: 'Negative', color: '#e24b4a' },
]

export default function ReportsPage() {
  const { user, profile } = useAuth()
  const canSeeLeaveDetails = canReviewLeave(profile)
  const [rangeKey, setRangeKey] = useState('90')
  const [departmentFilter, setDepartmentFilter] = useState('all')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [leaveData, setLeaveData] = useState([])
  const [userData, setUserData] = useState([])
  const [messageData, setMessageData] = useState([])
  const [payrollData, setPayrollData] = useState([])

  useEffect(() => {
    if (!user) return

    async function loadData() {
      setLoading(true)
      setLoadError('')

      try {
        const leavePromise = getDocs(collection(db, 'leaveRequests'))
        const usersPromise = getDocs(collection(db, 'users'))
        const messagesPromise = isManagerOrAdmin(profile?.role)
          ? getDocs(collection(db, 'messages')).then(snapshot => snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() })))
          : Promise.all([
              getDocs(query(collection(db, 'messages'), where('roomType', '==', 'channel'))),
              getDocs(query(collection(db, 'messages'), where('memberIds', 'array-contains', user.uid))),
            ]).then(([publicSnap, privateSnap]) =>
              mergeMessagesByNewest(
                publicSnap.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() })),
                privateSnap.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }))
              )
            )
        const payrollPromise = canViewAllPayroll(profile)
          ? getDocs(query(collection(db, 'payrollEntries'), orderBy('payDate', 'desc'))).then(snapshot => snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() })))
          : getDocs(
              query(
                collection(db, 'payrollEntries'),
                where('employeeId', '==', user.uid),
                where('status', '==', 'published'),
                orderBy('payDate', 'desc')
              )
            ).then(snapshot => snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() })))

        const [leaveSnap, usersSnap, messages, payroll] = await Promise.all([
          leavePromise,
          usersPromise,
          messagesPromise,
          payrollPromise,
        ])

        setLeaveData(leaveSnap.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() })))
        setUserData(usersSnap.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() })))
        setMessageData(messages)
        setPayrollData(payroll)
      } catch (err) {
        console.error('Reports data load failed', err)
        setLoadError(getReportsLoadError(err))
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [profile, user])

  const rangeDays = Number(rangeKey)
  const cutoffMs = useMemo(() => Date.now() - rangeDays * DAY_MS, [rangeDays])
  const userMap = useMemo(() => new Map(
    userData
      .map(userRecord => [getUserId(userRecord), userRecord])
      .filter(([userId]) => Boolean(userId))
  ), [userData])

  const departmentOptions = useMemo(() => {
    return Array.from(new Set(
      userData
        .map(userRecord => String(userRecord.department || '').trim())
        .filter(Boolean)
    )).sort((left, right) => left.localeCompare(right))
  }, [userData])

  const reportData = useMemo(() => {
    const decoratedLeave = leaveData
      .map(request => decorateLeaveRequest(request, userMap))
      .filter(request => isInRange(request.timestampMs, cutoffMs) && matchesDepartment(request.department, departmentFilter))
      .sort((left, right) => right.timestampMs - left.timestampMs)

    const decoratedMessages = messageData
      .map(message => decorateMessage(message, userMap))
      .filter(message => isInRange(message.timestampMs, cutoffMs) && matchesDepartment(message.department, departmentFilter))
      .sort((left, right) => right.timestampMs - left.timestampMs)

    const decoratedPayroll = payrollData
      .map(entry => decoratePayrollEntry(entry, userMap))
      .filter(entry => isInRange(entry.timestampMs, cutoffMs) && matchesDepartment(entry.department, departmentFilter))
      .sort((left, right) => right.timestampMs - left.timestampMs)

    return {
      leave: decoratedLeave,
      messages: decoratedMessages,
      chatMessages: decoratedMessages.filter(message => !isAnnouncementMessage(message)),
      moodMessages: decoratedMessages.filter(message => !isAnnouncementMessage(message) && Boolean(message.mood)),
      announcements: decoratedMessages.filter(message => isAnnouncementMessage(message)),
      payroll: decoratedPayroll,
      publishedPayroll: decoratedPayroll.filter(entry => String(entry.status || '').toLowerCase() === 'published'),
    }
  }, [cutoffMs, departmentFilter, leaveData, messageData, payrollData, userMap])

  const segments = useMemo(() => createTimeSegments(rangeDays), [rangeDays])
  const leaveSeries = useMemo(() => buildLeaveSeries(reportData.leave, segments), [reportData.leave, segments])
  const moodSeries = useMemo(() => buildMoodSeries(reportData.moodMessages, segments), [reportData.moodMessages, segments])
  const payrollSeries = useMemo(() => buildPayrollSeries(reportData.publishedPayroll, segments), [reportData.publishedPayroll, segments])
  const heatmapRows = useMemo(() => buildHeatmapRows(reportData.chatMessages), [reportData.chatMessages])
  const topMoods = useMemo(() => buildTopMoods(reportData.moodMessages), [reportData.moodMessages])
  const departmentRows = useMemo(() => buildDepartmentRows(reportData.leave, reportData.chatMessages, reportData.publishedPayroll), [reportData.chatMessages, reportData.leave, reportData.publishedPayroll])

  const totalLeave = reportData.leave.length
  const approvedCount = reportData.leave.filter(request => request.status === 'approved').length
  const approvalRate = totalLeave ? Math.round(approvedCount / totalLeave * 100) : 0
  const reviewHours = calculateMedianReviewHours(reportData.leave)
  const totalMessages = reportData.chatMessages.length
  const totalAnnouncements = reportData.announcements.length
  const totalPayrollNet = sumNumericField(reportData.publishedPayroll, 'netPay')
  const totalPayrollGross = sumNumericField(reportData.publishedPayroll, 'grossPay')
  const filteredRangeLabel = RANGE_OPTIONS.find(option => option.key === rangeKey)?.label || '90 days'
  const selectedDepartmentLabel = departmentFilter === 'all' ? 'All departments' : departmentFilter

  if (loading) {
    return (
      <div className={styles.loadingPage}>
        <span className="spinner" />
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <div className={`card ${styles.hero}`}>
        <div className={styles.heroTop}>
          <div>
            <div className="section-label">Reports</div>
            <h1 className={styles.heroTitle}>People analytics</h1>
            <p className={styles.heroSub}>
              Operational patterns across leave, communication, and payroll. The charts below react to the selected date window and department filter.
            </p>
          </div>

          <div className={styles.filterPanel}>
            <div className={styles.filterLabel}>Time range</div>
            <div className={styles.rangeButtons}>
              {RANGE_OPTIONS.map(option => (
                <button
                  key={option.key}
                  type="button"
                  className={styles.rangeBtn + (rangeKey === option.key ? ' ' + styles.rangeBtnActive : '')}
                  onClick={() => setRangeKey(option.key)}>
                  {option.label}
                </button>
              ))}
            </div>

            <div className={styles.selectWrap}>
              <label htmlFor="reports-department" className={styles.filterLabel}>Department</label>
              <select
                id="reports-department"
                className="input"
                value={departmentFilter}
                onChange={e => setDepartmentFilter(e.target.value)}>
                <option value="all">All departments</option>
                {departmentOptions.map(department => (
                  <option key={department} value={department}>{department}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className={styles.heroMeta}>
          <span>{filteredRangeLabel}</span>
          <span>{selectedDepartmentLabel}</span>
          <span>{canViewAllPayroll(profile) ? 'Company-wide payroll analytics' : 'Personal payroll analytics'}</span>
        </div>
      </div>

      {loadError && <div className={styles.errorBanner}>{loadError}</div>}

      <div className={styles.kpiGrid}>
        <KpiCard label="Leave requests" value={String(totalLeave)} meta={`${approvedCount} approved in range`} accent="var(--purple)" />
        <KpiCard label="Approval rate" value={`${approvalRate}%`} meta="Approved vs total leave requests" accent="var(--teal)" />
        <KpiCard label="Median review" value={formatDuration(reviewHours)} meta="Time from submit to approve or deny" accent="var(--amber-dark)" />
        <KpiCard label="Messages" value={String(totalMessages)} meta={`${totalAnnouncements} announcement posts`} accent="var(--blue)" />
        <KpiCard label="Net payroll" value={formatCurrency(totalPayrollNet)} meta={`Gross ${formatCurrency(totalPayrollGross)}`} accent="var(--coral)" />
      </div>

      <div className={styles.mainGrid}>
        <section className={`card ${styles.card} ${styles.spanSeven}`}>
          <CardHeader
            title="Leave flow"
            subtitle="Stacked request volume across the selected time window."
          />
          <div className={styles.legendRow}>
            {Object.entries(LEAVE_STATUS_COLORS).map(([status, color]) => (
              <LegendItem key={status} color={color} label={status} />
            ))}
          </div>
          {leaveSeries.some(item => item.total > 0) ? (
            <div className={styles.columnChart}>
              {leaveSeries.map(item => (
                <div key={item.label} className={styles.columnWrap}>
                  <div className={styles.columnTrack}>
                    <div
                      className={styles.columnStack}
                      style={{ height: `${getScaledHeight(item.total, getMaxValue(leaveSeries.map(entry => entry.total)))}%` }}>
                      {item.total > 0 ? (
                        <>
                          <div className={styles.segmentApproved} style={{ height: `${item.approved / item.total * 100}%` }} />
                          <div className={styles.segmentPending} style={{ height: `${item.pending / item.total * 100}%` }} />
                          <div className={styles.segmentDenied} style={{ height: `${item.denied / item.total * 100}%` }} />
                        </>
                      ) : (
                        <div className={styles.segmentEmpty} />
                      )}
                    </div>
                  </div>
                  <div className={styles.columnValue}>{item.total}</div>
                  <div className={styles.columnLabel}>{item.label}</div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState text="No leave requests match the current filters." />
          )}
        </section>

        <section className={`card ${styles.card} ${styles.spanFive}`}>
          <CardHeader
            title="Mood trend"
            subtitle="Positive, neutral, and negative message tone over time."
          />
          {reportData.moodMessages.length > 0 ? (
            <>
              <LineChart data={moodSeries} />
              <div className={styles.legendRow}>
                {MOOD_SERIES.map(series => (
                  <LegendItem key={series.key} color={series.color} label={series.label} />
                ))}
              </div>
              <div className={styles.moodChips}>
                {topMoods.map(mood => (
                  <div key={mood.label} className={styles.moodChip}>
                    <span>{getEmotionEmoji(mood.label)}</span>
                    <span>{mood.label}</span>
                    <strong>{mood.count}</strong>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <EmptyState text="No mood-tagged messages are available for this window." />
          )}
        </section>

        <section className={`card ${styles.card} ${styles.spanFull}`}>
          <CardHeader
            title="Message activity heatmap"
            subtitle="Message density by weekday and hour. Darker cells mean more activity."
          />
          {reportData.chatMessages.length > 0 ? (
            <Heatmap rows={heatmapRows} />
          ) : (
            <EmptyState text="No chat activity is available for this time range." />
          )}
        </section>

        <section className={`card ${styles.card} ${styles.spanFive}`}>
          <CardHeader
            title={departmentFilter === 'all' ? 'Department pulse' : `${departmentFilter} pulse`}
            subtitle="Operational volume by department using leave, messaging, and published payroll totals."
          />
          {departmentRows.length > 0 ? (
            <div className={styles.departmentList}>
              {departmentRows.map(row => (
                <DepartmentRow
                  key={row.name}
                  row={row}
                  maxLeave={getMaxValue(departmentRows.map(item => item.leaveCount))}
                  maxMessages={getMaxValue(departmentRows.map(item => item.messageCount))}
                />
              ))}
            </div>
          ) : (
            <EmptyState text="No department-level data matches the current filters." />
          )}
        </section>

        <section className={`card ${styles.card} ${styles.spanSeven}`}>
          <CardHeader
            title={canViewAllPayroll(profile) ? 'Payroll trend' : 'My payroll trend'}
            subtitle="Published payroll totals over the selected window."
          />
          {payrollSeries.some(item => item.total > 0) ? (
            <div className={styles.payrollChart}>
              {payrollSeries.map(item => (
                <div key={item.label} className={styles.payrollColumn}>
                  <div className={styles.payrollTrack}>
                    <div
                      className={styles.payrollBar}
                      style={{ height: `${getScaledHeight(item.total, getMaxValue(payrollSeries.map(entry => entry.total)))}%` }}
                    />
                  </div>
                  <div className={styles.payrollValue}>{formatCompactCurrency(item.total)}</div>
                  <div className={styles.columnLabel}>{item.label}</div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState text="No published payroll records fall inside the current filters." />
          )}
        </section>

        {canSeeLeaveDetails && (
          <section className={`card ${styles.card} ${styles.spanFull}`}>
            <CardHeader
              title="Filtered leave detail"
              subtitle="Latest leave requests behind the charts so the page stays actionable, not just decorative."
            />
            {reportData.leave.length > 0 ? (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Employee</th>
                      <th>Department</th>
                      <th>Leave type</th>
                      <th>Dates</th>
                      <th>Days</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reportData.leave.slice(0, 10).map(request => (
                      <tr key={request.id}>
                        <td>
                          <div className={styles.tablePrimary}>{request.requesterName}</div>
                          <div className={styles.tableSecondary}>{formatFullDate(request.timestampMs)}</div>
                        </td>
                        <td>{request.department}</td>
                        <td>{request.type}</td>
                        <td>{request.dateLabel}</td>
                        <td>{request.days}</td>
                        <td>
                          <span className={`pill ${getLeaveStatusPill(request.status)}`}>
                            {request.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState text="No leave records are available for the selected filters." />
            )}
          </section>
        )}
      </div>
    </div>
  )
}

function KpiCard({ label, value, meta, accent }) {
  return (
    <div className={`stat-card ${styles.kpiCard}`}>
      <div className="lbl">{label}</div>
      <div className={styles.kpiValue} style={{ color: accent }}>{value}</div>
      <div className="sub">{meta}</div>
    </div>
  )
}

function CardHeader({ title, subtitle }) {
  return (
    <div className={styles.cardHeader}>
      <div>
        <div className="section-label">{title}</div>
        <div className={styles.cardTitle}>{title}</div>
      </div>
      <div className={styles.cardSubtitle}>{subtitle}</div>
    </div>
  )
}

function LegendItem({ color, label }) {
  return (
    <div className={styles.legendItem}>
      <span className={styles.legendDot} style={{ background: color }} />
      <span>{label}</span>
    </div>
  )
}

function EmptyState({ text }) {
  return <div className={styles.emptyState}>{text}</div>
}

function LineChart({ data }) {
  const width = 480
  const height = 180
  const padding = 22
  const innerWidth = width - padding * 2
  const innerHeight = height - padding * 2
  const maxValue = Math.max(1, ...data.flatMap(point => [point.positive, point.neutral, point.negative]))
  const gridValues = [0.25, 0.5, 0.75, 1]

  return (
    <div className={styles.lineChartWrap}>
      <svg viewBox={`0 0 ${width} ${height}`} className={styles.lineChart}>
        {gridValues.map(level => {
          const y = padding + innerHeight - innerHeight * level
          return (
            <line
              key={level}
              x1={padding}
              x2={width - padding}
              y1={y}
              y2={y}
              stroke="rgba(112, 129, 122, 0.14)"
              strokeDasharray="4 6"
            />
          )
        })}

        {MOOD_SERIES.map(series => (
          <polyline
            key={series.key}
            fill="none"
            stroke={series.color}
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            points={buildLinePoints(data, series.key, width, height, padding, maxValue)}
          />
        ))}

        {MOOD_SERIES.map(series => (
          data.map((point, index) => {
            const x = padding + (data.length <= 1 ? innerWidth / 2 : index * innerWidth / (data.length - 1))
            const y = padding + innerHeight - (point[series.key] / maxValue) * innerHeight
            return <circle key={`${series.key}-${point.label}`} cx={x} cy={y} r="4" fill={series.color} stroke="white" strokeWidth="2" />
          })
        ))}
      </svg>

      <div className={styles.lineLabels}>
        {data.map(point => (
          <span key={point.label}>{point.label}</span>
        ))}
      </div>
    </div>
  )
}

function Heatmap({ rows }) {
  const maxValue = Math.max(1, ...rows.flatMap(row => row.values))

  return (
    <div className={styles.heatmapWrap}>
      <div className={styles.heatmapHours}>
        <span>00</span>
        <span>06</span>
        <span>12</span>
        <span>18</span>
        <span>23</span>
      </div>

      <div className={styles.heatmapRows}>
        {rows.map(row => (
          <div key={row.label} className={styles.heatmapRow}>
            <div className={styles.heatmapDay}>{row.label}</div>
            <div className={styles.heatmapCells}>
              {row.values.map((value, index) => (
                <div
                  key={`${row.label}-${index}`}
                  className={styles.heatCell}
                  title={`${row.label} ${String(index).padStart(2, '0')}:00 - ${value} messages`}
                  style={{ background: getHeatColor(value, maxValue) }}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className={styles.heatLegend}>
        <span>Low</span>
        <div className={styles.heatLegendBar}>
          {[0.15, 0.35, 0.6, 0.85].map(step => (
            <span key={step} style={{ background: `rgba(112, 129, 122, ${step})` }} />
          ))}
        </div>
        <span>High</span>
      </div>
    </div>
  )
}

function DepartmentRow({ row, maxLeave, maxMessages }) {
  return (
    <div className={styles.departmentRow}>
      <div className={styles.departmentHeader}>
        <div className={styles.departmentName}>{row.name}</div>
        <div className={styles.departmentMeta}>{formatCurrency(row.payrollNet)} net payroll</div>
      </div>

      <div className={styles.metricBlock}>
        <div className={styles.metricLabel}>Leave</div>
        <div className={styles.metricTrack}>
          <div className={styles.metricFillLeave} style={{ width: `${getScaledWidth(row.leaveCount, maxLeave)}%` }} />
        </div>
        <div className={styles.metricValue}>{row.leaveCount}</div>
      </div>

      <div className={styles.metricBlock}>
        <div className={styles.metricLabel}>Messages</div>
        <div className={styles.metricTrack}>
          <div className={styles.metricFillMessages} style={{ width: `${getScaledWidth(row.messageCount, maxMessages)}%` }} />
        </div>
        <div className={styles.metricValue}>{row.messageCount}</div>
      </div>
    </div>
  )
}

function decorateLeaveRequest(request, userMap) {
  const requester = userMap.get(String(request.requesterId || ''))
  const days = typeof request.days === 'number' && Number.isFinite(request.days) ? request.days : 1

  return {
    ...request,
    requesterName: toDisplayText(request.requesterName, 'Unknown employee'),
    department: getDepartmentName(requester?.department),
    timestampMs: getLeaveTimestampMs(request),
    days,
    status: String(request.status || 'pending').toLowerCase(),
    type: toDisplayText(request.type, 'Leave'),
    dateLabel: `${toDisplayText(request.startDate, '-')}\u00A0to\u00A0${toDisplayText(request.endDate, '-')}`,
  }
}

function decorateMessage(message, userMap) {
  const sender = userMap.get(String(message.senderId || ''))
  return {
    ...message,
    department: getDepartmentName(message.senderDepartment || sender?.department),
    timestampMs: getMessageTimestampMs(message.createdAt),
    mood: String(message.mood || '').toLowerCase(),
  }
}

function decoratePayrollEntry(entry, userMap) {
  const employee = userMap.get(String(entry.employeeId || ''))
  return {
    ...entry,
    department: getDepartmentName(entry.employeeDepartment || employee?.department),
    timestampMs: getPayrollTimestampMs(entry),
    status: String(entry.status || 'draft').toLowerCase(),
  }
}

function getReportsLoadError(err) {
  if (err?.code === 'failed-precondition') {
    return 'Reports need a Firestore index that is not available yet.'
  }
  if (err?.code === 'permission-denied') {
    return 'Reports could not load because one of the analytics queries was blocked by Firestore rules.'
  }
  return 'Reports could not be loaded right now. Try again.'
}

function createTimeSegments(rangeDays) {
  const endMs = endOfDay(Date.now())
  const startMs = startOfDay(endMs - (rangeDays - 1) * DAY_MS)
  const segmentCount = rangeDays <= 45 ? 6 : rangeDays <= 120 ? 8 : 12
  const segmentSpan = Math.ceil((endMs - startMs + 1) / segmentCount)

  return Array.from({ length: segmentCount }, (_, index) => {
    const segmentStart = startMs + index * segmentSpan
    const segmentEnd = index === segmentCount - 1 ? endMs : Math.min(endMs, segmentStart + segmentSpan - 1)
    return {
      label: formatSegmentLabel(segmentStart, segmentEnd, rangeDays),
      startMs: segmentStart,
      endMs: segmentEnd,
    }
  })
}

function buildLeaveSeries(requests, segments) {
  return segments.map(segment => {
    const items = requests.filter(request => request.timestampMs >= segment.startMs && request.timestampMs <= segment.endMs)
    const approved = items.filter(request => request.status === 'approved').length
    const pending = items.filter(request => request.status === 'pending').length
    const denied = items.filter(request => request.status === 'denied').length

    return {
      label: segment.label,
      total: items.length,
      approved,
      pending,
      denied,
    }
  })
}

function buildMoodSeries(messages, segments) {
  return segments.map(segment => {
    const items = messages.filter(message => message.timestampMs >= segment.startMs && message.timestampMs <= segment.endMs)
    return {
      label: segment.label,
      positive: items.filter(message => POSITIVE_MOODS.has(message.mood)).length,
      neutral: items.filter(message => !POSITIVE_MOODS.has(message.mood) && !NEGATIVE_MOODS.has(message.mood)).length,
      negative: items.filter(message => NEGATIVE_MOODS.has(message.mood)).length,
    }
  })
}

function buildPayrollSeries(entries, segments) {
  return segments.map(segment => ({
    label: segment.label,
    total: entries
      .filter(entry => entry.timestampMs >= segment.startMs && entry.timestampMs <= segment.endMs)
      .reduce((total, entry) => total + normalizeNumeric(entry.netPay), 0),
  }))
}

function buildHeatmapRows(messages) {
  const rows = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(label => ({
    label,
    values: Array.from({ length: 24 }, () => 0),
  }))

  messages.forEach(message => {
    const date = new Date(message.timestampMs)
    if (Number.isNaN(date.getTime())) return
    const dayIndex = (date.getDay() + 6) % 7
    rows[dayIndex].values[date.getHours()] += 1
  })

  return rows
}

function buildTopMoods(messages) {
  const moodCounts = new Map()

  messages.forEach(message => {
    if (!message.mood) return
    moodCounts.set(message.mood, (moodCounts.get(message.mood) || 0) + 1)
  })

  return Array.from(moodCounts.entries())
    .sort((left, right) => right[1] - left[1])
    .slice(0, 6)
    .map(([label, count]) => ({ label, count }))
}

function buildDepartmentRows(leaveData, messages, payrollEntries) {
  const departmentMap = new Map()

  leaveData.forEach(request => {
    const entry = getDepartmentBucket(departmentMap, request.department)
    entry.leaveCount += 1
  })

  messages.forEach(message => {
    const entry = getDepartmentBucket(departmentMap, message.department)
    entry.messageCount += 1
  })

  payrollEntries.forEach(entry => {
    const bucket = getDepartmentBucket(departmentMap, entry.department)
    bucket.payrollNet += normalizeNumeric(entry.netPay)
  })

  return Array.from(departmentMap.values())
    .filter(entry => entry.leaveCount || entry.messageCount || entry.payrollNet)
    .sort((left, right) => (right.leaveCount + right.messageCount) - (left.leaveCount + left.messageCount))
    .slice(0, 6)
}

function getDepartmentBucket(map, department) {
  const key = getDepartmentName(department)
  if (!map.has(key)) {
    map.set(key, { name: key, leaveCount: 0, messageCount: 0, payrollNet: 0 })
  }
  return map.get(key)
}

function calculateMedianReviewHours(requests) {
  const hours = requests
    .map(request => {
      const createdMs = getLeaveTimestampMs(request)
      const reviewedMs = getReviewTimestampMs(request)
      if (!createdMs || !reviewedMs || reviewedMs < createdMs) return null
      return (reviewedMs - createdMs) / 36e5
    })
    .filter(value => typeof value === 'number' && Number.isFinite(value))
    .sort((left, right) => left - right)

  if (hours.length === 0) return null
  const middle = Math.floor(hours.length / 2)
  if (hours.length % 2 === 1) return hours[middle]
  return (hours[middle - 1] + hours[middle]) / 2
}

function buildLinePoints(data, key, width, height, padding, maxValue) {
  const innerWidth = width - padding * 2
  const innerHeight = height - padding * 2
  return data.map((point, index) => {
    const x = padding + (data.length <= 1 ? innerWidth / 2 : index * innerWidth / (data.length - 1))
    const y = padding + innerHeight - (point[key] / maxValue) * innerHeight
    return `${x},${y}`
  }).join(' ')
}

function getUserId(userRecord) {
  return String(userRecord?.uid || userRecord?.id || '')
}

function getDepartmentName(value) {
  return String(value || '').trim() || 'Unassigned'
}

function getLeaveTimestampMs(request) {
  if (request?.createdAt?.toDate) return request.createdAt.toDate().getTime()
  return getDateStringMs(request?.startDate)
}

function getReviewTimestampMs(request) {
  if (request?.reviewedAt?.toDate) return request.reviewedAt.toDate().getTime()
  return 0
}

function getPayrollTimestampMs(entry) {
  const payDateMs = getDateStringMs(entry?.payDate)
  if (payDateMs) return payDateMs
  if (entry?.updatedAt?.toDate) return entry.updatedAt.toDate().getTime()
  return 0
}

function getDateStringMs(value) {
  if (typeof value !== 'string' || !value) return 0
  const parsedDate = new Date(`${value}T00:00:00`)
  return Number.isNaN(parsedDate.getTime()) ? 0 : parsedDate.getTime()
}

function isInRange(timestampMs, cutoffMs) {
  return typeof timestampMs === 'number' && Number.isFinite(timestampMs) && timestampMs >= cutoffMs
}

function matchesDepartment(department, departmentFilter) {
  return departmentFilter === 'all' || getDepartmentName(department) === departmentFilter
}

function startOfDay(timestampMs) {
  const date = new Date(timestampMs)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

function endOfDay(timestampMs) {
  const date = new Date(timestampMs)
  date.setHours(23, 59, 59, 999)
  return date.getTime()
}

function formatSegmentLabel(startMs, endMs, rangeDays) {
  const startDate = new Date(startMs)
  const endDate = new Date(endMs)

  if (rangeDays >= 365) {
    return startDate.toLocaleDateString('en-GB', { month: 'short' })
  }

  if (startDate.getMonth() === endDate.getMonth()) {
    return startDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
  }

  return `${startDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}`
}

function getMaxValue(values) {
  return Math.max(1, ...values)
}

function getScaledHeight(value, maxValue) {
  if (!value) return 4
  return Math.max(12, value / maxValue * 100)
}

function getScaledWidth(value, maxValue) {
  if (!value) return 0
  return Math.max(8, value / maxValue * 100)
}

function getHeatColor(value, maxValue) {
  if (!value) return 'rgba(112, 129, 122, 0.08)'
  const intensity = 0.18 + value / maxValue * 0.72
  return `rgba(112, 129, 122, ${intensity.toFixed(2)})`
}

function sumNumericField(items, field) {
  return items.reduce((total, item) => total + normalizeNumeric(item?.[field]), 0)
}

function normalizeNumeric(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function formatDuration(value) {
  if (value == null) return '-'
  if (value < 24) return `${value.toFixed(1)}h`
  return `${(value / 24).toFixed(1)}d`
}

function formatCompactCurrency(value) {
  if (!value) return '£0'
  if (value >= 1000) return `£${Math.round(value / 1000)}k`
  return `£${Math.round(value)}`
}

function formatFullDate(timestampMs) {
  if (!timestampMs) return '-'
  return new Date(timestampMs).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function getLeaveStatusPill(status) {
  if (status === 'approved') return 'green'
  if (status === 'denied') return 'red'
  return 'amber'
}
