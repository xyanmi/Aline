const Channel = require('./channel');

class ChannelManager {
  constructor() {
    this.channelsByHost = new Map();
  }

  getHostChannels(host) {
    if (!this.channelsByHost.has(host)) {
      this.channelsByHost.set(host, new Map());
    }
    return this.channelsByHost.get(host);
  }

  add(host, name) {
    const hostChannels = this.getHostChannels(host);
    if (!hostChannels.has(name)) {
      hostChannels.set(name, new Channel(name));
    }
    return hostChannels.get(name);
  }

  get(host, name) {
    return this.channelsByHost.get(host)?.get(name);
  }

  remove(host, name) {
    const hostChannels = this.channelsByHost.get(host);
    const channel = hostChannels?.get(name);
    if (!channel) {
      return false;
    }

    channel.clearTimeout();
    channel.stopActiveStreams();
    hostChannels.delete(name);
    if (hostChannels.size === 0) {
      this.channelsByHost.delete(host);
    }
    return true;
  }

  removeHost(host) {
    const hostChannels = this.channelsByHost.get(host);
    if (!hostChannels) {
      return 0;
    }

    const removedCount = hostChannels.size;
    for (const channel of hostChannels.values()) {
      channel.clearTimeout();
      channel.stopActiveStreams();
    }
    this.channelsByHost.delete(host);
    return removedCount;
  }

  list(host) {
    const hostChannels = this.channelsByHost.get(host);
    if (!hostChannels) {
      return [];
    }

    return Array.from(hostChannels.values()).map((channel) => channel.toJSON());
  }

  findHostsByChannelName(name) {
    return Array.from(this.channelsByHost.entries())
      .filter(([, channels]) => channels.has(name))
      .map(([host]) => host);
  }

  markHostError(host, message) {
    const hostChannels = this.channelsByHost.get(host);
    if (!hostChannels) {
      return;
    }

    for (const channel of hostChannels.values()) {
      channel.markError(message);
    }
  }
}

module.exports = ChannelManager;
