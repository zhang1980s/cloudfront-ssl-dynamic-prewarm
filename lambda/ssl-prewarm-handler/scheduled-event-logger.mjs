import https from 'https';
import {performance} from 'perf_hooks';
import {promises as dns} from 'dns';
import AWSXRay from 'aws-xray-sdk';

const getIpAddress = async (domain) => {
    try {
        const {address} = await dns.lookup(domain);
        console.log(`IP address for ${domain}: ${address}`);
        return {success: true, address};
    } catch (error) {
        console.error(`Error fetching IP address for ${domain}: ${error}`);
        return {success: false, error};
    }
}

async function digIpForPops(distributionId, pops) {
    const digPromises = pops.map(pop =>
        getIpAddress(`${distributionId}.${pop}.cloudfront.net`).then(result => ({pop, result}))
    );

    const results = await Promise.allSettled(digPromises);
    const ipMap = new Map();
    results.forEach(({value}) => {
        const {pop, result} = value;
        ipMap.set(pop, result);
    });
    return ipMap;
}


async function fetchViaSpecificPop(customDomain, distributionId, pop, ipMap, pathname) {
    const segment = AWSXRay.getSegment(); // 获取当前的 AWS X-Ray segment
    const subsegment = segment.addNewSubsegment(`fetch-pop-${pop}`);

    const ipObj = ipMap.get(pop);
    if (!ipObj || !ipObj.success) {
        console.error(`Failed to fetch IP address for ${distributionId}.${pop}.cloudfront.net: ${ipObj.error}`);
        subsegment.close(ipObj.error);
        return;
    }

    let realDomain = `${distributionId}.cloudfront.net`;
    if (customDomain !== undefined && customDomain !== '' && customDomain !== 'www.example.com') {
        realDomain = customDomain;
    }
    const url = `https://${realDomain}${pathname}`;
    const ip = ipObj.address;
    console.log("url", url, "POP", pop, "popIp", ip);

    return new Promise((resolve, reject) => {
        const startTime = performance.now();
        const ttfbSubsegment = subsegment.addNewSubsegment(`fetch-pop-${pop}-ttfb`);

        const metrics = { // ms
            ttfb: null,
            firstChunkTime: null,
            endTime: null,
            dnsLookupTime: null,
            tcpConnectionTime: null,
            tlsHandshakeTime: null
        };

        const result = {
            metrics,
            headers: null,
            body: null
        };

        // 创建一个新的 Agent 实例，禁用连接重用
        const agent = new https.Agent({
            keepAlive: false  // 禁止 keepAlive，确保不重用连接
        });

        // 解析 URL 并设置请求选项
        const parsedUrl = new URL(url);
        const options = {
            port: 443,
            path: parsedUrl.pathname,
            agent,
            headers: {
                'Host': realDomain // 明确指定原始的主机名
            },
            hostname: ip,
        };

        const req = https.request(options, (res) => {
            result.headers = res.headers;
            let bodyChunks = [];

            res.once('data', (chunk) => {
                ttfbSubsegment.close()
                metrics.ttfb = performance.now() - startTime;
                metrics.firstChunkTime = metrics.ttfb;
                bodyChunks.push(chunk);
            });

            res.on('data', (chunk) => {
                bodyChunks.push(chunk);
            });

            res.on('end', () => {
                metrics.endTime = performance.now() - startTime; // 记录响应结束的时间，并处理响应正文
                result.body = Buffer.concat(bodyChunks).toString(); // 将所有数据块合并成一个字符串
                subsegment.close();
                resolve(result);
            });
        });

        req.on('socket', (socket) => {
            socket.on('lookup', () => {
                metrics.dnsLookupTime = performance.now() - startTime; // DNS 查询完成
            });
            socket.on('connect', () => {
                metrics.tcpConnectionTime = performance.now() - startTime; // TCP 连接建立
            });
            socket.on('secureConnect', () => {
                metrics.tlsHandshakeTime = performance.now() - startTime; // TLS 握手完成
            });
        });

        req.on('error', (e) => {
            console.error(`Problem with request: ${e.message}`);
            subsegment.close(e)
            reject(e);
        });

        req.end();
    });
}


export const scheduledEventLoggerHandler = async (event, context) => {
    const DISTRIBUTION_ID = process.env.DISTRIBUTION_ID;
    const PATHNAME = process.env.PATH;
    const POPS = process.env.POPS;
    const REQUESTS_PER_POP = process.env.REQUESTS_PER_POP;
    const CUSTOM_DOMAIN = process.env.CUSTOM_DOMAIN;
    console.log(`CUSTOM_DOMAIN: ${CUSTOM_DOMAIN}, DISTRIBUTION_ID: ${DISTRIBUTION_ID}`, `PATH: ${PATHNAME}`, `POPS: ${POPS}`, `REQUESTS_PER_POP: ${REQUESTS_PER_POP}`);

    const popArray = POPS.split(',');

    try {
        const segment = AWSXRay.getSegment(); // 获取当前的 AWS X-Ray segment
        const digSubsegment = segment.addNewSubsegment(`dig-pops-ip`);
        const ipMap = await digIpForPops(DISTRIBUTION_ID, popArray);
        digSubsegment.close();

        const allRequests = [];
        for (let i = 0; i < REQUESTS_PER_POP; i++) {
            allRequests.push(...popArray.map(pop => fetchViaSpecificPop(CUSTOM_DOMAIN, DISTRIBUTION_ID, pop, ipMap, PATHNAME)));
        }

        // 使用 Promise.allSettled 同时发起多个 HTTP GET 请求
        const results = await Promise.allSettled(allRequests);
        console.log('Succeeded requests:', results.filter(r => r.status === 'fulfilled').length);
    } catch (error) {
        console.error('Error fetching data:', error);
    }
}
