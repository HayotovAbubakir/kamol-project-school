import { Plus, Receipt, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { PageEnter } from '../../components/motion/PageMotion'
import { GlowButton, Modal, PageHeader, StatCard, StatusBadge } from '../../components/ui'
import { useAuth } from '../../context/AuthContext'
import { useData } from '../../context/DataContext'
import { useLanguage } from '../../context/LanguageContext'
import { formatDate, formatMoney, todayISO, DEFAULT_EXPENSE_CATEGORY, expenseCategoryLabel, toStoredExpenseCategory } from '../../lib/utils'

export default function OwnerExpenses() {
  const { data, addExpense, deleteExpense } = useData()
  const { user } = useAuth()
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ title: '', amount: '', category: DEFAULT_EXPENSE_CATEGORY, date: todayISO() })

  const total = data.expenses.reduce((s, e) => s + e.amount, 0)
  const categories = [...new Set(data.expenses.map((e) => e.category))]

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    setSaving(true)
    try {
      await addExpense({ ...form, category: toStoredExpenseCategory(form.category), amount: Number(form.amount), recordedBy: user.id })
      setForm({ title: '', amount: '', category: DEFAULT_EXPENSE_CATEGORY, date: todayISO() })
      setOpen(false)
    } catch (err) {
      setError(err.message || t('owner.expenses.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <PageEnter>
      <PageHeader
        actions={
          <GlowButton className="btn-primary" onClick={() => { setError(''); setOpen(true) }}>
            <Plus size={16} /> {t('owner.expenses.new')}
          </GlowButton>
        }
      />

      <div className="stat-grid stat-grid-3">
        <StatCard label={t('common.total')} value={formatMoney(total)} icon={Receipt} tone="danger" featured={total > 0} />
        <StatCard label={t('owner.expenses.records')} value={data.expenses.length} icon={Receipt} tone="warning" />
        <StatCard label={t('owner.expenses.categories')} value={categories.length} icon={Receipt} tone="default" />
      </div>

      {data.expenses.length > 0 && (
        <div className="expenses-table-wrap">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('owner.expenses.category')}</th>
                  <th>{t('owner.expenses.title')}</th>
                  <th>{t('common.amount')}</th>
                  <th>{t('common.date')}</th>
                  <th>{t('common.status')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.expenses.map((expense) => (
                  <tr key={expense.id}>
                    <td><span className="tag-pill">{expenseCategoryLabel(expense.category, t)}</span></td>
                    <td><strong>{expense.title}</strong></td>
                    <td className="money-text">{formatMoney(expense.amount)}</td>
                    <td>{formatDate(expense.date)}</td>
                    <td><StatusBadge tone="neutral">{t('owner.expenses.approved')}</StatusBadge></td>
                    <td>
                      <GlowButton className="btn-danger btn-sm" onClick={() => deleteExpense(expense.id)}>
                        <Trash2 size={14} />
                      </GlowButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal
        open={open}
        title={t('owner.expenses.new')}
        onClose={() => setOpen(false)}
        actions={(
          <>
            <button type="button" className="btn btn-outline" onClick={() => setOpen(false)}>{t('common.cancel')}</button>
            <button type="submit" form="expense-form" className="btn btn-primary" disabled={saving}>{saving ? t('common.saving') : t('common.save')}</button>
          </>
        )}
      >
        {error && <div className="alert alert-error">{error}</div>}
        <form id="expense-form" onSubmit={submit}>
          <div className="field"><label>{t('owner.expenses.heading')}</label><input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required /></div>
          <div className="field"><label>{t('owner.expenses.category')}</label><input className="input" value={form.category === DEFAULT_EXPENSE_CATEGORY ? t('domain.expense.operational') : form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} required /></div>
          <div className="field"><label>{t('common.amount')}</label><input type="number" min="1" className="input" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required /></div>
          <div className="field"><label>{t('common.date')}</label><input type="date" className="input" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required /></div>
        </form>
      </Modal>
    </PageEnter>
  )
}
