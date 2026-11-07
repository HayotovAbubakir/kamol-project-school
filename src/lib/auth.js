export function getRoleHome(role) {
  if (role === 'owner' || role === 'reception' || role === 'teacher') return `/${role}`
  return '/login'
}

export function isStaffRole(role) {
  return role === 'owner' || role === 'reception'
}
