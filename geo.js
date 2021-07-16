/* eslint-disable linebreak-style */
/* eslint-disable arrow-parens */
/* eslint-disable no-console */

const fetch = require('node-fetch');

/**
 * This is the API key for api.geoapify.com.  See the README.md for directions on obtaining a key.
 */
const geoApiKey = process.env.MYFORD_GEOAPIKEY;
if (!geoApiKey || geoApiKey.length !== 32) {
  // System bell + color text in different color.
  console.log('\u0007\u001b[36m*** ERROR: The MYFORD_GEOAPIKEY is not set to a correct value. See the README.md for directions on obtaining a key. ***\u001b[0m');
}

/**
 * Checks the status code for HTTP 200 response and throws an error for incorrect values.
 *
 * @param {*} response The response to check the status of.
 * @returns The response, or throws an Error.
 */
function checkStatus(response) {
  if (response.status === 401) { // Access denied is typically due to invalid .
    throw new Error('Make sure your geoApiKey in settings.js is correct.');
  }

  if (response.status !== 200) {
    throw new Error(`Geoapify gave an unexpected status of ${response.status}.`);
  }

  return response;
}

/**
 * Converts a (lat,lon) into an address.
 *
 * @param {*} lat The latitude value where the vehicle is.
 * @param {*} lon The longitude value where the vehicle is.
 * @returns String. The name and address for the location.
 */
async function getLocation(lat, lon) {
  return fetch(`https://api.geoapify.com/v1/geocode/reverse?lat=${lat}&lon=${lon}&apiKey=${geoApiKey}`)
    .then(response => checkStatus(response))
    .then(response => response.json())
    .then(response => response.features[0].properties)
    .then(response => `${response.formatted.substring(0, response.formatted.indexOf(`${response.state_code} ${response.postcode}`))}`)
    .then(response => response.trimEnd())
    .then(response => response.replace(/,$/, ' '))
    .catch(error => `Error trying to get location ${error}`);
}

/**
 * Converts a kilometer distance into a string that can be spoken.
 *
 * @param {*} rangeKm The number of kilometers.
 * @returns String. The distance in miles and kilometers.
 */
function distance(rangeKm) {
  return `${(rangeKm * 0.62137119).toFixed(0)} miles (${rangeKm.toFixed(0)} kilometers)`;
}

exports.geo = {
  getLocation,
  distance,
};
