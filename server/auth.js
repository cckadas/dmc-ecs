import { supabaseAdmin } from './supabaseAdmin.js'


// =============================================================================
// Who is calling
//
// These routes use the service-role key, which skips the database's own rules,
// so each one has to check its caller first. The browser sends the signed-in
// user's Supabase session token; the caller's id and role come from that token
// and their profile, never from the request body.
// =============================================================================
async function getCaller(req) {
  const token = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1]
  if (!token) return null

  const { data, error } = await supabaseAdmin.auth.getUser(token)
  if (error || !data?.user) return null

  const { data: profile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('role, is_active')
    .eq('id', data.user.id)
    .single()

  // A deactivated account can't call anything, even with a token still valid.
  if (profileError || !profile || profile.is_active === false) return null

  return { id: data.user.id, role: profile.role?.trim().toLowerCase() }
}


// Lets only these roles through, e.g. app.use('/api/staffs', requireRole('admin'), ...).
export function requireRole(...roles) {
  return async (req, res, next) => {
    try {
      const caller = await getCaller(req)

      if (!caller) {
        return res.status(401).json({ error: 'Please sign in again.' })
      }

      if (!roles.includes(caller.role)) {
        return res.status(403).json({ error: 'Your account does not have access to this.' })
      }

      req.caller = caller
      return next()
    } catch (error) {
      console.error('Could not check the caller:', error.message)
      return res.status(500).json({ error: 'Could not verify your account. Please try again.' })
    }
  }
}
