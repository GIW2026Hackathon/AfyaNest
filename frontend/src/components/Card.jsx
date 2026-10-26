/**
 * Card — white surface card with subtle shadow and border.
 * Accepts className for layout overrides (e.g. col-span).
 */
export default function Card({ children, className = '', style = {}, title, headerAction }) {
  return (
    <div className={`card ${className}`} style={style}>
      {title && (
        <div className="card__header">
          <h2 className="card__title">{title}</h2>
          {headerAction && <div>{headerAction}</div>}
        </div>
      )}
      {children}
    </div>
  );
}
