/**
 * LoadingSpinner — accessible centered spinner
 * @param {string} message   Optional loading message
 * @param {string} size      'sm' | 'md' | 'lg'
 */
export default function LoadingSpinner({ message = 'Loading…', size = 'md' }) {
  const dim = size === 'sm' ? 20 : size === 'lg' ? 48 : 32;
  const border = size === 'sm' ? 2 : size === 'lg' ? 5 : 3;

  return (
    <div
      role="status"
      aria-label={message}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '12px',
        padding: size === 'lg' ? '48px' : '24px',
        color: '#64748B',
        fontSize: '14px',
      }}
    >
      <div
        aria-hidden="true"
        style={{
          width: dim,
          height: dim,
          border: `${border}px solid #D9E5EC`,
          borderTopColor: '#0077B6',
          borderRadius: '50%',
          animation: 'ks-spin 0.75s linear infinite',
        }}
      />
      <span>{message}</span>
    </div>
  );
}
