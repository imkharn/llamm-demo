export function Hint({ text }: { text: string }) {
  return (
    <span
      className="qmark"
      tabIndex={0}
      role="img"
      aria-label={text}
      onMouseDown={(event) => event.preventDefault()}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
      }}
    >
      ?
      <span className="splash" role="tooltip">
        {text}
      </span>
    </span>
  )
}
