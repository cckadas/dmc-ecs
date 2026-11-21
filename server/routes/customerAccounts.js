import express from 'express'
import { supabaseAdmin } from '../supabaseAdmin.js'

// =============================================================================
// Closing a customer's account (db/migrations/038), admin only
//
//   GET  /api/customer-accounts/:id/:step   what the step would do, or why it can't
//   POST /api/customer-accounts/:id/:step   the step
//
// Steps: stop (new orders), deactivate, activate, delete. The database does the
// records; this route does the sign-in: blocked after "deactivate", open again
// after "activate", removed before "delete" (the profile stays when a customer
// with records is erased). Each step can be asked again if its sign-in part
// failed: the records are already done, so only the sign-in part runs again.
// =============================================================================
export const STEPS = ['stop', 'deactivate', 'activate', 'delete']
const NEEDS_038 = 'Closing customer accounts needs db/migrations/038 to be run first.'
// The same as a deactivated staff account (routes/staffs.js): 100 years.
const BLOCKED = '876000h'

async function accountStep(admin, customerId, step, adminId, dryRun) {
  const { data, error } = await admin.rpc('customer_account_step', {
    p_customer: customerId,
    p_action: step,
    p_admin: adminId,
    p_dry_run: dryRun,
  })

  if (error) {
    const missing = error.code === 'PGRST202' || /customer_account_step/.test(error.message || '')
    const failure = new Error(missing ? NEEDS_038 : error.message)
    failure.status = missing ? 503 : 400
    throw failure
  }

  return data
}

// The step is already done (asked again after its sign-in part failed).
const alreadyDone = (step, status) =>
  (step === 'deactivate' && status === 'deactivated')
  || (step === 'activate' && status === 'active')
  || (step === 'delete' && status === 'deleted')

const signInFailure = (error) => (error && !/not found/i.test(error.message || '') ? error.message : null)

// What a step would do: { status, body }.
export async function previewAccountStep(admin, { customerId, step, adminId }) {
  try {
    return { status: 200, body: await accountStep(admin, customerId, step, adminId, true) }
  } catch (error) {
    return { status: error.status || 500, body: { error: error.message } }
  }
}

// The step: { status, body }. admin is a Supabase client with the
// service-role key (the route) or a stand-in (the rehearsal).
export async function runAccountStep(admin, { customerId, step, adminId }) {
  try {
    const preview = await accountStep(admin, customerId, step, adminId, true)
    const repeat = alreadyDone(step, preview.customer?.status)

    if (!preview.allowed && !repeat) {
      return { status: 409, body: { error: preview.refusal, result: preview } }
    }

    // Delete: the sign-in goes first, so a customer is never deleted while
    // they can still sign in. If the records part then fails, asking again
    // finishes it.
    if (step === 'delete') {
      const signInError = signInFailure((await admin.auth.admin.deleteUser(customerId)).error)
      if (signInError) {
        return { status: 502, body: { error: `Nothing was deleted: the sign-in couldn't be removed (${signInError}). Please try again.` } }
      }
      const result = repeat ? preview : await accountStep(admin, customerId, step, adminId, false)
      if (!repeat && !result.done) {
        return { status: 409, body: { error: result.refusal || 'Nothing was deleted.', result } }
      }
      return { status: 200, body: { result, repeated: repeat } }
    }

    const result = repeat ? preview : await accountStep(admin, customerId, step, adminId, false)
    if (!repeat && !result.done) {
      return { status: 409, body: { error: result.refusal || 'Nothing was changed.', result } }
    }

    let signInWarning = null
    if (step === 'deactivate' || step === 'activate') {
      const { error } = await admin.auth.admin.updateUserById(customerId, {
        ban_duration: step === 'deactivate' ? BLOCKED : 'none',
      })
      const signInError = signInFailure(error)
      if (signInError) {
        signInWarning = step === 'deactivate'
          ? `The account is deactivated, but the sign-in couldn't be blocked yet (${signInError}). Click Deactivate again to finish.`
          : `The account is open, but the sign-in couldn't be opened yet (${signInError}). Click Activate again to finish.`
      }
    }

    return { status: 200, body: { result, repeated: repeat, signInWarning } }
  } catch (error) {
    console.error(`Customer account step "${step}" failed:`, error.message)
    return { status: error.status || 500, body: { error: error.message } }
  }
}


const router = express.Router()

function stepOf(req, res) {
  const step = String(req.params.step || '').toLowerCase()
  if (!STEPS.includes(step)) {
    res.status(404).json({ error: 'Unknown step.' })
    return null
  }
  return step
}

router.get('/:id/:step', async (req, res) => {
  const step = stepOf(req, res)
  if (!step) return
  const { status, body } = await previewAccountStep(supabaseAdmin, { customerId: req.params.id, step, adminId: req.caller.id })
  return res.status(status).json(body)
})

router.post('/:id/:step', async (req, res) => {
  const step = stepOf(req, res)
  if (!step) return
  const { status, body } = await runAccountStep(supabaseAdmin, { customerId: req.params.id, step, adminId: req.caller.id })
  return res.status(status).json(body)
})

export default router
