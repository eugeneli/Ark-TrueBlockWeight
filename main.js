const { Client } = require('pg');
const config = require('./config.json');

const BLOCK_REWARD = 200000000;
const DAILY_FORGED_BLOCKS = 211;
const NODE_CREDS = {
    user: config.user,
    host: config.host,
    database: config.database,
    password: config.password,
    port: config.port,
};

var QueryStream = require('pg-query-stream'),
    fs = require('fs'),
    BigNumber = require('bignumber.js'),
    queries = require('./queries.js'),
    sortedForgedBlocks = [],
    latestForgedBlock,
    votes = [],
    voterBlockShares = new Map(),
    client = new Client(NODE_CREDS);

BigNumber.config({ DECIMAL_PLACES: 8, ERRORS: false });
queries.init(config.publicKey, config.pKey);

var blacklist;
var numBlocks;
var blockShareFunc = (poolSize, voterBalance) => {
    var forgedBalance = new BigNumber(BLOCK_REWARD);
    var poolSize = new BigNumber(poolSize);
    var balance = new BigNumber(voterBalance);

    var fullPay = forgedBalance.times(balance).dividedBy(poolSize);

    return [fullPay, new BigNumber(0)];
};

var connect = () => {
    return new Promise((resolve, reject) => {
        client.connect((err) => {
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

var close = (taxes) => {
    return new Promise((resolve, reject) => {
        client.end((err) => {
            console.log("Node database connection closed");
            client = new Client(NODE_CREDS); //reinstantiate client for next run
            resolve(taxes);
        });
    })
};

var getBlocks = () => {
    return new Promise((resolve, reject) => {
        // Get all our forged blocks
        client.query(queries.getGeneratedBlocks(numBlocks), (err, res) => {
            if (typeof res == "undefined")
                reject("Error querying node db for generated blocks");

            sortedForgedBlocks = res.rows.map((row) => {
                return {
                    'height': row.height,
                    'timestamp': row.timestamp,
                    'fees': row.totalFee,
                    'poolBalance': 0
                };
            }).sort((a, b) => a.timestamp - b.timestamp);

            latestForgedBlock = sortedForgedBlocks[sortedForgedBlocks.length - 1];

            console.log("Retrieved forged blocks")
            resolve();
        })
    })
};


var getVoters = () => {
    return new Promise((resolve, reject) => {
        var votersQuery = queries.getVoters(latestForgedBlock.timestamp);
        client.query(votersQuery, (err, res) => {
            if(typeof res == "undefined")
                reject("Error querying node db for voters");

            votes = res.rows.map((row) => {
                                return {
                                    'voter': row.senderId,
                                    'height': row.height,
                                    'timestamp': row.timestamp,
                                    'balances': {}
                                };
                            });

            console.log(`Historical voters retrieved (${votes.length})`);
            resolve();
        })
    })
};

var getVoterWeight = () => {
    console.log("Calculating voter weights for each block...");
    var taxes = new BigNumber(0);
    var totalPay = new BigNumber(0);
    return new Promise((resolve, rej) => {
        sortedForgedBlocks.forEach((block) => {
            var blockHeight = block.height;

            var poolTotal = 0;
            block.voterBalances.forEach((balanceData, addr) => {
                if (balanceData[0] > 0)
                    poolTotal += balanceData[0]
            });

            //compute voter shares
            block.voterBalances.forEach((balanceData, addr) => {
                if (balanceData[0] > 0) {
                    //[paidShare, tax]
                    var share = blockShareFunc(poolTotal, balanceData[0]);
                    balanceData[1] = share[0];

                    //If they are blacklisted, keep their share
                    if (blacklist[addr]) {
                        balanceData[1] = new BigNumber(0);
                        taxes = taxes.plus(share[0]);
                    }

                    taxes = taxes.plus(share[1]);
                    totalPay = totalPay.plus(share[0]);
                }
            });
        });

        console.log("TAXES: " + taxes.dividedBy(100000000));
        console.log("PAYOUTS: " + totalPay.dividedBy(100000000));
        console.log("Voter weight calculation complete");

        resolve(taxes);
    })
};

var handleData = (taxes) => {
    return new Promise((resolve, rej) => {
        var payouts = {};
        for (let i = 0; i < sortedForgedBlocks.length; i++) {
            var block = sortedForgedBlocks[i];
            block.voterBalances.forEach((balanceData, addr) => {
                var pay = payouts[addr] != null ? payouts[addr] : new BigNumber(0);
                payouts[addr] = pay.plus(balanceData[1]);
            });

            /*
            //For display purposes only
            if (i == sortedForgedBlocks.length - 1) {
                var asd = new BigNumber(0);
                sortedForgedBlocks[i].voterBalances.forEach((balanceData, addr) => {
                    asd = asd.plus(balanceData[1]);
                });
                console.log("last block sum: " + asd.dividedBy(100000000));
            }
            */
        }
        var totalPayouts = new BigNumber(0);
        Object.keys(payouts).forEach((key) => totalPayouts = totalPayouts.plus(payouts[key]));
        console.log("Total paid out: " + totalPayouts.dividedBy(100000000).toString());
        console.log("True block weight complete");

        var payData = {
            taxes: taxes,
            payouts: payouts
        };

        resolve(payData);
    })
};

var getPoolBalances = () => {
    return new Promise((resolve, rej) => {
        var voterAddrs = votes.map((vote) => vote.voter);
        var fullBalanceQuery = queries.getTransactions(voterAddrs);

        client.query(fullBalanceQuery, (err, res) => {
            if(typeof res == "undefined")
                rej("Error querying node db for full balances");

            var allVotersEver = new Set(voterAddrs);

            sortedForgedBlocks.forEach((forged) => {
                forged.rewardFees = parseInt(forged.fees) + parseInt(BLOCK_REWARD);
                forged.voterBalances = new Map();
            });

            var contributionThusFar = new Map();
            var totalBalanceThusFar = new Map();
            var currentVoters = new Set();

            var txs = res.rows.sort((a, b) => a.timestamp - b.timestamp); //sort ascending

            var voteUpdate = (tx, addr) => {
                if (tx.rawasset.includes(`+${config.pKey}`)) //If just voted now
                {
                    currentVoters.add(addr);
                    var runningTotal = totalBalanceThusFar.get(addr);
                    contributionThusFar.set(addr, runningTotal);

                    sortedForgedBlocks.forEach((block) => {
                        if (block.timestamp > tx.timestamp) {
                            block.voterBalances.set(addr, [runningTotal, 0]);
                        }
                    });
                }
                if (tx.rawasset.includes(`-${config.pKey}`)) //If just unvoted now
                {
                    currentVoters.delete(addr);
                    sortedForgedBlocks.forEach((block) => {
                        if (block.timestamp > tx.timestamp) {
                            block.voterBalances.set(addr, [0, 0]);
                        }
                    });

                    contributionThusFar.set(addr, 0);
                }
            }

            console.log("Processing txs...")
            txs.forEach((tx, idx) => {
                if (allVotersEver.has(tx.recipientId)) //A voter received ARK
                {
                    var amount = parseInt(tx.amount);
                    if (currentVoters.has(tx.recipientId)) //If they are a voter, update their contribution to the block
                    {
                        var thusFar = contributionThusFar.get(tx.recipientId);
                        thusFar = thusFar == null ? 0 : thusFar;
                        totalBalanceThusFar.set(tx.recipientId, thusFar + amount); //Keep track of their balance no matter what

                        contributionThusFar.set(tx.recipientId, thusFar + amount);
                        sortedForgedBlocks.forEach((block) => {
                            if (block.timestamp > tx.timestamp) {
                                block.voterBalances.set(tx.recipientId, [thusFar + amount, 0]);
                            }
                        });
                    } else {
                        var thusFar = totalBalanceThusFar.get(tx.recipientId);
                        thusFar = thusFar == null ? 0 : thusFar;
                        totalBalanceThusFar.set(tx.recipientId, thusFar + amount); //Keep track of their balance no matter what
                    }
                }

                if (allVotersEver.has(tx.senderId)) //A voter sent ARK
                {
                    if (currentVoters.has(tx.senderId)) //If they are a voter, update their contribution to the block
                    {
                        var amount = parseInt(tx.amount) + parseInt(tx.fee);
                        var thusFar = contributionThusFar.get(tx.senderId);
                        thusFar = thusFar == null ? 0 : thusFar;
                        totalBalanceThusFar.set(tx.senderId, thusFar - amount); //Keep track of their balance no matter what
                        contributionThusFar.set(tx.senderId, thusFar - amount);
                        sortedForgedBlocks.forEach((block) => {
                            if (block.timestamp > tx.timestamp) {
                                block.voterBalances.set(tx.senderId, [thusFar - amount, 0]);
                            }
                        });
                    } else {
                        var amount = parseInt(tx.amount) + parseInt(tx.fee);
                        var thusFar = totalBalanceThusFar.get(tx.senderId);
                        thusFar = thusFar == null ? 0 : thusFar;
                        totalBalanceThusFar.set(tx.senderId, thusFar - amount); //Keep track of their balance no matter what
                    }

                    //check if voted
                    if (tx.rawasset != null && tx.rawasset != "{}")
                        voteUpdate(tx, tx.senderId);
                }
            });

            var voterSum = 0;
            latestForgedBlock.voterBalances.forEach((bal) => voterSum += bal[0])
            var rewardFeeSum = sortedForgedBlocks.reduce((total, block) => total + block.rewardFees, 0);
            console.log("Pool balance calculations complete");

            resolve();
        })
    })
};

exports.getPayouts = (options) => {
    blacklist = options.blacklist ? options.blacklist : {};
    numBlocks = options.blocks ? options.blocks : DAILY_FORGED_BLOCKS;
    blockShareFunc = options.blockShareFunc ? options.blockShareFunc : blockShareFunc;

    console.log(`Calculating true block weight for ${numBlocks} forged blocks`);

    return connect()
        .then(getBlocks)
        .then(getVoters)
        .then(getPoolBalances)
        .then(getVoterWeight)
        .then(close)
        .then(handleData);
};

var args = process.argv.slice(2);
if (args.length >= 1) {
    if (args[0] == "start")
        exports.getPayouts({});
};
