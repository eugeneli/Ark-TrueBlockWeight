<p align="center">
  <img align="center" src="tbw.png">
</p>

# Ark-TrueBlockWeight

Ark’s Delegated Proof of Stake system encourages delegates to provide incentives to voters in the form of profit sharing from their forging rewards. In the current ecosystem, there is no way for the average non-technical delegate to get a forging node up and running with an accurate profit sharing distribution, as there is no existing public payout code that will exactly calculate rewards based on each individual voter’s staked ARK in the delegate pool. biz_classic has been developing a script that aims to address this issue whilst also allowing custom configurations on a per delegate basis, allowing for a diverse ecosystem of pools.

# Introduction

<p align="center">
    <a href="https://arkcommunity.fund/"><img src="https://arkcommunity.fund/media-kit/funded/banner.png" /></a>
</p>

## Getting Started

You will need to be running a [full node](https://github.com/ArkEcosystem/ark-node) to have a copy of the blockchain to query.
Then modify ```config.json``` with your Ark Node's Postgresql database credentials and your delegate's name.

```
{
    "user": "tbw",
    "host": "localhost",
    "database": "ark_mainnet",
    "password": "tbw",
    "blocks": 211,
    "port": 5432,
    "delegate": "Delegate Name"
}
```

`blocks` allows you to specify how many blocks you'd like to calculate payment for. If you prefer to instead calculate all blocks starting from a specific height, you can specify `start` with your starting block. This will ignore `blocks` if it is specified.

If your pay script and node are not on the same server, you will need to configure the node's Postgresql database for external access.

### Installation and Usage
First, remember to configure your node's database as mentioned above and insert your credentials in ```config.json```
1) Clone this repository
2) ```cd Ark-TrueBlockWeight```
3) ```npm install```

#### Command line usage:
```node main.js start```

Optionally, you can pass in an arbitrary number of blocks:  ``` node main.js start 211```

### Include in a Nodejs project:
```
var TBW = require("../true_block_weight/main");
var options = {
    blacklist: ["someArkAddress", "otherArkAddress"],
    blocks: 422, //Defaults to 211 if left empty
    blockShareFunc: (poolSize, voterBalanceAtblock) => { ... } //Function to be run when calculating each voter's share per block (Leave empty for 100% payouts, see examples below)
};
TBW.getPayouts(options).then((payData) => {
    console.log(payData);
});
```

```getPayouts(...)``` returns a promise that resolves with the following object:
```
var payData = {
    taxes: taxes, //The delegate owner's cut
    payouts: payouts // { "someArkAddress": (BigNumber.js object with their total share across all blocks), "otherArkAddress": (BigNumber.js object) ...}
};
```

### Example block share functions
Pay 100% of forged blocks (default if ```options.blockShareFunc``` is empty)
```
var blockShareFunc = (poolSize, voterBalance) => {
    var forgedBalance = new BigNumber(2);       //Block reward
    var poolSize = new BigNumber(poolSize);     //Total pool size
    var balance = new BigNumber(voterBalance);  //Balance of voter at each block

    var fullPay = forgedBalance.times(balance).dividedBy(poolSize); //This voter's share of the 2 Ark block reward

    //Return an array of two BigNumber.js objects, [voter's share, delegate's cut]
    return [fullPay, new BigNumber(0)]; 
};
```

Pay 90% of forged block rewards if the voter's balance is less than 100,000 Ark and 50% if the voter's balance is over 100,000 Ark
```
var blockShareFunc = (poolSize, voterBalance) => {
    var forgedBalance = new BigNumber(2);       //Block reward
    var poolSize = new BigNumber(poolSize);     //Total pool size
    var balance = new BigNumber(voterBalance);  //Balance of voter at each block
    
    var fullPay = forgedBalance.times(balance).dividedBy(poolSize);
    var pay, tax;
    var whaleLimit = 100000 * 100000000;        //Convert to Arktoshis
    if(balance.lessThan(whaleLimit))
    {
        pay = fullPay.times(0.9);
        tax = fullPay.times(0.1);
    }
    else
    {
        pay = fullPay.times(0.5);
        tax = fullPay.times(0.5);
    }

    //Return an array of two BigNumber.js objects, [voter's share, delegate's cut]
    return [pay, tax]; 
};
```

## Authors

* **George Kushnir** - [n4ru](https://github.com/n4ru)
* **Eugene Li** - [eugeneli](https://github.com/eugeneli)

See also the list of [contributors](https://github.com/eugeneli/Ark-TrueBlockWeight/graphs/contributors) who participated in this project.

## License

The MIT License (MIT)

Copyright (c) 2018 Eugene Li & George Kushnir

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:  

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.