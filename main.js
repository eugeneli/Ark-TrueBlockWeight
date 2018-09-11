const config = require("./config.json");
const util = require("./util.js");
const TBW = require("./TBW.js");

const DAILY_FORGED_BLOCKS = 211;

exports.getPayouts = async (options) => {
    config.blacklist = options.blacklist ? options.blacklist : [];
    config.numBlocks = options.numBlocks ? options.numBlocks : DAILY_FORGED_BLOCKS;
    config.delegate = options.delegate ? options.delegate : config.delegate;
    config.blockShareFunc = options.blockShareFunc ? options.blockShareFunc : util.blockShareFunc;
    config.nBlockTimePeriod = config.numBlocks * 8 * 51; //Look back numBlocks
    const startTime = new Date().getTime() / 1000;

    console.log(`Calculating TBW and paying out ${config.numBlocks} forged blocks with ${config.nBlockTimePeriod} seconds look-back`);

    const tbw = new TBW(config);
    await tbw.init();
    await tbw.getCurrentBalances();
    await tbw.getBlocks();
    await tbw.getNewTransactions();
    tbw.processBalances();
    tbw.getVoterWeights();

    const payData = tbw.finalize(options.print);

    console.log("True block weight complete");
    console.log(`Run Time: ${((new Date().getTime() / 1000) - startTime).toFixed(2)} seconds.`);
    
    return payData;
};

let args = process.argv.slice(2);
if (args.length >= 1) {
    if (args[0] == "start")
        exports.getPayouts({ print: false, numBlocks: config.numblocks || 2954 });
}