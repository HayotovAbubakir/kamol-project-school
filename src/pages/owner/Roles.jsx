import { Shield } from 'lucide-react'
import { PageEnter } from '../../components/motion/PageMotion'
import GlassPane from '../../components/GlassPane'
import { useLanguage } from '../../context/LanguageContext'

const ROLES = [
  {
    roleKey: 'role.owner',
    items: ['owner.roles.ownerAll', 'owner.roles.ownerStaff', 'owner.roles.ownerFinance', 'owner.roles.ownerRoles'],
  },
  {
    roleKey: 'role.admin',
    items: ['owner.roles.adminEducation', 'owner.roles.adminSchedule', 'owner.roles.adminFinance', 'owner.roles.adminAttendance'],
  },
  {
    roleKey: 'role.reception',
    items: [
      'owner.roles.receptionStudents',
      'owner.roles.receptionPayments',
      'owner.roles.receptionAttendance',
      'owner.roles.receptionNoFinance',
    ],
  },
  {
    roleKey: 'role.teacher',
    items: ['owner.roles.teacherGroups', 'owner.roles.teacherAttendance', 'owner.roles.teacherSchedule'],
  },
]

export default function OwnerRoles() {
  const { t } = useLanguage()

  return (
    <PageEnter>
      <div className="person-grid">
        {ROLES.map((item) => (
          <GlassPane key={item.roleKey} className="card" radius={22} style={{ padding: 20 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12 }}>
              <Shield size={18} />
              <h3>{t(item.roleKey)}</h3>
            </div>
            <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--muted)', display: 'grid', gap: 6 }}>
              {item.items.map((key) => <li key={key}>{t(key)}</li>)}
            </ul>
          </GlassPane>
        ))}
      </div>
    </PageEnter>
  )
}
