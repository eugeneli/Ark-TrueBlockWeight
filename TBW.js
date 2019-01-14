const util = require("./util.js");
const Postgres = require("./Postgres.js");
const BigNumber = require("bignumber.js");
const queries = require("./queries.js");

const BLOCK_REWARD = 200000000;

BigNumber.config({
    DECIMAL_PLACES: 8,
    ERRORS: false
});

module.exports = class TBW {
    constructor(config) {
        this.config = { ...config };
        this.psql = new Postgres(this.config);

        this.startBlock = config.startBlock || null;
        this.sortedForgedBlocks = [];
        this.curBals = [];
        this.voterAddrs = [];
        this.newTxs = [];
        this.forgedToday = 0;
    }

    async init() {
        await this.psql.connect();

        let keysQuery = queries.getKeys(this.config.delegate);
        try {
            const res = await this.psql.query(keysQuery);

            this.pKey = JSON.parse(res.rows[0].rawasset)["delegate"]["publicKey"];
            this.publicKey = "";

            for (let i = 0; i < this.pKey.length; i++) {
                let chunk = this.pKey[i] + this.pKey[i + 1];
                let thisChunk = util.getOctal(chunk);
                thisChunk = thisChunk.padStart(3, "0");
                this.publicKey = this.publicKey + "\\" + thisChunk;
                i++;
            }
            queries.init(this.publicKey, this.pKey);
        }
        catch (e) {
            console.log("Error querying node db for keys");
            console.log(e);
        }
    }

    async getCurrentBalances() {
        // Get balances of voters
        const currentBalQuery = queries.getVoterBalances();
        try {
            const res = await this.psql.query(currentBalQuery);

            this.curBals = res.rows.map((row) => {
                return {
                    "address": row.address,
                    "balance": parseInt(row.balance)
                };
            }).sort((a, b) => b.balance - a.balance);

            this.voterAddrs = this.curBals.map(bal => bal.address);

            console.log("Retrieved current voter balances")
        }
        catch (e) {
            console.log("Error querying node db for current voter balances");
            console.log(e);
        }
    };

    async getBlocks() {
        // Get all our forged blocks
        const blockQuery = queries.getGeneratedBlocks(Math.floor(this.config.numBlocks), this.startBlock);
        try {
            const res = await this.psql.query(blockQuery);

            this.sortedForgedBlocks = res.rows.map((row) => {
                return {
                    "height": row.height,
                    "timestamp": row.timestamp,
                    "fees": row.totalFee,
                    "poolBalance": 0
                };
            }).sort((a, b) => b.height - a.height);

            console.log("Retrieved forged blocks")
        }
        catch (e) {
            console.log("Error querying node db for generated blocks");
            console.log(e);
        }
    };

    async getNewTransactions() {
        const earliestForgedBlock = this.sortedForgedBlocks[this.sortedForgedBlocks.length - 1];
        const latestForgedBlock = this.sortedForgedBlocks[0];
        const newTxQuery = queries.getRelevantTransactions(this.voterAddrs, earliestForgedBlock.timestamp, latestForgedBlock.timestamp);

        try {
            const res = await this.psql.query(newTxQuery);

            this.newTxs = res.rows.map(tx => {
                return {
                    "amount": tx.amount,
                    "height": tx.height,
                    "recipientId": tx.recipientId,
                    "senderId": tx.senderId,
                    "fee": tx.fee,
                    "type": tx.type,
                    "rawasset": tx.rawasset || "{}"
                }
            });

            console.log(`New transactions retrieved (${this.newTxs.length})`);
        }
        catch (e) {
            console.log("Error querying node db for voters")
            console.log(e);
        }
    };

    processBalances() {
        const latestForgedBlock = this.sortedForgedBlocks[this.sortedForgedBlocks.length - 1];
        const timestampToday = latestForgedBlock.timestamp - this.config.nBlockTimePeriod; //Timestamp 24h ago
        const allVotersEver = new Set(this.voterAddrs);
        const currentVoters = new Set(this.voterAddrs);

        this.sortedForgedBlocks.forEach((forged) => {
            if (forged.timestamp >= timestampToday || this.startBlock) {
                this.forgedToday++;
            }
        });

        //Maps Address=>Balance
        const totalBalanceThusFar = new Map(this.curBals.map((vote) => [vote.address, vote.balance]));
        const txs = this.newTxs.sort((a, b) => b.height - a.height); //sort descending

        console.log("Processing new transactions...")

        //Sort txs into the blocks they apply to
        const sortTxIntoBlocks = (tx) => {
            for (let idx = 0; idx < this.sortedForgedBlocks.length; idx++) {
                const block = this.sortedForgedBlocks[idx];
                const txFee = parseInt(tx.fee);
                const txAmount = parseInt(tx.amount);

                // Populate the balances
                if (!this.sortedForgedBlocks[idx + 1].voterBalances)
                    this.sortedForgedBlocks[idx + 1].voterBalances = new Map(block.voterBalances);

                if (this.sortedForgedBlocks[idx + 1]) // Don't do anything on the last block
                {
                    if (tx.height <= block.height && tx.height > this.sortedForgedBlocks[idx + 1].height) {
                        // Apply the tx
                        if (allVotersEver.has(tx.senderId)) {
                            let thusFar = totalBalanceThusFar.get(tx.senderId);
                            thusFar += txFee + txAmount;
                            totalBalanceThusFar.set(tx.senderId, thusFar);

                            this.sortedForgedBlocks[idx + 1].voterBalances.set(tx.senderId, {
                                "balance": currentVoters.has(tx.senderId) ? thusFar : 0,
                                "share": 0
                            });
                        }
                        if (allVotersEver.has(tx.recipientId)) {
                            let thusFar = totalBalanceThusFar.get(tx.recipientId);
                            thusFar -= txAmount;
                            totalBalanceThusFar.set(tx.recipientId, thusFar);

                            this.sortedForgedBlocks[idx + 1].voterBalances.set(tx.recipientId, {
                                "balance": currentVoters.has(tx.recipientId) ? thusFar : 0,
                                "share": 0
                            });
                        }

                        // Apply votes
                        if (tx.type == 3 && JSON.parse(tx.rawasset).votes[0] == `-${this.pKey}`) {
                            currentVoters.add(tx.senderId, true);
                            this.sortedForgedBlocks[idx + 1].voterBalances.set(tx.senderId, {
                                "balance": totalBalanceThusFar.get(tx.senderId),
                                "share": 0
                            });
                        }
                        else if (tx.type == 3 && JSON.parse(tx.rawasset).votes[0] == `+${this.pKey}`) {
                            currentVoters.delete(tx.senderId);
                            this.sortedForgedBlocks[idx + 1].voterBalances.set(tx.senderId, {
                                "balance": 0,
                                "share": 0
                            });
                        }
                        break;
                    }
                }
            }
        }

        this.sortedForgedBlocks[0].voterBalances = new Map(this.curBals.map(vote => [vote.address, { // Populate the highest block
            "balance": vote.balance,
            "share": 0
        }]));

        txs.forEach((tx) => sortTxIntoBlocks(tx));

        // Populate the last blocks we missed
        this.sortedForgedBlocks.forEach((block, idx) => {
            if (!block.voterBalances) {
                block.voterBalances = new Map(this.sortedForgedBlocks[idx - 1].voterBalances);
            }
        })

        console.log("Pool balance calculations complete");
    };

    getVoterWeights() {
        console.log("Calculating voter weights for each block...");
        const shareFunc = this.config.blockShareFunc ? this.config.blockShareFunc : util.blockShareFunc;
        const cap = this.config.cap * 100000000;

        this.sortedForgedBlocks = this.sortedForgedBlocks.reverse();
        this.sortedForgedBlocks.forEach((block, idx) => {
            //console.log("block - " + parseInt(idx + 1) + " / " + this.sortedForgedBlocks.length + " | blockVoterBal.size: " + block.voterBalances.size);

            block.voterBalances.forEach((balanceData, index) => {
                if (balanceData.balance > cap) {
                    const curData = this.sortedForgedBlocks[idx].voterBalances.get(index);
                    curData.balance = cap;
                    curData.overlimit = true;
                    this.sortedForgedBlocks[idx].voterBalances.set(index, curData);
                }
            });

            const poolTotal = [...block.voterBalances.values()].map(val => val.balance).reduce((a, b) => a + b);

            block.voterBalances.forEach((balanceData, addr) => {

                if (balanceData.balance > 0) {
                    let share = shareFunc(poolTotal, new BigNumber(balanceData.balance));
                    balanceData.share = share.payout;

                    //If they are blacklisted, keep their share
                    if (this.config.blacklist.includes(addr)) {
                        balanceData.share = new BigNumber(0);
                    }
                }

            });
        });

        console.log("Voter weight calculation complete");
    };

    finalize(print) {
        const payouts = {};

        // Only pay up to number of blocks passed 
        if (this.forgedToday > this.config.numBlocks && !this.startBlock)
            this.forgedToday = this.config.numBlocks;

        for (let i = this.sortedForgedBlocks.length - this.forgedToday; i < this.sortedForgedBlocks.length; i++) {
            const block = this.sortedForgedBlocks[i];
            block.voterBalances.forEach((balanceData, addr) => {
                const pay = payouts[addr] != null ? payouts[addr] : new BigNumber(0);
                payouts[addr] = pay.plus(balanceData.share);
            });
        }

        let totalPayouts = new BigNumber(0);
        Object.keys(payouts).forEach((key) => totalPayouts = totalPayouts.plus(payouts[key]));

        const taxes = new BigNumber(this.forgedToday * BLOCK_REWARD).minus(totalPayouts);
        const ePayout = totalPayouts.dividedBy(100000000).dividedBy(new BigNumber(this.forgedToday).times(2)).times(100).toFormat(2);

        console.log(`Total paid out: ${totalPayouts.dividedBy(100000000).toString()}`);
        console.log(`Total taxes collected: ${taxes.dividedBy(100000000).toString()}`);
        console.log(`Effective Payout: ${ePayout}%`);

        const payData = {
            taxes: taxes,
            payouts: payouts,
            latestForgedBlock: this.sortedForgedBlocks[this.sortedForgedBlocks.length - 1]
        };

        if (print)
            console.log(payData.payouts);

        this.psql.close();

        return payData;
    };

};
