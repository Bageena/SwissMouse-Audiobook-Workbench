/** Keep protocol diagnostics readable when an older server returns its HTML app shell. */
export async function readApiJson(response: Response, operation: string): Promise<any> {
  const text = await response.text();
  const context = `${operation}: HTTP ${response.status} ${response.statusText}`;
  if (/^\s*(?:<!doctype\s+html|<html)/i.test(text)) {
    throw new Error(`${context}. The server returned an HTML page instead of JSON. It may still be running an older build without this endpoint. Restart SwissMouse and try again.`);
  }
  try { return JSON.parse(text); }
  catch { throw new Error(`${context}. Expected JSON but received an invalid response (${response.headers.get('content-type') || 'unknown content type'}). Response excerpt: ${text.slice(0, 300)}`); }
}
