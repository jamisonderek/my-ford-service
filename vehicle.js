/* eslint-disable linebreak-style */
/* eslint-disable no-console */

const fordConnect = require('./fordConnect/fordConnect');
const { geo } = require('./geo');

let activeVehicle;

/**
 * Updates the access token and sets the active vehicle to the vehicle with the
 * vehicleAuthorizationIndicator set to 1.
 *
 * We have this routine, since we only have a single user (one Alexa developer account for
 * the hack with the API access going away, so not publishing the Alexa skill publically).
 * To support multiple users we would simply add a listener on port 3000 and use the state to
 * do a user regisration lookup, with a quick expiry.  We would store the results refresh
 * tokens in a NoSQL database.
 */
async function init() {
  // Try to use the FORD_CODE environment variable to refresh our access token and refresh token.
  await fordConnect.updateTokenFromCode();

  // Try to use the FORD_REFRESH environment variable to refresh our access token and refresh token.
  await fordConnect.refreshToken(60);

  // Get the list of vehicles (hopefully one of the above APIs set our access token.)
  const vehicles = await fordConnect.getVehicles();
  if (vehicles.statusCode === 200) {
    // Grab the first vehicle that we have authorized (FordPass UI only lets you select 1 vehicle).
    // eslint-disable-next-line prefer-destructuring
    activeVehicle = vehicles.body.vehicles.filter((v) => v.vehicleAuthorizationIndicator === 1)[0];
    if (activeVehicle && activeVehicle.vehicleId) {
      console.log('\nAlexa commands will use the following vehicle:');
      console.log(activeVehicle);
    } else {
      console.error(`SPECBUG ${JSON.stringify(vehicles)}`);
      console.error('Did not get a vehicle back from getVehicles.');
      console.error('Please provide a new FORD_CODE or MYFORD_REFRESH.');
      process.exit(1);
    }
  } else if (vehicles.statusCode === 500) {
    // We got HTTP 500 during the hack and the request from Ford was to get a new token.
    // Refreshing the access token with the old refresh token would succeed OAuth calls,
    // but all calls to the FordConnect API still failed with HTTP 500.
    console.error(`500FORDCONNECT ${JSON.stringify(vehicles)}`);
    console.error('GOT 500 (INTERNAL SERVER ERROR) from FordConnect API calling getVehicles!');
    console.error('Please provide a new FORD_CODE or FORD_REFRESH.');
    process.exit(1);
  } else if (vehicles.stautsCode === 401) {
    console.error('Access deined.');
    console.error('Please provide a new FORD_CODE or FORD_REFRESH.');
  } else {
    console.log(`SPECBUG ${JSON.stringify(vehicles)}`);
    console.error('*** Unexpected error calling getVehicles.');
    process.exit(1);
  }
}

/**
 * This API should convert a userId into a vehicleId.  For now this always just returns the single
 * active vehicle.  To support multiple users, we could use a NoSQL database to do the persistent
 * mapping.
 *
 * @param {*} userId The user passed in the request.
 * @returns The vehicleId to use for the request.
 */
function toVehicleId(userId) {
  // TODO: Add mapping if we need to support multiple users.
  const { vehicleId } = activeVehicle;

  console.log(`User ${userId} is using vehicle ${vehicleId}.`);
  return vehicleId;
}

/**
 * Updates the cloud data by geting a doStatus followed by a getStatus, to know when it is complete.
 * The timeout is set fairly tight, since we only have 8-10 seconds to return data to Alexa.
 *
 * @param {*} vehicleId The vehicle to push to the cloud.
 * @returns The response object from the getStatus (or undefined if the doStatus call failed).
 * For success the .statusCode should be 202 and the body.commandStatus should be COMPLETED.
 * Because of agressive timeouts it may still be PENDINGRESPONSE.
 */
async function cloudPush(vehicleId) {
  const response = await fordConnect.doStatus(vehicleId);
  if (response.statusCode === 202
    && response.body
    && response.body.status === 'SUCCESS'
    && response.body.commandStatus === 'COMPLETED'
    && response.body.commandId) {
    const { commandId } = response.body;

    // NOTE: We get an HTTP 202 from the GET call not a 200.
    const status = await fordConnect.getStatus(vehicleId, commandId);
    return status;
  }

  return undefined;
}

/**
 * Returns a message about the fuel and battery levels.
 *
 * @param {*} vehicleInfo The .body.vehicle data from getDetails call.
 * @returns String. A message to speak about the status of charging.
 */
function checkFuel(vehicleInfo) {
  const energy = {
    fuelLevel: null,
    fuelDTE: null,
    batteryLevel: null,
    batteryDTE: null,
  };

  // BUGBUG: I'm really unclear on what the values here should look like.  I need
  // to see real data from ICE, PHEV, HEV and BEV to understand all of the use
  // cases.  For now, I'm going with the API sends null if it isn't supported and
  // it sends a float if it is & I'm not relying on engineType.
  if (vehicleInfo.vehicleDetails && vehicleInfo.vehicleDetails.fuelLevel) {
    energy.fuelLevel = vehicleInfo.vehicleDetails.fuelLevel.value;
    energy.fuelDTE = vehicleInfo.vehicleDetails.fuelLevel.distanceToEmpty;
  }

  if (vehicleInfo.vehicleDetails && vehicleInfo.vehicleDetails.batteryChargeLevel) {
    energy.batteryLevel = vehicleInfo.vehicleDetails.batteryChargeLevel.value;
    energy.batteryDTE = vehicleInfo.vehicleDetails.batteryChargeLevel.distanceToEmpty;
  }

  let message;

  if (energy.fuelLevel !== null && energy.fuelLevel <= 0.0) {
    message = 'Fuel is empty. ';
  } else if (energy.fuelLevel !== null && energy.fuelLevel) {
    message = `Fuel is ${energy.fuelLevel} percent. `;
  } else {
    message = '';
  }

  if (energy.fuelDTE !== null && energy.fuelDTE >= 0) {
    message += `You can travel ${geo.distance(energy.fuelDTE)} on fuel. `;
  }

  if (energy.batteryLevel !== null && energy.batteryLevel <= 0.0) {
    message += 'Battery is empty. ';
  } else if (energy.batteryLevel !== null && energy.batteryLevel) {
    message += `Battery is ${energy.batteryLevel} percent. `;
  }

  if (energy.batteryDTE !== null && energy.batteryDTE >= 0) {
    message += `You can travel ${geo.distance(energy.batteryDTE)} on battery. `;
  }

  return message;
}

/**
 * Returns a message about the EV plug and the charging status.
 *
 * @param {*} vehicleInfo The .body.vehicle data from getDetails call.
 * @returns String. A message to speak about the status of the plug.
 */
function checkPlug(vehicleInfo) {
  let message;

  if (vehicleInfo.vehicleStatus.plugStatus) {
    message = `The EV plug is ${vehicleInfo.vehicleStatus.plugStatus.value === true ? 'connected' : 'disconnected'}. `;
  } else {
    message = 'Failed to get EV plug status. ';
  }

  if (vehicleInfo.vehicleStatus.chargingStatus) {
    message += `The current charging status is ${vehicleInfo.vehicleStatus.chargingStatus.value}.`;
  }

  return message;
}

/**
 * Charges an electric vehicle.
 *
 * @param {*} vehicleId The vehicle to charge.
 * @returns String. A message to speak about the status of charging.
 */
async function chargeVehicle(vehicleId) {
  let message;

  // Start charging.
  const response = await fordConnect.doStartCharge(vehicleId);

  if (response.statusCode === 406) {
    if (response.body && response.body.error && response.body.error.details) {
      message = `Failed charging vehicle.  ${response.body.error.details}.`;
    } else {
      console.error(`SPECBUG ${JSON.stringify(response)}`);
      message = 'Failed charging vehicle.  Only EV cars are supported.';
    }
  } else if (response.statusCode < 300) {
    // Try to update the cloud with the latest and get the details.  Due to aggressive timeouts
    // it is possible that vehicleStatus.chargingStatus didn't get a chance to update, but likely
    // plugStatus was already correct (e.g. the vehicle was typically plugged in a long time ago.)
    await cloudPush(vehicleId);
    const details = await fordConnect.getDetails(vehicleId);
    if (details.statusCode === 200 && details.body.vehicle.vehicleStatus.plugStatus) {
      if (details.body.vehicle.vehicleStatus.plugStatus.value === true) {
        message = 'Request for charging sent.';
      } else if (details.body.vehicle.vehicleStatus.plugStatus.value === false) {
        message = 'Request for charging sent, but the plug is not connected.';
      } else {
        console.log(JSON.stringify(details));
        message = "Request for charging sent, but I'm unable to determine if the vehicle is plugged in.";
      }
    } else {
      console.log(JSON.stringify(details));
      message = 'Request for charging sent, but getting vehicle status failed.';
    }
  } else {
    message = `Failed charging vehicle.  Got status code ${response.statusCode}.`;
  }

  return message;
}

/**
 * Returns a message with the name (if known) and address where the vehicle is located.
 *
 * @param {*} vehicleId The vehicle to find.
 * @returns String. A message to speak containing the name and address where the vehicle is located.
 */
async function locateVehicle(vehicleId) {
  let message;

  await fordConnect.doLocation(vehicleId);
  // REVIEW: The GET /location API doesn't require a commandId, so how do we know it is updated.
  const response = await fordConnect.getLocation(vehicleId);
  if (response.statusCode === 200 && response.body && response.body.status === 'SUCCESS' && response.body.vehicleLocation) {
    message = `The vehicle is at ${await geo.getLocation(response.body.vehicleLocation.latitude, response.body.vehicleLocation.longitude)}`;
  } else if (response.body) {
    message = `Failed to get location information with status code ${response.statusCode} and body status of ${response.body.status}. `;
  } else {
    message = `Failed to get location information with status ${response.statusCode}. `;
  }

  return message;
}

/**
 * Returns a message with the status of door locks (LOCKED, UNLOCKED) and the
 * alarm (SET, NOT SET, ACTIVE, ERROR).
 *
 * @param {*} vehicleId The vehicle to check.
 * @returns String. A message to speak about the status of the door locks and alarm.
 */
async function checkLocksAndAlarm(vehicleId) {
  let message;

  const cloud = await cloudPush(vehicleId);
  if (cloud && cloud.statusCode === 202 && cloud.body && cloud.body.commandStatus === 'COMPLETED' && cloud.body.vehiclestatus) {
    const status = cloud.body.vehiclestatus;
    message = `The locks are ${status.lockStatus.value}. The alarm is ${status.alarm.value.replace('NOTSET', 'NOT SET')}. `;
  } else {
    console.error(JSON.stringify(cloud));
    console.error('Failed to get lock and alarm status.');
    message = 'Unable to check locks and alarm. ';
  }

  return message;
}

/**
 * Returns a message with the status of fuel & battery level and EV plug connection.
 *
 * @param {*} vehicleId The vehicle to check.
 * @returns String. A message to speak about the fuel and EV plug status.
 */
async function checkFuelAndPlug(vehicleId) {
  let message;

  const details = await fordConnect.getDetails(vehicleId);

  // Message about fuel level.
  if (details.statusCode === 200 && details.body.vehicle) {
    message = checkFuel(details.body.vehicle);

    // Message about EV plug.
    if (details.body
      && details.body.vehicle
      && details.body.vehicle.engineType
      && details.body.vehicle.engineType.indexOf('EV') >= 0) {
      message += checkPlug(details.body.vehicle);
    }
  } else {
    console.error(JSON.stringify(details));
    message = 'Unable to check fuel level. ';
  }

  return message;
}

/**
 * Returns a message about any open doors (or confirms all doors are closed.)
 *
 * @param {*} vehicleId The vehicle to check.
 * @returns String. A message to speak about any open doors.
 */
async function checkDoors(vehicleId) {
  let message;

  const details = await fordConnect.getDetails(vehicleId);

  // Message about any open doors.
  if (details.body
    && details.body.vehicle
    && details.body.vehicle.vehicleStatus
    && details.body.vehicle.vehicleStatus.doorStatus) {
    const doors = details.body.vehicle.vehicleStatus.doorStatus;
    message = doors.map((d) => (d.value !== 'CLOSED'
      // Delete the words "UNSPECIFIED_" AND "NOT_APPLICABLE". Replace underscore with spaces
      // for better speach output.  Per the FAQ the d.value is either OPEN or CLOSED.
      //
      // TODO: We could do a more user friendly mapping.  Right now we have voice responses like
      //  "DRIVER FRONT", "PASSENGER FRONT", "PASSENGER REAR LEFT", "HOOD DOOR",
      //  "PASSENGER INNER TAILGATE", etc.
      ? `${d.vehicleOccupantRole} ${d.vehicleDoor} is ${d.value}. `.replace(/UNSPECIFIED_|NOT_APPLICABLE/g, '').replace('_', ' ')
      : '')).join('');
    if (doors.filter((d) => d.value !== 'CLOSED').length === 0) {
      message = 'All doors are closed. ';
    }
  }

  return message;
}

/**
 * Returns a message about the weekday and weekend charge schedule.
 *
 * @param {*} vehicleId The vehicle to get the schedule of.
 * @returns String. A message to speak about the chaging schedule.
 */
async function chargeSchedule(vehicleId) {
  let message;

  const response = await fordConnect.getChargeSchedule(vehicleId);

  if (response.statusCode === 200 && response.body.chargeSchedules) {
    if (response.body.chargeSchedules.length === 0) {
      message = 'No charging schedule is set. ';
    } else {
      message = 'The charge schedule is ';
      message += response.body.chargeSchedules.map(
        // The Ford dash UI allows each schedule to have multiple charge windows.
        // REVIEW: What does "00:00" to "00:00" mean?  For now we just say it.
        (sch) => sch.chargeWindows.map(
          (cw) => `${sch.days}S from ${cw.startTime} to ${cw.endTime} at ${sch.desiredChargeLevel} percent. `,
        ).join(' '),
      ).join(' ');
    }
  } else {
    message = `Failed getting charge schedule with status code ${response.statusCode}`;
  }

  return message;
}

exports.vehicle = {
  init,
  toVehicleId,
  cloudPush,
  chargeVehicle,
  checkFuel,
  checkPlug,
  checkFuelAndPlug,
  checkLocksAndAlarm,
  checkDoors,
  locateVehicle,
  chargeSchedule,
};
