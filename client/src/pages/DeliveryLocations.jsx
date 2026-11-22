'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import ExportButton from '../components/ExportButton'
import { exportList } from '../utils/csvExport'
import { useAuth } from '../context/AuthContext'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faPen, faTrash, faPlus } from '@fortawesome/free-solid-svg-icons'
import { useToast } from "../context/ToastContext"

import IconButton from '../components/IconButton'
import TableScroll from '../components/TableScroll'
import { COUNTRY_NAMES, listedCountry } from '../utils/countryPlaces'


export default function DeliveryLocationsPage() {
  const { profile } = useAuth()
  const { toast } = useToast()

  const [locations, setLocations] = useState([])
  const [showModal, setShowModal] = useState(false)
  const [editingLocation, setEditingLocation] = useState(null)
  // Where each location is used: its requests' and orders' numbers, by id.
  // A location in use is frozen (db/migrations/036): those keep its address.
  const [usedBy, setUsedBy] = useState({})


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
      .eq('is_archived', false)
      .order('created_at', { ascending: false })


    if (error) {
      toast.error(error.message)
      return
    }

    setLocations(data)
    loadUsage().catch((usageError) => console.error('Failed to check where locations are used:', usageError))
  }


  // =============================================
  // WHERE EACH LOCATION IS USED
  // =============================================
  async function loadUsage() {
    const [requests, orders] = await Promise.all([
      supabase.from('quotation_requests').select('delivery_location_id, quotation_reference, created_at').eq('customer_id', profile.id),
      supabase.from('customer_orders').select('delivery_location_id, order_number, created_at').eq('customer_id', profile.id),
    ])
    if (requests.error) throw requests.error
    if (orders.error) throw orders.error

    const used = {}
    const add = (locationId, reference, madeAt) => {
      if (!locationId || !reference) return
      ;(used[locationId] ||= []).push({ reference, madeAt })
    }
    for (const order of orders.data || []) add(order.delivery_location_id, order.order_number, order.created_at)
    for (const request of requests.data || []) add(request.delivery_location_id, request.quotation_reference, request.created_at)
    for (const list of Object.values(used)) list.sort((a, b) => String(b.madeAt).localeCompare(String(a.madeAt)))
    setUsedBy(used)
  }

  const referencesOf = (locationId) => (usedBy[locationId] || []).map((use) => use.reference)


  // =============================================
  // SAVE LOCATION
  // =============================================
  async function saveLocation(formData, { takeOldOff = false } = {}) {
    if (!formData.location_name || !formData.address) {
      alert('Location name and address are required')
      return
    }

    // Contact number is optional, but if given it must look like a phone
    // number. Customers are international, so this checks shape and length
    // (7–15 digits, the international maximum) rather than a PH format.
    const contactNumber = (formData.contact_number || '').trim()

    if (contactNumber) {
      const digitCount = contactNumber.replace(/\D/g, '').length

      if (!/^\+?[\d\s\-()]+$/.test(contactNumber) || digitCount < 7 || digitCount > 15) {
        alert('Please enter a valid contact number: 7 to 15 digits, optionally starting with +.')
        return
      }
    }

    let error
    // A location in use stays as it is: the changes become a new location.
    const asNew = Boolean(editingLocation) && referencesOf(editingLocation.id).length > 0

    if (editingLocation && !asNew) {
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

    if (asNew && takeOldOff) {
      // Archived, since requests or orders use it (db/migrations/011).
      const { error: removeError } = await supabase.rpc('remove_delivery_location', { p_location_id: editingLocation.id })
      if (removeError) toast.error(`The new location was saved, but the old one couldn't be taken off your list: ${removeError.message}`)
    }

    toast.success(
      asNew
        ? `Saved as a new location for your next requests. ${referencesOf(editingLocation.id).join(', ')} keep${referencesOf(editingLocation.id).length === 1 ? 's' : ''} the old address.`
        : editingLocation ? 'Location updated successfully!' : 'Location added successfully!'
    )
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

    // An address used by a past request or order is archived instead, so those
    // records keep it (db/migrations/011).
    const { data: outcome, error } = await supabase.rpc('remove_delivery_location', {
      p_location_id: id,
    })

    if (error) {
      toast.error(error.message)
      return
    }

    toast.success(
      outcome === 'archived'
        ? 'Location removed from your list. Your past requests and orders keep it.'
        : 'Location deleted successfully!'
    )
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

          <p className="mt-1 text-gray-500">
            Manage your saved delivery addresses.
          </p>

          <ExportButton className="mt-3" count={locations.length} onExport={(how) => exportList(how, 'delivery-locations', LOCATION_COLUMNS, locations)} />
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
      <TableScroll className="rounded-xl border border-gray-200 bg-white shadow-sm">
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
                  <td className="px-5 py-3 font-medium text-gray-800">
                    {location.location_name}
                    {referencesOf(location.id).length > 0 && (
                      <span className="mt-0.5 block max-w-[16rem] text-xs font-normal text-gray-500">
                        On {referencesOf(location.id).slice(0, 3).join(', ')}
                        {referencesOf(location.id).length > 3 ? ` and ${referencesOf(location.id).length - 3} more` : ''}: kept as it is
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3"> {location.recipient_name || '-'} </td>
                  <td className="px-5 py-3"> {location.contact_number || '-'} </td>
                  <td className="px-5 py-3"> {location.address} </td>
                  <td className="px-5 py-3"> {location.country} </td>

                  <td className="px-5 py-3">
                    <div className="flex gap-2">
                      <IconButton icon={faPen} title={referencesOf(location.id).length ? 'Change (saved as a new location)' : 'Edit Location'} color="amber" disabled={false} onClick={() => openEditModal(location)}/>
                      <IconButton icon={faTrash} title="Delete Location" color="red" disabled={false} onClick={() => deleteLocation(location.id)}/>
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
      </TableScroll>

      {showModal && (
        <DeliveryLocationModal
          location={editingLocation}
          usedOn={editingLocation ? referencesOf(editingLocation.id) : []}
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
// usedOn: the requests and orders that use this location. Then it can't be
// changed (db/migrations/036): the changes are saved as a new location.
function DeliveryLocationModal({ onClose, onSubmit, location, usedOn = [] }) {
  const asNew = Boolean(location) && usedOn.length > 0
  const [takeOldOff, setTakeOldOff] = useState(true)

  const [form, setForm] = useState({
    location_name: location?.location_name || '',
    recipient_name: location?.recipient_name || '',
    contact_number: location?.contact_number || '',
    address: location?.address || '',
    // As the list writes it (" Hong Kong" -> "Hong Kong"); kept as typed if it isn't listed.
    country: listedCountry(location?.country) || location?.country || '',
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
    onSubmit(form, { takeOldOff: asNew && takeOldOff })
    onClose()
  }


  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white shadow-xl">

        {/* Header */}
        <div className="border-b bg-[#F4F8F5] px-6 py-4">
          <h2 className="text-xl font-semibold text-[#1F3A2C]">
            {asNew ? 'Change Delivery Location' : location ? 'Edit Delivery Location' : 'Add Delivery Location'}
          </h2>

          {asNew && (
            <p className="mt-1 text-sm text-gray-600">
              This address is on {usedOn.slice(0, 4).join(', ')}{usedOn.length > 4 ? ` and ${usedOn.length - 4} more` : ''}, and they keep it as it is.
              Your changes are saved as a new location, for your next requests.
            </p>
          )}
        </div>

        <form
          onSubmit={handleSubmit}
          className="space-y-6 p-6"
        >

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
                type="tel"
                inputMode="tel"
                maxLength={20}
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

              {/* Picked, not typed: the quotation's markup and shipping cost go by
                  this country, so it must be spelled as DMC's rates are. */}
              <select
                name="country"
                value={form.country}
                onChange={handleChange}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 outline-none focus:border-[#2D5A42] focus:ring-2 focus:ring-[#3B7556]/20"
                required
              >
                <option value="">Choose a country</option>
                {form.country && !COUNTRY_NAMES.includes(form.country) && (
                  <option value={form.country}>{form.country} (as typed before)</option>
                )}
                {COUNTRY_NAMES.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </div>

            <div className="sm:col-span-2">
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


          {asNew && (
            <label className="flex items-start gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={takeOldOff}
                onChange={(event) => setTakeOldOff(event.target.checked)}
                className="mt-0.5 h-4 w-4 accent-[#2D5A42]"
              />
              <span>Take the old location off my list (the requests and orders above still show it).</span>
            </label>
          )}

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
              {asNew ? 'Save as a New Location' : location ? 'Save Changes' : 'Save Location'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}


// =============================================
// EXPORT (utils/csvExport.js)
// A row per saved delivery location.
// =============================================
const LOCATION_COLUMNS = [
  { header: 'Location', value: (location) => location.location_name },
  { header: 'Recipient', value: (location) => location.recipient_name },
  { header: 'Contact number', value: (location) => location.contact_number },
  { header: 'Address', value: (location) => location.address },
  { header: 'Country', value: (location) => location.country },
]
