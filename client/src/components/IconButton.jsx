import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'

const colorStyles = {
  yellow: {
    border: 'border-yellow-200',
    background: 'bg-yellow-100',
    text: 'text-yellow-600',
    hover: 'hover:bg-yellow-200',
    disabledHover: 'disabled:hover:bg-yellow-50',
  },

  amber: {
    border: 'border-amber-200',
    background: 'bg-amber-100',
    text: 'text-amber-600',
    hover: 'hover:bg-amber-200',
    disabledHover: 'disabled:hover:bg-amber-50',
  },

  green: {
    border: 'border-green-200',
    background: 'bg-green-100',
    text: 'text-green-600',
    hover: 'hover:bg-green-200',
    disabledHover: 'disabled:hover:bg-green-50',
  },

  blue: {
    border: 'border-blue-200',
    background: 'bg-blue-100',
    text: 'text-blue-600',
    hover: 'hover:bg-blue-200',
    disabledHover: 'disabled:hover:bg-blue-50',
  },

  red: {
    border: 'border-red-200',
    background: 'bg-red-100',
    text: 'text-red-600',
    hover: 'hover:bg-red-200',
    disabledHover: 'disabled:hover:bg-red-50',
  },
}

export default function IconButton({
  icon,
  onClick,
  title,
  color = 'green',
  disabled = false,
}) {
  const styles = colorStyles[color] || colorStyles.green

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`
        rounded-md
        border
        ${styles.border}
        ${styles.background}
        ${styles.text}
        ${styles.hover}
        disabled:cursor-not-allowed
        disabled:opacity-50
        ${styles.disabledHover}
        p-1.5
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