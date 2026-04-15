# Aline 远程调试与同步引擎 - 核心开发文档 (v1.0)

## 1. 架构总览

Aline 采用 Client-Server (C/S) 本地微服务架构，分为两个独立运行的物理进程：

* **Aline Daemon (服务端):** 驻留在本地后台，负责维持跨网络的 SSH 长连接、管理通道生命周期、捕获进程输出，以及执行后台文件监控（Watch）。
* **Aline CLI (客户端):** 提供给用户或 Agent 使用的命令行工具。作为触发器，通过本地 IPC（Inter-Process Communication，如 Unix Domain Sockets）向 Daemon 发送指令并接收结构化返回结果。

## 2. 技术栈与框架选型

为保证跨平台兼容性、极简的部署流程以及对 I/O 密集型任务的支持，项目采用纯 Node.js 技术栈。

### 核心依赖

* **运行时:** Node.js (v18+ LTS)
* **命令行解析:** `commander` (用于构建 CLI 层级命令与参数解析)
* **SSH 引擎:** `ssh2` (实现底层长连接与 Multi-channel 通道复用)
* **配置解析:** `ssh-config` (解析 `~/.ssh/config` 支持 ProxyCommand/JumpHost)
* **文件监控:** `chokidar` (极低资源消耗的文件系统事件监听)
* **后台守护:** `daemonize2` 或原生 `child_process.spawn(..., { detached: true })`
* **进程通信:** Node.js 原生 `net` 模块 (TCP/Unix Socket IPC)


字符串logo

```
                ___    ___   
  ╭━━━━━╮      /   |  / (_)___  ___  
  ┃· - ·┃     / /| | / / / __ \/ _ \ 
  ╰━┳━┳━╯    / ___ |/ / / / / /  __/ 
  ▝▘▝▘   /_/  |_/_/_/_/ /_/\___/
```

## 3. 项目目录结构

建议采用标准的 Node.js CLI 工程结构，实现 CLI 与 Daemon 逻辑的物理隔离。

**Plaintext**

```
aline/
├── bin/
│   └── aline.js            # CLI 入口文件 (配置 #!/usr/bin/env node)
├── src/
│   ├── cli/                # CLI 客户端逻辑
│   │   ├── commands.js     # 命令注册与路由
│   │   └── client.js       # IPC 客户端通信类
│   ├── daemon/             # 后台守护进程逻辑
│   │   ├── server.js       # IPC 服务端，接收 CLI 请求
│   │   ├── sshManager.js   # 维护 SSH 物理连接池
│   │   └── channel.js      # 命名通道与 Ring Buffer 日志管理
│   ├── sync/               # 同步引擎
│   │   ├── watcher.js      # chokidar 监听封装
│   │   └── rsync.js        # 调用系统原生 rsync
│   └── utils/
│       ├── config.js       # 解析 ~/.ssh/config 
│       └── logger.js       # Daemon 自身的运行日志
├── package.json
└── README.md
```

    运行
        ## 4. 核心功能与模块设计

### 4.1 SSH 连接池与 Proxy 支持 (sshManager.js)

Daemon 必须维护一个 Map：`Map<hostAlias, SSHConnection>`。
当发起连接请求时，利用 `ssh-config` 提取目标主机的真实 IP、端口、私钥路径。**关键处理：** 如果配置中包含 `ProxyCommand`，需使用本地 `child_process.exec` 建立代理流，并将其透传给 `ssh2` 实例。

### 4.2 命名通道与环形缓冲区 (channel.js)

每一个活动的 Exec 命令分配一个独立的 Channel 实例。
为了防止由于长时间运行（如 `pm2 logs`）导致 Daemon 内存泄漏，必须实现 Ring Buffer 存储 stdout/stderr。

**JavaScript**

```
// src/daemon/channel.js

class Channel {
    constructor(name) {
        this.name = name;
        this.status = 'IDLE'; // IDLE, RUNNING, ERROR
        this.bufferSize = 2000; // Max lines to keep
        this.logs = [];
        this.stream = null; 
    }

    appendLog(data) {
        const lines = data.toString().split('\n');
        this.logs.push(...lines);
    
        // Truncate from the beginning if exceeds buffer size
        if (this.logs.length > this.bufferSize) {
            this.logs = this.logs.slice(-this.bufferSize);
        }
    }

    getLogs(tailCount = 100) {
        return this.logs.slice(-tailCount).join('\n');
    }
}

module.exports = Channel;
```

    运行
        ### 4.3 IPC 通信协议

CLI 与 Daemon 之间传输 JSON 数据。

* **Request Schema:** `{ "action": "exec", "host": "dev", "payload": { "cmd": "ls", "channel": "ch1" } }`
* **Response Schema:** `{ "status": "success", "data": { ... }, "error": null }`

## 5. CLI 命令接口规范

所有给 Agent 调用的接口必须支持 `--json` 参数以返回纯净的机器可读数据。

### 5.1 物理连接管理

* `aline connect <host>`
  * 建立到目标的底层长连接。若 Daemon 未启动，则拉起 Daemon。
* `aline status <host>`
  * 返回远端机器基础负载信息（CPU/MEM/GPU 占用）。

### 5.2 命名通道生命周期

* `aline channel add <host> <name>`
  * 在内存中预注册一个逻辑通道，准备接收执行命令。
* `aline channel delete <host> <name>`
  * 向通道内的远端进程发送 `SIGINT`/`SIGTERM`，切断流，释放本地 Buffer。
* `aline channel list <host>`
  * 返回目标主机下所有通道的状态（名称、PID、状态、最后活跃时间）。

### 5.3 命令执行与日志诊断

* `aline exec <host> --channel <name> <command>`
  * 在指定通道执行命令。Agent 必须提供明确的通道名，确保无状态操作。如果通道不存在则自动创建。
* `aline log <host> <channel> [--tail N]`
  * 提取该通道最后 N 行执行日志。供 Agent 进行错误堆栈分析。

### 5.4 资产同步

* `aline sync start <host> --local <local_path> --remote <remote_path>`
  * 后台启动 `chokidar` 挂载显式本地目录，屏蔽 `node_modules` 和 `.git`，文件变动即刻触发同步。
* `aline sync stop <host>`
  * 停止后台监听器。
* `aline push <host> --local <local_path> --remote <remote_path>` / `aline pull <host> --remote <remote_path> --local <local_path>`
  * 执行单次强制全量/增量双向同步。传输命令必须显式提供 `--local` 与 `--remote`，不支持隐藏式位置参数，避免本地/远端路径歧义。

## 6. 异常处理与边界条件

1. **网络闪断:** 如果 Daemon 侦测到 `ssh2` 实例抛出 `error` 或 `close` 事件，必须将该 Host 下所有 Channel 标记为 `ERROR`。CLI 请求时返回 `Connection Lost`，并尝试指数退避重连。
2. **死循环命令:** Agent 可能执行 `while true` 等恶意或失控代码。`aline exec` 可配置可选参数 `--timeout <ms>`，超时后由 Daemon 主动销毁远端 Channel。
3. **大文件同步:** `rsync` 同步过程中如果发生大量文件更改，Daemon 应实施防抖（Debounce）策略（例如 500ms 内的多次变更合并为一次 `rsync` 调度），避免引发进程崩溃。
