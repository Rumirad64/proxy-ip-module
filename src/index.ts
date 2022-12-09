/* eslint-disable max-len */
import { lookup } from 'dns';
import { createClient, RedisClientType } from 'redis';
import net from 'net';
import mongoose from 'mongoose';
import ports from './ports';
import { ProxyIp } from './proxyIp.model';

export interface config {
  host: string;
  port: number;
  password: string;
  username: string;
  ports?: number[];
  mongoUri: string;
}

export const redisTable: string = 'proxies';

class ProxyDetect {
  private RedisClient: RedisClientType | null = null;

  private ports: number[] = [];

  // eslint-disable-next-line no-useless-constructor, no-empty-function
  constructor() { }

  public async init(cfg: config) {
    const {
      password,
      username,
      mongoUri,
    } = cfg;
    const url = `redis://${cfg.host}:${cfg.port.toString()}`;

    if (cfg.ports) {
      console.log('using custom ports', cfg.ports);
      this.ports = [...cfg.ports];
    } else {
      console.log('using default ports', ports);
      this.ports = [...ports];
    }
    this.RedisClient = createClient({ url, password, username });
    this.RedisClient.on('error', (err) => console.log('Redis Client Error', err));
    await this.RedisClient.connect().then(() => console.log('Redis Client Connected'));

    await mongoose.connect(mongoUri);
    console.log(`MongoDB Connected. Database -> ${mongoose.connection.name} Endpoint -> ${mongoose.connection.host}:${mongoose.connection.port}`);

    // get all ips from mongo db and push to redis using mongoose aggregation pipeline
    const result: { ips: string[] }[] = await ProxyIp.aggregate([{
      $group: {
        _id: null,
        ips: {
          $push: '$ip',
        },
      },
    },
    {
      $unset: '_id',
    }]);

    // check if redis table 'proxies' has at least 1 ip
    const redisTableSize = await this.RedisClient.sCard(redisTable);
    const mongoTableSize = await ProxyIp.countDocuments();
    console.log(`MongoDB Table Size -> ${mongoTableSize}`);
    console.log(`Redis Table Size -> ${redisTableSize}`);
    // if redis table is empty and mongo db is empty, flush redis table and continue
    if (mongoTableSize === 0 && redisTableSize === 0) {
      console.log('MongoDB and Redis Table is empty, skipping MongoDB to Redis population and flushing Redis Table');
      await this.RedisClient.flushAll().then(() => console.log('Redis Instance Flushed Successfully'));
      // if redis table is empty and mongo db is not empty, populate redis table from mongo db
    } else if (mongoTableSize > 0 && redisTableSize === 0) {
      await this.RedisClient.sAdd(redisTable, result[0].ips as string[]).then(() => console.log('Redis Instance Populated from MongoDB using Aggregation Pipeline'));
      console.log(`Total IPs Loaded from MongoDB -> ${result[0].ips.length}`);
    } else if (mongoTableSize === 0 && redisTableSize > 0) {
      console.log('Since the MongoDB Table is empty, and Redis Table is not empty');
      console.log('There is a de-sync between MongoDB and Redis Table and Aborting the Initialization');
      console.log('Please clear the Redis Table and re-initialize the module, Aborting...');
      process.exitCode = 1;
    } else if (mongoTableSize > 0 && redisTableSize > 0 && (mongoTableSize === redisTableSize)) {
      console.log('Since the Both MongoDB and Redis Table is not empty, and both have same number of IPs');
      console.log('Assuming that the MongoDB and Redis Table is in perfect sync and skipping MongoDB to Redis population');
    } else if (mongoTableSize > 0 && redisTableSize > 0 && (mongoTableSize > redisTableSize)) {
      console.log('Since the Both MongoDB and Redis Table is not empty, and MongoDB has more IPs than Redis Table');
      console.log('Flushing Redis Table and Populating Redis Table from MongoDB using Aggregation');
      await this.RedisClient.flushAll().then(() => console.log('Redis Instance Flushed Successfully'));
      await this.RedisClient.sAdd(redisTable, result[0].ips as string[]).then(() => console.log('Redis Instance Populated from MongoDB using Aggregation Pipeline'));
      console.log(`Total IPs Loaded from MongoDB -> ${result[0].ips.length}`);
    } else if (mongoTableSize > 0 && redisTableSize > 0 && (mongoTableSize < redisTableSize)) {
      console.log('Since the Both MongoDB and Redis Table is not empty, and MongoDB has less IPs than Redis Table');
      console.log('There is a de-sync between MongoDB and Redis Table and Aborting the Initialization');
      console.log('Please clear the Redis Table and re-initialize the module, Aborting...');
      process.exitCode = 1;
    }
    console.log('Proxy Detection Module Initialized');
  }

  private async PushToRedis(ip: string): Promise<void> {
    if (this.RedisClient) {
      await this.RedisClient?.sAdd(redisTable, ip);
    }
  }

  private async CheckIP(ip: string): Promise<boolean> {
    // check existing ip in redis
    if (this.RedisClient) {
      const isExist = await this.RedisClient.sIsMember(redisTable, ip);
      if (isExist) {
        console.log('IP already exist in redis', ip);
        return true;
      }

      console.log('IP not exist in redis', ip);
      return false;
    }

    console.log('Redis Client not initialized');
    return false;
  }

  private IsTorExitNode = (ip: string): Promise<boolean> => new Promise((resolve, reject) => {
    try {
      const ipRev = ip.split('.').reverse().join('.');
      const domain = `${ipRev}.dnsel.torproject.org`;
      lookup(domain, (err, address, family) => {
        if (err) {
          reject(false);
        }
        if (address === '127.0.0.1' || address === '127.0.0.2') {
          console.log(`${ip} is a Tor exit node`);
          console.log(`${domain} resolved to ${address}`);
          resolve(true);

          // UPDATE OR INSERT TO MONGODB
          ProxyIp.findOneAndUpdate(
            { ip },
            { ip, port: null, reason: 'Tor Exit Node' },
            { upsert: true, new: true, setDefaultsOnInsert: true },
          ).then((doc) => {
            console.log('MongoDB Updated', doc);
          }).catch((er) => {
            console.log('MongoDB Error', er);
          });
        } else {
          reject(false);
        }
      });
    } catch (err) {
      reject(false);
    }
  });

  // eslint-disable-next-line no-async-promise-executor
  public IsProxy = (ip: string): Promise<boolean> => new Promise(async (resolve, reject) => {
    try {
      if (await this.CheckIP(ip)) {
        resolve(true);

        // increment hits in mongodb
        await ProxyIp.findOneAndUpdate({ ip }, { $inc: { hits: 1 } }).then((doc) => {
        }).catch((er) => {
          console.log('MongoDB Error', er);
        });
        return;
      }
      const promises = this.ports.map((port) => {
        console.log(`pushing port ${port} check to promises`);
        return this.IsTCPSocketOpen(ip, port);
      });
      console.log('pushing tor check check');
      promises.push(this.IsTorExitNode(ip));
      Promise.any(promises).then(async (res) => {
        resolve(true);
        await this.PushToRedis(ip);
      }).catch((err) => {
        console.log(err);
      });
      Promise.all(promises).catch((err) => {
        resolve(false);
      });
    } catch (err) {
      reject(false);
    }
  });

  private IsTCPSocketOpen(ip: string, port: number): Promise<boolean> {
    return new Promise((resolve, reject) => {
      try {
        const client = new net.Socket();

        // timeout after 2 seconds
        client.setTimeout(2000);

        client.connect(port, ip, () => {
          console.log(`${ip}:${port} is open`);

          resolve(true);

          // UPDATE OR INSERT TO MONGODB
          ProxyIp.findOneAndUpdate(
            { ip },
            { ip, port, reason: `Port ${port} is open` },
            { upsert: true, new: true, setDefaultsOnInsert: true },
          ).then((doc) => {
            console.log('MongoDB Updated', doc);
          }).catch((err) => {
            console.log('MongoDB Error', err);
          });
        });
        client.on('data', (data) => {
          // console.log("Received: " + data);
        });
        client.on('close', () => {
          // console.log("Connection closed");
        });
        client.on('error', (err) => {
          // console.log("Error: " + err);
          reject(false);
        });
      } catch (err) {
        console.log(err);
        reject(false);
      }
    });
  }

  public async GetProxyList(page: number, limit: number, search: string): Promise<any> {
    const result = await ProxyIp.paginate(
      { ip: { $regex: search, $options: 'i' } },
      { page, limit, sort: { CreatedAt: -1 } },
    );
    return result;
  }

  public async DeleteProxyIP(ip: string): Promise<any> {
    const resultM = await ProxyIp.deleteOne({ ip });
    if (this.RedisClient) {
      const resultR = await this.RedisClient.sRem(redisTable, ip);
      return { mongo: resultM, redis: resultR };
    }
    return { mongo: resultM, redis: null };
  }
}

export default ProxyDetect;
