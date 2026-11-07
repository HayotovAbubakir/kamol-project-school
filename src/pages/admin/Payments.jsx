import { useState } from 'react'
import Select from '../../components/Select'
import { PageEnter } from '../../components/motion/PageMotion'
import { Modal, PageHeader } from '../../components/ui'
import { useAuth } from '../../context/AuthContext'
import { useData } from '../../context/DataContext'
import { useLanguage } from '../../context/LanguageContext'
import { remainingFee } from '../../lib/store'
import { currentMonthYear, formatDate, formatMoney } from '../../lib/utils'

const METHOD_LABEL = { cash: 'Naqd', card: 'Karta', transfer: "O'tkazma" }

export default function AdminPayments() {
  const { data, addPayment, addSalaryPayment, correctPayment, voidPayment, loadPaymentHistory, deletePayment } = useData()
  const { user } = useAuth()
  const { t } = useLanguage()
  const { month, year } = currentMonthYear()
  const [studentOpen, setStudentOpen] = useState(false)
  const [salaryOpen, setSalaryOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [voidOpen, setVoidOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [history, setHistory] = useState([])
  const [selected, setSelected] = useState(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [studentForm, setStudentForm] = useState({ studentId: '', amount: '', month, year })
  const [salaryForm, setSalaryForm] = useState({ teacherId: '', amount: '' })
  const [editForm, setEditForm] = useState({ amount: '', month, year, paidAt: '', method: 'cash', note: '', reason: '' })
  const [voidReason, setVoidReason] = useState('')

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
      await addSalaryPayment({ teacherId: salaryForm.teacherId, amount: Number(salaryForm.amount) })
      setSalaryOpen(false)
      setSalaryForm({ teacherId: '', amount: '' })
    } catch (err) {
      setError(err.message || t('admin.error.salarySaveFailed'))
    } finally {
      setSaving(false)
    }
  }

  function openEdit(payment) {
    setSelected(payment)
    setEditForm({
      amount: payment.amount,
      month: payment.month,
      year: payment.year,
      paidAt: String(payment.paidAt || '').slice(0, 10),
      method: payment.method || 'cash',
      note: payment.note || '',
      reason: '',
    })
    setError('')
    setEditOpen(true)
  }

  async function submitEdit(e) {
    e.preventDefault()
    setError('')
    setSaving(true)
    try {
      await correctPayment({
        id: selected.id,
        amount: Number(editForm.amount),
        month: Number(editForm.month),
        year: Number(editForm.year),
        paid_at: `${editForm.paidAt}T12:00:00.000Z`,
        method: editForm.method,
        note: editForm.note,
        reason: editForm.reason,
      })
      setEditOpen(false)
    } catch (err) {
      setError(err.message || "To'lovni tuzatib bo'lmadi.")
    } finally {
      setSaving(false)
    }
  }

  function openVoid(payment) {
    setSelected(payment)
    setVoidReason('')
    setError('')
    setVoidOpen(true)
  }

  async function submitVoid(e) {
    e.preventDefault()
    setError('')
    if (voidReason.trim().length < 3) {
      setError('Bekor qilish sababi majburiy (kamida 3 belgi).')
      return
    }
    setSaving(true)
    try {
      await voidPayment({ id: selected.id, reason: voidReason.trim() })
      setVoidOpen(false)
    } catch (err) {
      setError(err.message || "To'lovni bekor qilib bo'lmadi.")
    } finally {
      setSaving(false)
    }
  }

  async function openHistory(payment) {
    setSelected(payment)
    setHistory([])
    setError('')
    setHistoryOpen(true)
    try {
      setHistory(await loadPaymentHistory(payment.id))
    } catch (err) {
      setError(err.message || "Tarixni yuklab bo'lmadi.")
    }
  }

  async function removePayment(payment) {
    if (!window.confirm("To'lov butunlay o'chirilsinmi?")) return
    setError('')
    try {
      await deletePayment(payment.id)
    } catch (err) {
      setError(err.message || "To'lovni o'chirib bo'lmadi.")
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
      {error && !studentOpen && !salaryOpen && !editOpen && !voidOpen && !historyOpen && <div className="alert alert-error" style={{ marginBottom: 16 }}>{error}</div>}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header"><strong>{t('admin.payment.studentList')}</strong></div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t('admin.label.student')}</th>
                <th>{t('common.amount')}</th>
                <th>{t('common.month')}</th>
                <th>Usul</th>
                <th>{t('common.date')}</th>
                <th>Holati</th>
                <th>Amallar</th>
              </tr>
            </thead>
            <tbody>
              {data.payments.length === 0 ? (
                <tr><td colSpan={7} className="empty-state">{t('admin.payment.emptyStudent')}</td></tr>
              ) : data.payments.slice().reverse().map((p) => (
                <tr key={p.id}>
                  <td>
                    {data.students.find((s) => s.id === p.studentId)?.name
                      || p.studentName
                      || t('admin.payment.deletedStudent')}
                  </td>
                  <td>{formatMoney(p.amount)}</td>
                  <td>{p.month}/{p.year}</td>
                  <td>{METHOD_LABEL[p.method] || 'Naqd'}</td>
                  <td>{formatDate(p.paidAt)}</td>
                  <td>{p.voidedAt ? `Bekor qilingan: ${p.voidReason}` : 'Faol'}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {!p.voidedAt && (
                        <>
                          <button type="button" className="btn btn-outline btn-sm" onClick={() => openEdit(p)}>Tuzatish</button>
                          <button type="button" className="btn btn-outline btn-sm" onClick={() => openVoid(p)}>Bekor qilish</button>
                        </>
                      )}
                      <button type="button" className="btn btn-outline btn-sm" onClick={() => openHistory(p)}>Tarix</button>
                      {user?.role === 'owner' && (
                        <button type="button" className="btn btn-outline btn-sm" onClick={() => removePayment(p)}>O&apos;chirish</button>
                      )}
                    </div>
                  </td>
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
                  <td>{data.teachers.find((teacher) => teacher.id === p.teacherId)?.name ?? '—'}</td>
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
        open={editOpen}
        title="To'lovni tuzatish"
        onClose={() => setEditOpen(false)}
        actions={(
          <>
            <button type="button" className="btn btn-outline" onClick={() => setEditOpen(false)}>{t('common.cancel')}</button>
            <button type="submit" form="pay-edit-form" className="btn btn-primary" disabled={saving}>{saving ? t('common.saving') : t('common.save')}</button>
          </>
        )}
      >
        {error && <div className="alert alert-error">{error}</div>}
        <form id="pay-edit-form" onSubmit={submitEdit}>
          <div className="field"><label>{t('common.amount')}</label><input type="number" min="1" className="input" value={editForm.amount} onChange={(e) => setEditForm({ ...editForm, amount: e.target.value })} required /></div>
          <div className="grid-2">
            <div className="field"><label>{t('common.month')}</label><input type="number" min="1" max="12" className="input" value={editForm.month} onChange={(e) => setEditForm({ ...editForm, month: e.target.value })} required /></div>
            <div className="field"><label>{t('common.year')}</label><input type="number" className="input" value={editForm.year} onChange={(e) => setEditForm({ ...editForm, year: e.target.value })} required /></div>
          </div>
          <div className="grid-2">
            <div className="field"><label>{t('common.date')}</label><input type="date" className="input" value={editForm.paidAt} onChange={(e) => setEditForm({ ...editForm, paidAt: e.target.value })} required /></div>
            <div className="field">
              <label>To&apos;lov usuli</label>
              <Select value={editForm.method} onChange={(e) => setEditForm({ ...editForm, method: e.target.value })} options={Object.entries(METHOD_LABEL).map(([value, label]) => ({ value, label }))} />
            </div>
          </div>
          <div className="field"><label>Izoh</label><textarea rows="2" className="input" value={editForm.note} onChange={(e) => setEditForm({ ...editForm, note: e.target.value })} /></div>
          <div className="field"><label>Tuzatish sababi (ixtiyoriy)</label><input className="input" value={editForm.reason} onChange={(e) => setEditForm({ ...editForm, reason: e.target.value })} /></div>
        </form>
      </Modal>
      <Modal
        open={voidOpen}
        title="To'lovni bekor qilish"
        onClose={() => setVoidOpen(false)}
        actions={(
          <>
            <button type="button" className="btn btn-outline" onClick={() => setVoidOpen(false)}>{t('common.cancel')}</button>
            <button type="submit" form="pay-void-form" className="btn btn-primary" disabled={saving}>{saving ? t('common.saving') : 'Bekor qilish'}</button>
          </>
        )}
      >
        {error && <div className="alert alert-error">{error}</div>}
        <form id="pay-void-form" onSubmit={submitVoid}>
          <p style={{ marginTop: 0, color: 'var(--muted)' }}>To&apos;lov o&apos;chirilmaydi — bekor qilinadi va tarixda sababi bilan qoladi.</p>
          <div className="field"><label>Bekor qilish sababi (majburiy)</label><textarea rows="3" className="input" value={voidReason} onChange={(e) => setVoidReason(e.target.value)} required /></div>
        </form>
      </Modal>
      <Modal
        open={historyOpen}
        title="To'lov tarixi"
        onClose={() => setHistoryOpen(false)}
        actions={<button type="button" className="btn btn-outline" onClick={() => setHistoryOpen(false)}>Yopish</button>}
      >
        {error && <div className="alert alert-error">{error}</div>}
        {history.length === 0 ? <p className="empty-state">Tarix yozuvlari yo&apos;q.</p> : (
          <div style={{ display: 'grid', gap: 10 }}>
            {history.map((row) => {
              const oldData = JSON.parse(row.old_data || '{}')
              const newData = JSON.parse(row.new_data || '{}')
              return (
                <div key={row.id} className="card" style={{ padding: 12 }}>
                  <strong>{row.action === 'voided' ? 'Bekor qilindi' : 'Tuzatildi'}</strong>
                  <div style={{ color: 'var(--muted)', fontSize: 13 }}>{row.actor_name || 'Xodim'} · {formatDate(row.created_at)}</div>
                  {row.reason && <div style={{ fontSize: 13 }}>Sabab: {row.reason}</div>}
                  <div style={{ fontSize: 13 }}>{formatMoney(oldData.amount)} → {formatMoney(newData.amount)}</div>
                </div>
              )
            })}
          </div>
        )}
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
              onChange={(e) => setSalaryForm({ ...salaryForm, teacherId: e.target.value })}
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
