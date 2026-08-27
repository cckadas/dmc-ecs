import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabase'
import { useToast } from '../context/ToastContext'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'

import {
  faWarehouse,
  faTruckFast,
  faLocationDot,
  faMagnifyingGlass,
  faXmark,
  faCheckCircle,
  faBan,
  faLayerGroup,
  faArrowRight,
  faDoorOpen,
  faRoad,
  faPlus,
  faPen,
  faCircleExclamation,
} from '@fortawesome/free-solid-svg-icons'


export default function WarehouseLocationPage() {

  const { toast } = useToast()

  const [racks, setRacks] = useState([])
  const [loading, setLoading] = useState(true)

  const [selectedRack, setSelectedRack] = useState(null)

  const [search, setSearch] = useState('')

  const [showRackModal, setShowRackModal] = useState(false)
  const [editingRack, setEditingRack] = useState(null)

  const [saving, setSaving] = useState(false)

  const [formData, setFormData] = useState({
    rack_id: '',
    name: '',
    location: '',
    section: '',
    description: '',
    is_active: true,
    is_occupied: false,
  })


  // =====================================================
  // LOAD WAREHOUSE RACKS
  // =====================================================

  async function loadRacks() {

    setLoading(true)

    try {

      const {
        data,
        error,
      } = await supabase

        .from('warehouse_racks')

        .select('*')

        .order('rack_id', {
          ascending: true,
        })


      if (error) {
        throw error
      }


      setRacks(data || [])

    }

    catch (error) {

      console.error(
        'Failed to load warehouse racks:',
        error
      )

      toast.error(
        error.message ||
        'Failed to load warehouse locations.'
      )

    }

    finally {

      setLoading(false)

    }

  }


  // =====================================================
  // INITIAL LOAD
  // =====================================================

  useEffect(() => {

    loadRacks()

  }, [])


  // =====================================================
  // FILTER RACKS
  // =====================================================

  const filteredRacks = useMemo(() => {

    const value =
      search.trim().toLowerCase()

    if (!value) {
      return racks
    }


    return racks.filter((rack) => {

      return (

        String(
          rack.rack_id || ''
        )
          .toLowerCase()
          .includes(value)

        ||

        String(
          rack.name || ''
        )
          .toLowerCase()
          .includes(value)

        ||

        String(
          rack.location || ''
        )
          .toLowerCase()
          .includes(value)

        ||

        String(
          rack.section || ''
        )
          .toLowerCase()
          .includes(value)

      )

    })

  }, [
    racks,
    search,
  ])


  // =====================================================
  // STATISTICS
  // =====================================================

  const totalRacks =
    racks.length


  const activeRacks =
    racks.filter(
      (rack) => rack.is_active
    ).length


  const inactiveRacks =
    racks.filter(
      (rack) => !rack.is_active
    ).length


  const occupiedRacks =
    racks.filter(
      (rack) =>
        rack.is_active &&
        rack.is_occupied
    ).length


  // =====================================================
  // GET RACK STATUS
  // =====================================================

  function getRackStatus(rack) {

    if (!rack.is_active) {

      return {
        label: 'Inactive',
        className:
          'border-gray-300 bg-gray-100 text-gray-500',
        icon: faBan,
      }

    }


    if (rack.is_occupied) {

      return {
        label: 'Occupied',
        className:
          'border-amber-200 bg-amber-50 text-amber-600',
        icon: faCircleExclamation,
      }

    }


    return {
      label: 'Available',
      className:
        'border-[#B8D5C3] bg-[#F4F8F5] text-[#2D5A42]',
      icon: faCheckCircle,
    }

  }


  // =====================================================
  // OPEN ADD MODAL
  // =====================================================

  function openAddModal() {

    setEditingRack(null)

    setFormData({
      rack_id: '',
      name: '',
      location: '',
      section: '',
      description: '',
      is_active: true,
      is_occupied: false,
    })

    setShowRackModal(true)

  }


  // =====================================================
  // OPEN EDIT MODAL
  // =====================================================

  function openEditModal(rack) {

    setEditingRack(rack)

    setFormData({
      rack_id: rack.rack_id || '',
      name: rack.name || '',
      location: rack.location || '',
      section: rack.section || '',
      description: rack.description || '',
      is_active: rack.is_active ?? true,
      is_occupied: rack.is_occupied ?? false,
    })

    setSelectedRack(null)

    setShowRackModal(true)

  }


  // =====================================================
  // HANDLE FORM CHANGE
  // =====================================================

  function handleFormChange(event) {

    const {
      name,
      value,
      type,
      checked,
    } = event.target


    setFormData((prev) => ({
      ...prev,
      [name]:
        type === 'checkbox'
          ? checked
          : value,
    }))

  }


  // =====================================================
  // SAVE RACK
  // =====================================================

  async function saveRack(event) {

    event.preventDefault()

    if (!formData.rack_id.trim()) {

      toast.error(
        'Rack ID is required.'
      )

      return
    }


    if (!formData.name.trim()) {

      toast.error(
        'Rack name is required.'
      )

      return
    }


    setSaving(true)


    try {

      const payload = {

        rack_id:
          formData.rack_id.trim(),

        name:
          formData.name.trim(),

        location:
          formData.location.trim() ||
          null,

        section:
          formData.section.trim() ||
          null,

        description:
          formData.description.trim() ||
          null,

        is_active:
          formData.is_active,

        is_occupied:
          formData.is_occupied,

        updated_at:
          new Date().toISOString(),

      }


      // =================================================
      // UPDATE
      // =================================================

      if (editingRack) {

        const {
          data,
          error,
        } = await supabase

          .from('warehouse_racks')

          .update(payload)

          .eq(
            'id',
            editingRack.id
          )

          .select()

          .single()


        if (error) {
          throw error
        }


        setRacks((prev) =>
          prev.map((rack) =>
            rack.id === editingRack.id
              ? data
              : rack
          )
        )


        toast.success(
          'Warehouse rack updated successfully.'
        )

      }

      // =================================================
      // CREATE
      // =================================================

      else {

        const {
          data,
          error,
        } = await supabase

          .from('warehouse_racks')

          .insert(payload)

          .select()

          .single()


        if (error) {
          throw error
        }


        setRacks((prev) =>
          [...prev, data].sort(
            (a, b) =>
              String(a.rack_id)
                .localeCompare(
                  String(b.rack_id)
                )
          )
        )


        toast.success(
          'Warehouse rack added successfully.'
        )

      }


      setShowRackModal(false)

      setEditingRack(null)

    }

    catch (error) {

      console.error(
        'Failed to save warehouse rack:',
        error
      )

      toast.error(
        error.message ||
        'Failed to save warehouse rack.'
      )

    }

    finally {

      setSaving(false)

    }

  }


  // =====================================================
  // GET RACK CODE
  // =====================================================

  function getRackCode(rack, index) {

    return (
      rack.rack_id ||
      rack.name ||
      `R-${String(index + 1).padStart(2, '0')}`
    )

  }


  // =====================================================
  // RACK COMPONENT
  // =====================================================

  function Rack({
    rack,
    index,
  }) {

    const status =
      getRackStatus(rack)

    const code =
      getRackCode(
        rack,
        index
      )


    return (

      <button
        type="button"
        onClick={() =>
          setSelectedRack(rack)
        }
        className="group relative w-full text-left"
      >

        {/* =================================================
            RACK
        ================================================= */}

        <div
          className={`
            relative
            min-h-[150px]
            overflow-hidden
            rounded-lg
            border-2
            bg-white
            shadow-sm
            transition-all
            duration-200

            ${
              !rack.is_active
                ? 'border-gray-300 opacity-60'
                : rack.is_occupied
                  ? 'border-amber-400'
                  : 'border-[#2D5A42]'
            }

            group-hover:-translate-y-1
            group-hover:shadow-lg
          `}
        >

          {/* =================================================
              RACK HEADER
          ================================================= */}

          <div
            className={`
              flex
              items-center
              justify-between
              border-b
              px-3
              py-2

              ${
                !rack.is_active
                  ? 'border-gray-200 bg-gray-100'
                  : rack.is_occupied
                    ? 'border-amber-100 bg-amber-50'
                    : 'border-[#DCE8E1] bg-[#F4F8F5]'
              }
            `}
          >

            <div className="flex items-center gap-2">

              <FontAwesomeIcon
                icon={faLayerGroup}
                className={`
                  h-3.5
                  w-3.5

                  ${
                    !rack.is_active
                      ? 'text-gray-400'
                      : rack.is_occupied
                        ? 'text-amber-600'
                        : 'text-[#2D5A42]'
                  }
                `}
              />

              <span className="text-xs font-bold uppercase tracking-wide text-gray-700">

                {code}

              </span>

            </div>


            <FontAwesomeIcon
              icon={status.icon}
              className={`
                h-3.5
                w-3.5

                ${
                  !rack.is_active
                    ? 'text-gray-400'
                    : rack.is_occupied
                      ? 'text-amber-500'
                      : 'text-[#2D5A42]'
                }
              `}
            />

          </div>


          {/* =================================================
              SHELVES
          ================================================= */}

          <div className="flex flex-col gap-2 p-3">

            {[1, 2, 3].map((level) => (

              <div
                key={level}
                className="
                  relative
                  flex
                  h-6
                  items-center
                  border
                  border-gray-300
                  bg-gray-50
                "
              >

                <div
                  className="
                    absolute
                    left-1
                    h-3
                    w-8
                    rounded-sm
                    bg-[#DCE8E1]
                  "
                />

                <div
                  className="
                    absolute
                    left-11
                    h-3
                    w-6
                    rounded-sm
                    bg-[#E7EFEA]
                  "
                />

                <div
                  className="
                    absolute
                    right-2
                    h-3
                    w-10
                    rounded-sm
                    bg-[#DCE8E1]
                  "
                />

              </div>

            ))}

          </div>


          {/* =================================================
              RACK LABEL
          ================================================= */}

          <div className="absolute bottom-0 left-0 right-0 bg-[#1F3A2C]/95 px-3 py-2">

            <div className="flex items-center justify-between gap-2">

              <p className="truncate text-xs font-semibold text-white">

                {rack.name ||
                  rack.location ||
                  'Warehouse Rack'}

              </p>

              {rack.section && (

                <span className="shrink-0 text-[10px] text-white/60">

                  {rack.section}

                </span>

              )}

            </div>

          </div>

        </div>

      </button>

    )

  }


  // =====================================================
  // MAIN CONTENT
  // =====================================================

  return (

    <div className="min-h-full">

      {/* =================================================
          HEADER
      ================================================= */}

      <div className="mb-6">

        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">

          <div>

            <div className="mb-2 flex items-center gap-2 text-sm font-medium text-[#2D5A42]">

              <FontAwesomeIcon
                icon={faWarehouse}
                className="h-4 w-4"
              />

              Warehouse

            </div>


            <h1 className="text-3xl font-bold text-[#1F3A2C]">

              Warehouse Locations

            </h1>


            <p className="mt-1 text-gray-500">

              View the warehouse layout and manage rack locations.

            </p>

          </div>


          {/* =================================================
              ACTIONS
          ================================================= */}

          <div className="flex flex-col gap-3 sm:flex-row">

            {/* SEARCH */}

            <div className="relative w-full sm:w-72">

              <FontAwesomeIcon
                icon={faMagnifyingGlass}
                className="
                  absolute
                  left-3
                  top-1/2
                  h-4
                  w-4
                  -translate-y-1/2
                  text-gray-400
                "
              />

              <input
                type="text"
                value={search}
                onChange={(event) =>
                  setSearch(
                    event.target.value
                  )
                }
                placeholder="Search rack..."
                className="
                  w-full
                  rounded-lg
                  border
                  border-gray-200
                  bg-white
                  py-2.5
                  pl-10
                  pr-4
                  text-sm
                  outline-none
                  transition
                  focus:border-[#2D5A42]
                  focus:ring-2
                  focus:ring-[#2D5A42]/10
                "
              />

            </div>


            {/* ADD RACK */}

            <button
              type="button"
              onClick={openAddModal}
              className="
                inline-flex
                shrink-0
                items-center
                justify-center
                gap-2
                rounded-lg
                bg-[#2D5A42]
                px-4
                py-2.5
                text-sm
                font-semibold
                text-white
                transition
                hover:bg-[#234A36]
              "
            >

              <FontAwesomeIcon
                icon={faPlus}
                className="h-4 w-4"
              />

              Add Rack

            </button>

          </div>

        </div>

      </div>


      {/* =================================================
          WAREHOUSE SUMMARY
      ================================================= */}

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">

        {/* TOTAL */}

        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">

          <div className="flex items-center justify-between">

            <div>

              <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">

                Total Racks

              </p>

              <p className="mt-1 text-3xl font-bold text-[#1F3A2C]">

                {loading
                  ? '-'
                  : totalRacks
                }

              </p>

            </div>


            <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-[#F4F8F5] text-[#2D5A42]">

              <FontAwesomeIcon
                icon={faLayerGroup}
                className="h-5 w-5"
              />

            </div>

          </div>

        </div>


        {/* ACTIVE */}

        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">

          <div className="flex items-center justify-between">

            <div>

              <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">

                Active Racks

              </p>

              <p className="mt-1 text-3xl font-bold text-[#2D5A42]">

                {loading
                  ? '-'
                  : activeRacks
                }

              </p>

            </div>


            <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-[#F4F8F5] text-[#2D5A42]">

              <FontAwesomeIcon
                icon={faCheckCircle}
                className="h-5 w-5"
              />

            </div>

          </div>

        </div>


        {/* OCCUPIED */}

        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">

          <div className="flex items-center justify-between">

            <div>

              <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">

                Occupied Racks

              </p>

              <p className="mt-1 text-3xl font-bold text-amber-600">

                {loading
                  ? '-'
                  : occupiedRacks
                }

              </p>

            </div>


            <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-amber-50 text-amber-600">

              <FontAwesomeIcon
                icon={faCircleExclamation}
                className="h-5 w-5"
              />

            </div>

          </div>

        </div>


        {/* INACTIVE */}

        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">

          <div className="flex items-center justify-between">

            <div>

              <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">

                Inactive Racks

              </p>

              <p className="mt-1 text-3xl font-bold text-gray-500">

                {loading
                  ? '-'
                  : inactiveRacks
                }

              </p>

            </div>


            <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-gray-100 text-gray-500">

              <FontAwesomeIcon
                icon={faBan}
                className="h-5 w-5"
              />

            </div>

          </div>

        </div>

      </div>


      {/* =================================================
          WAREHOUSE FLOOR
      ================================================= */}

      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">

        {/* =================================================
            FLOOR HEADER
        ================================================= */}

        <div className="flex flex-col gap-4 border-b border-gray-100 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">

          <div className="flex items-center gap-3">

            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#2D5A42] text-white">

              <FontAwesomeIcon
                icon={faWarehouse}
                className="h-5 w-5"
              />

            </div>


            <div>

              <h2 className="font-semibold text-gray-800">

                Warehouse Floor

              </h2>

              <p className="text-sm text-gray-500">

                Rack arrangement and storage locations

              </p>

            </div>

          </div>


          {/* =================================================
              LEGEND
          ================================================= */}

          <div className="flex flex-wrap items-center gap-4 text-xs">

            <div className="flex items-center gap-2">

              <span className="h-3 w-3 rounded border-2 border-[#2D5A42] bg-[#F4F8F5]" />

              Available

            </div>


            <div className="flex items-center gap-2">

              <span className="h-3 w-3 rounded border-2 border-amber-400 bg-amber-50" />

              Occupied

            </div>


            <div className="flex items-center gap-2">

              <span className="h-3 w-3 rounded border border-gray-300 bg-gray-100" />

              Inactive

            </div>

          </div>

        </div>


        {/* =================================================
            FLOOR PLAN
        ================================================= */}

        <div className="relative overflow-x-auto bg-[#F8FAF9] p-6">

          {/* FLOOR */}

          <div className="relative min-w-[900px] rounded-xl border-2 border-dashed border-gray-300 bg-white p-6">

            {/* =================================================
                ENTRANCE
            ================================================= */}

            <div className="mb-6 flex justify-center">

              <div className="flex items-center gap-2 rounded-lg border border-[#B8D5C3] bg-[#F4F8F5] px-5 py-2 text-xs font-semibold text-[#2D5A42]">

                <FontAwesomeIcon
                  icon={faDoorOpen}
                  className="h-4 w-4"
                />

                WAREHOUSE ENTRANCE

              </div>

            </div>


            {/* =================================================
                AISLES
            ================================================= */}

            {loading ? (

              <div className="grid grid-cols-4 gap-6">

                {[1, 2, 3, 4, 5, 6, 7, 8].map(
                  (item) => (

                    <div
                      key={item}
                      className="
                        h-[150px]
                        animate-pulse
                        rounded-lg
                        bg-gray-100
                      "
                    />

                  )
                )}

              </div>

            ) : filteredRacks.length > 0 ? (

              <div className="space-y-8">

                {/* =================================================
                    FIRST AISLE
                ================================================= */}

                <div>

                  <div className="mb-3 flex items-center gap-2">

                    <FontAwesomeIcon
                      icon={faRoad}
                      className="h-3.5 w-3.5 text-gray-400"
                    />

                    <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">

                      Aisle 01

                    </span>

                  </div>


                  <div className="grid grid-cols-4 gap-5">

                    {filteredRacks

                      .filter(
                        (_, index) =>
                          index % 2 === 0
                      )

                      .map(
                        (rack, index) => (

                          <Rack
                            key={rack.id}
                            rack={rack}
                            index={index}
                          />

                        )
                      )}

                  </div>

                </div>


                {/* =================================================
                    WALKWAY
                ================================================= */}

                <div className="flex items-center justify-center">

                  <div className="flex w-full items-center gap-3">

                    <div className="h-px flex-1 border-t border-dashed border-gray-300" />


                    <div className="flex items-center gap-2 rounded-full bg-gray-100 px-4 py-2 text-xs font-medium text-gray-400">

                      <FontAwesomeIcon
                        icon={faArrowRight}
                        className="h-3 w-3"
                      />

                      WALKWAY

                    </div>


                    <div className="h-px flex-1 border-t border-dashed border-gray-300" />

                  </div>

                </div>


                {/* =================================================
                    SECOND AISLE
                ================================================= */}

                <div>

                  <div className="mb-3 flex items-center gap-2">

                    <FontAwesomeIcon
                      icon={faRoad}
                      className="h-3.5 w-3.5 text-gray-400"
                    />

                    <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">

                      Aisle 02

                    </span>

                  </div>


                  <div className="grid grid-cols-4 gap-5">

                    {filteredRacks

                      .filter(
                        (_, index) =>
                          index % 2 !== 0
                      )

                      .map(
                        (rack, index) => (

                          <Rack
                            key={rack.id}
                            rack={rack}
                            index={index}
                          />

                        )
                      )}

                  </div>

                </div>

              </div>

            ) : (

              <div className="flex min-h-[350px] flex-col items-center justify-center text-center">

                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gray-100 text-gray-400">

                  <FontAwesomeIcon
                    icon={faWarehouse}
                    className="h-7 w-7"
                  />

                </div>


                <h3 className="mt-4 font-semibold text-gray-700">

                  No racks found

                </h3>


                <p className="mt-1 max-w-sm text-sm text-gray-400">

                  {search
                    ? 'No warehouse racks match your search.'
                    : 'No warehouse racks have been configured yet.'
                  }

                </p>


                {!search && (

                  <button
                    type="button"
                    onClick={openAddModal}
                    className="
                      mt-4
                      inline-flex
                      items-center
                      gap-2
                      rounded-lg
                      bg-[#2D5A42]
                      px-4
                      py-2
                      text-sm
                      font-semibold
                      text-white
                      transition
                      hover:bg-[#234A36]
                    "
                  >

                    <FontAwesomeIcon
                      icon={faPlus}
                      className="h-4 w-4"
                    />

                    Add First Rack

                  </button>

                )}

              </div>

            )}


            {/* =================================================
                SHIPPING / EXIT
            ================================================= */}

            <div className="mt-8 flex justify-end">

              <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-5 py-2 text-xs font-semibold text-gray-500">

                <FontAwesomeIcon
                  icon={faTruckFast}
                  className="h-4 w-4"
                />

                SHIPPING / DISPATCH

              </div>

            </div>

          </div>

        </div>

      </div>


      {/* =====================================================
          SELECTED RACK MODAL
      ===================================================== */}

      {selectedRack && (

        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">

          <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl">

            {/* HEADER */}

            <div className="flex items-center justify-between border-b border-gray-100 px-6 py-5">

              <div className="flex items-center gap-3">

                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#F4F8F5] text-[#2D5A42]">

                  <FontAwesomeIcon
                    icon={faLayerGroup}
                    className="h-5 w-5"
                  />

                </div>


                <div>

                  <h2 className="font-semibold text-gray-800">

                    {selectedRack.rack_id}

                  </h2>

                  <p className="text-sm text-gray-500">

                    Warehouse Rack

                  </p>

                </div>

              </div>


              <button
                type="button"
                onClick={() =>
                  setSelectedRack(null)
                }
                className="
                  flex
                  h-8
                  w-8
                  items-center
                  justify-center
                  rounded-lg
                  text-gray-400
                  transition
                  hover:bg-gray-100
                  hover:text-gray-600
                "
              >

                <FontAwesomeIcon
                  icon={faXmark}
                  className="h-4 w-4"
                />

              </button>

            </div>


            {/* BODY */}

            <div className="space-y-5 p-6">

              {/* STATUS */}

              <div className="flex items-center justify-between rounded-lg bg-gray-50 px-4 py-3">

                <span className="text-sm font-medium text-gray-600">

                  Status

                </span>


                <span
                  className={`
                    inline-flex
                    items-center
                    gap-2
                    rounded-full
                    px-3
                    py-1
                    text-xs
                    font-semibold

                    ${
                      !selectedRack.is_active
                        ? 'bg-gray-200 text-gray-500'
                        : selectedRack.is_occupied
                          ? 'bg-amber-100 text-amber-600'
                          : 'bg-[#E6F0EA] text-[#2D5A42]'
                    }
                  `}
                >

                  <span className="h-1.5 w-1.5 rounded-full bg-current" />

                  {!selectedRack.is_active
                    ? 'Inactive'
                    : selectedRack.is_occupied
                      ? 'Occupied'
                      : 'Available'
                  }

                </span>

              </div>


              {/* LOCATION */}

              <div>

                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">

                  Location

                </p>


                <div className="flex items-center gap-2 text-sm text-gray-700">

                  <FontAwesomeIcon
                    icon={faLocationDot}
                    className="h-4 w-4 text-[#2D5A42]"
                  />

                  {selectedRack.location ||
                    'Not specified'}

                </div>

              </div>


              {/* SECTION */}

              {selectedRack.section && (

                <div>

                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">

                    Section

                  </p>

                  <p className="text-sm text-gray-700">

                    {selectedRack.section}

                  </p>

                </div>

              )}


              {/* NAME */}

              {selectedRack.name && (

                <div>

                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">

                    Rack Name

                  </p>

                  <p className="text-sm text-gray-700">

                    {selectedRack.name}

                  </p>

                </div>

              )}


              {/* DESCRIPTION */}

              {selectedRack.description && (

                <div>

                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">

                    Description

                  </p>

                  <p className="text-sm leading-relaxed text-gray-600">

                    {selectedRack.description}

                  </p>

                </div>

              )}


              {/* STORAGE VISUAL */}

              <div>

                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">

                  Rack Structure

                </p>


                <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">

                  <div className="grid grid-cols-3 gap-2">

                    {[1, 2, 3, 4, 5, 6].map(
                      (slot) => (

                        <div
                          key={slot}
                          className="
                            flex
                            h-12
                            items-center
                            justify-center
                            rounded
                            border
                            border-gray-200
                            bg-white
                            text-xs
                            text-gray-400
                          "
                        >

                          Slot {slot}

                        </div>

                      )
                    )}

                  </div>

                </div>

              </div>

            </div>


            {/* FOOTER */}

            <div className="flex gap-3 border-t border-gray-100 bg-gray-50 px-6 py-4">

              <button
                type="button"
                onClick={() =>
                  openEditModal(selectedRack)
                }
                className="
                  inline-flex
                  flex-1
                  items-center
                  justify-center
                  gap-2
                  rounded-lg
                  border
                  border-gray-200
                  bg-white
                  px-4
                  py-2.5
                  text-sm
                  font-semibold
                  text-gray-700
                  transition
                  hover:bg-gray-100
                "
              >

                <FontAwesomeIcon
                  icon={faPen}
                  className="h-3.5 w-3.5"
                />

                Edit Rack

              </button>


              <button
                type="button"
                onClick={() =>
                  setSelectedRack(null)
                }
                className="
                  flex-1
                  rounded-lg
                  bg-[#2D5A42]
                  px-4
                  py-2.5
                  text-sm
                  font-semibold
                  text-white
                  transition
                  hover:bg-[#234A36]
                "
              >

                Close

              </button>

            </div>

          </div>

        </div>

      )}


      {/* =====================================================
          ADD / EDIT RACK MODAL
      ===================================================== */}

      {showRackModal && (

        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">

          <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl">

            {/* =================================================
                HEADER
            ================================================= */}

            <div className="flex items-center justify-between border-b border-gray-100 px-6 py-5">

              <div className="flex items-center gap-3">

                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#F4F8F5] text-[#2D5A42]">

                  <FontAwesomeIcon
                    icon={
                      editingRack
                        ? faPen
                        : faPlus
                    }
                    className="h-5 w-5"
                  />

                </div>


                <div>

                  <h2 className="font-semibold text-gray-800">

                    {editingRack
                      ? 'Edit Warehouse Rack'
                      : 'Add Warehouse Rack'
                    }

                  </h2>

                  <p className="text-sm text-gray-500">

                    {editingRack
                      ? 'Update rack information and status.'
                      : 'Configure a new warehouse storage rack.'
                    }

                  </p>

                </div>

              </div>


              <button
                type="button"
                onClick={() =>
                  setShowRackModal(false)
                }
                disabled={saving}
                className="
                  flex
                  h-8
                  w-8
                  items-center
                  justify-center
                  rounded-lg
                  text-gray-400
                  transition
                  hover:bg-gray-100
                  hover:text-gray-600
                  disabled:opacity-50
                "
              >

                <FontAwesomeIcon
                  icon={faXmark}
                  className="h-4 w-4"
                />

              </button>

            </div>


            {/* =================================================
                FORM
            ================================================= */}

            <form onSubmit={saveRack}>

              <div className="space-y-5 p-6">

                {/* RACK ID */}

                <div>

                  <label className="mb-1.5 block text-sm font-medium text-gray-700">

                    Rack ID

                  </label>

                  <input
                    type="text"
                    name="rack_id"
                    value={formData.rack_id}
                    onChange={handleFormChange}
                    placeholder="e.g. R-01"
                    disabled={saving}
                    className="
                      w-full
                      rounded-lg
                      border
                      border-gray-200
                      bg-white
                      px-4
                      py-2.5
                      text-sm
                      outline-none
                      transition
                      focus:border-[#2D5A42]
                      focus:ring-2
                      focus:ring-[#2D5A42]/10
                      disabled:bg-gray-100
                    "
                  />

                </div>


                {/* NAME */}

                <div>

                  <label className="mb-1.5 block text-sm font-medium text-gray-700">

                    Rack Name

                  </label>

                  <input
                    type="text"
                    name="name"
                    value={formData.name}
                    onChange={handleFormChange}
                    placeholder="e.g. Main Storage Rack"
                    disabled={saving}
                    className="
                      w-full
                      rounded-lg
                      border
                      border-gray-200
                      bg-white
                      px-4
                      py-2.5
                      text-sm
                      outline-none
                      transition
                      focus:border-[#2D5A42]
                      focus:ring-2
                      focus:ring-[#2D5A42]/10
                      disabled:bg-gray-100
                    "
                  />

                </div>


                {/* LOCATION / SECTION */}

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">

                  <div>

                    <label className="mb-1.5 block text-sm font-medium text-gray-700">

                      Location

                    </label>

                    <input
                      type="text"
                      name="location"
                      value={formData.location}
                      onChange={handleFormChange}
                      placeholder="e.g. Aisle 01"
                      disabled={saving}
                      className="
                        w-full
                        rounded-lg
                        border
                        border-gray-200
                        bg-white
                        px-4
                        py-2.5
                        text-sm
                        outline-none
                        transition
                        focus:border-[#2D5A42]
                        focus:ring-2
                        focus:ring-[#2D5A42]/10
                        disabled:bg-gray-100
                      "
                    />

                  </div>


                  <div>

                    <label className="mb-1.5 block text-sm font-medium text-gray-700">

                      Section

                    </label>

                    <input
                      type="text"
                      name="section"
                      value={formData.section}
                      onChange={handleFormChange}
                      placeholder="e.g. A"
                      disabled={saving}
                      className="
                        w-full
                        rounded-lg
                        border
                        border-gray-200
                        bg-white
                        px-4
                        py-2.5
                        text-sm
                        outline-none
                        transition
                        focus:border-[#2D5A42]
                        focus:ring-2
                        focus:ring-[#2D5A42]/10
                        disabled:bg-gray-100
                      "
                    />

                  </div>

                </div>


                {/* DESCRIPTION */}

                <div>

                  <label className="mb-1.5 block text-sm font-medium text-gray-700">

                    Description

                  </label>

                  <textarea
                    name="description"
                    value={formData.description}
                    onChange={handleFormChange}
                    placeholder="Describe this rack or its intended storage use..."
                    rows={3}
                    disabled={saving}
                    className="
                      w-full
                      resize-none
                      rounded-lg
                      border
                      border-gray-200
                      bg-white
                      px-4
                      py-2.5
                      text-sm
                      outline-none
                      transition
                      focus:border-[#2D5A42]
                      focus:ring-2
                      focus:ring-[#2D5A42]/10
                      disabled:bg-gray-100
                    "
                  />

                </div>


                {/* STATUS OPTIONS */}

                <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">

                  <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">

                    Rack Status

                  </p>


                  {/* ACTIVE */}

                  <label className="flex cursor-pointer items-center justify-between">

                    <div>

                      <p className="text-sm font-medium text-gray-700">

                        Active Rack

                      </p>

                      <p className="text-xs text-gray-400">

                        Allow this rack to be used for storage.

                      </p>

                    </div>


                    <input
                      type="checkbox"
                      name="is_active"
                      checked={formData.is_active}
                      onChange={handleFormChange}
                      disabled={saving}
                      className="
                        h-4
                        w-4
                        rounded
                        border-gray-300
                        text-[#2D5A42]
                        focus:ring-[#2D5A42]
                      "
                    />

                  </label>


                  <div className="my-3 border-t border-gray-200" />


                  {/* OCCUPIED */}

                  <label className="flex cursor-pointer items-center justify-between">

                    <div>

                      <p className="text-sm font-medium text-gray-700">

                        Occupied

                      </p>

                      <p className="text-xs text-gray-400">

                        Mark this rack as currently holding inventory.

                      </p>

                    </div>


                    <input
                      type="checkbox"
                      name="is_occupied"
                      checked={formData.is_occupied}
                      onChange={handleFormChange}
                      disabled={
                        saving ||
                        !formData.is_active
                      }
                      className="
                        h-4
                        w-4
                        rounded
                        border-gray-300
                        text-[#2D5A42]
                        focus:ring-[#2D5A42]
                      "
                    />

                  </label>

                </div>

              </div>


              {/* =================================================
                  FOOTER
              ================================================= */}

              <div className="flex gap-3 border-t border-gray-100 bg-gray-50 px-6 py-4">

                <button
                  type="button"
                  onClick={() =>
                    setShowRackModal(false)
                  }
                  disabled={saving}
                  className="
                    flex-1
                    rounded-lg
                    border
                    border-gray-200
                    bg-white
                    px-4
                    py-2.5
                    text-sm
                    font-semibold
                    text-gray-700
                    transition
                    hover:bg-gray-100
                    disabled:opacity-50
                  "
                >

                  Cancel

                </button>


                <button
                  type="submit"
                  disabled={saving}
                  className="
                    flex-1
                    rounded-lg
                    bg-[#2D5A42]
                    px-4
                    py-2.5
                    text-sm
                    font-semibold
                    text-white
                    transition
                    hover:bg-[#234A36]
                    disabled:cursor-not-allowed
                    disabled:opacity-60
                  "
                >

                  {saving
                    ? 'Saving...'
                    : editingRack
                      ? 'Save Changes'
                      : 'Add Rack'
                  }

                </button>

              </div>

            </form>

          </div>

        </div>

      )}

    </div>

  )

}