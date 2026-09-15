import { useState } from 'react'
import Select from '../../components/Select'
import { PageEnter } from '../../components/motion/PageMotion'
import { Modal, PageHeader } from '../../components/ui'
import { useAuth } from '../../context/AuthContext'
import { useData } from '../../context/DataContext'
import { useLanguage } from '../../context/LanguageContext'
import { remainingFee } from '../../lib/store'
import { currentMonthYear, formatDate, formatMoney } from '../../lib/utils'

export default function AdminPayments() {
  const { data, addPayment, addSalaryPayment } = useData()
  const { user } = useAuth()
  const { t } = useLanguage()
  const { month, year } = currentMonthYear()
  const [studentOpen, setStudentOpen] = useState(false)
  const [salaryOpen, setSalaryOpen] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [studentForm, setStudentForm] = useState({ studentId: '', amount: '', month, year })
  const [salaryForm, setSalaryForm] = useState({ teacherId: '', amount: '' })

  const submitPayment = async (e) => {
    e.preventDefault()
    setError('')
    setSaving(true)
    try {
      await addPayment({
        studentId: studentForm.studentId,
        studentName: data.students.find((s) => s.id === studentForm.studentId)?.name || '',
        amount: Number(studentForm.amount),
        month: Number(studentForm.month),
        year: Number(studentForm.year),
        recordedBy: user.id,
      })
      setStudentOpen(false)
      setStudentForm({ studentId: '', amount: '', month, year })
    } catch (err) {
      setError(err.message || t('admin.error.paymentSaveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const submitSalary = async (e) => {
    e.preventDefault()
    setError('')
    setSaving(true)
    try {
      await addSalaryPayment({
        teacherId: salaryForm.teacherId,
        amount: Number(salaryForm.amount),
      })
      setSalaryOpen(false)
      setSalaryForm({ teacherId: '', amount: '' })
    } catch (err) {
      setError(err.message || t('admin.error.salarySaveFailed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <PageEnter>
      <PageHeader
        actions={
          <>
            <button type="button" className="btn btn-outline" onClick={() => { setError(''); setSalaryOpen(true) }}>{t('admin.payment.salary')}</button>
            <button type="button" className="btn btn-primary" onClick={() => { setError(''); setStudentOpen(true) }}>{t('admin.payment.student')}</button>
          </>
        }
      />
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header"><strong>{t('admin.payment.studentList')}</strong></div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t('admin.label.student')}</th>
                <th>{t('common.amount')}</th>
                <th>{t('common.month')}</th>
                <th>{t('common.date')}</th>
              </tr>
            </thead>
            <tbody>
              {data.payments.length === 0 ? (
                <tr><td colSpan={4} className="empty-state">{t('admin.payment.emptyStudent')}</td></tr>
              ) : data.payments.slice().reverse().map((p) => (
                <tr key={p.id}>
                  <td>
                    {data.students.find((s) => s.id === p.studentId)?.name
                      || p.studentName
                      || t('admin.payment.deletedStudent')}
                  </td>
                  <td>{formatMoney(p.amount)}</td>
                  <td>{p.month}/{p.year}</td>
                  <td>{formatDate(p.paidAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="card">
        <div className="card-header"><strong>{t('admin.payment.salaryList')}</strong></div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t('admin.label.teacher')}</th>
                <th>{t('common.amount')}</th>
                <th>{t('common.date')}</th>
              </tr>
            </thead>
            <tbody>
              {data.salaryPayments.length === 0 ? (
                <tr><td colSpan={3} className="empty-state">{t('admin.payment.emptySalary')}</td></tr>
              ) : data.salaryPayments.slice().reverse().map((p) => (
                <tr key={p.id}>
                  <td>{data.teachers.find((t) => t.id === p.teacherId)?.name ?? '—'}</td>
                  <td>{formatMoney(p.amount)}</td>
                  <td>{formatDate(p.paidAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <Modal
        open={studentOpen}
        title={t('admin.payment.student')}
        onClose={() => setStudentOpen(false)}
        actions={(
          <>
            <button type="button" className="btn btn-outline" onClick={() => setStudentOpen(false)}>{t('common.cancel')}</button>
            <button type="submit" form="pay-form" className="btn btn-primary" disabled={saving}>{saving ? t('common.saving') : t('common.save')}</button>
          </>
        )}
      >
        {error && <div className="alert alert-error">{error}</div>}
        <form id="pay-form" onSubmit={submitPayment}>
          <div className="field">
            <label>{t('admin.label.student')}</label>
            <Select
              value={studentForm.studentId}
              required
              onChange={(e) => {
                const student = data.students.find((s) => s.id === e.target.value)
                const due = student ? remainingFee(student, data.payments, Number(studentForm.month), Number(studentForm.year)) : 0
                setStudentForm({ ...studentForm, studentId: e.target.value, amount: due || student?.monthlyFee || '' })
              }}
              options={[
                { value: '', label: t('common.select') },
                ...data.students.map((s) => ({ value: s.id, label: s.name })),
              ]}
            />
          </div>
          <div className="field"><label>{t('common.amount')}</label><input type="number" min="1" className="input" value={studentForm.amount} onChange={(e) => setStudentForm({ ...studentForm, amount: e.target.value })} required /></div>
          <div className="grid-2">
            <div className="field"><label>{t('common.month')}</label><input type="number" min="1" max="12" className="input" value={studentForm.month} onChange={(e) => setStudentForm({ ...studentForm, month: e.target.value })} required /></div>
            <div className="field"><label>{t('common.year')}</label><input type="number" className="input" value={studentForm.year} onChange={(e) => setStudentForm({ ...studentForm, year: e.target.value })} required /></div>
          </div>
        </form>
      </Modal>
      <Modal
        open={salaryOpen}
        title={t('admin.payment.salary')}
        onClose={() => setSalaryOpen(false)}
        actions={(
          <>
            <button type="button" className="btn btn-outline" onClick={() => setSalaryOpen(false)}>{t('common.cancel')}</button>
            <button type="submit" form="salary-form" className="btn btn-primary" disabled={saving}>{saving ? t('common.saving') : t('common.save')}</button>
          </>
        )}
      >
        {error && <div className="alert alert-error">{error}</div>}
        <form id="salary-form" onSubmit={submitSalary}>
          <div className="field">
            <label>{t('admin.label.teacher')}</label>
            <Select
              value={salaryForm.teacherId}
              required
              onChange={(e) => {
                setSalaryForm({ ...salaryForm, teacherId: e.target.value })
              }}
              options={[
                { value: '', label: t('common.select') },
                ...data.teachers.map((teacher) => ({ value: teacher.id, label: teacher.name })),
              ]}
            />
          </div>
          <div className="field"><label>{t('common.amount')}</label><input type="number" min="1" className="input" value={salaryForm.amount} onChange={(e) => setSalaryForm({ ...salaryForm, amount: e.target.value })} required /></div>
        </form>
      </Modal>
    </PageEnter>
  )
}
