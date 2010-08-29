var sys = require("sys");
/**
 * Builds a bounding box that encloses transformed geometry instances.
 *
 * As a model file is parsed (eg. Collada), this builder is fed all of the library geometry positions,
 * transforms and geometry instances as they are parsed. Then when the file is parsed, it will provide a
 * parapiped that encloses the spatial extents of the model.
 */
exports.getBoundaryBuilder = function() {
    return new BoundaryBuilder();
};

var BoundaryBuilder = function() {
    var matStack = [];
    var geos = {};
    const hugeNum = 9999999; // TODO: Guarantee this is max

    var extents = {
        xmin : hugeNum, ymin : hugeNum, zmin : hugeNum,
        xmax : -hugeNum, ymax : -hugeNum, zmax : -hugeNum
    };

    /** Register occurrence of a library geometry
     */
    this.libGeometry = function(id, positions) {
        var geo = new Array(positions.length / 3);
        var j = 0;
        for (var i = 0; i < positions.length; i += 3) {
            geo[j++] = [positions[i], positions[i + 1], positions[i + 2]];
        }
        geos[id] = geo;
    };

    this.pushRotate = function(angle, v) {
        matStack.push(rotationMat4v(angle * Math.PI / 180.0, v));
    };

    this.pushTranslate = function(v) {
        matStack.push(translationMat4v(v));
    };

    this.pushScale = function(v) {
        matStack.push(scalingMat4v(v));
    };

    this.pushMatrix = function(elements) {
        matStack.push(elements);
    };

    /** Register instantiation of library geometry
     */
    this.instanceGeometry = function(id) {
        var geo = geos[id];
        var geo2;
        if (!geo) {
            throw ("Unresolved geometry: '" + id + "'");
        }
        for (var i = matStack.length - 1; i >= 0; i--) {
            geo2 = transformPoints3(matStack[i], geo2 || geo);
        }
        expandBoundary(extents, geo2 || geo);
    };

    /** Register occurrence of geometry
     */
    this.geometry = function(positions) {
        var geo = new Array(positions.length / 3);
        var geo2;
        var j = 0;
        for (var i = 0; i < positions.length; i += 3) {
            geo[j++] = [positions[i], positions[i + 1], positions[i + 2]];
        }
        for (var i = matStack.length - 1; i >= 0; i--) {
            geo2 = transformPoints3(matStack[i], geo2 || geo);
        }
        expandBoundary(extents, geo2 || geo);
    };

    /** Pop whatever is on the top of the transform matrix stack
     */
    this.popTransform = function() {
        matStack.pop();
    };

    /** Get current boundary result
     */
    this.getBoundary = function() {
        return extents;
    };
};

function expandBoundary(e, positions) {
    for (var i = 0; (i + 2) < positions.length; i += 3) {
        var p = positions[i];

        var x = p[i];
        var y = p[i + 1];
        var z = p[i + 2];

        if (x != null && y != null && z != null) {
            if (x < e.xmin) e.xmin = x;
            if (y < e.ymin) e.ymin = y;
            if (z < e.zmin) e.zmin = z;
            if (x > e.xmax) e.xmax = x;
            if (y > e.ymax) e.ymax = y;
            if (z > e.zmax) e.zmax = z;
        }
    }
}

function identityMat() {
    return [
        1.0, 0.0, 0.0, 0.0,
        0.0, 1.0, 0.0, 0.0,
        0.0, 0.0, 1.0, 0.0,
        0.0, 0.0, 0.0, 1.0
    ];
}

function lenVec4(v) {
    return Math.sqrt(sqLenVec4(v));
}


function sqLenVec4(v) {
    return dotVector4(v, v);
}

function dotVector4(u, v) {
    return (u[0] * v[0] + u[1] * v[1] + u[2] * v[2] + u[3] * v[3]);
}

function normalizeVec4(v) {
    var f = 1.0 / lenVec4(v);
    return mulVec4Scalar(v, f);
}

function mulVec4Scalar(v, s) {
    return [v[0] * s,v[1] * s,v[2] * s,v[3] * s];
}

function rotationMat4v(anglerad, axis) {
    var ax = normalizeVec4([axis[0],axis[1],axis[2],0.0]);
    var s = Math.sin(anglerad);
    var c = Math.cos(anglerad);
    var q = 1.0 - c;

    var x = ax[0];
    var y = ax[1];
    var z = ax[2];

    var xx,yy,zz,xy,yz,zx,xs,ys,zs;

    xx = x * x;
    yy = y * y;
    zz = z * z;
    xy = x * y;
    yz = y * z;
    zx = z * x;
    xs = x * s;
    ys = y * s;
    zs = z * s;

    var m = identityMat();

    m[0] = (q * xx) + c;
    m[1] = (q * xy) + zs;
    m[2] = (q * zx) - ys;
    m[3] = 0.0;

    m[4] = (q * xy) - zs;
    m[5] = (q * yy) + c;
    m[6] = (q * yz) + xs;
    m[7] = 0.0;

    m[8] = (q * zx) + ys;
    m[9] = (q * yz) - xs;
    m[10] = (q * zz) + c;
    m[11] = 0.0;

    m[12] = 0.0;
    m[13] = 0.0;
    m[14] = 0.0;
    m[15] = 1.0;

    return m;
}

function translationMat4v(v) {
    var m = identityMat();
    m[12] = v[0];
    m[13] = v[1];
    m[14] = v[2];
    return m;
}

function scalingMat4v(v) {
    var m = identityMat();
    m[0] = v[0];
    m[5] = v[1];
    m[10] = v[2];
    return m;
}

function transformPoints3(m, points) {
    var len = points.length;
    var points2 = new Array(len);

    for (var i = 0; i < len; i++) {
        points2[i] = transformPoint3(m, points[i]);
    }
    return points2;
}

function transformPoint3(m, p) {
    return [
        (m[0] * p[0]) + (m[4] * p[1]) + (m[8] * p[2]) + m[12],
        (m[1] * p[0]) + (m[5] * p[1]) + (m[9] * p[2]) + m[13],
        (m[2] * p[0]) + (m[6] * p[1]) + (m[10] * p[2]) + m[14],
        (m[3] * p[0]) + (m[7] * p[1]) + (m[11] * p[2]) + m[15]
    ];
}
