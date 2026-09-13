import express from 'express'
import { supabaseAdmin } from '../supabaseAdmin.js'

const router = express.Router()


// =============================================
// CREATE STAFF ACCOUNT
// =============================================
router.post('/', async (req, res) => {
  try {
    const {
      name,
      email,
      password,
      contact_number = null,
      company = null,
      address = null,
      country = null,
      role,
    } = req.body


    // =============================================
    // VALIDATION
    // =============================================
    if (!name || !email || !password || !role) {
      return res.status(400).json({
        error: 'Name, email, password, and role are required.',
      })
    }


    // =============================================
    // ALLOWED STAFF ROLES
    // =============================================
    const allowedRoles = [
      'admin',
      'procurement',
      'sales',
      'management',
      'warehouse'
    ]

    if (!allowedRoles.includes(role)) {
      return res.status(400).json({
        error: 'Invalid staff role.',
      })
    }


    // =============================================
    // CHECK IF EMAIL ALREADY EXISTS
    // =============================================
    const {
      data: existing,
      error: existingError,
    } = await supabaseAdmin
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


    // =============================================
    // CREATE AUTH USER DIRECTLY
    // =============================================
    const {
      data,
      error: authError,
    } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })


    if (authError) {
      return res.status(400).json({
        error: authError.message,
      })
    }


    const user = data.user


    // =============================================
    // CREATE STAFF PROFILE
    // =============================================
    const {
      error: profileError,
    } = await supabaseAdmin
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
        is_active: true,
      })


    // =============================================
    // ROLLBACK AUTH USER
    // =============================================
    if (profileError) {
      await supabaseAdmin.auth.admin.deleteUser(user.id)

      return res.status(400).json({
        error: profileError.message,
      })
    }


    // =============================================
    // SUCCESS
    // =============================================
    return res.status(201).json({
      id: user.id,
      name,
      email,
      role,
      is_active: true,
    })

  } catch (error) {

    console.error('Create staff error:', error)

    return res.status(500).json({
      error: 'Internal server error.',
    })

  }
})


// =============================================
// ACTIVATE / DEACTIVATE STAFF ACCOUNT
// =============================================
router.patch('/:id/status', async (req, res) => {
  try {

    const { id } = req.params
    const { isActive } = req.body


    // =============================================
    // VALIDATION
    // =============================================
    if (typeof isActive !== 'boolean') {
      return res.status(400).json({
        error: 'Invalid account status.',
      })
    }


    // =============================================
    // FIND STAFF PROFILE
    // =============================================
    const {
      data: profile,
      error: profileError,
    } = await supabaseAdmin
      .from('profiles')
      .select('id, role, is_active')
      .eq('id', id)
      .maybeSingle()


    if (profileError) {
      return res.status(500).json({
        error: profileError.message,
      })
    }


    if (!profile) {
      return res.status(404).json({
        error: 'Staff account not found.',
      })
    }


    // =============================================
    // MAKE SURE THIS IS A STAFF ACCOUNT
    // =============================================
    if (
      profile.role !== 'admin' &&
      profile.role !== 'procurement' &&
      profile.role !== 'sales' &&
      profile.role !== 'management' &&
      profile.role !== 'warehouse'
    ) {
      return res.status(400).json({
        error: 'Only staff accounts can be activated or deactivated.',
      })
    }


    // =============================================
    // UPDATE SUPABASE AUTH STATUS
    // =============================================
    const {
      error: authError,
    } = await supabaseAdmin.auth.admin.updateUserById(
      id,
      {
        ban_duration: isActive
          ? 'none'
          : '876000h',
      }
    )


    if (authError) {
      return res.status(400).json({
        error: authError.message,
      })
    }


    // =============================================
    // UPDATE PROFILE STATUS
    // =============================================
    const {
      error: updateError,
    } = await supabaseAdmin
      .from('profiles')
      .update({
        is_active: isActive,
      })
      .eq('id', id)


    if (updateError) {
      return res.status(400).json({
        error: updateError.message,
      })
    }


    return res.status(200).json({
      id,
      is_active: isActive,
    })

  } catch (error) {

    console.error(
      'Update staff status error:',
      error
    )

    return res.status(500).json({
      error: 'Internal server error.',
    })

  }
})


export default router