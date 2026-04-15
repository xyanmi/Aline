class Channel {
  constructor(name) {
    this.name = name;
    this.status = 'IDLE';
    this.bufferSize = 2000;
    this.executions = [];
    this.nextExecutionId = 1;
    this.stream = null;
    this.streams = new Set();
    this.shellSession = null;
    this.pid = null;
    this.exitCode = null;
    this.lastActiveAt = null;
    this.timeout = null;
  }

  startExecution(command) {
    const startedAt = new Date().toISOString();
    const execution = {
      id: this.nextExecutionId++,
      command,
      status: 'RUNNING',
      exitCode: null,
      startedAt,
      endedAt: null,
      lines: [],
      stream: null,
    };

    this.executions.push(execution);
    this.status = 'RUNNING';
    this.exitCode = null;
    this.lastActiveAt = startedAt;
    return execution;
  }

  appendLog(data) {
    const execution = this.getLatestExecution() || this.startExecution(null);
    this.appendExecutionLog(execution, data);
  }

  appendExecutionLog(execution, data) {
    if (!execution) {
      return;
    }

    const text = String(data).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = text.split('\n').filter((line) => !/^\([A-Za-z0-9_.-]+\)\s*$/.test(line));
    execution.lines.push(...lines);
    while (execution.lines.length > 0 && execution.lines[execution.lines.length - 1] === '') {
      execution.lines.pop();
    }
    this.trimExecutions();
    this.lastActiveAt = new Date().toISOString();
  }

  trimExecutions() {
    let totalLines = this.executions.reduce((count, execution) => count + execution.lines.length, 0);
    while (totalLines > this.bufferSize) {
      const oldestWithLines = this.executions.find((execution) => execution.lines.length > 0);
      if (!oldestWithLines) {
        return;
      }

      oldestWithLines.lines.shift();
      totalLines -= 1;
    }
  }

  getLatestExecution() {
    return this.executions[this.executions.length - 1] || null;
  }

  getActiveExecutions() {
    return this.executions.filter((execution) => execution.status === 'RUNNING');
  }

  attachStream(stream, execution = this.getLatestExecution()) {
    if (execution) {
      execution.stream = stream;
    }
    this.stream = stream;
    this.streams.add(stream);
    this.status = 'RUNNING';
    this.lastActiveAt = new Date().toISOString();
  }

  removeStream(stream) {
    if (!stream) {
      return;
    }

    this.streams.delete(stream);
    if (this.stream === stream) {
      const remainingStreams = Array.from(this.streams);
      this.stream = remainingStreams[remainingStreams.length - 1] || null;
    }
  }

  setPid(pid) {
    this.pid = pid;
  }

  setShellSession(shellSession) {
    this.shellSession = shellSession;
  }

  getShellSession() {
    return this.shellSession;
  }

  clearShellSession() {
    this.shellSession = null;
  }

  setTimeout(timer) {
    this.clearTimeout();
    this.timeout = timer;
  }

  clearTimeout() {
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }
  }

  complete(exitCode = 0, execution = this.getLatestExecution()) {
    this.completeExecution(execution, exitCode);
  }

  completeExecution(execution, exitCode = 0) {
    const normalizedExitCode = exitCode ?? 0;
    const endedAt = new Date().toISOString();

    if (execution) {
      if (execution.status === 'RUNNING') {
        execution.status = normalizedExitCode === 0 ? 'COMPLETED' : 'ERROR';
      }
      execution.exitCode = normalizedExitCode;
      execution.endedAt = endedAt;
      this.removeStream(execution.stream);
      execution.stream = null;
    }

    this.pid = null;
    this.clearTimeout();
    this.exitCode = normalizedExitCode;
    this.lastActiveAt = endedAt;
    this.updateChannelStatus();
  }

  markError(message) {
    const activeExecutions = this.getActiveExecutions();
    if (activeExecutions.length === 0) {
      this.markExecutionError(this.startExecution(null), message);
      return;
    }

    for (const execution of activeExecutions) {
      this.markExecutionError(execution, message);
    }
  }

  markExecutionError(execution, message, exitCode = 1) {
    const endedAt = new Date().toISOString();

    if (!execution) {
      execution = this.startExecution(null);
    }

    if (message) {
      this.appendExecutionLog(execution, message);
    }

    execution.status = 'ERROR';
    execution.exitCode = exitCode;
    execution.endedAt = endedAt;
    this.removeStream(execution.stream);
    execution.stream = null;
    this.pid = null;
    this.clearTimeout();
    this.exitCode = exitCode;
    this.lastActiveAt = endedAt;
    this.updateChannelStatus();
  }

  stopActiveStreams() {
    for (const stream of Array.from(this.streams)) {
      try {
        stream.signal?.('INT');
      } catch (_) {
        // ignore signal failures
      }
      try {
        stream.close?.();
      } catch (_) {
        // ignore close failures
      }
      this.removeStream(stream);
    }

    const shellSession = this.getShellSession();
    if (shellSession) {
      try {
        shellSession.close?.();
      } catch (_) {
        // ignore close failures
      }
      this.clearShellSession();
    }
  }

  updateChannelStatus() {
    if (this.getActiveExecutions().length > 0) {
      this.status = 'RUNNING';
      return;
    }

    const latestExecution = this.getLatestExecution();
    if (!latestExecution) {
      this.status = 'IDLE';
      return;
    }

    this.status = latestExecution.status === 'ERROR' ? 'ERROR' : 'IDLE';
  }

  getHistory() {
    return this.executions.map((execution) => ({
      id: execution.id,
      command: execution.command,
      status: execution.status,
      exitCode: execution.exitCode,
      startedAt: execution.startedAt,
      endedAt: execution.endedAt,
      output: execution.lines.join('\n'),
    }));
  }

  renderExecution(execution) {
    const block = [];

    if (execution.command) {
      block.push(`$ ${execution.command}`);
    }

    const output = execution.lines.join('\n');
    if (output) {
      block.push(output);
    }

    if (execution.status === 'RUNNING') {
      block.push('[running]');
    } else if (execution.command) {
      block.push(`[exit ${execution.exitCode ?? 0}]`);
    } else if (execution.status === 'ERROR') {
      block.push('[error]');
    }

    return block.join('\n');
  }

  getLogs(tailCount = 100) {
    const lines = [];

    for (const execution of this.executions) {
      const rendered = this.renderExecution(execution);
      if (!rendered) {
        continue;
      }

      lines.push(...rendered.split('\n'));
      lines.push('');
    }

    while (lines.length > 0 && lines[lines.length - 1] === '') {
      lines.pop();
    }

    return lines.slice(-tailCount).join('\n');
  }

  getLogSnapshot(tailCount = 100) {
    const activeExecutions = this.getActiveExecutions();
    const currentExecution = activeExecutions[activeExecutions.length - 1] || null;

    return {
      channel: this.name,
      status: this.status,
      currentCommand: currentExecution?.command || null,
      currentExecutionId: currentExecution?.id || null,
      history: this.getHistory(),
      logs: this.getLogs(tailCount),
    };
  }

  toJSON() {
    return {
      name: this.name,
      pid: this.pid,
      status: this.status,
      exitCode: this.exitCode,
      lastActiveAt: this.lastActiveAt,
    };
  }
}

module.exports = Channel;
