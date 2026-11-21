import { supabase } from '../supabase'


// The signed-in user's session token, for calls to our own server. The server
// uses it to check who is calling before it does anything (server/auth.js).
export async function authHeaders() {
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token

  return token ? { Authorization: `Bearer ${token}` } : {}
}
