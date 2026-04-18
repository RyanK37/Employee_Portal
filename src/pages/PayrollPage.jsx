import { useEffect, useState } from 'react'
import { addDoc, collection, doc, limit, onSnapshot, orderBy, query, serverTimestamp, updateDoc, where } from 'firebase/firestore'
import { getDownloadURL, ref, uploadBytesResumable } from 'firebase/storage'
import { db, storage } from '../firebase'
import { useAuth } from '../hooks/useAuth'
import { createNotification } from '../utils/notifications'
import { canManagePayroll, canViewAllPayroll } from '../utils/roles'
import {
  buildPayrollPeriodLabel,
  calculateNetPay,
  createPayrollForm,
  formatCurrency,
  formatPayrollDate,
  getPayrollStatusClass,
  normalizePayrollStatus,
  parsePayrollAmount,
} from '../utils/payroll'
import styles from './PayrollPage.module.css'

export default function PayrollPage() {
  const { user, profile } = useAuth()
  const managePayroll = canManagePayroll(profile)
  const viewAllPayroll = canViewAllPayroll(profile)
  const [entries, setEntries] = useState([])
  const [employees, setEmployees] = useState([])
  const [auditLogs, setAuditLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [saveError, setSaveError] = useState('')
  const [saveNotice, setSaveNotice] = useState('')
  const [saving, setSaving] = useState(false)
  const [downloadBusyId, setDownloadBusyId] = useState('')
  const [uploadProgress, setUploadProgress] = useState(0)
  const [editingEntryId, setEditingEntryId] = useState('')
  const [selectedFile, setSelectedFile] = useState(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [form, setForm] = useState(createPayrollForm(user?.uid || ''))

  useEffect(() => {
    if (!user) return

    const entriesQuery = viewAllPayroll
      ? query(collection(db, 'payrollEntries'), orderBy('payDate', 'desc'))
      : query(
          collection(db, 'payrollEntries'),
          where('employeeId', '==', user.uid),
          where('status', '==', 'published'),
          orderBy('payDate', 'desc')
        )

    const unsubEntries = onSnapshot(entriesQuery, snapshot => {
      setEntries(snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() })))
      setLoadError('')
      setLoading(false)
    }, err => {
      console.error('Load payroll entries failed', err)
      setEntries([])
      setLoadError(friendlyPayrollError(err))
      setLoading(false)
    })

    let unsubUsers = () => {}
    let unsubAuditLogs = () => {}

    if (managePayroll) {
      unsubUsers = onSnapshot(collection(db, 'users'), snapshot => {
        const nextEmployees = snapshot.docs
          .map(docSnap => ({ id: docSnap.id, ...docSnap.data() }))
          .sort((left, right) => getUserLabel(left).localeCompare(getUserLabel(right)))
        setEmployees(nextEmployees)
      }, err => {
        console.error('Load payroll employees failed', err)
      })

      unsubAuditLogs = onSnapshot(
        query(collection(db, 'payrollAuditLogs'), orderBy('createdAt', 'desc'), limit(12)),
        snapshot => setAuditLogs(snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }))),
        err => {
          console.error('Load payroll audit logs failed', err)
          setAuditLogs([])
        }
      )
    } else {
      setEmployees([])
      setAuditLogs([])
    }

    return () => {
      unsubEntries()
      unsubUsers()
      unsubAuditLogs()
    }
  }, [managePayroll, user, viewAllPayroll])

  useEffect(() => {
    if (!managePayroll || form.employeeId || employees.length === 0) return
    setForm(current => ({
      ...current,
      employeeId: getDefaultEmployeeId(employees, user?.uid || ''),
    }))
  }, [employees, form.employeeId, managePayroll, user])

  const activeEntry = editingEntryId
    ? entries.find(entry => entry.id === editingEntryId) || null
    : null

  const filteredEntries = viewAllPayroll
    ? entries.filter(entry => {
        const matchesStatus = statusFilter === 'all' || normalizePayrollStatus(entry.status) === statusFilter
        const queryText = search.trim().toLowerCase()
        const matchesSearch = !queryText
          || String(entry.employeeName || '').toLowerCase().includes(queryText)
          || String(entry.employeeEmail || '').toLowerCase().includes(queryText)
          || String(entry.periodLabel || '').toLowerCase().includes(queryText)
          || String(entry.payDate || '').toLowerCase().includes(queryText)

        return matchesStatus && matchesSearch
      })
    : entries

  const publishedEntries = entries.filter(entry => normalizePayrollStatus(entry.status) === 'published')
  const latestPublishedEntry = publishedEntries[0] || null
  const currentYear = String(new Date().getFullYear())
  const ytdEntries = publishedEntries.filter(entry => String(entry.payDate || '').startsWith(currentYear))
  const ytdNet = sumEntries(ytdEntries, 'netPay')
  const ytdTax = sumEntries(ytdEntries, 'tax')
  const draftCount = entries.filter(entry => normalizePayrollStatus(entry.status) === 'draft').length
  const latestNetPay = latestPublishedEntry?.netPay

  async function handleSave(e) {
    e.preventDefault()
    if (!user || !managePayroll) return

    setSaveError('')
    setSaveNotice('')

    const employeeId = form.employeeId || getDefaultEmployeeId(employees, user.uid)
    const employeeRecord = employees.find(record => getUserRecordId(record) === employeeId)

    if (!employeeId || !employeeRecord) {
      setSaveError('Select an employee before saving payroll.')
      return
    }

    if (!form.payDate) {
      setSaveError('Pay date is required.')
      return
    }

    const periodLabel = String(form.periodLabel || '').trim() || buildPayrollPeriodLabel(form.payDate)
    if (!periodLabel) {
      setSaveError('Period label is required.')
      return
    }

    const grossPay = parsePayrollAmount(form.grossPay)
    const bonus = parsePayrollAmount(form.bonus)
    const tax = parsePayrollAmount(form.tax)
    const deductions = parsePayrollAmount(form.deductions)
    const status = normalizePayrollStatus(form.status)
    const notes = String(form.notes || '').trim()

    if (status === 'published' && !selectedFile && !activeEntry?.payslipPath && !activeEntry?.payslipUrl) {
      setSaveError('A published payroll entry needs a payslip PDF.')
      return
    }

    setSaving(true)
    setUploadProgress(0)

    try {
      let payslipPath = activeEntry?.payslipPath || ''
      let payslipName = activeEntry?.payslipName || ''
      let payslipSize = activeEntry?.payslipSize || 0

      if (selectedFile) {
        const storagePath = `payslips/${employeeId}/${form.payDate}_${Date.now()}_${sanitizeFileName(selectedFile.name)}`
        const storageRef = ref(storage, storagePath)
        const uploadTask = uploadBytesResumable(storageRef, selectedFile)

        uploadTask.on('state_changed', snapshot => {
          setUploadProgress(Math.round(snapshot.bytesTransferred / snapshot.totalBytes * 100))
        })

        await uploadTask
        payslipPath = storagePath
        payslipName = selectedFile.name
        payslipSize = selectedFile.size
      }

      const actorName = getUserLabel({ displayName: profile?.displayName, email: user.email, uid: user.uid })
      const nextPayload = {
        employeeId,
        employeeName: getUserLabel(employeeRecord),
        employeeEmail: String(employeeRecord.email || ''),
        employeeDepartment: String(employeeRecord.department || ''),
        periodLabel,
        payDate: form.payDate,
        grossPay,
        bonus,
        tax,
        deductions,
        netPay: calculateNetPay({ grossPay, bonus, tax, deductions }),
        status,
        notes,
        payslipPath,
        payslipName,
        payslipSize,
        updatedAt: serverTimestamp(),
        updatedByUid: user.uid,
        updatedByName: actorName,
      }

      let entryId = editingEntryId
      const auditAction = getAuditAction(editingEntryId, activeEntry?.status, status)

      if (editingEntryId) {
        await updateDoc(doc(db, 'payrollEntries', editingEntryId), nextPayload)
      } else {
        const created = await addDoc(collection(db, 'payrollEntries'), {
          ...nextPayload,
          createdAt: serverTimestamp(),
        })
        entryId = created.id
      }

      await addDoc(collection(db, 'payrollAuditLogs'), {
        entryId,
        employeeId,
        employeeName: nextPayload.employeeName,
        periodLabel,
        payDate: form.payDate,
        status,
        action: auditAction,
        actorUid: user.uid,
        actorName,
        createdAt: serverTimestamp(),
      })

      if (status === 'published') {
        await createNotification(db, {
          userId: employeeId,
          type: 'payroll',
          text: editingEntryId ? 'A payroll record was updated' : 'A new payslip was published',
          sub: `${periodLabel} payslip`,
        })
      }

      setSaveNotice(editingEntryId ? 'Payroll entry updated.' : 'Payroll entry created.')
      setEditingEntryId('')
      setSelectedFile(null)
      setUploadProgress(0)
      setForm(createPayrollForm(employeeId))
    } catch (err) {
      console.error('Save payroll failed', err)
      setSaveError(friendlyPayrollError(err))
    } finally {
      setSaving(false)
    }
  }

  function handleEdit(entry) {
    setEditingEntryId(entry.id)
    setSelectedFile(null)
    setUploadProgress(0)
    setSaveError('')
    setSaveNotice('')
    setForm({
      employeeId: entry.employeeId || '',
      periodLabel: String(entry.periodLabel || ''),
      payDate: String(entry.payDate || ''),
      grossPay: toAmountInput(entry.grossPay),
      bonus: toAmountInput(entry.bonus),
      tax: toAmountInput(entry.tax),
      deductions: toAmountInput(entry.deductions),
      status: normalizePayrollStatus(entry.status),
      notes: String(entry.notes || ''),
    })
  }

  function handleStartNew() {
    setEditingEntryId('')
    setSelectedFile(null)
    setUploadProgress(0)
    setSaveError('')
    setSaveNotice('')
    setForm(createPayrollForm(getDefaultEmployeeId(employees, user?.uid || '')))
  }

  function handleFormChange(key, value) {
    setForm(current => ({ ...current, [key]: value }))
  }

  async function handleDownloadPayslip(entry) {
    const downloadKey = entry?.id || entry?.payslipPath || 'download'
    setSaveError('')
    setDownloadBusyId(downloadKey)

    try {
      const downloadUrl = entry?.payslipPath
        ? await getDownloadURL(ref(storage, entry.payslipPath))
        : entry?.payslipUrl

      if (!downloadUrl) {
        throw new Error('Missing payslip file')
      }

      const anchor = document.createElement('a')
      anchor.href = downloadUrl
      anchor.target = '_blank'
      anchor.rel = 'noreferrer'
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
    } catch (err) {
      console.error('Download payslip failed', err)
      setSaveError('Payslip download failed. Try again.')
    } finally {
      setDownloadBusyId('')
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.hero}>
        <div>
          <div className="section-label">Payroll</div>
          <h1 className={styles.title}>{viewAllPayroll ? 'Payroll operations' : 'My payroll'}</h1>
          <div className={styles.subtitle}>
            {viewAllPayroll
              ? 'Upload payslips, publish payroll records, and keep a traceable audit history.'
              : 'See your published payslips, current year totals, and the latest payment details.'}
          </div>
        </div>

        {managePayroll && (
          <button type="button" className="btn secondary sm" onClick={handleStartNew}>
            {editingEntryId ? 'Create new record' : 'New payroll record'}
          </button>
        )}
      </div>

      {loadError && <div className={styles.errorBanner}>{loadError}</div>}
      {!loadError && saveError && <div className={styles.errorBanner}>{saveError}</div>}
      {saveNotice && <div className={styles.noticeBanner}>{saveNotice}</div>}

      <div className={styles.stats}>
        {viewAllPayroll ? (
          <>
            <div className="stat-card">
              <div className="lbl">Payroll records</div>
              <div className="val">{entries.length}</div>
              <div className="sub">All employees</div>
            </div>
            <div className="stat-card">
              <div className="lbl">Draft payslips</div>
              <div className="val">{draftCount}</div>
              <div className="sub">Need review or upload</div>
            </div>
            <div className="stat-card">
              <div className="lbl">Published payslips</div>
              <div className="val">{publishedEntries.length}</div>
              <div className="sub">Visible to employees</div>
            </div>
            <div className="stat-card">
              <div className="lbl">Latest published net</div>
              <div className="val" style={{ fontSize: 18 }}>{formatCurrency(latestNetPay)}</div>
              <div className="sub">{latestPublishedEntry ? latestPublishedEntry.periodLabel : 'No published payroll yet'}</div>
            </div>
          </>
        ) : (
          <>
            <div className="stat-card">
              <div className="lbl">Latest net pay</div>
              <div className="val" style={{ fontSize: 18 }}>{formatCurrency(latestNetPay)}</div>
              <div className="sub">{latestPublishedEntry ? latestPublishedEntry.periodLabel : 'No payslips yet'}</div>
            </div>
            <div className="stat-card">
              <div className="lbl">YTD net pay</div>
              <div className="val" style={{ fontSize: 18 }}>{formatCurrency(ytdNet)}</div>
              <div className="sub">Published in {currentYear}</div>
            </div>
            <div className="stat-card">
              <div className="lbl">YTD tax</div>
              <div className="val" style={{ fontSize: 18 }}>{formatCurrency(ytdTax)}</div>
              <div className="sub">Tax withheld this year</div>
            </div>
            <div className="stat-card">
              <div className="lbl">Published payslips</div>
              <div className="val">{publishedEntries.length}</div>
              <div className="sub">Available to download</div>
            </div>
          </>
        )}
      </div>

      {viewAllPayroll ? (
        <div className={styles.workspace}>
          <div className={styles.mainColumn}>
            <div className="card">
              <div className={styles.sectionRow}>
                <div>
                  <div className="section-label">Payroll records</div>
                  <div className={styles.sectionTitle}>Team payroll list</div>
                </div>

                <div className={styles.toolbar}>
                  <input
                    className="input"
                    style={{ width: 220 }}
                    placeholder="Search employee or period..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                  />
                  <select
                    className="input"
                    style={{ width: 140 }}
                    value={statusFilter}
                    onChange={e => setStatusFilter(e.target.value)}>
                    <option value="all">All statuses</option>
                    <option value="draft">Draft</option>
                    <option value="published">Published</option>
                  </select>
                </div>
              </div>

              {loading ? (
                <div className={styles.loadingState}><span className="spinner" /></div>
              ) : filteredEntries.length === 0 ? (
                <div className={styles.emptyState}>No payroll records match the current filters.</div>
              ) : (
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Employee</th>
                        <th>Period</th>
                        <th>Pay date</th>
                        <th>Net pay</th>
                        <th>Status</th>
                        <th>Payslip</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {filteredEntries.map(entry => (
                        <tr key={entry.id} className={editingEntryId === entry.id ? styles.activeRow : ''}>
                          <td>
                            <div className={styles.primaryCell}>{entry.employeeName || 'Unknown employee'}</div>
                            <div className={styles.secondaryCell}>{entry.employeeDepartment || entry.employeeEmail || '-'}</div>
                          </td>
                          <td>
                            <div className={styles.primaryCell}>{entry.periodLabel || '-'}</div>
                          </td>
                          <td>{formatPayrollDate(entry.payDate)}</td>
                          <td>{formatCurrency(entry.netPay)}</td>
                          <td>
                            <span className={`pill ${getPayrollStatusClass(entry.status)}`}>
                              {normalizePayrollStatus(entry.status)}
                            </span>
                          </td>
                          <td>
                            {entry.payslipPath || entry.payslipUrl ? (
                              <button
                                type="button"
                                className="btn secondary sm"
                                disabled={downloadBusyId === entry.id}
                                onClick={() => handleDownloadPayslip(entry)}>
                                {downloadBusyId === entry.id ? 'Opening...' : 'Download'}
                              </button>
                            ) : (
                              <span className={styles.secondaryCell}>Missing file</span>
                            )}
                          </td>
                          <td>
                            <button type="button" className="btn secondary sm" onClick={() => handleEdit(entry)}>
                              Edit
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="card">
              <div className="section-label">Audit log</div>
              <div className={styles.sectionTitle}>Recent payroll actions</div>
              {auditLogs.length === 0 ? (
                <div className={styles.emptyState}>No payroll actions have been logged yet.</div>
              ) : (
                <div className={styles.logList}>
                  {auditLogs.map(log => (
                    <div key={log.id} className={styles.logItem}>
                      <div className={styles.logTitle}>
                        {log.actorName || 'Unknown user'} {formatAuditAction(log.action)} {log.employeeName || 'an employee'}
                      </div>
                      <div className={styles.logMeta}>
                        {log.periodLabel || 'Payroll period'} | {formatPayrollDate(log.payDate, 'No pay date')} | {formatLogTime(log.createdAt)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <form className={`card ${styles.editorCard}`} onSubmit={handleSave}>
            <div className="section-label">{editingEntryId ? 'Edit payroll' : 'New payroll'}</div>
            <div className={styles.editorTitle}>
              {editingEntryId ? `Editing ${activeEntry?.employeeName || 'record'}` : 'Create a payroll record'}
            </div>

            <div className={styles.formGrid}>
              <div className={styles.field}>
                <label>Employee</label>
                <select
                  className="input"
                  value={form.employeeId}
                  onChange={e => handleFormChange('employeeId', e.target.value)}>
                  <option value="">Select employee</option>
                  {employees.map(employee => (
                    <option key={getUserRecordId(employee)} value={getUserRecordId(employee)}>
                      {getUserLabel(employee)}{employee.department ? ` | ${employee.department}` : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div className={styles.field}>
                <label>Pay date</label>
                <input
                  className="input"
                  type="date"
                  value={form.payDate}
                  onChange={e => handleFormChange('payDate', e.target.value)}
                />
              </div>

              <div className={styles.field}>
                <label>Period label</label>
                <input
                  className="input"
                  value={form.periodLabel}
                  onChange={e => handleFormChange('periodLabel', e.target.value)}
                  placeholder="April 2026 payroll"
                />
              </div>

              <div className={styles.field}>
                <label>Status</label>
                <select
                  className="input"
                  value={form.status}
                  onChange={e => handleFormChange('status', e.target.value)}>
                  <option value="draft">Draft</option>
                  <option value="published">Published</option>
                </select>
              </div>

              <div className={styles.field}>
                <label>Gross pay</label>
                <input
                  className="input"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.grossPay}
                  onChange={e => handleFormChange('grossPay', e.target.value)}
                  placeholder="0.00"
                />
              </div>

              <div className={styles.field}>
                <label>Bonus</label>
                <input
                  className="input"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.bonus}
                  onChange={e => handleFormChange('bonus', e.target.value)}
                  placeholder="0.00"
                />
              </div>

              <div className={styles.field}>
                <label>Tax</label>
                <input
                  className="input"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.tax}
                  onChange={e => handleFormChange('tax', e.target.value)}
                  placeholder="0.00"
                />
              </div>

              <div className={styles.field}>
                <label>Deductions</label>
                <input
                  className="input"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.deductions}
                  onChange={e => handleFormChange('deductions', e.target.value)}
                  placeholder="0.00"
                />
              </div>
            </div>

            <div className={styles.summaryPanel}>
              <div className={styles.summaryLabel}>Calculated net pay</div>
              <div className={styles.summaryValue}>
                {formatCurrency(calculateNetPay({
                  grossPay: parsePayrollAmount(form.grossPay),
                  bonus: parsePayrollAmount(form.bonus),
                  tax: parsePayrollAmount(form.tax),
                  deductions: parsePayrollAmount(form.deductions),
                }))}
              </div>
              <div className={styles.summaryMeta}>Net pay = gross pay + bonus - tax - deductions</div>
            </div>

            <div className={styles.field}>
              <label>Payslip PDF</label>
              <input
                className="input"
                type="file"
                accept=".pdf,application/pdf"
                onChange={e => setSelectedFile(e.target.files?.[0] || null)}
              />
              <div className={styles.fileMeta}>
                {selectedFile
                  ? `${selectedFile.name} (${formatFileSize(selectedFile.size)})`
                  : activeEntry?.payslipName
                    ? `Current file: ${activeEntry.payslipName}`
                    : 'Upload a PDF before publishing this record.'}
              </div>
              {uploadProgress > 0 && uploadProgress < 100 && (
                <div className={styles.progressRow}>Uploading payslip {uploadProgress}%</div>
              )}
            </div>

            <div className={styles.field}>
              <label>Notes</label>
              <textarea
                className={`${styles.textarea} input`}
                value={form.notes}
                onChange={e => handleFormChange('notes', e.target.value)}
                placeholder="Optional internal notes or payroll comments"
              />
            </div>

            <div className={styles.editorActions}>
              <button type="button" className="btn secondary sm" onClick={handleStartNew}>
                Reset
              </button>
              <button type="submit" className="btn sm" disabled={saving}>
                {saving ? <span className="spinner" style={{ width: 12, height: 12 }} /> : editingEntryId ? 'Save changes' : 'Create record'}
              </button>
            </div>
          </form>
        </div>
      ) : (
        <div className={styles.employeeGrid}>
          <div className="card">
            <div className="section-label">Latest payslip</div>
            {latestPublishedEntry ? (
              <>
                <div className={styles.sectionTitle}>{latestPublishedEntry.periodLabel}</div>
                <div className={styles.payslipHeroValue}>{formatCurrency(latestPublishedEntry.netPay)}</div>
                <div className={styles.miniGrid}>
                  <div className={styles.miniStat}>
                    <span>Gross pay</span>
                    <strong>{formatCurrency(latestPublishedEntry.grossPay)}</strong>
                  </div>
                  <div className={styles.miniStat}>
                    <span>Tax</span>
                    <strong>{formatCurrency(latestPublishedEntry.tax)}</strong>
                  </div>
                  <div className={styles.miniStat}>
                    <span>Deductions</span>
                    <strong>{formatCurrency(latestPublishedEntry.deductions)}</strong>
                  </div>
                  <div className={styles.miniStat}>
                    <span>Pay date</span>
                    <strong>{formatPayrollDate(latestPublishedEntry.payDate)}</strong>
                  </div>
                </div>
                <div className={styles.cardActions}>
                  {latestPublishedEntry.payslipPath || latestPublishedEntry.payslipUrl ? (
                    <button
                      type="button"
                      className="btn secondary sm"
                      disabled={downloadBusyId === latestPublishedEntry.id}
                      onClick={() => handleDownloadPayslip(latestPublishedEntry)}>
                      {downloadBusyId === latestPublishedEntry.id ? 'Opening...' : 'Download latest payslip'}
                    </button>
                  ) : (
                    <button type="button" className="btn secondary sm" disabled>File not uploaded</button>
                  )}
                </div>
              </>
            ) : (
              <div className={styles.emptyState}>No published payroll entries are available for your account yet.</div>
            )}
          </div>

          <div className="card">
            <div className="section-label">Year to date</div>
            <div className={styles.sectionTitle}>{currentYear} summary</div>
            <div className={styles.miniGrid}>
              <div className={styles.miniStat}>
                <span>Net pay</span>
                <strong>{formatCurrency(ytdNet)}</strong>
              </div>
              <div className={styles.miniStat}>
                <span>Tax</span>
                <strong>{formatCurrency(ytdTax)}</strong>
              </div>
              <div className={styles.miniStat}>
                <span>Gross pay</span>
                <strong>{formatCurrency(sumEntries(ytdEntries, 'grossPay'))}</strong>
              </div>
              <div className={styles.miniStat}>
                <span>Payslips</span>
                <strong>{ytdEntries.length}</strong>
              </div>
            </div>
          </div>

          <div className={`card ${styles.fullWidthCard}`}>
            <div className="section-label">Payslip history</div>
            {loading ? (
              <div className={styles.loadingState}><span className="spinner" /></div>
            ) : publishedEntries.length === 0 ? (
              <div className={styles.emptyState}>No payslips have been published for your account yet.</div>
            ) : (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Period</th>
                      <th>Pay date</th>
                      <th>Gross pay</th>
                      <th>Net pay</th>
                      <th>Tax</th>
                      <th>Payslip</th>
                    </tr>
                  </thead>
                  <tbody>
                    {publishedEntries.map(entry => (
                      <tr key={entry.id}>
                        <td>{entry.periodLabel || '-'}</td>
                        <td>{formatPayrollDate(entry.payDate)}</td>
                        <td>{formatCurrency(entry.grossPay)}</td>
                        <td>{formatCurrency(entry.netPay)}</td>
                        <td>{formatCurrency(entry.tax)}</td>
                        <td>
                          {entry.payslipPath || entry.payslipUrl ? (
                            <button
                              type="button"
                              className="btn secondary sm"
                              disabled={downloadBusyId === entry.id}
                              onClick={() => handleDownloadPayslip(entry)}>
                              {downloadBusyId === entry.id ? 'Opening...' : 'Download'}
                            </button>
                          ) : (
                            <span className={styles.secondaryCell}>Unavailable</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function sumEntries(entries, field) {
  return entries.reduce((total, entry) => {
    const value = entry?.[field]
    return total + (typeof value === 'number' && Number.isFinite(value) ? value : 0)
  }, 0)
}

function getDefaultEmployeeId(employees, fallbackUid = '') {
  if (employees.some(employee => getUserRecordId(employee) === fallbackUid)) return fallbackUid
  return getUserRecordId(employees[0]) || fallbackUid
}

function getUserRecordId(userRecord) {
  return String(userRecord?.uid || userRecord?.id || '')
}

function getUserLabel(userRecord) {
  return String(userRecord?.displayName || userRecord?.email || userRecord?.uid || 'Unknown user')
}

function toAmountInput(value) {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : ''
}

function sanitizeFileName(value) {
  return String(value || 'payslip.pdf').replace(/[^a-zA-Z0-9._-]+/g, '_')
}

function formatFileSize(bytes) {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) return '-'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function getAuditAction(entryId, previousStatus, nextStatus) {
  if (!entryId) return nextStatus === 'published' ? 'published' : 'created'
  if (normalizePayrollStatus(previousStatus) !== 'published' && nextStatus === 'published') return 'published'
  return 'updated'
}

function formatAuditAction(action) {
  switch (action) {
    case 'created':
      return 'created payroll for'
    case 'published':
      return 'published payroll for'
    default:
      return 'updated payroll for'
  }
}

function formatLogTime(value) {
  if (value?.toDate) {
    return value.toDate().toLocaleString('en-GB', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  return 'Pending sync'
}

function friendlyPayrollError(err) {
  if (err?.code === 'permission-denied') {
    return 'Payroll access was blocked by Firebase rules. Deploy the latest Firestore and Storage rules, then try again.'
  }

  if (err?.code === 'failed-precondition') {
    return 'A required Firestore index for payroll is missing. Deploy Firestore indexes and reload the page.'
  }

  if (typeof err?.code === 'string' && err.code.startsWith('storage/')) {
    return 'Payslip upload failed in Firebase Storage. Check Storage rules and try the PDF upload again.'
  }

  return 'Payroll action failed. Try again.'
}
