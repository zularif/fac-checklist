import { createContext, useContext, useEffect, useState } from 'react'
import { localGet, localPut } from '../lib/localStore'
import { db } from '../lib/db'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null) // row from technicians table
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    db.auth.getSession().then(({ data }) => {
      setSession(data.session)
      if (!data.session) setLoading(false)
    })
    const { data: listener } = db.auth.onAuthStateChange((event, s) => {
      // A silent token refresh keeps the same user: don't reload the profile.
      if (event === 'TOKEN_REFRESHED') return
      if (s) setLoading(true)
      else { setLoading(false); setProfile(null) }
      setSession(s)
    })
    return () => listener.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    let alive = true
    async function loadProfile() {
      if (!session) { setProfile(null); return }
      setLoading(true)
      try {
        let data
        if (!navigator.onLine) data = await localGet(`profile:${session.user.id}`)
        else {
          const result = await db.from('technicians').select('id, tech_id, name, role, status, auth_uid').eq('auth_uid', session.user.id).single()
          if (result.error) {
            // Offline-ish failure: fall back to the cached profile for this account.
            if (result.error.code === 'NETWORK') data = await localGet(`profile:${session.user.id}`)
            else throw result.error
          } else {
            data = result.data
            await localPut(`profile:${session.user.id}`, data)
          }
        }
        if (alive) setProfile(data || null)
      } catch { if (alive) setProfile(null) }
      finally { if (alive) setLoading(false) }
    }
    loadProfile()
    return () => { alive = false }
  }, [session])

  // Technicians sign in with their 4-digit PIN. The Worker checks it against
  // the hashed PIN in D1 and returns a signed session token.
  async function loginWithPin(techId, pin) {
    const { error } = await db.auth.signInWithPin(pin, techId)
    return { error }
  }

  // PIN-only login: PINs are unique per active staff member.
  async function loginWithPinOnly(pin) {
    const { error } = await db.auth.signInWithPin(pin)
    return { error }
  }

  async function loginWithEmail(email, password) {
    const { error } = await db.auth.signInWithPassword({ email, password })
    return { error }
  }

  async function logout() {
    await db.auth.signOut()
  }

  return (
    <AuthContext.Provider value={{ session, profile, loading, loginWithPin, loginWithPinOnly, loginWithEmail, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
