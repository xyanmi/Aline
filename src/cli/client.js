const { ensureDaemon, readMetadata } = require('../daemon/daemonProcess');
const { connect } = require('../utils/ipc');

async function sendRequest(request) {
  await ensureDaemon();

  let metadata = readMetadata();
  let attempts = 0;
  while (!metadata?.endpoint && attempts < 20) {
    await new Promise((resolve) => setTimeout(resolve, 150));
    metadata = readMetadata();
    attempts += 1;
  }

  if (!metadata?.endpoint) {
    throw new Error('Daemon failed to start');
  }

  let lastError = null;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      const result = await new Promise((resolve, reject) => {
        const socket = connect(metadata.endpoint);
        let buffer = '';

        socket.once('error', reject);
        socket.on('data', (chunk) => {
          buffer += chunk.toString('utf8');
        });
        socket.on('end', () => {
          try {
            resolve(JSON.parse(buffer));
          } catch (error) {
            reject(error);
          }
        });
        socket.on('connect', () => {
          socket.write(JSON.stringify(request));
          socket.end();
        });
      });
      return result;
    } catch (error) {
      lastError = error;
      if (error.code !== 'ECONNREFUSED' && error.code !== 'ENOENT') {
        throw error;
      }
      await ensureDaemon();
      await new Promise((resolve) => setTimeout(resolve, 150));
      metadata = readMetadata() || metadata;
    }
  }

  throw lastError || new Error('Daemon request failed');
}

module.exports = {
  sendRequest,
};
