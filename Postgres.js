const { Client } = require("pg");

module.exports = class Postgres {
    constructor(config) {
        this.config = { ...config };
        this.client = new Client(this.config);
    }

    connect() {
        return new Promise((resolve, reject) => {
            this.client.connect((err) => {
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
    
    close() {
        return new Promise((resolve, reject) => {
            this.client.end((err) => {
                console.log("Node database connection closed");
                this.client = new Client(this.config); //reinstantiate client for next run
            });
        })
    };

    query(query) {
        return new Promise((resolve, reject) => {
            this.client.query(query, (err, res) => {
                if(typeof res == "undefined" || err)
                    return reject(err);
                
                resolve(res);
            });
        });
    }
};