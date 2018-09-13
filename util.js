const BigNumber = require('bignumber.js'),
    BLOCK_REWARD = 200000000;

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
    const forgedBalance = new BigNumber(BLOCK_REWARD);
    const total = new BigNumber(poolSize);
    const balance = new BigNumber(voterBalance);

    const fullPay = forgedBalance.times(balance).dividedBy(total);

    return {
        payout: fullPay,
        taxes: new BigNumber(0)
    };
};

