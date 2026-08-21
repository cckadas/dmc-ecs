'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import { useAuth } from '../context/AuthContext'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faPen, faTrash, faPlus } from '@fortawesome/free-solid-svg-icons'
import { useToast } from "../context/ToastContext"

import IconButton from '../components/IconButton'


export default function DeliveryLocationsPage() {
  const { profile } = useAuth()
  const { toast } = useToast()

  const [locations, setLocations] = useState([])
  const [showModal, setShowModal] = useState(false)
  const [editingLocation, setEditingLocation] = useState(null)


  // =============================================
  // LOAD LOCATIONS
  // =============================================
  async function loadLocations() {
    const { data, error } = await supabase
      .from('delivery_locations')
      .select(`
        id,
        location_name,
        recipient_name,
        contact_number,
        address,
        country
      `)
      .eq('profile_id', profile.id)
      .order('created_at', { ascending: false })


    if (error) {
      toast.error(error.message)
      return
    }

    setLocations(data)
  }


  // =============================================
  // SAVE LOCATION
  // =============================================
  async function saveLocation(formData) {
    if (!formData.location_name || !formData.address) {
      alert('Location name and address are required')
      return
    }

    let error

    if (editingLocation) {
      const { error: updateError } = await supabase
        .from('delivery_locations')
        .update(formData)
        .eq('id', editingLocation.id)

      error = updateError
    }
    
    else {
      const { error: insertError } = await supabase
        .from('delivery_locations')
        .insert({
          ...formData,
          profile_id: profile.id
        })

      error = insertError
    }

    if (error) {
      alert(error.message)
      return
    }

    toast.success("Location edited successfully!")
    setShowModal(false)
    loadLocations()
  }


  // =============================================
  // DELETE LOCATION
  // =============================================
  async function deleteLocation(id) {
    const confirmDelete = confirm(
      'Are you sure you want to delete this location?'
    )

    if (!confirmDelete) return

    const { error } = await supabase
      .from('delivery_locations')
      .delete()
      .eq('id', id)

    if (error) {
      toast.success(error.message)
      return
    }

    toast.success("Location deleted successfully!")
    loadLocations()
  }


  // =============================================
  // OPEN ADD MODAL
  // =============================================
  function openAddModal() {
    setEditingLocation(null)
    setShowModal(true)
  }


  // =============================================
  // OPEN EDIT MODAL
  // =============================================
  function openEditModal(location) {
    setEditingLocation(location)
    setShowModal(true)
  }
  

  // =============================================
  // INITIAL LOAD
  // =============================================
  useEffect(() => {
    if (profile?.id) {
      loadLocations()
    }
  }, [profile])


  // =============================================
  // MAIN CONTENT
  // =============================================
  return (
    <div>

      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold text-[#1F3A2C]">
            Delivery Locations
          </h1>

          <p className="text-gray-500">
            Manage your saved delivery addresses.
          </p>
        </div>

        <button
          onClick={openAddModal}
          className="flex items-center gap-2 rounded-lg bg-[#2D5A42] px-4 py-2 text-sm font-medium text-white hover:bg-[#234633]"
        >
          <FontAwesomeIcon icon={faPlus}/>
          Add Location
        </button>
      </div>


      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <table className="min-w-full">
          <thead className="bg-[#F4F8F5]">
            <tr>
              <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                Location
              </th>

              <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                Recipient
              </th>

              <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                Contact
              </th>

              <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                Address
              </th>

              <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                Country
              </th>

              <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                Actions
              </th>
            </tr>
          </thead>

          <tbody>
            {locations.length > 0 ? (
              locations.map((location) => (
                <tr key={location.id} className="border-t border-gray-200 text-sm hover:bg-gray-50">
                  <td className="px-5 py-3 font-medium text-gray-800"> {location.location_name} </td>
                  <td className="px-5 py-3"> {location.recipient_name || '-'} </td>
                  <td className="px-5 py-3"> {location.contact_number || '-'} </td>
                  <td className="px-5 py-3"> {location.address} </td>
                  <td className="px-5 py-3"> {location.country} </td>

                  <td className="px-5 py-3">
                    <div className="flex gap-2">
                      <IconButton icon={faPen} title="Edit Location" color="amber" disabled={false} onClick={() => openEditModal(location)}/>
                      <IconButton icon={faTrash} title="Delete Lcoation" color="red" disabled={false} onClick={() => deleteLocation(location.id)}/>
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan="6" className="py-10 text-center text-sm text-gray-500">
                  No delivery locations found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showModal && (
        <DeliveryLocationModal
          location={editingLocation}
          onClose={() => setShowModal(false)}
          onSubmit={saveLocation}
        />
      )}

    </div>
  )
}


// =============================================
// DELIVERY LOCATION MODAL
// =============================================
function DeliveryLocationModal({ onClose, onSubmit, location }) {

  const [form, setForm] = useState({
    location_name: location?.location_name || '',
    recipient_name: location?.recipient_name || '',
    contact_number: location?.contact_number || '',
    address: location?.address || '',
    country: location?.country || '',
  })


  function handleChange(e) {
    setForm({
      ...form,
      [e.target.name]: e.target.value,
    })
  }


  function handleSubmit(e) {
    e.preventDefault()
    if (!form.location_name || !form.address) return
    onSubmit(form)
    onClose()
  }


  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-2xl overflow-hidden rounded-xl bg-white shadow-xl">

        {/* Header */}
        <div className="border-b bg-[#F4F8F5] px-6 py-4">
          <h2 className="text-xl font-semibold text-[#1F3A2C]">
            {location ? 'Edit Delivery Location' : 'Add Delivery Location'}
          </h2>
        </div>

        <form
          onSubmit={handleSubmit}
          className="space-y-6 p-6"
        >

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Location Name
              </label>

              <input
                type="text"
                name="location_name"
                value={form.location_name}
                onChange={handleChange}
                placeholder="Enter location name"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-[#2D5A42] focus:ring-2 focus:ring-[#3B7556]/20"
                required
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Recipient Name
              </label>

              <input
                type="text"
                name="recipient_name"
                value={form.recipient_name}
                onChange={handleChange}
                placeholder="Enter recipient name"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-[#2D5A42] focus:ring-2 focus:ring-[#3B7556]/20"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Contact Number
              </label>

              <input
                type="text"
                name="contact_number"
                value={form.contact_number}
                onChange={handleChange}
                placeholder="Enter contact number"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-[#2D5A42] focus:ring-2 focus:ring-[#3B7556]/20"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Country
              </label>

              <input
                type="text"
                name="country"
                value={form.country}
                onChange={handleChange}
                placeholder="Enter country"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-[#2D5A42] focus:ring-2 focus:ring-[#3B7556]/20"
                required
              />
            </div>

            <div className="col-span-2">
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Address
              </label>

              <textarea
                name="address"
                value={form.address}
                onChange={handleChange}
                rows={3}
                placeholder="Enter delivery address"
                className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-[#2D5A42] focus:ring-2 focus:ring-[#3B7556]/20"
                required
              />
            </div>
          </div>


          {/* Buttons */}
          <div className="flex justify-end gap-3 pt-5">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-gray-300 px-4 py-2 transition hover:bg-gray-100"
            >
              Cancel
            </button>

            <button
              type="submit"
              className="rounded-lg bg-[#1F3A2C] px-4 py-2 text-white transition hover:bg-[#2D5A42]"
            >
              {location ? 'Save Changes' : 'Save Location'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}