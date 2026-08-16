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

    if (!name || !email) {
      return res.status(400).json({
        error: 'Name and email are required.',
      })
    }

    // Check if email already exists
    const { data: existing, error: existingError } =
      await supabaseAdmin
        .from('profiles')
        .select('id')
        .eq('email', email)
        .maybeSingle()

    if (existingError) {
      console.error(existingError)

      return res.status(500).json({
        error: existingError.message,
      })
    }

    if (existing) {
      return res.status(400).json({
        error: 'Email already exists.',
      })
    }

    // Invite user through Supabase Auth
    const { data, error } =
      await supabaseAdmin.auth.admin.inviteUserByEmail(
        email,
        {
          redirectTo:
            `${process.env.CLIENT_URL}/set-password`,
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
      // Roll back Auth user if profile creation fails
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
  } catch (error) {
    console.error('Create user error:', error)

    return res.status(500).json({
      error: 'Internal server error.',
    })
  }
})

export default router