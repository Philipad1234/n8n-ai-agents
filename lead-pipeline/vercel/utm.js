// assets/js/utm.js
//
// First-touch UTM capture. Include this on EVERY page of the site.
//
// When a visitor arrives from a tagged link (?utm_source=...&utm_medium=...),
// we remember those values for 90 days. If they browse around and submit the
// lead form later, or come back next week, the lead is still credited to the
// campaign that first brought them in.

(function () {
  var KEY = "lead_utm_first_touch";
  var MAX_AGE_DAYS = 90;

  function clean(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_.\-]/g, "")
      .slice(0, 100);
  }

  function read() {
    try {
      var stored = JSON.parse(localStorage.getItem(KEY) || "null");
      if (!stored) return null;
      var ageDays =
        (Date.now() - new Date(stored.captured_at).getTime()) / 86400000;
      if (ageDays > MAX_AGE_DAYS) {
        localStorage.removeItem(KEY);
        return null;
      }
      return stored;
    } catch (e) {
      return null; // storage blocked (private mode, strict settings): just carry on
    }
  }

  var params = new URLSearchParams(window.location.search);
  var fromUrl = {
    utm_source: clean(params.get("utm_source")),
    utm_medium: clean(params.get("utm_medium")),
    utm_campaign: clean(params.get("utm_campaign")),
  };
  var hasUtms =
    fromUrl.utm_source || fromUrl.utm_medium || fromUrl.utm_campaign;

  // First touch wins: only store if nothing is stored yet.
  if (hasUtms && !read()) {
    try {
      fromUrl.captured_at = new Date().toISOString();
      localStorage.setItem(KEY, JSON.stringify(fromUrl));
    } catch (e) {
      /* storage blocked: the current page's UTMs are still used below */
    }
  }

  // Expose for the form: stored first touch, else whatever is on this URL.
  window.getLeadUtms = function () {
    var stored = read();
    return (
      stored ||
      (hasUtms ? fromUrl : { utm_source: "", utm_medium: "", utm_campaign: "" })
    );
  };
})();
