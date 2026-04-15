function success(data) {
  return {
    status: 'success',
    data,
    error: null,
  };
}

function failure(message, code = 'ALINE_ERROR', details = null) {
  return {
    status: 'error',
    data: null,
    error: {
      code,
      message,
      details,
    },
  };
}

function isJsonSuccess(result) {
  return result && result.status === 'success';
}

function isLogSnapshot(data) {
  return Boolean(
    data
    && typeof data === 'object'
    && typeof data.channel === 'string'
    && Array.isArray(data.history)
    && typeof data.logs === 'string'
  );
}

function renderLogSnapshot(data) {
  const header = [
    `Channel: ${data.channel}`,
    `Status: ${data.status || 'UNKNOWN'}`,
  ];

  if (data.currentCommand) {
    header.push(`Current command: ${data.currentCommand}`);
  }

  if (!data.logs) {
    return `${header.join('\n')}\n\n(no output yet)`;
  }

  return `${header.join('\n')}\n\n${data.logs}`;
}

function renderResult(result, asJson) {
  if (asJson) {
    return JSON.stringify(result, null, 2);
  }

  if (!result) {
    return '';
  }

  if (result.status === 'error') {
    return result.error?.message || 'Unknown error';
  }

  const data = result.data;
  if (typeof data === 'string') {
    return data;
  }

  if (isLogSnapshot(data)) {
    return renderLogSnapshot(data);
  }

  return JSON.stringify(data, null, 2);
}

module.exports = {
  success,
  failure,
  isJsonSuccess,
  isLogSnapshot,
  renderLogSnapshot,
  renderResult,
};

