# proxy-ip-module

* This module is used to detect the IP address if an IP address is a proxy IP address.
* It will store the proxy IP address in a MongoDB database and a Redis database.
* Redis is used to store only IP addresses and fast access and MongoDB is used to store the IP address and other information as a permanent record.
* The module will check the IP address on the following default ports: 8000, 443, 8080, 8081, 1194, 3128.
* The module will try to connect (TCP CONNECT) to the IP address on the above ports, if it is successful, it will be considered as a proxy IP address.
* The module will also check if the IP address is a TOR node, if it is, it will be considered as a proxy IP address. ( DNSEL Service will be used to check if the IP address is a TOR node )
* Before checking the IP address, it will be checked in the Redis database, if it is not in the Redis database, it will be checked.
* When the module is initialized, IP addresses are stored in MongoDB, will be transferred to Redis.
* Full Lookup time is about 500ms, even if the IP address is not a proxy IP address.


### MongoDB Schema to store IP address and other information
![Screenshot](imgs/mongodb.model.png)

### IP address stored in Redis
![Screenshot](imgs/redis.model.png)


## Installation

```bash
yarn add proxy-ip-module
```

## Exposed Methods

```typescript
// initialize the module with the following parameters
proxyDetect.init({
  host: 'redis-domain.com',
  port: 19831, // Redis port
  password: 'redispassword', 
  username: 'default', // Redis username
  ports: [8000, 443, 8080, 8081, 1194, 3128], // Ports to check
  mongoUri:
    'mongodb+srv://DetectService:fgfg' // MongoDB connection string
});

// get all proxy ip stored in mongoDB
proxyDetect.GetProxyList(page: number, limit: number, search: string) : Promise<ProxyIp[]>;

//peform a check on a single ip address, if it is a proxy ip address, it will be stored in mongoDB and redis
proxyDetect.IsProxy(ip: string) : Promise<boolean>;

//remove a proxy ip address from mongoDB and redis
proxyDetect.DeleteProxyIP(id: string) : Promise<{ resultM : boolean, resultR : boolean }>;

```

## Usage ( NestJS API Example )

```typescript
// importing the module
import { ProxyDetect } from 'proxy-ip-module';


export class DetectService {
  // initialize the module with the following parameters
  private proxyDetect = new ProxyDetect();
  constructor() {
    this.proxyDetect.init({
      host: 'redis-domain.com',
      port: 19831, // Redis port
      password: 'redispassword', 
      username: 'default', // Redis username
      ports: [8000, 443, 8080, 8081, 1194, 3128], // Ports to check
      mongoUri:
        'mongodb+srv://DetectService:Asdfv8dsfds8q@clusternt.jdryd3.mongodb.net/ProxyIpDB?retryWrites=true&w=majority',
    });
  }
  // get all proxy ip stored in mongoDB
  async findAll(page: number, limit: number, search: string) {
    return await this.proxyDetect.GetProxyList(page, limit, search);
  }

  //peform a check on a single ip address, if it is a proxy ip address, it will be stored in mongoDB and redis
  async findOne(ip: string) {
    console.log('findOne service', ip);
    const res = await this.proxyDetect.IsProxy(ip);
    return { ip, res };
  }

  //remove a proxy ip address from mongoDB and redis
  async remove(id: string) {
    return await this.proxyDetect.DeleteProxyIP(id); 
  }
}
    
```

## Methodology of the module

```mermaid
graph TD;
    Start-->IP-TO-CHECK;
    IP-TO-CHECK-->Redis-Check;
    Redis-Check<-------->Redis-Database;
    Redis-Check-->Result;
    Redis-Check-->Async-Operations-Queue;
    Async-Operations-Queue-->Try-TCP-CONNECT;
    Async-Operations-Queue-->TOR-Node-CHECK;
    Try-TCP-CONNECT-->8000;
    Try-TCP-CONNECT-->443;
    Try-TCP-CONNECT-->8080;
    Try-TCP-CONNECT-->8081;
    Try-TCP-CONNECT-->1194;
    Try-TCP-CONNECT-->3128;

    8080--->Result;
    8081--->Result;
    1194--->Result;
    3128--->Result;
    8000--->Result;
    443--->Result;
    Result--->Store-IP-Address;
    Store-IP-Address--->Finish;
    Store-IP-Address--->Redis-Database;
    Store-IP-Address--->MongoDB-Database;

    TOR-Node-CHECK-->Result;

    A[Start] ------------>|Maximum 500ms| B(Finish)
    

```