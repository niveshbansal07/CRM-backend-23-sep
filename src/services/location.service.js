const env = require("../config/env");
const ApiError = require("../utils/ApiError");

const LOCATION_ROLES = ["company_admin", "sub_admin", "sales_head", "sales_manager", "sales_executive", "sales"];

const getComponent = (components = [], types = []) => {
  const component = components.find((item) => types.every((type) => item.types?.includes(type)));
  return component?.long_name || "";
};

const getFirstComponent = (components = [], typeGroups = []) => {
  for (const types of typeGroups) {
    const value = getComponent(components, types);
    if (value) return value;
  }
  return "";
};

const normalizeGoogleResult = (result = {}, latitude, longitude) => {
  const components = result.address_components || [];
  return {
    latitude: Number(latitude),
    longitude: Number(longitude),
    local: getFirstComponent(components, [
      ["sublocality_level_1"],
      ["sublocality"],
      ["neighborhood"],
      ["locality"],
      ["premise"],
    ]),
    city: getFirstComponent(components, [["locality"], ["administrative_area_level_3"]]),
    district: getFirstComponent(components, [["administrative_area_level_3"], ["administrative_area_level_2"]]),
    state: getFirstComponent(components, [["administrative_area_level_1"]]),
    pincode: getFirstComponent(components, [["postal_code"]]),
    country: getFirstComponent(components, [["country"]]),
    formattedAddress: result.formatted_address || "",
    googlePlaceId: result.place_id || "",
    provider: "google_maps",
    resolvedAt: new Date(),
  };
};

const reverseGeocode = async ({ latitude, longitude }) => {
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new ApiError(400, "Valid latitude and longitude are required");
  }
  if (!env.googleMapsApiKey) {
    throw new ApiError(500, "Google Maps API key is not configured. Set GOOGLE_MAPS_API_KEY in Backend .env");
  }

  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("latlng", `${lat},${lng}`);
  url.searchParams.set("key", env.googleMapsApiKey);
  url.searchParams.set("result_type", "street_address|premise|subpremise|route|sublocality|locality|postal_code");

  const response = await fetch(url);
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new ApiError(response.status, "Google Maps reverse geocoding request failed");
  }
  if (!payload || payload.status !== "OK" || !payload.results?.length) {
    const googleStatus = payload?.status || "UNKNOWN_ERROR";
    const googleMessage = payload?.error_message ? `: ${payload.error_message}` : "";
    const statusCode = ["REQUEST_DENIED", "OVER_DAILY_LIMIT", "OVER_QUERY_LIMIT"].includes(googleStatus) ? 502 : 400;
    throw new ApiError(
      statusCode,
      `Unable to resolve address from GPS coordinates (${googleStatus})${googleMessage}`
    );
  }

  return normalizeGoogleResult(payload.results[0], lat, lng);
};

module.exports = {
  LOCATION_ROLES,
  reverseGeocode,
};
