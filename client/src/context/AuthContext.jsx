import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../supabase'

const AuthContext = createContext()

export function AuthProvider({ children }) {
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadProfile() {
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (!session?.user) {
        setLoading(false)
        return
      }

      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', session.user.id)
        .single()

      if (!error) {
        setProfile(data)
      }

      setLoading(false)
    }

    loadProfile()


    // Listen for login/logout changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {

      if (event === 'SIGNED_OUT') {
        setProfile(null)
      }

      if (event === 'SIGNED_IN' && session?.user) {
        const { data } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', session.user.id)
          .single()

        setProfile(data)
      }

    })


    return () => {
      subscription.unsubscribe()
    }

  }, [])


  return (
    <AuthContext.Provider
      value={{
        profile,
        setProfile,
        loading,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}