# my-ford-service
Control your Ford vehicle using Alexa and the FordConnect API.  

This package is the my-ford-service that processes all of your Alexa requests.  Please see the [my-ford-skill repo](https://www.github.com/jamisonderek/my-ford-skill) for additional directions about deploying the my-ford-skill to Alexa.


## Setup
This project requires you have [Node.js](https://nodejs.org/en/download/) and npm installed.  This version was developed and testing using Node version 15.5.1, npm 7.17.0 and Windows 10 (19042.1052).  You can check your vesrions by using the following command:
```
node --version
npm install npm@latest -g
npm --version
winver
```

Download the code to your local computer.  You can either clone the [repository](https://github.com/jamisonderek/my-ford-service), or from the github repository click on the Code button and choose Download ZIP (which you can then extract into some folder on your local computer.)

To install the projects dependencies make sure you are in the same directory as the package.json file and then type the following command:
```
npm ci
```
When it finishes you should have a folder called node_modules with a couple hundred directories in it.

The above steps only need to be performed one time, however running the _npm ci_ command multiple times will not hurt anything.

## Location data
To get the address of a vehicle you need a geoapify account.  
You can register for an account at [https://myprojects.geoapify.com/register](https://myprojects.geoapify.com/register).  NOTE: The confirmation mail was caught by both of my spam filters, so be sure check your spam folders.  Once registered you can create a new project at [https://myprojects.geoapify.com/](https://myprojects.geoapify.com/) which will provide you with an API key.
Set the MYFORD_GEOAPIKEY environment variable with your API key.

## Getting your FORD_REFRESH token
For the purposes of this hack, the service currently maps all users to the same vehicle.  In the production app, we would map users to refresh tokens.

To get a refresh_token, you can use the files Ford provided for Postman.  Follow the steps and run the "Ford Get Token".  You can then click on the environment variables in Postman and you will see a **refreshToken** variable.  This token should be good for 90 days.

## Environmenet variables
|variable|example value|default value|notes|
|--------|-------------|-------------|-----|
FORD_CLIENTSECRET|T_SuperSecret123|(See postman environment variables)|**Required.** Secret used to authenticate to the FordConnect API servers provided by Ford.
MYFORD_GEOAPIKEY|042aadebadeb29badf00d4200aaed0e1|(none)|**Required.** The API KEY to use for [location data](#location-data).
FORD_REFERSH|eySomething|(none)|**Required.** Set to your refresh_token (or set FORD_CODE if you prefer to use the auth code).
FORD_CODE|CODE1234-1234-1234|(none)|Optional. You can copy the value from your auth login page, the part after (https://localhost:3000/state=123&code=)
MYFORD_HTTPPORT|8000|8000|Optional. The HTTP port that the service will listen on.
FORD_NGROK|example.ngrok.io|(none - use real Ford servers)|Optional. The domain name of your ngrok server hosting the simulator.  If it is not set, then the FordConnect API server (*.ford.com) will be used instead.

## Running the service
Make sure you set the required environment variables.

You can start the service using
```
node app
```

You then need to run the ngrok service.
You can use [ngrok](https://dashboard.ngrok.com/get-started/setup) to expose your localhost address on the internet.  Install ngrok then run:
```
ngrok http 8000
```
You will see a Forwarding https address like "https://f00d0bad0042.ngrok.io" which is your domain.<p>
**NOTE:** This domain will change everytime you reset ngrok if you are on the free plan, which means
you will need to update and redeploy this skill.
<br>
**NOTE:**
Please see the [my-ford-skill repo](https://www.github.com/jamisonderek/my-ford-skill) for additional directions about 
deploying the my-ford-skill to Alexa and updating its lambda\settings.js file whenever you restart ngrok.

## Features
The following endpoints are exposed for the my-ford-skill to invoke:
|endpoint|description|
|--------|-----------|
|/my-ford/start-vehicle|Start the vehicle
|/my-ford/lock-vehicle|Lock the vehicle
|/my-ford/unlock-vehicle|Unlock the vehicle
|/my-ford/charge-vehicle|Charge the vehicle
|/my-ford/where-vehicle|Find the vehicle
|/my-ford/check-fuel|Check the fuel and battery level
|/my-ford/check-plug|Check to see if the vehicle is plugged in
|/my-ford/when-charging|Find out the charging schedule
|/my-ford/good-night|Run the good night routine (make sure it's plugged in, doors closed and locked, remind user of fuel level.)
