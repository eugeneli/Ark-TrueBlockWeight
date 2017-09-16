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

exports.getVoters = (timestamp) => {
    return `SELECT votes."votes", blocks."height", transactions."senderId", transactions."timestamp" \
            FROM votes, transactions, blocks WHERE votes."transactionId" = transactions.id \
            AND transactions."timestamp" <= ${timestamp} \
            AND transactions."blockId" = blocks."id" \
            AND (votes."votes" = '+${pKey}' \
            OR votes."votes" = '-${pKey}') \
            ORDER BY blocks."height" ASC \
            LIMIT ALL;`;
};

exports.getTransactions = (addrs) => {
    var joinedAddrs = addrs.map((addr) => `'${addr}'`).join(",");
    
    var query = 'SELECT transactions."id", transactions."amount", transactions."timestamp", transactions."recipientId", transactions."senderId", transactions."fee", transactions."rawasset" FROM transactions WHERE transactions."senderId" IN (';
    query += joinedAddrs + ")";
    query += ' OR transactions."recipientId" IN ('
    query += joinedAddrs + ");";

    return query;
};