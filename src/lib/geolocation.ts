// Best-effort browser GPS capture for clock-in / clock-out location tagging.
//
// Audit-only: a captured position is stored on the attendance record so HR can
// see where a clock-in happened. It NEVER gates the action — every failure mode
// (permission denied, timeout, insecure context, unsupported browser, no fix)
// resolves to `status: "unavailable"` so the clock-in always proceeds.
//
// This function never rejects. Callers can `await` it directly without a
// try/catch and always get a well-formed result.

export type LocationStatus = "captured" | "unavailable" | "not_captured";

export type LocationCapture = {
  lat: number | null;
  lon: number | null;
  accuracy: number | null; // GPS accuracy radius in meters (68% confidence)
  status: LocationStatus;
};

// Passed to getCurrentPosition. The browser gives up after this and fires the
// error callback (→ "unavailable").
const GEO_TIMEOUT_MS = 8000;
// App-side hard cap: even if the browser never invokes either callback, the
// clock-in must not wait longer than this.
const RACE_TIMEOUT_MS = 9000;
// A fix up to this old is acceptable for audit and returns instantly (e.g. a
// clock-out shortly after clock-in reuses the earlier fix).
const MAX_AGE_MS = 60_000;

export const LOCATION_UNAVAILABLE: LocationCapture = {
  lat: null,
  lon: null,
  accuracy: null,
  status: "unavailable",
};

export function captureLocation(): Promise<LocationCapture> {
  // Feature + secure-context guards. Resolve "unavailable" rather than throw so
  // the caller never has to handle an exception.
  if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
    return Promise.resolve(LOCATION_UNAVAILABLE);
  }
  if (typeof window !== "undefined" && window.isSecureContext === false) {
    // Geolocation is a secure-context-only API; a call would be denied.
    return Promise.resolve(LOCATION_UNAVAILABLE);
  }

  const fix = new Promise<LocationCapture>((resolve) => {
    try {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { latitude, longitude, accuracy } = pos.coords;
          if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
            resolve(LOCATION_UNAVAILABLE);
            return;
          }
          resolve({
            lat: latitude,
            lon: longitude,
            accuracy: Number.isFinite(accuracy) ? accuracy : null,
            status: "captured",
          });
        },
        // PERMISSION_DENIED / POSITION_UNAVAILABLE / TIMEOUT all land here.
        () => resolve(LOCATION_UNAVAILABLE),
        { enableHighAccuracy: true, timeout: GEO_TIMEOUT_MS, maximumAge: MAX_AGE_MS },
      );
    } catch {
      resolve(LOCATION_UNAVAILABLE);
    }
  });

  const cap = new Promise<LocationCapture>((resolve) => {
    setTimeout(() => resolve(LOCATION_UNAVAILABLE), RACE_TIMEOUT_MS);
  });

  return Promise.race([fix, cap]);
}
