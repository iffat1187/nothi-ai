export async function request(url, options) {
  let response
  try {
    response = await fetch(url, options)
  } catch (error) {
    if (error.name === 'AbortError') throw error
    throw new Error('Could not reach Nothi AI. Check that Express is running and try again.', { cause: error })
  }

  const body = await response.json().catch(() => null)
  if (!response.ok || body === null) {
    const error = new Error(body?.error || 'The request could not be completed. Try again.')
    error.chat = body?.chat
    throw error
  }
  return body
}

export function jsonRequest(method, data) {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }
}
