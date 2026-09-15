import { Plus } from 'lucide-react'
import { useState } from 'react'
import { PageEnter, Stagger, StaggerItem } from '../../components/motion/PageMotion'
import { GlowButton, MagneticCard, Modal, PageHeader } from '../../components/ui'
import { useAuth } from '../../context/AuthContext'
import { useData } from '../../context/DataContext'
import { useLanguage } from '../../context/LanguageContext'
import { formatDate, formatMoney, DEFAULT_EXPENSE_CATEGORY, expenseCategoryLabel, toStoredExpenseCategory } from '../../lib/utils'

export default function AdminExpenses() {
  const { data, addExpense } = useData()
  const { user } = useAuth()
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ title: '', amount: '', category: DEFAULT_EXPENSE_CATEGORY, date: new Date().toISOString().slice(0, 10) })

  const submit = (e) => {
    e.preventDefault()
    addExpense({ ...form, category: toStoredExpenseCategory(form.category), amount: Number(form.amount), recordedBy: user.id })
    setForm({ title: '', amount: '', category: DEFAULT_EXPENSE_CATEGORY, date: new Date().toISOString().slice(0, 10) })
    setOpen(false)
  }

  return (
    <PageEnter>
      <PageHeader
        actions={
          <GlowButton className="btn-primary" onClick={() => setOpen(true)}>
            <Plus size={16} /> {t('admin.action.newExpense')}
          </GlowButton>
        }
      />

      {data.expenses.length > 0 && (
        <Stagger className="person-grid">
          {data.expenses.map((expense) => (
            <StaggerItem key={expense.id}>
              <MagneticCard className="expense-card">
                <div className="expense-top">
                  <span className="tag-pill">{expenseCategoryLabel(expense.category, t)}</span>
                  <strong className="money-text">{formatMoney(expense.amount)}</strong>
                </div>
                <h3>{expense.title}</h3>
                <p className="expense-date">{formatDate(expense.date)}</p>
              </MagneticCard>
            </StaggerItem>
          ))}
        </Stagger>
      )}

      <Modal open={open} title={t('admin.action.newExpense')} onClose={() => setOpen(false)} actions={<><button type="button" className="btn btn-outline" onClick={() => setOpen(false)}>{t('common.cancel')}</button><button type="submit" form="expense-form" className="btn btn-primary">{t('common.save')}</button></>}>
        <form id="expense-form" onSubmit={submit}>
          <div className="field"><label>{t('admin.expense.title')}</label><input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required /></div>
          <div className="field"><label>{t('admin.expense.category')}</label><input className="input" value={form.category === DEFAULT_EXPENSE_CATEGORY ? t('domain.expense.operational') : form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} required /></div>
          <div className="field"><label>{t('common.amount')}</label><input type="number" className="input" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required /></div>
          <div className="field"><label>{t('common.date')}</label><input type="date" className="input" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required /></div>
        </form>
      </Modal>
    </PageEnter>
  )
}
