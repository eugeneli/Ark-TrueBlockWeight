"use strict";
const {
    Client
} = require('pg'),
    BigNumber = require('bignumber.js'),
    config = require('./config.json'),
    BLOCK_REWARD = 200000000,
    NODE_CREDS = {
        user: config.user,
        host: config.host,
        database: config.database,
        password: config.password,
        port: config.port,
    };

exports.client = new Client(NODE_CREDS);

exports.getOctal = (s) => {
    s = s.replace(/^ +| +$/g, '');

    var n;
    var matches = s.match(/^([-+]?[0-9a-f]*)(\.[0-9a-f]*)?$/i);
    if (!matches /*/^[-+]?\w*(\.\w*)?$/.test(s) */ ) {
        n = NaN;
    } else if (!matches[2] || matches[2].length < 2) {
        n = parseInt('0' + matches[1], 16);
    } else {
        n = parseInt('0' + matches[1], 16);
        n += (matches[1].subString(0, 1) == '-' ? -1 : +1) * parseInt(matches[2].subString(1), 16) / Math.pow(16, matches[2].length - 1);
    }
    // FIXME: check for invalid characters, that are silently ignored by parseInt()
    var output;
    if (isNaN(n)) {
        output = '';
    } else if (16.25.toString(8) == '10.4') {
        // Opera 9 does not support toString() for floats with base != 10
        output = n.toString(8);
    } else {
        output = (n > 0 ? Math.floor(n) : Math.ceil(n)).toString(8);
        if (n % 1) {
            output += '.' + Math.round((Math.abs(n) % 1) * Math.pow(8, 8)).toString(8);
            output = output.replace(/0+$/, '');
        }
    }
    return (output)
};

exports.blockShareFunc = (poolSize, voterBalance) => {
    var forgedBalance = new BigNumber(BLOCK_REWARD);
    var poolSize = new BigNumber(poolSize);
    var balance = new BigNumber(voterBalance);

    var fullPay = forgedBalance.times(balance).dividedBy(poolSize);

    return [fullPay, new BigNumber(0)];
};

exports.connect = () => {
    return new Promise((resolve, reject) => {
        exports.client.connect((err) => {
            if (!err) {
                console.log("Node database connection opened")
                resolve();
            } else {
                console.log(err);
                reject("Error getting node database connection");
            }
        })
    })
};

exports.close = (taxes) => {
    return new Promise((resolve, reject) => {
        exports.client.end((err) => {
            console.log("Node database connection closed");
            exports.client = new Client(NODE_CREDS); //reinstantiate exports.client for next run
            resolve(taxes);
        });
    })
};