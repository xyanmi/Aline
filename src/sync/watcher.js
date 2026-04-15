const chokidar = require('chokidar');

class SyncWatcher {
  constructor({ debounceMs = 500, onSync }) {
    this.debounceMs = debounceMs;
    this.onSync = onSync;
    this.watcher = null;
    this.timer = null;
  }

  start(localPath) {
    this.watcher = chokidar.watch(localPath, {
      ignored: ['**/node_modules/**', '**/.git/**'],
      ignoreInitial: true,
    });

    const schedule = () => {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.onSync(), this.debounceMs);
    };

    this.watcher.on('add', schedule);
    this.watcher.on('change', schedule);
    this.watcher.on('unlink', schedule);
  }

  async stop() {
    clearTimeout(this.timer);
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
  }
}

module.exports = SyncWatcher;
