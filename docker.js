var Docker = require('dockerode');
var Q = require('q');

function getDocker(host, port) {
    return new Docker({
        host: host,
        port: port
    });
}

function runImage(docker, image) {
    pullImage(docker, image)
        .then(function() {
            return createContainer(docker, image)
        })
        .then(function(container) {
            return inspectContainer(container)
                .then(function(data) {
                    return startContainer(container, data)
                })
        })
        .
    catch (function(err) {
        console.log(err)
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

function createContainer(docker, image) {

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
        'Image': image,
        'Volumes': {},
        'VolumesFrom': '',
        "ExposedPorts": {
            "7474/tcp": {}
        },
    };

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
}

module.exports.getDocker = getDocker;
module.exports.runImage = runImage;
