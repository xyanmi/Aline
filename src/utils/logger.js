const fs = require('fs');
const { ensureRuntimeDirSync, getLogFile } = require('./platform');

function createLogger(scope = 'aline') {
  ensureRuntimeDirSync();

  function write(level, message, extra = null) {
    const line = JSON.stringify({
      time: new Date().toISOString(),
      scope,
      level,
      message,
      extra,
    });

    try {
      fs.appendFileSync(getLogFile(), `${line}\n`, 'utf8');
    } catch (_) {
      // ignore log write failures
    }
  }

  return {
    info(message, extra) {
      write('info', message, extra);
    },
    warn(message, extra) {
      write('warn', message, extra);
    },
    error(message, extra) {
      write('error', message, extra);
    },
  };
}

module.exports = {
  createLogger,
};
