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
var docker = require('./docker.js');

var SERVICE_BROKER_USER
var SERVICE_BROKER_PASSWORD
var API
var CLIENT_ID
var CLIENT_SECRET
var DOCKER
var DOCKER_HOST

var tokenEndpoint = null;
var authzEndpoint = null;
var servicesMetadata = null;
var dockerImageMap = {};
var provisioningMap = {};


function connected() {
   console.log("Node server started on %s", Date(Date.now()));
};

function getSSORedirectURI(request) {
   return "https://" + request.get("host") + "/sso_dashboard";
};

function createDockerImageMap() {
   for (var idx = 0; idx < servicesMetadata.length; idx++) {
      dockerImageMap[servicesMetadata[idx].cloudfoundry.id] = servicesMetadata[idx].docker;
      provisioningMap[servicesMetadata[idx].cloudfoundry.id] = servicesMetadata[idx].provisioning;
   }
   console.log('%j', dockerImageMap);
   console.log('%j', provisioningMap);
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
      for (var idx = 0; idx < servicesMetadata.length; idx++) {
         for (var key in servicesMetadata[idx].cloudfoundry.metadata) {
            servicesMetadata[idx].cloudfoundry.metadata[key] = servicesMetadata[idx].cloudfoundry.metadata[key].replace('${brokerHost}',request.get('host'));
         }
         myServices.push(servicesMetadata[idx].cloudfoundry);
      }

      var result = {
         services: myServices
      };

      console.log("Catalog GET result: %j ", result);

      response.json(200, result);
   } catch (exception) {
      console.log(exception);
   }
};

function generateDashboard(provisioning, ports) {
   host = url.parse(DOCKER_HOST).host
   var dashboard_url = provisioning.dashboard_url.replace('${host}', host);
   for (var x in ports) {
      dashboard_url = dashboard_url.replace('${' + x + '}', ports[x]);
   }
   console.log('dashboard_url=' + dashboard_url);
   return dashboard_url;
}

function storeContainerId(containerId, instanceId) {
   var deferred = q.defer();
   db.insert({
      'containerId': containerId
   }, instanceId, function(err, body) {
      if (!err) {
         deferred.resolve(body);
      } else
         deferred.reject(new Error(err));
   });
   return deferred.promise;
}

function getContainerId(instanceId) {
   var deferred = q.defer();
   db.get(instanceId, {
      revs_info: true
   }, function(err, body) {
      if (err) {
         deferred.reject(new Error(err));
      } else {
         deferred.resolve(body);
      }
   });
   return deferred.promise;
}

function destroyInstanceId(instanceId, rev) {
   var deferred = q.defer();
   db.destroy(instanceId, rev, function(err, body) {
      if (err) {
         deferred.reject(new Error(err));
      } else {
         deferred.resolve();
      }
   });
   return deferred.promise;
}

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

      console.log('provision %j', dockerImageMap[serviceId].Image);
      docker.runImage(DOCKER, dockerImageMap[serviceId]).then(function(containerInfo) {
         console.log('containerInfo %j', containerInfo);
         var dashboardUrl = generateDashboard(provisioningMap[serviceId], containerInfo.ports);
         return storeContainerId(containerInfo.containerId, instanceId)
            .then(function(containerid) {
               var result = {
                  dashboard_url: dashboardUrl
                  //         dashboard_url: "https://" + request.get(
                  //            "host") +
                  //            "/dashboard?instance_id=" + instanceId+'&space_id='+spaceGuid"
               };
               console.log("Provision PUT result: %j", result);
               response.json(200, result); // Return 409 if already provisioned at this url
            })
      }).
      catch(function(error) {
         console.log('error %j', error);
         response.json(500, error);
      });
   } catch (exception) {
      console.log('exception %j', exception);
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

      var result = {};

      getContainerId(instanceId)
         .then(function(data) {
            return docker.stopImage(DOCKER, data.containerId)
               .then(function() {
                  return destroyInstanceId(instanceId, data._rev)
               })
         })
         .catch(function(error) {
            console.log('error %j', error);
            response.json(500, error);
         });

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
      catch(function(error) {
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
   DOCKER_HOST = creds.dockerHost;
   DOCKER = docker.getDocker(creds.dockerHost, creds.dockerPort);
   db = require('nano')(creds.couchDB);
   console.log('%j', db);

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
