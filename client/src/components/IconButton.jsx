import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'

export default function IconButton({ icon, onClick, title, color, disabled = false }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`
        rounded-md
        border
        border-${color}-200
        bg-${color}-50
        p-1.5
        text-${color}-600
        hover:bg-${color}-100
        disabled:cursor-not-allowed
        disabled:opacity-50
        disabled:hover:bg-${color}-50
      `}
      title={title}
      type="button"
    >
      <FontAwesomeIcon
        icon={icon}
        className="h-3.5 w-3.5"
      />
    </button>
  )
}