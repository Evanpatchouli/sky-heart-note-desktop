import { isIP, type LookupFunction } from 'node:net';
import { lookup } from 'node:dns';
import { request } from 'node:https';
import type { IncomingHttpHeaders } from 'node:http';
import ipaddr from 'ipaddr.js';
import type { RequestDetails } from 'web-push';

const publicLookup: LookupFunction = (hostname, options, callback) => {
  lookup(hostname, { all: true }, (error, results) => {
    if (error) return callback(error, '', 0);
    // Check every address and give HTTPS the exact addresses we checked. It
    // still connects with the original hostname for SNI and certificate checks.
    if (!results.length || results.some(({ address }) => ipaddr.process(address).range() !== 'unicast')) {
      return callback(new Error('Push endpoint requires a public address'), '', 0);
    }
    if (options.all) return callback(null, results);
    const { address, family } = results[0];
    callback(null, address, family);
  });
};

export interface PushResponse {
  statusCode: number;
  headers: IncomingHttpHeaders;
}

export function postPushRequest(details: RequestDetails, signal: AbortSignal) {
  const endpoint = new URL(details.endpoint);
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password ||
      endpoint.hash || isIP(endpoint.hostname) || endpoint.hostname.startsWith('[')) {
    throw new Error('Push endpoint requires an HTTPS hostname');
  }
  return new Promise<PushResponse>((resolve, reject) => {
    const req = request(endpoint, {
      method: details.method,
      headers: details.headers,
      lookup: publicLookup,
      agent: false,
      rejectUnauthorized: true,
      signal,
    }, response => {
      // We only need the status and headers. Do not buffer provider bodies or
      // follow a Location header to another address.
      const { statusCode = 0, headers } = response;
      response.destroy();
      resolve({ statusCode, headers });
    });
    req.on('error', reject);
    req.end(details.body);
  });
}
