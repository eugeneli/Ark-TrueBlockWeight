let publicKey;
let pKey;

exports.init = (publicKeyBytes, publicKeyString) => {
    publicKey = publicKeyBytes;
    pKey = publicKeyString;
};

exports.getGeneratedBlocks = (numBlocks, startBlock) => {
    return `SELECT height, timestamp, total_fee AS totalFee \
    			FROM blocks
				WHERE generator_public_key = '${pKey}' \
                AND height >= ${startBlock ? startBlock : 1}\
                ORDER BY height DESC \
                LIMIT ${startBlock ? 'ALL' : numBlocks };`;
};

exports.getKeys = (delegate) => {
	return `SELECT CONCAT('{"delegate":{"username":"', username, '","publicKey":"', public_key, '"}}') AS rawasset \
			FROM wallets \
			WHERE username = '${delegate}' \
			LIMIT 1;`;
}

exports.getVoterBalances = () => {
    return `SELECT balance, address \
            FROM wallets \
            WHERE balance > 0 \
            AND vote = '${pKey}' \
            ORDER BY balance DESC;`;
}

exports.getRelevantTransactions = (addrs, timeStart, timeEnd) => {
    let joinedAddrs = addrs.map((addr) => `'${addr}'`).join(",");

	let query = `SELECT transactions.id, transactions.amount, transactions.timestamp, transactions.recipient_id AS "recipientId", wallets.address AS "senderId", transactions.type, transactions.fee, CASE WHEN transactions.type = 3 THEN CONCAT('{"votes":["', CASE WHEN SUBSTRING(ENCODE(serialized, 'hex'), 103, 2) = '01' THEN '+' ELSE '-' END, SUBSTRING(ENCODE(serialized, 'hex'), 105, 66), '"]}') ELSE NULL END AS rawasset, blocks.height \
				FROM transactions INNER JOIN blocks ON blocks.id = transactions.block_id
				INNER JOIN wallets ON wallets.public_key = transactions.sender_public_key
                WHERE transactions.timestamp >= ${timeStart} \
                AND transactions.timestamp <= ${timeEnd} \
                AND (wallets.address in (${joinedAddrs}) \
                OR transactions.recipient_id in (${joinedAddrs}))`

    return query;
}
