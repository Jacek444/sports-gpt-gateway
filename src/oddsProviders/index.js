import { config } from '../config.js';
import { HttpError } from '../errors.js';
import { addOddsProviderUsage } from '../storage.js';

import { theOddsApiProvider } from './theOddsApiProvider.js';
import { oddsApiIoProvider } from './oddsApiIoProvider.js';
import { sportsGameOddsProvider } from './sportsGameOddsProvider.js';
import { parlayApiProvider } from './parlayApiProvider.js';

const providers = {
  theOddsApi: theOddsApiProvider,
  oddsApiIo: oddsApiIoProvider,
  sportsGameOdds: sportsGameOddsProvider,
  parlayApi: parlayApiProvider
};

const runtimeState = new Map();
const cache = new Map();
const eventProviderMap = new Map();

function isConfigured(name) {
  const providerConfig = config.oddsProviders[name];

  if (!providerConfig) {
    return false;
  }

  return providerConfig.enabled && Boolean(providerConfig.apiKey);
}

function getState(name) {
  if (!runtimeState.has(name)) {
    runtimeState.set(name, {
      disabledUntil: 0,
      exhaustedUntil: 0,
      lastError: null,
      lastSuccessAt: null,
      lastQuota: null,
      requests: 0,
      successes: 0,
      failures: 0,
      fallbacksTriggered: 0
    });
  }

  return runtimeState.get(name);
}

function isTemporarilyUnavailable(name) {
  const state = getState(name);
  const now = Date.now();

  return (
    state.disabledUntil > now ||
    state.exhaustedUntil > now
  );
}

async function safeLogUsage({
  provider,
  requestType,
  success,
  fallbackUsed = false,
  cacheHit = false,
  upstreamStatus = null,
  quota = null,
  errorMessage = null
}) {
  if (!provider || !requestType) {
    return;
  }

  try {
    await addOddsProviderUsage({
      provider,
      request_type: requestType,
      success,
      fallback_used: fallbackUsed,
      cache_hit: cacheHit,
      upstream_status: upstreamStatus,
      quota,
      error_message: errorMessage
    });
  } catch (error) {
    /*
      Usage logging should never break a live odds request.

      If Supabase logging fails, the provider response should still
      be returned normally.
    */
    console.error(
      'Failed to persist odds provider usage:',
      error
    );
  }
}

function rememberQuota(name, result) {
  const state = getState(name);

  state.lastSuccessAt = new Date().toISOString();
  state.lastError = null;
  state.successes += 1;

  if (result?.quota) {
    state.lastQuota = result.quota;
  }
}

function rememberFailure(name, error) {
  const state = getState(name);
  const now = Date.now();

  state.failures += 1;

  const upstreamStatus =
    error?.details?.upstreamStatus ??
    error?.details?.status ??
    error?.status ??
    null;

  state.lastError = {
    at: new Date().toISOString(),
    message:
      error?.message ||
      String(error),
    upstreamStatus
  };

  if (Number(upstreamStatus) === 429) {
    const retrySeconds = Number(
      error?.details?.retryAfter || 60
    );

    state.disabledUntil =
      now +
      (
        Number.isFinite(retrySeconds)
          ? retrySeconds
          : 60
      ) *
        1000;
  }

  const body = error?.details?.body;

  const theOddsApiOutOfCredits =
    Number(upstreamStatus) === 401 &&
    body &&
    typeof body === 'object' &&
    body.error_code === 'OUT_OF_USAGE_CREDITS';

  const genericCreditLimitExceeded =
    Number(upstreamStatus) === 403 &&
    body &&
    typeof body === 'object' &&
    body.error === 'credit_limit_exceeded';

  if (
    theOddsApiOutOfCredits ||
    genericCreditLimitExceeded
  ) {
    const resetAt = Date.parse(
      body.next_reset_at || ''
    );

    state.exhaustedUntil =
      Number.isFinite(resetAt)
        ? resetAt
        : now + 24 * 60 * 60 * 1000;
  }
}

function resultDataItems(result) {
  const data = result?.data;

  if (Array.isArray(data)) {
    return data;
  }

  if (data && typeof data === 'object') {
    return [data];
  }

  return [];
}

function rememberEventIds(
  result,
  providerName
) {
  for (const item of resultDataItems(result)) {
    if (
      !item ||
      typeof item !== 'object'
    ) {
      continue;
    }

    const rawId =
      item.provider_event_id ||
      item.eventID ||
      item.id;

    if (!rawId) {
      continue;
    }

    const rawIdString =
      String(rawId);

    eventProviderMap.set(
      rawIdString,
      providerName
    );

    const gatewayId =
      `${providerName}:${rawIdString}`;

    eventProviderMap.set(
      gatewayId,
      providerName
    );

    if (!item.gateway_event_id) {
      item.gateway_event_id =
        gatewayId;
    }

    if (!item.provider_event_id) {
      item.provider_event_id =
        rawIdString;
    }
  }
}

function readCache(cacheKey) {
  if (!cacheKey) {
    return null;
  }

  const entry = cache.get(cacheKey);

  if (!entry) {
    return null;
  }

  if (entry.expiresAt <= Date.now()) {
    cache.delete(cacheKey);
    return null;
  }

  return entry.value;
}

function writeCache(
  cacheKey,
  value,
  ttlMs
) {
  if (
    !cacheKey ||
    !ttlMs ||
    ttlMs <= 0
  ) {
    return;
  }

  cache.set(cacheKey, {
    value,
    expiresAt:
      Date.now() + ttlMs
  });
}

function getUpstreamStatus(error) {
  return (
    error?.details?.upstreamStatus ??
    error?.details?.status ??
    error?.status ??
    null
  );
}

export function getOddsProvider(
  name,
  {
    ignoreRuntimeState = false
  } = {}
) {
  if (name) {
    const provider =
      providers[name];

    if (!provider) {
      throw new HttpError(
        400,
        `Unknown odds provider "${name}"`
      );
    }

    if (!isConfigured(name)) {
      throw new HttpError(
        503,
        `Odds provider "${name}" is not configured`
      );
    }

    if (
      !ignoreRuntimeState &&
      isTemporarilyUnavailable(name)
    ) {
      throw new HttpError(
        503,
        `Odds provider "${name}" is temporarily unavailable`
      );
    }

    return provider;
  }

  for (
    const providerName
    of config.oddsProviderOrder
  ) {
    if (
      isConfigured(providerName) &&
      providers[providerName] &&
      (
        ignoreRuntimeState ||
        !isTemporarilyUnavailable(
          providerName
        )
      )
    ) {
      return providers[providerName];
    }
  }

  throw new HttpError(
    503,
    'No odds providers are currently available'
  );
}

export function getProviderNameForEventId(
  eventId
) {
  if (!eventId) {
    return null;
  }

  const text = String(eventId);
  const colonIndex =
    text.indexOf(':');

  if (colonIndex > 0) {
    const candidate =
      text.slice(0, colonIndex);

    if (providers[candidate]) {
      return candidate;
    }
  }

  return (
    eventProviderMap.get(text) ||
    null
  );
}

export function unwrapGatewayEventId(
  eventId
) {
  const text =
    String(eventId || '');

  const colonIndex =
    text.indexOf(':');

  if (colonIndex > 0) {
    const candidate =
      text.slice(0, colonIndex);

    if (providers[candidate]) {
      return text.slice(
        colonIndex + 1
      );
    }
  }

  return text;
}

export async function withOddsProviderFallback(
  action,
  {
    order =
      config.oddsProviderOrder,

    cacheKey = null,

    cacheTtlMs = 0,

    rememberEvents = false,

    requestType = 'unknown'
  } = {}
) {
  const cached =
    readCache(cacheKey);

  if (cached) {
    await safeLogUsage({
      provider:
        cached.provider ||
        'unknown',
      requestType,
      success: true,
      fallbackUsed: false,
      cacheHit: true,
      quota:
        cached.quota ||
        null
    });

    return {
      ...cached,
      cache: {
        hit: true
      }
    };
  }

  const errors = [];

  /*
    This becomes true if an earlier configured provider
    could not be used or failed.

    That lets us record when a later provider actually
    handled the request as a fallback.
  */
  let fallbackNeeded = false;

  for (const providerName of order) {
    if (
      !isConfigured(providerName) ||
      !providers[providerName]
    ) {
      continue;
    }

    if (
      isTemporarilyUnavailable(
        providerName
      )
    ) {
      fallbackNeeded = true;
      continue;
    }

    const provider =
      providers[providerName];

    const state =
      getState(providerName);

    const attemptIsFallback =
      fallbackNeeded;

    state.requests += 1;

    try {
      const result =
        await action(
          provider,
          providerName
        );

      rememberQuota(
        providerName,
        result
      );

      if (rememberEvents) {
        rememberEventIds(
          result,
          providerName
        );
      }

      if (attemptIsFallback) {
        state.fallbacksTriggered += 1;
      }

      await safeLogUsage({
        provider: providerName,
        requestType,
        success: true,
        fallbackUsed:
          attemptIsFallback,
        cacheHit: false,
        quota:
          result?.quota ||
          null
      });

      const output = {
        ...result,

        provider:
          result?.provider ||
          providerName,

        cache: {
          hit: false
        }
      };

      writeCache(
        cacheKey,
        output,
        cacheTtlMs
      );

      return output;
    } catch (error) {
      rememberFailure(
        providerName,
        error
      );

      await safeLogUsage({
        provider: providerName,
        requestType,
        success: false,
        fallbackUsed:
          attemptIsFallback,
        cacheHit: false,
        upstreamStatus:
          getUpstreamStatus(error),
        errorMessage:
          error?.message ||
          String(error)
      });

      errors.push({
        provider:
          providerName,

        message:
          error?.message ||
          String(error),

        status:
          error?.status ||
          null,

        upstreamStatus:
          getUpstreamStatus(error)
      });

      fallbackNeeded = true;
    }
  }

  throw new HttpError(
    502,
    'All configured odds providers failed',
    {
      providersTried:
        errors
    }
  );
}

export async function withSpecificOddsProvider(
  providerName,
  action,
  {
    cacheKey = null,

    cacheTtlMs = 0,

    rememberEvents = false,

    requestType = 'unknown'
  } = {}
) {
  const cached =
    readCache(cacheKey);

  if (cached) {
    await safeLogUsage({
      provider:
        cached.provider ||
        providerName,
      requestType,
      success: true,
      fallbackUsed: false,
      cacheHit: true,
      quota:
        cached.quota ||
        null
    });

    return {
      ...cached,
      cache: {
        hit: true
      }
    };
  }

  const provider =
    getOddsProvider(providerName);

  const state =
    getState(providerName);

  state.requests += 1;

  try {
    const result =
      await action(
        provider,
        providerName
      );

    rememberQuota(
      providerName,
      result
    );

    if (rememberEvents) {
      rememberEventIds(
        result,
        providerName
      );
    }

    await safeLogUsage({
      provider:
        providerName,
      requestType,
      success: true,
      fallbackUsed: false,
      cacheHit: false,
      quota:
        result?.quota ||
        null
    });

    const output = {
      ...result,

      provider:
        result?.provider ||
        providerName,

      cache: {
        hit: false
      }
    };

    writeCache(
      cacheKey,
      output,
      cacheTtlMs
    );

    return output;
  } catch (error) {
    rememberFailure(
      providerName,
      error
    );

    await safeLogUsage({
      provider:
        providerName,
      requestType,
      success: false,
      fallbackUsed: false,
      cacheHit: false,
      upstreamStatus:
        getUpstreamStatus(error),
      errorMessage:
        error?.message ||
        String(error)
    });

    throw error;
  }
}

export function getOddsProviderStatus() {
  const names =
    Object.keys(providers);

  return {
    defaultOrder:
      config.oddsProviderOrder,

    sportsOrder:
      config.oddsSportsProviderOrder,

    providers:
      Object.fromEntries(
        names.map((name) => {
          const providerConfig =
            config.oddsProviders[name];

          const state =
            getState(name);

          return [
            name,
            {
              enabled:
                Boolean(
                  providerConfig?.enabled
                ),

              configured:
                isConfigured(name),

              temporarilyUnavailable:
                isTemporarilyUnavailable(
                  name
                ),

              disabledUntil:
                state.disabledUntil
                  ? new Date(
                      state.disabledUntil
                    ).toISOString()
                  : null,

              exhaustedUntil:
                state.exhaustedUntil
                  ? new Date(
                      state.exhaustedUntil
                    ).toISOString()
                  : null,

              lastSuccessAt:
                state.lastSuccessAt,

              lastError:
                state.lastError,

              lastQuota:
                state.lastQuota,

              requests:
                state.requests,

              successes:
                state.successes,

              failures:
                state.failures,

              fallbacksTriggered:
                state.fallbacksTriggered
            }
          ];
        })
      )
  };
}
