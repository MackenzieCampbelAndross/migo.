import 'server-only';
import * as xrpl from 'xrpl';
import { getXrplConfig } from './xrpl-config.js';
import { safeLog } from './logger.js';

let client = null;
let connecting = null;

export async function getClient() {
  if (client?.isConnected()) return client;
  if (connecting) return connecting;

  connecting = (async () => {
    const connection = new xrpl.Client(getXrplConfig().url);

    connection.on('disconnected', () => {
      safeLog('warn', 'xrpl.disconnected', {});
      client = null;
    });

    connection.on('error', (error) => {
      safeLog('error', 'xrpl.connection_error', { code: error?.name });
    });

    await connection.connect();
    client = connection;
    return connection;
  })().finally(() => {
    connecting = null;
  });

  return connecting;
}
