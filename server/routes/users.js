import express from 'express'
import { supabaseAdmin } from '../supabaseAdmin.js'

const router = express.Router()

router.post('/', async (req, res) => {
  try {
    const {
      name,
      email,
      contact_number = null,
      company = null,
      address = null,
      country = null,
      role = 'customer',
    } = req.body

    // Check if email already exists
    const { data: existing } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('email', email)
      .maybeSingle()

    if (existing) {
      return res.status(400).json({
        error: 'Email already exists.',
      })
    }

    // Invite user
    const { data, error } =
      await supabaseAdmin.auth.admin.inviteUserByEmail(
        email,
        {
          redirectTo: 'http://localhost:5173/set-password',
        }
      )

    if (error) {
      return res.status(400).json({
        error: error.message,
      })
    }

    const user = data.user

    // Create profile
    const { error: profileError } =
      await supabaseAdmin
        .from('profiles')
        .insert({
          id: user.id,
          name,
          email,
          contact_number,
          company,
          address,
          country,
          role,
        })

    if (profileError) {
      await supabaseAdmin.auth.admin.deleteUser(user.id)

      return res.status(400).json({
        error: profileError.message,
      })
    }

    return res.status(201).json({
      id: user.id,
      name,
      email,
      role,
    })

  } catch (err) {
    console.error(err)

    return res.status(500).json({
      error: err.message,
    })
  }
})

export default router