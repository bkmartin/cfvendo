/*
 * cfvendo cloudfoundry v2 node.js express service broker.
 *
 * This sample can be deployed to CloudFoundry as an application as well.
 *
 * The URL paths herein (other than the GET /) are mandated by CloudFoundry.
 */
var express = require('express');
var http = require('http');
var https = require('https');
var url = require('url');
var q = require('q');
var request = require('request');
var jade = require('jade');
var bodyParser = require('body-parser');
var basicAuth = require('basic-auth');

var SERVICE_BROKER_USER = "cfvendo";
var SERVICE_BROKER_PASSWORD = "3245sdf3454t";
var API = "https://api.ng.bluemix.net";
var CLIENT_ID = "DockerVendo";
var CLIENT_SECRET = "3245sdf3454t";

var tokenEndpoint = null;
var authzEndpoint = null;
var servicesMetadata = null;
var dockerImageMap = {};


function connected() {
   console.log("Node server started on %s", Date(Date.now()));
};

function getSSORedirectURI(request) {
   return "https://" + request.get("host") + "/sso_dashboard";
};

function createDockerImageMap() {
   for (var idx = 0; idx < servicesMetadata.length; idx++) {
      dockerImageMap[servicesMetadata[idx].cloudfoundry.id] = servicesMetadata[
         idx].docker;
      console.log('%j', dockerImageMap);
   }
}

//initialize endpoint urls from the cloud controller info endpoint
function initOauthUrls() {
   var deferred = q.defer();
   request({
         method: "GET",
         uri: API + '/info'
      },
      function(error, res, body) {
         if (!error && res.statusCode == 200) {
            console.log("api info: " + body);
            tokenEndpoint = JSON.parse(body).token_endpoint;
            authzEndpoint = JSON.parse(body).authorization_endpoint;
            deferred.resolve(authzEndpoint);
         } else {
            console.log("error getting oauth urls");
            deferred.reject(error);
         }
      });
   return deferred.promise;
}

function getBearerToken(code, redirectUri) {
   console.log('getBearerToken code=' + code + ' redirect uri=' +
      redirectUri);
   var deferred = q.defer();
   request({
         method: "POST",
         uri: authzEndpoint + '/oauth/token',
         'content-type': 'application/x-www-form-urlencoded',
         auth: {
            'user': CLIENT_ID,
            'pass': CLIENT_SECRET
         },
         form: {
            client_id: CLIENT_ID,
            grant_type: 'authorization_code',
            code: code,
            redirect_uri: redirectUri
         }
      },
      function(error, res, body) {
         if (!error && res.statucCode == 200) {
            var parsedBody = JSON.parse(body);
            deferred.resolve(parsedBody.access_token)
         } else {
            console.log('getBearerToken status=' + res.statusCode);
            console.log('getBearerToken error %j', error);
            deferred.reject(new Error('getAccessCode statusCode=' + res.statusCode));
         }
      });
   return deferred.promise;
}


function checkDeveloperAccess(request, response, accessToken, spaceid,
   authzEndpoint,
   callback) {
   console.log("checkDeveloperAccess");
   console.log("accesstoken=" + accessToken);
   console.log("spaceid=" + spaceid);
   console.log("authzEndpoint=" + authzEndpoint);
   var urlString = authzEndpoint + '/rolecheck?space_guid=' + spaceid +
      '&role=developers';
   console.log('checkDeveloperAccess ' + urlString);
   var deferred = q.defer();
   request({
         method: 'GET',
         uri: urlString,
         headers: {
            'Authorization': 'Bearer ' + accessToken
         },
      },
      function(error, res, body) {
         if (!error && res.statusCode == 200) {

            deferred.resolve(JSON.parse(body).hasaccess);
         } else {
            console.log('error ' + res.statusCode);
            deferred.reject(res.statusCode);
         }
      });
   return deferred.promise;
}


function canManageServiceInstance(accessToken, instanceId) {
   var urlString = API + "/v2/service_instances/" +
      instanceId + "/permissions";
   var deferred = q.defer();
   request({
         method: 'GET',
         uri: urlString,
         headers: {
            'Authorization': 'Bearer ' + accessToken
         },
      },
      function(error, res, body) {
         if (!error && res.statusCode == 200) {
            deferred.resolve(JSON.parse(body).manage);
         } else {
            console.log('error ' + res.statusCode);
            deferred.reject(res.statusCode);
         }
      });
   return deferred.promise;
};


function catalog(request, response) {
   try {
      var baseMetadataUrl = "https://" + request.get("host") + "/";

      var myServices = [];
      for (var idx = 0; idx < servicesMetadata.length; idx++)
         myServices.push(servicesMetadata[idx].cloudfoundry);

      var result = {
         services: myServices
      };

      console.log("Catalog GET result: %j ", result);

      response.json(200, result);
   } catch (exception) {
      console.log(exception);
   }
};



function provision(request, response) {
   try {
      var instanceId = request.params.instance_id;

      console.log("Provision PUT instance_id: " + instanceId);

      var s = JSON.stringify(request.body);
      var json = JSON.parse(s);

      console.log("Provision PUT body: %j", json);

      var organizationGuid = json.organization_guid;
      var planId = json.plan_id;
      var serviceId = json.service_id;
      var spaceGuid = json.space_guid;

      var dockerImage = dockerImageMap[serviceId].image;
      console.log('provision docker image ' + dockerImage);

      var result = {
         dashboard_url: "http://192.168.59.103:7474/browser/"
         //         dashboard_url: "https://" + request.get(
         //            "host") +
         //            "/dashboard?instance_id=" + instanceId+'&space_id='+spaceGuid"
      };
      console.log("Provision PUT result: %j", result);
      response.json(200, result); // Return 409 if already provisioned at this url
   } catch (exception) {
      console.log(exception);
   }
};

function bind(request, response) {
   try {
      var instanceId = request.params.instance_id;
      var bindingId = request.params.binding_id;

      console.log("Bind PUT instanceId: " + instanceId);
      console.log("Bind PUT bindingId: " + bindingId);

      var s = JSON.stringify(request.body);
      var json = JSON.parse(s);
      console.log("BIND body: %j", json);

      var result = {
         username: 'TODO',
         password: 'TODO',
         url: 'http://www.todo.com/'
      };
      console.log("BIND PUT result: %j", result);
      response.json(200, result); // Return 409 if already provisioned at this url

   } catch (exception) {
      console.log(exception);
   }
};

function unbind(request, response) {
   try {
      var instanceId = request.params.instance_id;
      var bindingId = request.params.binding_id;
      var serviceId = request.query.service_id;
      var planId = request.query.plan_id;

      console.log("Unbind DELETE instanceId: " + instanceId);
      console.log("Unbind DELETE bindingId: " + bindingId);
      console.log("Unbind DELETE serviceId: " + serviceId);
      console.log("Unbind DELETE planId: " + planId);

      var result = {};

      console.log("Unbind DELETE result: %j", result);

      response.json(200, result); // Return 410 with body of {} if deleted
   } catch (exception) {
      console.log(exception);
   }
};

function unprovision(request, response) {
   try {
      var instanceId = request.params.instance_id;
      var serviceId = request.query.service_id;
      var planId = request.query.plan_id;

      console.log("Unprovision DELETE instanceId: " + instanceId);
      console.log("Unprovision DELETE serviceId: " + serviceId);
      console.log("Unprovision DELETE planId: " + planId);

      // TODO - Do your actual work here

      var result = {};

      console.log("Unprovision DELETE result: %j", result);

      response.json(200, result); // Return 410 with body of {} if deleted
   } catch (exception) {
      console.log(exception);
   }
};

function dashboard(request, response) {
   try {
      var instance_id = request.query.instance_id;
      var space_id = request.query.space_id;
      console.log("Dashboard GET instanceId: " + instance_id);
      var redirectUri = authzEndpoint +
         "/oauth/authorize?state=" +
         instance_id +
         "&response_type=code&client_id=" +
         CLIENT_ID +
         "&redirect_uri=" +
         getSSORedirectURI(request) +
         "%3Fspace_id=" + space_id +
         "%26instance_id=" + instance_id;
      console.log('redirect to %j', redirectUri);
      response.redirect(redirectUri);
   } catch (exception) {
      console.log(exception);
   }
};

function sso_dashboard(request, response) {
   try {
      var code = request.query.code;
      var state = request.query.state;
      var space_id = request.query.space_id;
      var instance_id = request.query.instance_id;

      console.log("SSO Dashboard GET code: " + code);
      console.log("SSO Dashboard GET state: " + state);
      console.log("SSO Dashboard GET state: " + space_id);
      console.log("SSO Dashboard GET state: " + instance_id);

      var redirectUri = getSSORedirectURI(request) + '?space_id=' + space_id +
         '&instance_id=' + instance_id;

      getBearerToken(code, redirectUri).then(function(accessTokenResult) {
         console.log('accessToken=' + accessTokenResult);
         checkDeveloperAccess(request, response, accessTokenResult,
            space_id,
            authzEndpoint, manageServiceInstanceCallback);
      }).then(function() {
         response.render('account', {
            'username': accountInfo.username,
            'password': accountInfo.password
         });
      }).
      catch (function(error) {
         response.json(401, 'Unauthorized');
      });
   } catch (exception) {
      console.log(exception);
   }
};



function errorHandler(err, req, res, next) {
   console.log("ERROR %j", err);
   res.status(500);
   res.render('error', {
      error: err
   });
}

function unauthorized(res) {
   res.set('WWW-Authenticate', 'Basic realm=Authorization Required');
   return res.send(401);
};

function doBasicAuth(req, res, next) {
   var user = basicAuth(req);
   if (!user || !user.name || !user.pass) {
      return unauthorized(res);
   };

   if (user.name == SERVICE_BROKER_USER && user.pass ==
      SERVICE_BROKER_PASSWORD) {
      return next();
   }
   return unauthorized(res);
};

function initialize() {
   creds = require(__dirname + "/creds.json");
   SERVICE_BROKER_USER = creds.brokerUser;
   SERVICE_BROKER_PASSWORD = creds.brokerPassword;
   API = creds.apiHost;
   CLIENT_ID = creds.clientId;
   CLIENT_SECRET = creds.clientSecret;

   servicesMetadata = require(__dirname + "/services.json");
   createDockerImageMap();

   var expressServer = express();
   expressServer.use(bodyParser());
   expressServer.use(express.static(__dirname + "/public"));
   expressServer.set('views', __dirname + '/views');
   expressServer.set('view engine', 'jade')
   expressServer.use(errorHandler);

   // Get for testing.  Not authenticated
   expressServer.get("/", doBasicAuth, function(req, res) {
      res.send(200, 'Authenticated');

   });

   // The following URL paths are all mandated by CloudFoundry
   expressServer.get("/v2/catalog", doBasicAuth, catalog);
   expressServer.put("/v2/service_instances/:instance_id", doBasicAuth,
      provision);
   expressServer.put(
      "/v2/service_instances/:instance_id/service_bindings/:binding_id",
      doBasicAuth,
      bind);
   expressServer.delete(
      "/v2/service_instances/:instance_id/service_bindings/:binding_id",
      doBasicAuth,
      unbind);
   expressServer.delete("/v2/service_instances/:instance_id", doBasicAuth,
      unprovision);

   // Paths to handle SSO - not authenticated
   expressServer.get("/dashboard", dashboard);
   expressServer.get("/sso_dashboard", sso_dashboard);

   initOauthUrls().then(function(endpoint) {
      //Setup and start the server.
      port = 3000
      if (process.env.VCAP_APP_PORT) {
         port = process.env.VCAP_APP_PORT;
      }
      console.log("listening on port " + port);
      expressServer.listen(port, connected);
   }, function(error) {
      console.log("unable to initialize server " + error);
   });
}

initialize();
