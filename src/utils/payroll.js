const GBP_FORMATTER = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
})

export function formatCurrency(value, fallback = '-') {
  return typeof value === 'number' && Number.isFinite(value)
    ? GBP_FORMATTER.format(value)
    : fallback
}

export function parsePayrollAmount(value) {
  const numeric = Number.parseFloat(String(value ?? '').replace(/,/g, '').trim())
  return Number.isFinite(numeric) ? roundCurrency(numeric) : 0
}

export function calculateNetPay({ grossPay = 0, bonus = 0, tax = 0, deductions = 0 }) {
  return roundCurrency(grossPay + bonus - tax - deductions)
}

export function buildPayrollPeriodLabel(payDate) {
  if (typeof payDate !== 'string' || !payDate) return ''

  const parsedDate = new Date(`${payDate}T00:00:00`)
  if (Number.isNaN(parsedDate.getTime())) return ''

  return parsedDate.toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
  })
}

export function normalizePayrollStatus(status) {
  return status === 'published' ? 'published' : 'draft'
}

export function getPayrollStatusClass(status) {
  return normalizePayrollStatus(status) === 'published' ? 'green' : 'amber'
}

export function formatPayrollDate(value, fallback = '-') {
  if (value?.toDate) return value.toDate().toLocaleDateString('en-GB')

  if (typeof value === 'string' && value) {
    const parsedDate = new Date(`${value}T00:00:00`)
    if (!Number.isNaN(parsedDate.getTime())) {
      return parsedDate.toLocaleDateString('en-GB')
    }
  }

  return fallback
}

export function createPayrollForm(defaultEmployeeId = '') {
  return {
    employeeId: defaultEmployeeId,
    periodLabel: '',
    payDate: '',
    grossPay: '',
    bonus: '',
    tax: '',
    deductions: '',
    status: 'draft',
    notes: '',
  }
}

function roundCurrency(value) {
  return Math.round(value * 100) / 100
}
