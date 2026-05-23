/**
 * Error classification untuk retry logic.
 * Dipakai di cli.js (streamWithAutoContinue) dan provider manapun.
 */
export function isRetryableError(err) {
  if (!err) return false;
  const msg = (err.message || '').toLowerCase();
  const code = err.code || '';
  return (
    msg.includes('connection') ||
    msg.includes('premature close') ||
    msg.includes('network') ||
    msg.includes('econnreset') ||
    msg.includes('econnrefused') ||
    msg.includes('timeout') ||
    msg.includes('socket hang up') ||
    code === 'ERR_STREAM_PREMATURE_CLOSE' ||
    code === 'ECONNRESET' ||
    code === 'ENOTFOUND' ||
    err.status === 502 ||
    err.status === 503 ||
    err.status === 529  // overloaded
  );
}
