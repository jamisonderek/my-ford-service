/* eslint-disable linebreak-style */
/* eslint-disable no-console */

/**
 * Intent listener for events from Alexa skill.
 *
 * FORD_CLIENTSECRET environment variable is the secret value for connecting
 * to the endpoint.  This value must be set (see your Postman environment variable
 * for the correct value).
 *
 * MYFORD_GEOAPIKEY environment variable is the API key for geoapify.com.
 *
 * FORD_REFRESH environment variable is a refresh access token to use in the second
 * set of the oauth authentication.  If it is not set, then the refresh token value
 * returned by the first oauth call will be used.
 *
 * FORD_CODE environment variable is the Access code used in the first step of
 * the oauth authentication.
 *
 * MYFORD_HTTPPORT - Port for listening for webhook requests (default 8000).
 *
 * FORD_NGROK environment variable is the domain name of your ngrok server
 * hosting the simulator.  If it is not set, then the FordConnect API server
 * (*.ford.com) will be used instead.
 *
 */

const express = require('express');
const http = require('http');
const fordConnect = require('./fordConnect/fordConnect');
const { vehicle } = require('./vehicle');

const app = express();
const httpServer = http.createServer(app);
const httpPort = parseInt(process.env.MYFORD_HTTPPORT, 10) || 8000;
if (process.env.NODE_ENV !== 'test') {
  console.log(`Listening on port ${httpPort} for webhook calls.`);
  httpServer.listen(httpPort);
} else {
  console.log('WARNING: Environment set to "test" so not enabling listener.');
}

// Update the token and gets the authorized vehicle.
vehicle.init();

/**
 * Prints the message to the console and sends a JSON response back to Alexa.
 *
 * @param {*} res The response object.
 * @param {*} message The message to return.
 * @returns The JSON response.
 */
function sendMessage(res, message) {
  console.log(message);
  res.statusCode = 200;
  return res.json({ status: message.startsWith('Fail') ? 'FAILED' : 'SUCCESS', msg: message });
}

/**
 * Prints the name of the invoked intent. Ensures access token isnt expired. Returns the vehicleId
 * assoicated with the Alexa instance making the request.
 *
 * @param {*} req The request object.
 * @param {*} name The name of the intent being invoked.
 * @returns The vehicleId from the request.
 */
async function startRequest(req, name) {
  console.log(`\n${name} invoked.`);

  // Make sure our access token is good for the duration of our calls (60 seconds).
  await fordConnect.refreshToken(60);

  // Return the vehicleId for this request.
  return vehicle.toVehicleId(req.query.user);
}

/**
 * Requests updated vehicle details, then invokes a callback and returns its result.
 *
 * @param {*} req The request object.
 * @param {*} res The respones object.
 * @param {*} intent The name of the intent being invoked.
 * @param {*} callbackFn A callback function to pass the vehicle details to.
 * @returns The JSON response from the callback function.
 */
async function requestDetails(req, res, intent, callbackFn) {
  let message;

  const vehicleId = await startRequest(req, intent);

  // Push the car details back to the cloud, so we have fresh data.
  await vehicle.cloudPush(vehicleId);

  // Call the callback function with the details of the vehicle.
  const details = await fordConnect.getDetails(vehicleId);
  if (details.statusCode === 200 && details.body.vehicle) {
    message = callbackFn(details.body.vehicle);
  } else {
    console.error(JSON.stringify(details));
    message = `Failed to get vehicle details with statusCode ${details.statusCode}`;
  }

  return sendMessage(res, message);
}

/**
 * Invokes the doCommand and checkCommand (e.g. doStartEngine, checkStartEngine) and
 * returns a message about its success or failure.
 *
 * @param {*} intent The name of the intent being invoked.
 * @param {*} vehicleId The vehicleId for the request.
 * @param {*} doCommand A function to invoke for doing command (e.g. doStartEngine)
 * @param {*} checkCommand A function to invoke for cheking the status (e.g. checkStartEngine)
 * @returns A message indicating if the command was successful.
 */
async function actionWithCheck(intent, vehicleId, doCommand, checkCommand) {
  let message;

  const response = await doCommand(vehicleId);

  if (response.statusCode === 202
    && response.body
    && response.body.status === 'SUCCESS'
    && response.body.commandStatus === 'COMPLETED'
    && response.body.commandId) {
    const { commandId } = response.body;
    message = `Sent ${intent} command`;

    const checkResponse = await checkCommand(vehicleId, commandId);

    if (checkResponse.statusCode === 200) {
      if (checkResponse.body && checkResponse.body.commandStatus === 'COMPLETED') {
        message += ' and got confirmation.';
      } else if (checkResponse.body && checkResponse.body.commandStatus === 'PENDINGRESPONSE') {
        message += ' but confirmation is pending.';
      } else if (checkResponse.body && checkResponse.body.commandStatus) {
        message += ` but confirmation is ${checkResponse.body.commandStatus}.`;
      } else if (checkResponse.body && checkResponse.body.status) {
        message += ` but confirmation status is ${checkResponse.body.status}.`;
      } else {
        console.error(JSON.stringify(response));
        message += ' but confirmation failed.';
      }
    } else {
      console.error(JSON.stringify(response));
      message += ` but confirmation gave status code ${checkResponse.statusCode}.`;
    }
  } else {
    console.error(JSON.stringify(response));
    message = `Failed to ${intent}.`;
  }

  return message;
}

/**
 * Invokes the doCommand and checkCommand (e.g. doStartEngine, checkStartEngine) and
 * returns a JSON message to Alexa about its success or failure.
 *
 * @param {*} req The request object.
 * @param {*} res The response object.
 * @param {*} intent The name of the intent being invoked.
 * @param {*} doCommand A function to invoke for doing command (e.g. doStartEngine)
 * @param {*} checkCommand A function to invoke for cheking the status (e.g. checkStartEngine)
 * @returns The JSON response indicating if the command was successful.
 */
async function requestActionWithCheck(req, res, intent, doCommand, checkCommand) {
  const vehicleId = await startRequest(req, intent);

  return sendMessage(res,
    await actionWithCheck(intent, vehicleId, doCommand, checkCommand));
}

/**
 * Starts charging the vehicle and returns a JSON message to Alexa about its success or failure.
 *
 * @param {*} req The request object.
 * @param {*} res The response object.
 * @returns The JSON response from charging the vehicle.
 */
async function requestCharge(req, res) {
  const vehicleId = await startRequest(req, 'request charge');

  return sendMessage(res,
    await vehicle.chargeVehicle(vehicleId));
}

/**
 * Looks up the (lat,lon) of the vehicle and returns a JSON message to Alexa with the
 * friendly name of the location.
 *
 * @param {*} req The request object.
 * @param {*} res The respones object.
 * @returns The JSON response with the location of the vehicle.
 */
async function whereVehicle(req, res) {
  const vehicleId = await startRequest(req, 'where vehicle');

  return sendMessage(res,
    await vehicle.locateVehicle(vehicleId));
}

/**
 * Return a JSON message to Alexa with the charging schedule for the vehicle.
 *
 * @param {*} req The request object.
 * @param {*} res The response object.
 * @returns The JSON response with the charging schedule for the vehicle.
 */
async function whenCharging(req, res) {
  const vehicleId = await startRequest(req, 'when charging');

  return sendMessage(res,
    await vehicle.chargeSchedule(vehicleId));
}

/**
 * Returns a JSON message to Alexa with information about the open doors, locks, alarms,
 * fuel, battery, and charging cable.  This can be added as a step in Alexa's "Good night"
 * routine (which could also turn off the house lights, etc.)
 *
 * @param {*} req The request object.
 * @param {*} res The response object.
 * @returns The JSON response with the details of open doors, locks, alarms, fuel,
 * battery, and charging cable.
 */
async function goodNight(req, res) {
  const vehicleId = await startRequest(req, 'good night');

  const checks = [
    vehicle.checkDoors(vehicleId),
    vehicle.checkLocksAndAlarm(vehicleId),
    vehicle.checkFuelAndPlug(vehicleId),
  ];

  // We only get 8-10 seconds to respond, so run the calls in parallel.
  return sendMessage(res,
    await Promise.all(checks).then((messages) => messages.join(' ')));
}

app.get('/my-ford/start-vehicle',
  async (req, res) => requestActionWithCheck(req, res, 'start vehicle', fordConnect.doStartEngine, fordConnect.checkStartEngine));

app.get('/my-ford/lock-vehicle',
  async (req, res) => requestActionWithCheck(req, res, 'lock vehicle', fordConnect.doLock, fordConnect.checkLock));

app.get('/my-ford/unlock-vehicle',
  async (req, res) => requestActionWithCheck(req, res, 'unlock vehicle', fordConnect.doUnlock, fordConnect.checkUnlock));

app.get('/my-ford/check-fuel',
  async (req, res) => requestDetails(req, res, 'check fuel', vehicle.checkFuel));

app.get('/my-ford/check-plug',
  async (req, res) => requestDetails(req, res, 'check plug', vehicle.checkPlug));

app.get('/my-ford/charge-vehicle',
  async (req, res) => requestCharge(req, res));

app.get('/my-ford/where-vehicle',
  async (req, res) => whereVehicle(req, res));

app.get('/my-ford/when-charging',
  async (req, res) => whenCharging(req, res));

app.get('/my-ford/good-night',
  async (req, res) => goodNight(req, res));
