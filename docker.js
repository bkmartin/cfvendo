var Docker = require('dockerode');
var Q = require('q');

function getDocker(host, port) {
    return new Docker({
        host: host,
        port: port
    });
}

function runImage(docker, containerOpts) {
    return pullImage(docker, containerOpts.Image)
        .then(function() {
            return createContainer(docker, containerOpts)
        })
        .then(function(container) {
            return inspectContainer(container)
                .then(function(data) {
                    startContainer(container, data)
                        .then(function() {
                            var ports = {}
                            for (var port in data.HostConfig.PortBindings) {
                                ports[port] = data.HostConfig.PortBindings[port][0].HostPort
                            }

                            return {
                                "containerId": container.id,
                                "ports": ports,
                            }
                        })
                })
        })
        .
    catch (function(err) {
        throw err;
    })
}

function pullImage(docker, image) {
    var deferred = Q.defer()
    docker.pull(image, function(err, stream) {
        if (err) {
            deferred.reject(err)
        } else {
            stream.on('data', function(chunk) {})
            stream.on('end', function() {
                deferred.resolve()
            })
            stream.on('error', function(err) {
                deferred.reject(err)
            })
        }
    })

    return deferred.promise
}

function createContainer(docker, containerOpts) {

    var ccopts = {
        'Hostname': '',
        'User': '',
        'AttachStdin': false,
        'AttachStdout': false,
        'AttachStderr': false,
        'Tty': true,
        'OpenStdin': true,
        'StdinOnce': false,
        'Env': null,
        'Cmd': null,
        'Volumes': {},
        'VolumesFrom': '',
    };

    for (var k in containerOpts) {
        ccopts[k] = containerOpts[k]
    }

    var deferred = Q.defer()
    docker.createContainer(ccopts, function handler(err, container) {
        if (err) {
            deferred.reject(err)
        } else {
            deferred.resolve(container)
        }
    })

    return deferred.promise
}

function inspectContainer(container) {
    var deferred = Q.defer()

    container.inspect(function(err, data) {
        if (err) {
            deferred.reject(err)
        } else {
            deferred.resolve(data)
        }
    })

    return deferred.promise
}

function startContainer(container, data) {
    var deferred = Q.defer()

    var portbindings = {}
    for (var port in data.Config.ExposedPorts) {
        portbindings[port] = [{}]
    }

    var scopts = {
        "Privileged": true,
        "PortBindings": portbindings
    }

    container.start(scopts, function(err, container) {
        if (err) {
            deferred.reject(err)
        } else {
            deferred.resolve(container)
        }
    })

    return deferred.promise
}

module.exports.getDocker = getDocker;
module.exports.runImage = runImage;
