// Best-effort browser location capture for clock-in / clock-out tagging.
//
// Audit-only: a captured position is stored on the attendance record so HR can
// see where a clock-in happened. It NEVER gates the action — every failure mode
// (permission denied, no fix, timeout, insecure context, unsupported browser)
// resolves to `status: "unavailable"` with a `reason`, so the clock-in always
// proceeds and the UI can tell the user WHY it couldn't tag a location.
//
// Accuracy note: we request a LOW-accuracy (network/wifi) fix rather than GPS
// (`enableHighAccuracy: false`). Web clock-ins happen mostly on office desktops
// and laptops with no GPS chip; a high-accuracy request there tends to hang and
// then fail, whereas the network fix returns quickly and reliably. The fix's
// `accuracy` (metres) is stored too, so HR can judge how precise it is.
//
// This function never rejects.

export type LocationStatus = "captured" | "unavailable" | "not_captured";

// Why a capture came back unavailable. Client-only — surfaced in a toast, never
// stored (the server validator ignores it).
export type LocationReason =
  | "permission-denied"
  | "position-unavailable"
  | "timeout"
  | "unsupported"
  | "insecure-context"
  | "invalid-fix";

export type LocationCapture = {
  lat: number | null;
  lon: number | null;
  accuracy: number | null; // fix accuracy radius in metres (68% confidence)
  status: LocationStatus;
  reason?: LocationReason;
};

const GEO_TIMEOUT_MS = 10000; // browser gives up and errors after this
const RACE_TIMEOUT_MS = 11000; // app-side hard cap so a hung call never wedges clock-in
const MAX_AGE_MS = 60_000; // a fix up to this old is fine for audit and returns instantly

function unavailable(reason: LocationReason): LocationCapture {
  return { lat: null, lon: null, accuracy: null, status: "unavailable", reason };
}

function reasonFromError(err: GeolocationPositionError): LocationReason {
  switch (err.code) {
    case err.PERMISSION_DENIED:
      return "permission-denied";
    case err.TIMEOUT:
      return "timeout";
    // POSITION_UNAVAILABLE — no location provider produced a fix. On desktops
    // this usually means the OS location service is off.
    default:
      return "position-unavailable";
  }
}

// Human-readable, actionable message for an unavailable capture. Used by the
// dashboard clock-in/out toasts.
export function describeLocationIssue(reason: LocationReason | undefined): string {
  switch (reason) {
    case "permission-denied":
      return "Location permission was denied — recorded without location.";
    case "position-unavailable":
      return "Couldn't get a location fix — check that your device's location is turned on. Recorded without location.";
    case "timeout":
      return "Location request timed out — recorded without location.";
    case "insecure-context":
    case "unsupported":
      return "Location isn't available in this browser — recorded without location.";
    default:
      return "Location unavailable — recorded without location.";
  }
}

export function captureLocation(): Promise<LocationCapture> {
  // Feature + secure-context guards. Resolve "unavailable" rather than throw.
  if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
    return Promise.resolve(unavailable("unsupported"));
  }
  if (typeof window !== "undefined" && window.isSecureContext === false) {
    return Promise.resolve(unavailable("insecure-context"));
  }

  const fix = new Promise<LocationCapture>((resolve) => {
    try {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { latitude, longitude, accuracy } = pos.coords;
          if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
            resolve(unavailable("invalid-fix"));
            return;
          }
          resolve({
            lat: latitude,
            lon: longitude,
            accuracy: Number.isFinite(accuracy) ? accuracy : null,
            status: "captured",
          });
        },
        (err) => {
          const reason = reasonFromError(err);
          // Diagnostic breadcrumb — helps distinguish "user denied" from
          // "device location off" when a capture unexpectedly fails.
          console.warn(`[geolocation] capture failed: ${reason} (code ${err.code})`);
          resolve(unavailable(reason));
        },
        { enableHighAccuracy: false, timeout: GEO_TIMEOUT_MS, maximumAge: MAX_AGE_MS },
      );
    } catch {
      resolve(unavailable("position-unavailable"));
    }
  });

  const cap = new Promise<LocationCapture>((resolve) => {
    setTimeout(() => resolve(unavailable("timeout")), RACE_TIMEOUT_MS);
  });

  return Promise.race([fix, cap]);
}
