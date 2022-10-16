import { lookup } from 'dns';
import { createClient, RedisClientType } from 'redis';
import net from 'net';
import { ports } from './ports';

export interface config {
  host: string;
  port: number;
  password: string;
  username: string;
  ports?: number[];
}
const redisTable: string = 'proxies';

class ProxyDetect {
  private RedisClient: RedisClientType | null = null;
  private ports: number[] = new Array();
  constructor() { }

  public async init(config: config) {
    const {
      password,
      username,
    } = config;
    const url = `redis://${config.host}:${config.port}`;

    if (config.ports) {
      console.log('using custom ports', config.ports);
      this.ports = config.ports;
    }
    else {
      console.log('using default ports', ports);
      this.ports = [...ports];
    }
    this.RedisClient = createClient({ url, password, username });
    this.RedisClient.on('error', (err) => console.log('Redis Client Error', err));
    await this.RedisClient.connect().then(() => console.log('Redis Client Connected'));
  }

  private async PushToRedis(ip: string) : Promise<void> {
    if (this.RedisClient) {
      await this.RedisClient?.sAdd(redisTable, ip);
    }
  }
  private async CheckIP(ip: string) : Promise<boolean> {
    //check existing ip in redis
    if (this.RedisClient) {
      const isExist = await this.RedisClient.sIsMember(redisTable, ip);
      if (isExist) {
        console.log('IP already exist in redis', ip);
        return true;
      }
      else {
        console.log('IP not exist in redis', ip);
        return false;
      }
    }
    else {
      console.log('Redis Client not initialized');
      return false;
    }
  }

  private IsTorExitNode = (ip: string): Promise<boolean> => {
    return new Promise((resolve, reject) => {
      try {
        const ip_rev = ip.split(".").reverse().join(".");
        const domain = `${ip_rev}.dnsel.torproject.org`;
        lookup(domain, (err, address, family) => {
          if (err) {
            reject(false);
          }
          if (address === "127.0.0.1" || address === "127.0.0.2") {
            console.log(`${ip} is a Tor exit node`);
            console.log(`${domain} resolved to ${address}`);
            resolve(true);
          }
          else {
            reject(false);
          }
        });
      } catch (err) {
        reject(false);
      }
    });
  }

  public IsProxy = (ip: string): Promise<boolean> => {
    return new Promise(async (resolve, reject) => {
      try {
        if(await this.CheckIP(ip)) {
          resolve(true);
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
  }

  private IsTCPSocketOpen(ip: string, port: number): Promise<boolean> {
    return new Promise((resolve, reject) => {
      try {
        const client = new net.Socket();
        //timeout after 2 seconds
        client.setTimeout(2000);
        client.connect(port, ip, () => {
          console.log(`${ip}:${port} is open`);
          //console.log("Hello, server! Love, Client.");
          resolve(true);
        });
        client.on("data", (data) => {
          //console.log("Received: " + data);
        });
        client.on("close", () => {
          //console.log("Connection closed");
        });
        client.on("error", (err) => {
          //console.log("Error: " + err);
          reject(false);
        });
      } catch (err) {
        console.log(err);
        reject(false);
      }
    });
  }
}

export default ProxyDetect;
