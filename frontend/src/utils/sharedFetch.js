// Read requests to the backend that several parts of the page make at nearly
// the same time (React's StrictMode runs page effects twice; the Projects page
// first counts and then loads the same folders; Home and Projects ask for the
// same lists). Identical requests in flight share one answer, and an answer is
// reused for a moment. Any change sent to the backend (POST, PUT, DELETE …)
// clears everything, and `force` always asks the backend again, so a Refresh
// or a list shown after a change is never out of date.

const DEFAULT_MAX_AGE_MS = 2000;
const inFlight = new Map();
const recent = new Map();

export const clearSharedFetchCache = () => {
  recent.clear();
  inFlight.clear();
};

// Resolves to the parsed JSON body; rejects on network or JSON errors.
export const fetchJsonShared = (url, { force = false, maxAgeMs = DEFAULT_MAX_AGE_MS, fetchImpl } = {}) => {
  const doFetch = fetchImpl || ((u) => fetch(u, { cache: 'no-store' }));
  if (!force) {
    const hit = recent.get(url);
    if (hit && Date.now() - hit.at < maxAgeMs) return Promise.resolve(hit.data);
    const pending = inFlight.get(url);
    if (pending) return pending;
  }
  const request = Promise.resolve()
    .then(() => doFetch(url))
    .then((res) => res.json())
    .then((data) => {
      if (inFlight.get(url) === request) inFlight.delete(url);
      recent.set(url, { at: Date.now(), data });
      return data;
    }, (error) => {
      if (inFlight.get(url) === request) inFlight.delete(url);
      throw error;
    });
  inFlight.set(url, request);
  return request;
};
