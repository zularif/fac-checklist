import { useAuth } from '../context/AuthContext'

export function useIsAdmin() {
  const { profile } = useAuth()
  return profile?.role === 'Admin'
}
