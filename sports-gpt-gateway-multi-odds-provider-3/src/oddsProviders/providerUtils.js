import { HttpError } from '../errors.js';

export function addQueryParams(url, params = {}) {
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') {
      continue;
    }

    url.searchParams.set(key, String(value));
  }

  return url;
}

export function getHeader(response, ...names) {
  for (const name of names) {
    const value = response.headers.get(name);
    if (value !== null) {
      return value;
    }
  }
  return null;
}

export async function fetchJson({
  provider,
  url,
  headers = {},
  timeoutMs = 12000
}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response;

  try {
    response = await fetch(url, {
      headers,
      signal: controller.signal
    });
  } catch (error) {
    const timedOut = error?.name === 'AbortError';

    throw new HttpError(
      502,
      timedOut
        ? `${provider} request timed out`
        : `${provider} request failed`,
      {
        provider,
        upstreamStatus: timedOut ? 504 : null,
        cause: error?.message || String(error)
      }
    );
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text();
  let body;

  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  if (!response.ok) {
    throw new HttpError(502, `${provider} request failed`, {
      provider,
      upstreamStatus: response.status,
      statusText: response.statusText,
      retryAfter: response.headers.get('retry-after'),
      body
    });
  }

  return { response, body };
}

export function parseNumberOrNull(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
