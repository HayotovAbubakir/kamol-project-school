import { Shield } from 'lucide-react'
import { PageEnter } from '../../components/motion/PageMotion'
import GlassPane from '../../components/GlassPane'
import { ROLE_PERMISSIONS, ROLES } from '../../../shared/role-permissions.js'

const ACTION_LABELS = {
  select: 'ko‘rish',
  insert: 'yaratish',
  update: 'tahrirlash',
  delete: 'o‘chirish',
  upsert: 'saqlash',
}

function entriesFor(role) {
  const permissions = ROLE_PERMISSIONS[role]
  if (permissions.tables === '*') return ['Barcha jadval va amallar']
  return Object.entries(permissions.tables).map(([table, actions]) => (
    `${table}: ${actions.map((action) => ACTION_LABELS[action] || action).join(', ')}`
  ))
}

export default function OwnerRoles() {
  return (
    <PageEnter>
      <div className="person-grid">
        {ROLES.map((role) => {
          const permissions = ROLE_PERMISSIONS[role]
          const entries = entriesFor(role)
          return (
            <GlassPane key={role} className="card" radius={22} style={{ padding: 20 }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12 }}>
                <Shield size={18} />
                <h3>{permissions.label}</h3>
              </div>
              <h4>Ma’lumotlar va amallar</h4>
              <ul style={{ margin: '8px 0 16px', paddingLeft: 18, color: 'var(--muted)', display: 'grid', gap: 6 }}>
                {entries.map((entry) => <li key={entry}>{entry}</li>)}
              </ul>
              <p><strong>API:</strong> {permissions.endpoints === '*' ? 'Barcha endpointlar' : permissions.endpoints.join(', ') || 'Maxsus API ruxsati yo‘q'}</p>
              <p><strong>Sahifalar:</strong> {permissions.pages === '*' ? 'Barcha sahifalar' : permissions.pages.join(', ') || 'Veb sahifaga ruxsat yo‘q'}</p>
            </GlassPane>
          )
        })}
      </div>
    </PageEnter>
  )
}
