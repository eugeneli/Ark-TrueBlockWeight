const config = require('./config.json'),
    utils = require('./utils.js'),
    BLOCK_REWARD = 200000000,
    DAILY_FORGED_BLOCKS = 211,
    MONTHLY_FORGED_BLOCKS = DAILY_FORGED_BLOCKS * 30,
    BigNumber = require('bignumber.js'),
    queries = require('./queries.js'),
    request = require('request-promise-native');

let sortedForgedBlocks = [],
    latestForgedBlock,
    earliestForgedBlock,
    timestampToday,
    nBlockTimePeriod,
    curBals,
    votes = [],
    voterBals = {},
    forgedToday = 0,
    numBlocks,
    newTxs,
    blacklist = config.blacklist,
    unpaidBalances = {};

BigNumber.config({
    DECIMAL_PLACES: 8,
    ERRORS: false
});

queries.init(config.publicKey, config.pKey);

process.on(
    "unhandledRejection",
    function handleWarning(reason, promise) {

        console.log(reason);

    }
);

let getKey = () => {
    return new Promise((resolve, reject) => {
        let keysQuery = queries.getKeys(config.delegate);
        utils.client.query(keysQuery, (err, res) => {
            if (typeof res == "undefined")
                reject("Error querying node db for keys");
            config.pKey = JSON.parse(res.rows[0].rawasset)['delegate']['publicKey'];
            let pKey = config.pKey;
            config.publicKey = "";
            for (let i = 0; i < pKey.length; i++) {
                chunk = pKey[i] + pKey[i + 1];
                thisChunk = utils.getOctal(chunk);
                while (thisChunk.length < 3) {
                    thisChunk = "0" + thisChunk;
                }
                config.publicKey = config.publicKey + "\\" + thisChunk;
                i++;
            }
            queries.init(config.publicKey, config.pKey);
            resolve();
        })
    })
};

let getBlocks = () => {
    return new Promise((resolve, reject) => {
        // Get all our forged blocks
        let blockQuery = queries.getGeneratedBlocks(Math.floor(numBlocks));
        utils.client.query(blockQuery, (err, res) => {
            if (typeof res == "undefined")
                reject("Error querying node db for generated blocks");

            sortedForgedBlocks = res.rows.map((row) => {
                return {
                    'height': row.height,
                    'timestamp': row.timestamp,
                    'fees': row.totalFee,
                    'poolBalance': 0
                };
            });

            earliestForgedBlock = sortedForgedBlocks[sortedForgedBlocks.length - 1];
            latestForgedBlock = sortedForgedBlocks[0];

            // Timestamp 24h ago
            timestampToday = latestForgedBlock.timestamp - nBlockTimePeriod;

            console.log("Retrieved forged blocks")
            resolve();
        })
    })
};

let getCurrentBalances = () => {
    return new Promise((resolve, reject) => {
        // Get all our forged blocks
        let currentBalQuery = queries.getVoterBalances();
        utils.client.query(currentBalQuery, (err, res) => {
            if (typeof res == "undefined")
                reject("Error querying node db for current voter balances");

            curBals = res.rows.map((row) => {
                return {
                    'address': row.address,
                    'balance': parseInt(row.balance)
                };
            }).sort((a, b) => b.balance - a.balance);
            console.log("Retrieved current voter balances")
            resolve();
        })
    })
};


let getNewTransactions = () => {
    return new Promise((resolve, reject) => {
        curBals.forEach(val => {
            voterBals[val.address] = val.balance
        })
        let addrs = curBals.map(val => val.address)
        let newTxQuery = queries.getRelevantTransactions(addrs, earliestForgedBlock.timestamp, latestForgedBlock.timestamp);

        utils.client.query(newTxQuery, (err, res) => {
            if (typeof res == "undefined")
                reject("Error querying node db for voters");

            newTxs = res.rows.map(tx => {
                return {
                    'amount': tx.amount,
                    'height': tx.height,
                    'recipientId': tx.recipientId,
                    'senderId': tx.senderId,
                    'fee': tx.fee,
                    'rawasset': tx.rawasset || '{}'
                }
            });

            console.log(`New transactions received (${newTxs.length})`);
            resolve();
        })
    })
};

let processBalances = () => {
    return new Promise((resolve, rej) => {
        let voterAddrs = curBals.map((vote) => vote.address);

        let allVotersEver = new Set(voterAddrs);

        sortedForgedBlocks.forEach((forged) => {
            //forged.voterBalances = new Map();
            if (forged.timestamp >= timestampToday) {
                forgedToday++;
            }
        });

        let totalBalanceThusFar = new Map(curBals.map((vote) => [vote.address, vote.balance]));
        let currentVoters = new Set(voterAddrs);
        let txs = newTxs.sort((a, b) => b.height - a.height); //sort descending

        console.log("Processing new transactions...")

        // Sort txs into the blocks they apply to
        let sortTx = (tx) => {
            sortedForgedBlocks.some((block, idx) => {
                // Populate the balances
                if (!sortedForgedBlocks[idx + 1].voterBalances)
                    sortedForgedBlocks[idx + 1].voterBalances = new Map(block.voterBalances);
                if (sortedForgedBlocks[idx + 1]) { // Don't do anything on the last block
                    if (tx.height <= block.height && tx.height > sortedForgedBlocks[idx + 1].height) {
                        // Apply the tx
                        if (allVotersEver.has(tx.senderId)) {
                            let thusFar = totalBalanceThusFar.get(tx.senderId);
                            thusFar += (parseInt(tx.fee) + parseInt(tx.amount));
                            totalBalanceThusFar.set(tx.senderId, thusFar);
                            sortedForgedBlocks[idx + 1].voterBalances.set(tx.senderId, {
                                'balance': thusFar,
                                'share': 0
                            });
                        }
                        if (allVotersEver.has(tx.recipientId)) {
                            let thusFar = totalBalanceThusFar.get(tx.recipientId);
                            thusFar -= parseInt(tx.amount);
                            totalBalanceThusFar.set(tx.recipientId, thusFar);
                            sortedForgedBlocks[idx + 1].voterBalances.set(tx.recipientId, {
                                'balance': thusFar,
                                'share': 0
                            });
                        }
                        // Apply votes
                        if (tx.rawasset.includes(`-${config.pKey}`)) {
                            currentVoters.add(tx.senderId);
                            sortedForgedBlocks[idx + 1].voterBalances.set(tx.senderId, {
                                'balance': totalBalanceThusFar.get(tx.senderId),
                                'share': 0
                            });
                        } else if (tx.rawasset.includes(`+${config.pKey}`)) {
                            currentVoters.delete(tx.senderId);
                            sortedForgedBlocks[idx + 1].voterBalances.set(tx.senderId, {
                                'balance': 0,
                                'share': 0
                            });
                        }
                        return true;
                    }
                }
            })
        }

        sortedForgedBlocks[0].voterBalances = new Map(curBals.map(vote => [vote.address, { // Populate the highest block
            'balance': vote.balance,
            'share': 0
        }]));
        txs.forEach((tx, idx) => {
            sortTx(tx);
        });
        // Populate the last blocks we missed
        sortedForgedBlocks.forEach((block, idx) => {
            if (!block.voterBalances) {
                block.voterBalances = new Map(sortedForgedBlocks[idx - 1].voterBalances);
            }
        })
        currentVoters = new Set(voterAddrs);
        let voterSum = 0;
        latestForgedBlock.voterBalances.forEach((bal) => voterSum += bal[0])
        let rewardFeeSum = sortedForgedBlocks.reduce((total, block) => total + block.rewardFees, 0);
        console.log("Pool balance calculations complete");

        resolve();
    })
};

let getVoterWeight = () => {
    console.log("Calculating voter weights for each block...");
    let taxes = new BigNumber(0);
    let totalPay = new BigNumber(0);
    return new Promise((resolve, rej) => {
        sortedForgedBlocks = sortedForgedBlocks.reverse();
        sortedForgedBlocks.forEach((block, idx) => {
            //console.log("block - " + parseInt(idx + 1) + " / " + sortedForgedBlocks.length + " | blockVoterBal.size: " + block.voterBalances.size);

            block.voterBalances.forEach((balanceData, index) => {
                if (balanceData.balance > (config.cap * 100000000)) {
                    let curData = sortedForgedBlocks[idx].voterBalances.get(index);
                    curData.balance = (config.cap * 100000000);
                    curData.overlimit = true;
                    sortedForgedBlocks[idx].voterBalances.set(index, curData);
                }
            });

            const poolTotal = [...block.voterBalances.values()].map(val => val.balance).reduce((a, b) => a + b);

            block.voterBalances.forEach((balanceData, addr) => {

                let curData = sortedForgedBlocks[idx].voterBalances.get(addr);
                let max = new BigNumber(curData.balance);

                if (fullBalances.includes(addr)) {
                    current = max;
                } else {
                    current = max.times(config.payout);
                }

                curData.current = current.toNumber();

                sortedForgedBlocks[idx].voterBalances.set(addr, curData);

                balanceData = curData;

                if (balanceData.current > 1) {
                    //[paidShare, tax]
                    let share = utils.blockShareFunc(poolTotal, balanceData.current);
                    balanceData.share = share[0];

                    //If they are blacklisted, keep their share
                    if (blacklist[addr]) {
                        balanceData.share = new BigNumber(0);
                        taxes = taxes.plus(share[0]);
                    }

                    taxes = taxes.plus(share[1]);
                    totalPay = totalPay.plus(share[0]);
                }


            });
        });

        console.log("Voter weight calculation complete");

        resolve(taxes);
    })
};

let handleData = (taxes) => {
    return new Promise((resolve, rej) => {
        let payouts = {};

        // Only pay up to number of blocks passed 
        if (forgedToday > numBlocks)
            forgedToday = numBlocks;

        for (let i = sortedForgedBlocks.length - forgedToday; i < sortedForgedBlocks.length; i++) {
            let block = sortedForgedBlocks[i];
            block.voterBalances.forEach((balanceData, addr) => {
                let pay = payouts[addr] != null ? payouts[addr] : new BigNumber(0);
                payouts[addr] = pay.plus(balanceData.share);
            });
        }
        
        let totalPayouts = new BigNumber(0);
        Object.keys(payouts).forEach((key) => totalPayouts = totalPayouts.plus(payouts[key]));
        let taxes = new BigNumber(forgedToday * BLOCK_REWARD).minus(totalPayouts);
        let ePayout = totalPayouts.dividedBy(100000000).dividedBy(new BigNumber(forgedToday).times(2)).times(100).toFormat(2);
        console.log("Total paid out: " + totalPayouts.dividedBy(100000000).toString());
        console.log("Total taxes collected: " + taxes.dividedBy(100000000).toString());
        console.log("Effective Payout: " + ePayout);
        console.log("True block weight complete");

        let payData = {
            taxes: taxes,
            payouts: payouts,
            latestForgedBlock: latestForgedBlock
        };

        resolve(payData);
    })
};

exports.getPayouts = (options) => {
    blacklist = options.blacklist ? options.blacklist : {};
    unpaidBalances = options.unpaidBalances ? options.unpaidBalances : {};
    numBlocks = options.blocks ? options.blocks : config.blocks;
    nBlockTimePeriod = numBlocks * 8 * 51; //Look back numBlocks
    blockShareFunc = options.blockShareFunc ? options.blockShareFunc : utils.blockShareFunc;


    console.log(`Calculating TBW and paying out ${numBlocks} forged blocks with ${nBlockTimePeriod} seconds look-back`);

    return utils.connect()
        .then(getKey) // Get Delegate Public Keys
        .then(getCurrentBalances) // Get Current Balances
        .then(getBlocks) // Get Blocks
        .then(getNewTransactions) // Get Vote and Balance Changes
        .then(processBalances) // Process relevant txs
        .then(getVoterWeight)
        .then(utils.close)
        .then(handleData);
};

let args = process.argv.slice(2);
if (args.length >= 1) {
    if (args[0] == "start")
        exports.getPayouts({});
}