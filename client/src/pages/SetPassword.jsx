import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase'


export default function SetPasswordPage() {
  const navigate = useNavigate()

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')


  // =============================================
  // SET PASSWORD
  // =============================================
  async function handleSubmit(e) {
    e.preventDefault()

    setError('')
    setSuccess('')

    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setLoading(true)

    const { error } = await supabase.auth.updateUser({
      password,
    })

    setLoading(false)

    if (error) {
      setError(error.message)
      return
    }

    setSuccess('Password has been set successfully.')

    setTimeout(() => {
      navigate('/')
    }, 1500)
  }


  // =============================================
  // MAIN CONTENT
  // =============================================
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-100 px-4">
      <div className="w-full max-w-md overflow-hidden rounded-xl bg-white shadow-lg">

        <div className="border-b bg-[#F4F8F5] px-6 py-5">
          <h1 className="text-2xl font-bold text-[#1F3A2C]">
            Set Password
          </h1>

          <p className="mt-1 text-sm text-gray-500">
            Create a password for your account.
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="space-y-5 p-6"
        >
          <div>
            <label className="mb-1 block text-sm font-medium">
              New Password
            </label>

            <input
              type="password"
              value={password}
              onChange={(e) =>
                setPassword(e.target.value)
              }
              className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-[#2D5A42] focus:outline-none"
              required
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">
              Confirm Password
            </label>

            <input
              type="password"
              value={confirmPassword}
              onChange={(e) =>
                setConfirmPassword(e.target.value)
              }
              className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-[#2D5A42] focus:outline-none"
              required
            />
          </div>

          {error && (
            <div className="rounded-lg bg-red-100 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          {success && (
            <div className="rounded-lg bg-green-100 px-3 py-2 text-sm text-green-700">
              {success}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-[#1F3A2C] py-2 font-medium text-white transition hover:bg-[#2D5A42] disabled:opacity-50"
          >
            {loading ? 'Saving...' : 'Set Password'}
          </button>
        </form>

      </div>
    </div>
  )
}