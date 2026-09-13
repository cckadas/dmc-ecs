'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabase'
import { useAuth } from '../context/AuthContext'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faXmark, faFloppyDisk, faLocationDot, faLayerGroup, faWarehouse, faBox, faToggleOn, faToggleOff, faBoxOpen } from '@fortawesome/free-solid-svg-icons'
import { useToast } from "../context/ToastContext"

import IconButton from '../components/IconButton'
import RoleActivityBadge from '../components/RoleActivityBadge'


export default function WarehouseLocationsPage() {

  const { profile } = useAuth()
  const { toast } = useToast()

  const [racks, setRacks] = useState([])
  const [selectedRack, setSelectedRack] = useState(null)
  const [showEditModal, setShowEditModal] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [togglingRackId, setTogglingRackId] = useState(null)
  const [selectedLocation, setSelectedLocation] = useState('all')

  const isAdmin = profile?.role === 'admin'


  // =====================================================
  // LOAD WAREHOUSE RACKS
  // =====================================================
  async function loadWarehouseRacks() {

    setLoading(true)

    try {
      const { data, error } = await supabase
        .from('warehouse_racks')
        .select(`
          id,
          rack_id,
          name,
          location,
          section,
          description,
          is_active,
          created_at,
          updated_at,
          is_occupied
        `)
        .order('location', { ascending: true })
        .order('section', { ascending: true })
        .order('rack_id', { ascending: true })


      if (error) {
        throw error
      }

      setRacks(data || [])
    }

    catch (error) {
      console.error('Failed to load warehouse racks:', error)
      toast.error(error.message || 'Failed to load warehouse locations.')
    }

    finally {
      setLoading(false)
    }
  }


  // =====================================================
  // GROUP RACKS BY LOCATION THEN BY SECTION
  // =====================================================
  const racksByLocation = useMemo(() => {
    const locations = {}

    racks.forEach((rack) => {
      const location = rack.location?.trim() || 'Unassigned Location'
      const section = rack.section?.trim() || 'Unassigned Section'

      if (!locations[location]) {
        locations[location] = {}
      }

      if (!locations[location][section]) {
        locations[location][section] = []
      }

      locations[location][section].push(rack)
    })

    return locations
  }, [racks])


  // =====================================================
  // GET DYNAMIC LOCATIONS
  // =====================================================
  const locations = useMemo(() => {
    return Object.keys(racksByLocation)
  }, [racksByLocation])


  // =====================================================
  // GET ONLY THE SELECTED LOCATION
  // =====================================================
  const visibleLocations = useMemo(() => {
    if (selectedLocation === 'all') {

      return Object.entries(
        racksByLocation
      )
    }

    return Object.entries(racksByLocation).filter(([location]) => location === selectedLocation)
  }, [ racksByLocation, selectedLocation ])


  // =====================================================
  // RESET SELECTED LOCATION IF IT NO LONGER EXISTS
  // =====================================================
  useEffect(() => {
    if ( selectedLocation !== 'all' && !locations.includes(selectedLocation)) {
      setSelectedLocation('all')
    }
  }, [ locations, selectedLocation ])


  // =====================================================
  // TOGGLE RACK OCCUPANCY
  // =====================================================
  async function toggleRackOccupied(rack) {
    if (!rack?.id) {
      toast.error('Missing rack information.')
      return
    }

    setTogglingRackId(rack.id)

    try {
      const newOccupiedState = !rack.is_occupied

      const { error } = await supabase
        .from('warehouse_racks')
        .update({
          is_occupied: newOccupiedState,
          updated_at: new Date().toISOString(),
        })
        .eq('id', rack.id)

      if (error) {
        throw error
      }

      // =================================================
      // UPDATE UI IMMEDIATELY
      // =================================================
      setRacks((prev) =>
        prev.map((item) =>
          item.id === rack.id
            ? {
                ...item,
                is_occupied: newOccupiedState,
                updated_at: new Date().toISOString(),
              }
            : item
        )
      )


      toast.success(newOccupiedState ? `${rack.name || rack.rack_id} marked as occupied.` : `${rack.name || rack.rack_id} marked as available.`)
    }

    catch (error) {
      console.error('Failed to update rack occupancy:', error)
      toast.error(error.message || 'Failed to update rack occupancy.')
    }

    finally {
      setTogglingRackId(null)
    }
  }


  // =====================================================
  // OPEN EDIT MODAL 
  // =====================================================
  function openEditModal(rack) {
    if (!isAdmin) {
      return
    }

    setSelectedRack({
      ...rack,
    })

    setShowEditModal(true)
  }


  // =====================================================
  // CLOSE EDIT MODAL
  // =====================================================
  function closeEditModal() {
    if (saving) { return }

    setShowEditModal(false)
    setSelectedRack(null)
  }


  // =====================================================
  // UPDATE SELECTED RACK FIELD
  // =====================================================
  function updateSelectedRack( field, value ) {
    setSelectedRack((prev) => ({ ...prev,  [field]: value }))
  }


  // =====================================================
  // SAVE RACK DETAILS
  // =====================================================
  async function saveRackDetails() {
    if (!isAdmin) {
      toast.error('Only administrators can edit rack details.')
      return
    }

    if (!selectedRack?.id) {
      toast.error('Missing rack information.')
      return
    }

    if (!selectedRack.rack_id?.trim()) {
      toast.error('Rack ID is required.')
      return
    }

    if (!selectedRack.name?.trim()) {
      toast.error('Rack name is required.')
      return
    }

    setSaving(true)

    try {
      const updateData = {
        rack_id: selectedRack.rack_id.trim(),
        name: selectedRack.name.trim(),
        location: selectedRack.location?.trim() || null,
        section: selectedRack.section?.trim() || null,
        description: selectedRack.description?.trim() || null,
        is_active: Boolean( selectedRack.is_active ),
        updated_at: new Date().toISOString(),
      }

      const { data, error } =
        await supabase
          .from('warehouse_racks')
          .update(updateData)
          .eq('id', selectedRack.id)
          .select()
          .single()

      if (error) {
        throw error
      }


      // =================================================
      // UPDATE UI
      // =================================================
      setRacks((prev) =>
        prev.map((rack) =>
          rack.id === selectedRack.id
            ? {
                ...rack,
                ...data,
              }
            : rack
        )
      )

      toast.success('Warehouse rack updated successfully.')
      closeEditModal()
    }

    catch (error) {
      console.error('Failed to update warehouse rack:', error)
      toast.error(error.message || 'Failed to update warehouse rack.')
    }

    finally {
      setSaving(false)
    }
  }


  // =====================================================
  // INITIAL LOAD
  // =====================================================
  useEffect(() => {
    loadWarehouseRacks()
  }, [])


  // =====================================================
  // MAIN CONTENT
  // =====================================================
  return (
    <div>

      {/* =================================================
          HEADER
      ================================================= */}
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">

        {/* =================================================
            TITLE + SUBTITLE
        ================================================= */}
        <div>
          <h1 className="text-3xl font-bold text-[#1F3A2C]">
            Warehouse Locations
          </h1>

          <p className="mt-1 text-gray-500">
            View and manage warehouse racks by location and section.
          </p>
        </div>


        {/* =================================================
            LOCATION FILTER CHIPS
        ================================================= */}
        {!loading && locations.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">

            {/* =================================================
                ALL LOCATIONS
            ================================================= */}
            <button
              type="button"
              onClick={() => setSelectedLocation('all')}
              className={`rounded-lg border px-4 py-2 text-sm font-medium transition ${selectedLocation === 'all' ? 'border-[#1F3A2C] bg-[#1F3A2C] text-white' : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50'}`}
            >
              All
            </button>

            {/* =================================================
                DYNAMIC LOCATION BUTTONS
            ================================================= */}
            {locations.map((location) => (
              <button
                key={location}
                type="button"
                onClick={() => setSelectedLocation(location)}
                title={`Show ${location}`}
                className={`rounded-lg border px-4 py-2 text-sm font-medium transition ${selectedLocation === location ? 'border-[#1F3A2C] bg-[#1F3A2C] text-white' : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50'}`}
              >
                {location}
              </button>
            ))}
          </div>
        )}
      </div>


      {/* =================================================
          LOADING
      ================================================= */}
      {loading ? (

        <div className="rounded-xl border border-gray-200 bg-white py-16 text-center shadow-sm">
          <p className="text-sm text-gray-500">
            Loading warehouse locations...
          </p>
        </div>

      ) : racks.length === 0 ? (

        /* =================================================
            EMPTY STATE
        ================================================= */
        <div className="rounded-xl border border-gray-200 bg-white py-16 text-center shadow-sm">
          <FontAwesomeIcon icon={faWarehouse} className="mb-4 text-4xl text-gray-300"/>

          <p className="text-sm font-medium text-gray-600">
            No warehouse racks found.
          </p>

          <p className="mt-1 text-sm text-gray-400">
            Warehouse locations will appear here once racks are added.
          </p>
        </div>

      ) : visibleLocations.length === 0 ? (

        /* =================================================
            NO SELECTED LOCATION
        ================================================= */
        <div className="rounded-xl border border-gray-200 bg-white py-16 text-center shadow-sm">
          <FontAwesomeIcon  icon={faLocationDot} className="mb-4 text-4xl text-gray-300"/>

          <p className="text-sm font-medium text-gray-600">
            No racks found for this location.
          </p>
        </div>

      ) : (

        /* =================================================
            LOCATIONS
        ================================================= */
        <div className="space-y-6">

          {visibleLocations.map(([location, sections]) => (

              /* =================================================
                  LOCATION CARD
              ================================================= */
              <div key={location} className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">

                <div className="border-b border-gray-200 bg-[#F4F8F5] px-6 py-5">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#1F3A2C] text-white">
                      <FontAwesomeIcon icon={faLocationDot}/>
                    </div>

                    <div>
                      <h2 className="text-lg leading-tight font-semibold text-[#1F3A2C]">
                        {location}
                      </h2>

                      <p className="text-md leading-tight text-gray-500">
                        {Object.values(sections).reduce((total, sectionRacks) => total + sectionRacks.length, 0)} rack{Object.values(sections).reduce((total, sectionRacks) => total + sectionRacks.length, 0) !== 1 ? 's' : ''}
                      </p>
                    </div>
                  </div>
                </div>


                <div className="p-6">
                  <div className="space-y-6">
                    {Object.entries(sections).map(([section, sectionRacks]) => (
                      <div key={section}>
                        <div className="mb-3 flex items-center gap-2">
                          <FontAwesomeIcon icon={faLayerGroup} className="text-gray-400"/>

                          <h3 className="text-sm font-semibold text-gray-700">
                            {section}
                          </h3>
                        </div>

                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                          {sectionRacks.map((rack) => (
                            <RackCard key={rack.id} rack={rack} toggling={ togglingRackId === rack.id} onToggleOccupied={() => toggleRackOccupied(rack)} onEdit={() => openEditModal(rack)}/>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

              </div>
            )
          )}
        </div>
      )}


      {/* =====================================================
          EDIT RACK MODAL
      ===================================================== */}
      {showEditModal && selectedRack && (
        <RackEditModal
          rack={selectedRack}
          isAdmin={isAdmin}
          saving={saving}
          onChange={updateSelectedRack}
          onSave={saveRackDetails}
          onClose={closeEditModal}
        />
      )}

    </div>
  )
}





// =====================================================
// RACK CARD
// =====================================================
function RackCard({ rack, toggling, onToggleOccupied, onEdit }) {

  const occupied = Boolean(rack.is_occupied)
  const inactive = !rack.is_active

  return (
    <div onClick={() => onEdit(rack)} className={`relative cursor-pointer rounded-xl border bg-white p-5 shadow-sm transition ${inactive ? 'border-gray-200 opacity-60' : occupied ? 'border-amber-200' : 'border-gray-200'} hover:shadow-md`}>

      {/* =================================================
          TOP
      ================================================= */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div
            className={`
              flex h-10 w-10 items-center justify-center rounded-lg bg-[#F4F8F5]
              ${occupied ? 'text-amber-600' : 'text-[#2D5A42]'}
            `}
          >
            <FontAwesomeIcon icon={occupied ? faBox : faBoxOpen} />
          </div>

          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
              {rack.rack_id}
            </p>

            <h4 className="truncate font-semibold text-gray-800">
              {rack.name}
            </h4>
          </div>
        </div>
      </div>


      {/* =================================================
          DESCRIPTION
      ================================================= */}
      <div className="mt-4 min-h-[42px]">
        {rack.description ? (
          <p className="text-sm leading-5 text-gray-500">
            {rack.description}
          </p>
        ) : (
          <p className="text-sm italic text-gray-400">
            No description.
          </p>
        )}
      </div>


      {/* =================================================
          STATUS
      ================================================= */}
      <div className="mt-4 flex items-center justify-between border-t border-gray-100 pt-4">

        <RoleActivityBadge status={inactive ? 'inactive' : occupied ? 'occupied' : 'available'}/>

        {!inactive && (
          <div onClick={(e) => e.stopPropagation()}>
            <IconButton
              icon={occupied ? faToggleOn : faToggleOff}
              title={inactive ? 'Inactive rack' : occupied ? 'Mark as available' : 'Mark as occupied'}
              color={inactive ? 'gray' : occupied ? 'amber' : 'blue'}
              disabled={toggling || inactive}
              onClick={onToggleOccupied}
            />
          </div>
        )}

      </div>
    </div>
  )
}






// =====================================================
// EDIT RACK MODAL
// =====================================================
function RackEditModal({ rack, isAdmin, saving, onChange, onSave, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white shadow-xl">

        {/* =================================================
            HEADER
        ================================================= */}
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div>
            <h2 className="text-xl font-semibold text-gray-800">
              Edit Warehouse Rack
            </h2>

            <p className="text-sm text-gray-500">
              Update the details of this warehouse rack.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-md p-2 text-gray-500 hover:bg-gray-100 disabled:opacity-50"
          >
            <FontAwesomeIcon icon={faXmark}/>
          </button>
        </div>


        {/* =================================================
            CONTENT
        ================================================= */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">

            {/* =================================================
                RACK ID
            ================================================= */}
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Rack ID
              </label>

              <input
                type="text"
                value={rack.rack_id || ''}
                onChange={(e) => onChange('rack_id', e.target.value)}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-[#1F3A2C] focus:ring-1 focus:ring-[#1F3A2C]"
              />
            </div>


            {/* =================================================
                NAME
            ================================================= */}
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Rack Name
              </label>

              <input
                type="text"
                value={rack.name || ''}
                onChange={(e) => onChange('name', e.target.value)}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-[#1F3A2C] focus:ring-1 focus:ring-[#1F3A2C]"
              />
            </div>


            {/* =================================================
                LOCATION
            ================================================= */}
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Location
              </label>

              <input
                type="text"
                value={rack.location || ''}
                onChange={(e) => onChange( 'location', e.target.value)}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-[#1F3A2C] focus:ring-1 focus:ring-[#1F3A2C]"
              />
            </div>


            {/* =================================================
                SECTION
            ================================================= */}
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Section
              </label>

              <input
                type="text"
                value={rack.section || ''}
                onChange={(e) => onChange('section', e.target.value)}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-[#1F3A2C] focus:ring-1 focus:ring-[#1F3A2C]"
              />
            </div>


            {/* =================================================
                DESCRIPTION
            ================================================= */}
            <div className="md:col-span-2">
              <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Description
              </label>

              <textarea
                rows="4"
                value={rack.description || ''}
                onChange={(e) => onChange('description', e.target.value)}
                className="mt-1 w-full resize-none rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-[#1F3A2C] focus:ring-1 focus:ring-[#1F3A2C]"
              />
            </div>


            {/* =================================================
                ACTIVE STATUS
            ================================================= */}
            <div className="md:col-span-2">
              <div className="flex items-center justify-between rounded-lg bg-gray-50 p-4">
                <div>
                  <p className="text-sm font-semibold text-gray-700">
                    Rack Status
                  </p>

                  <p className="mt-1 text-xs text-gray-500">
                    Inactive racks remain visible but cannot be marked as occupied.
                  </p>
                </div>

                <button
                  type="button"
                  disabled={!isAdmin}
                  onClick={() => isAdmin && onChange('is_active', !rack.is_active)}
                  className={`
                    flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition
                    ${rack.is_active ? 'bg-green-100 text-green-700 hover:bg-green-200': 'bg-gray-200 text-gray-600 hover:bg-gray-300'}
                    ${!isAdmin ? 'cursor-not-allowed opacity-70' : ''}
                  `}
                >
                  <FontAwesomeIcon icon={rack.is_active ? faToggleOn : faToggleOff} />
                  {rack.is_active ? 'Active' : 'Inactive'}
                </button>
              </div>
            </div>

          </div>
        </div>


        {/* =================================================
            FOOTER
        ================================================= */}
        <div className="flex items-center justify-end gap-3 bg-gray-50 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>

          {isAdmin ?? (
            <button
              type="button"
              onClick={onSave}
              disabled={saving}
              className="flex items-center gap-2 rounded-md bg-[#1F3A2C] px-4 py-2 text-sm font-medium text-white hover:bg-[#162C21] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <FontAwesomeIcon icon={ saving ? faToggleOn : faFloppyDisk}/>
              {saving ? 'Saving...' : 'Save Changes'}
            </button>       
          )}
        </div>

      </div>
    </div>
  )
}