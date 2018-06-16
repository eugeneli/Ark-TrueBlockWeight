"use strict";

var publicKey;
var pKey;

exports.init = (publicKeyBytes, publicKeyString) => {
    publicKey = publicKeyBytes;
    pKey = publicKeyString;
};

exports.getGeneratedBlocks = (numBlocks) => {
    return `SELECT blocks.height, blocks.timestamp, blocks."totalFee" \
                FROM public.blocks \
                WHERE blocks."generatorPublicKey" = '${publicKey}'\
                ORDER BY blocks.height DESC \
                LIMIT ${numBlocks};`;
};

exports.getKeys = (delegate) => {
    return `SELECT transactions."rawasset" \
            FROM transactions \ 
            WHERE id IN (SELECT delegates."transactionId" FROM delegates WHERE delegates."username" = '${delegate}') \
            LIMIT 1;`;
}

exports.getVoterBalances = () => {
    return `SELECT mem_accounts."balance", mem_accounts."address" \
            FROM mem_accounts \
            WHERE mem_accounts."balance" > 0 \
            AND mem_accounts."address" in (SELECT mem_accounts2delegates."accountId" FROM public.mem_accounts2delegates WHERE mem_accounts2delegates."dependentId" = '${pKey}') \
            ORDER BY mem_accounts."balance" DESC;`;
}

exports.getRelevantTransactions = (addrs, timeStart, timeEnd) => {
    let joinedAddrs = addrs.map((addr) => `'${addr}'`).join(",");

    let query = `SELECT transactions."id", transactions."amount", transactions."timestamp", transactions."recipientId", transactions."senderId", \
                transactions."fee", transactions."rawasset", blocks."height" \
                FROM transactions INNER JOIN blocks ON blocks."id" = transactions."blockId" \ 
                WHERE transactions."timestamp" >= ${timeStart} \
                AND transactions."timestamp" <= ${timeEnd} \
                AND (transactions."senderId" in (${joinedAddrs}) \
                OR transactions."recipientId" in (${joinedAddrs}))`

    return query;
}