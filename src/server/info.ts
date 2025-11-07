import { h } from 'koishi'
import { Config } from '../index'
import * as net from 'net'
import * as dgram from 'dgram'

/**
 * Minecraft 服务器状态信息接口
 * @interface ServerStatus
 */
interface ServerStatus {
  online: Boolean
  host: string
  port: number
  ip_address?: string | null
  eula_blocked?: boolean
  ping?: number
  version?: {
    name_clean?: string
    name?: string | null
  }
  players: {
    online: number | null
    max: number | null
    list?: string[]
  }
  motd?: string
  icon?: string | null
  mods?: { name: string, version?: string }[]
  software?: string | null
  plugins?: { name: string, version?: string | null }[]
  srv_record?: { host: string, port: number } | null
  gamemode?: string | null
  server_id?: string | null
  edition?: 'MCPE' | 'MCEE' | null
  error?: string
}

/**
 * 定义了一组用于检测无效或私有服务器地址的正则表达式模式。
 * 这有助于防止机器人被用于扫描本地网络或保留地址空间。
 */
const FORBIDDEN_PATTERNS: RegExp[] = [
  /^localhost$/, /^127\./, /^0\.0\.0\.0$/, /^\[::\]/, /^::$/, /^\[::1\]/,
  /^10\./, /^(192\.168)\./, /^(172\.(1[6-9]|2[0-9]|3[0-1]))\./, /^(169\.254)\./,
  /^fe80:/, /^[fd]/, /^ff/
];

/**
 * 验证给定的 Minecraft 服务器地址是否为有效的公共地址。
 * @param {string} input - 用户输入的服务器地址 (例如: "example.com:25565")。
 * @returns {string|null} 如果地址有效，则返回原始地址；否则返回 null。
 */
function validateServerAddress(input: string): string | null {
  const lowerAddr = input.toLowerCase();
  if (FORBIDDEN_PATTERNS.some(pattern => pattern.test(lowerAddr))) return null;
  const portPart = lowerAddr.includes(':') ? lowerAddr.substring(lowerAddr.lastIndexOf(':') + 1) : null;
  if (portPart) {
    const port = parseInt(portPart, 10);
    if (isNaN(port) || port < 1 || port > 65535) return null;
  }
  return input;
}

/**
 * 通过建立 TCP (Java) 或发送 UDP (Bedrock) 包来直接测量到服务器的网络延迟。
 * @param {string} host - 服务器的主机名或 IP 地址。
 * @param {number} port - 服务器的端口。
 * @param {'java' | 'bedrock'} type - 服务器类型。
 * @returns {Promise<number>} 返回连接延迟（毫秒）。如果连接失败或超时（10秒），则返回 -1。
 */
async function pingServer(host: string, port: number, type: 'java' | 'bedrock'): Promise<number> {
  const startTime = Date.now();
  return new Promise((resolve) => {
    if (type === 'java') {
      const socket = new net.Socket();
      const onError = () => { socket.destroy(); resolve(-1); };
      socket.setTimeout(10000);
      socket.on('connect', () => { socket.destroy(); resolve(Date.now() - startTime); });
      socket.on('error', onError);
      socket.on('timeout', onError);
      socket.connect(port, host);
    } else { // bedrock
      const client = dgram.createSocket('udp4');
      const timer = setTimeout(() => { client.close(); resolve(-1); }, 10000);
      const cleanup = () => { clearTimeout(timer); client.close(); };
      client.on('message', () => { cleanup(); resolve(Date.now() - startTime); });
      client.on('error', () => { cleanup(); resolve(-1); });
      const pingData = Buffer.from([1,0,0,0,0,0,0,0,0,0,255,255,0,254,254,254,254,253,253,253,253,18,52,86,120]);
      client.send(pingData, port, host, (err) => { if (err) { cleanup(); resolve(-1); } });
    }
  });
}

/**
 * 将用户输入的服务器地址字符串解析为主机和端口。
 * @param {string} address - 用户输入的服务器地址。
 * @param {number} defaultPort - 如果地址中未指定端口，则使用此默认端口。
 * @returns {{host: string, port: number}} 解析出的主机和端口对象。
 */
function parseServerAddress(address: string, defaultPort: number): { host: string; port: number } {
  const ipv6WithPortMatch = address.match(/^\[(.+)\]:(\d+)$/);
  if (ipv6WithPortMatch) return { host: ipv6WithPortMatch[1], port: parseInt(ipv6WithPortMatch[2], 10) };
  const ipv6Match = address.match(/^\[(.+)\]$/);
  if (ipv6Match) return { host: ipv6Match[1], port: defaultPort };
  if (address.split(':').length > 2 && !address.endsWith(']')) return { host: address, port: defaultPort };
  const lastColonIndex = address.lastIndexOf(':');
  if (lastColonIndex > -1) {
    const host = address.substring(0, lastColonIndex);
    const port = parseInt(address.substring(lastColonIndex + 1), 10);
    if (!isNaN(port)) return { host, port };
  }
  return { host: address, port: defaultPort };
}

/**
 * 从多个第三方 API 获取、解析并标准化 Minecraft 服务器的状态。
 * @param {string} server - 用户输入的服务器地址。
 * @param {'java' | 'bedrock'} forceType - 要查询的服务器类型。
 * @param {Config} [config] - 插件的配置对象，包含 API 端点。
 * @returns {Promise<ServerStatus>} 返回一个包含服务器状态的 Promise 对象。
 */
async function fetchServerStatus(server: string, forceType: 'java' | 'bedrock', config?: Config): Promise<ServerStatus> {
  const serverType = forceType || 'java';
  const defaultPort = serverType === 'java' ? 25565 : 19132;
  const address = validateServerAddress(server);
  if (!address) {
    const { host, port } = parseServerAddress(server, defaultPort);
    return { online: false, host, port, players: { online: null, max: null }, error: '无效地址' };
  }
  const { host, port } = parseServerAddress(address, defaultPort);
  const apiEndpoints = config?.serverApis?.filter(api => api.type === serverType)?.map(api => api.url) || [];
  const apiResults = await Promise.allSettled(
    apiEndpoints.map(apiUrl => fetch(apiUrl.replace('${address}', address), { headers: { 'User-Agent': 'Koishi-MC-Info/1.0' }})
      .then(res => res.ok ? res.json() : Promise.reject(`API 请求失败: ${res.status}`)))
  );
  const successfulData = apiResults.find(r => r.status === 'fulfilled')?.value;
  if (successfulData) {
    const status = normalizeApiResponse(successfulData, address, serverType);
    if (status.online) {
      status.ping = await pingServer(status.host, status.port, serverType);
      return status;
    }
  }
  return { online: false, host, port, players: { online: null, max: null }, error: '查询失败' };
}

/**
 * 将来自不同 API 的、格式各异的响应数据，统一转换为标准的 `ServerStatus` 格式。
 * @param {any} data - 从 API 获取的原始 JSON 数据。
 * @param {string} address - 用户最初输入的服务器地址，用作备用信息。
 * @param {'java' | 'bedrock'} serverType - 服务器类型。
 * @returns {ServerStatus} 标准化后的服务器状态对象。
 */
function normalizeApiResponse(data: any, address: string, serverType: 'java' | 'bedrock'): ServerStatus {
  const [hostFromAddr, portStr] = address.split(':');
  const defaultPort = serverType === 'java' ? 25565 : 19132;
  const portFromAddr = parseInt(portStr) || defaultPort;
  if (data.online === false || ['error', 'offline'].includes(data.status?.toLowerCase())) {
    return { online: false, host: hostFromAddr, port: portFromAddr, players: { online: null, max: null }, error: data.error || data.description };
  }
  let finalHost = data.hostname || data.host || data.server || hostFromAddr;
  let finalPort = data.port ?? data.ipv6Port;
  if (finalPort == null) {
    const ipv6Match = finalHost.match(/^\[(.+)\]:(\d+)$/);
    const hostPortMatch = finalHost.lastIndexOf(':') > finalHost.indexOf(':') ? null : finalHost.match(/^([^:]+):(\d+)$/);
    const match = ipv6Match || hostPortMatch;
    if (match) { finalHost = match[1]; finalPort = parseInt(match[2], 10) }
  }
  finalPort = finalPort ?? portFromAddr;
  const processListData = (items: any) => Array.isArray(items) ? items.map(item => typeof item === 'string' ? { name: item } : item) : undefined;
  const motdText = (() => {
    if (!data.motd) return data.description?.text || data.description;
    if (typeof data.motd === 'string') return data.motd;
    if (typeof data.motd === 'object') {
        const textArray = data.motd.clean || data.motd.raw;
        return Array.isArray(textArray) ? textArray.join('\n') : textArray;
    }
    return null;
  })();
  const playerList = data.players?.list || data.players?.sample?.map(p => p.name) || (Array.isArray(data.players) ? data.players : data.player_list);
  return {
    online: true, host: finalHost, port: finalPort,
    ip_address: data.ip_address || data.ip,
    eula_blocked: data.eula_blocked,
    motd: motdText,
    version: {
      name_clean: data.version?.name_clean ?? data.version,
      name: data.version?.name ?? data.protocol?.name,
    },
    players: {
      online: data.players?.online ?? data.players?.now, max: data.players?.max,
      list: playerList?.map(p => (typeof p === 'string' ? p : p.name) || ''),
    },
    icon: data.icon || data.favicon,
    srv_record: data.srv_record || data.srv,
    mods: processListData(data.mods || data.modinfo?.modList),
    software: data.software,
    plugins: processListData(data.plugins),
    gamemode: data.gamemode,
    server_id: data.server_id,
    edition: data.edition || (serverType === 'bedrock' ? 'MCPE' : null),
  };
}

/**
 * 将标准化的 `ServerStatus` 对象格式化为用户可读的字符串。
 * @param {ServerStatus} status - 服务器状态对象。
 * @param {Config} config - 插件配置，主要用于获取 `serverTemplate`。
 * @returns {string} 格式化后的、准备发送给用户的消息文本。
 */
function formatServerStatus(status: ServerStatus, config: Config): string {
  if (!status.online) return status.error;
  const formatList = (list: {name: string, version?: string}[], limit?: number): string | null => {
    if (!list?.length) return null;
    const limitedList = list.slice(0, limit || list.length);
    const text = limitedList.map(item => item.version ? `${item.name}-${item.version}` : item.name).join(', ');
    return limit && limit < list.length ? `${text}...` : text;
  };
  const getValue = (name: string, limit?: number): string | null => {
    switch (name) {
      case 'name': return status.port === 25565 || status.port === 19132 ? status.host : `${status.host}:${status.port}`;
      case 'ip': return status.ip_address;
      case 'srv': return status.srv_record ? `${status.srv_record.host}:${status.srv_record.port}` : null;
      case 'icon': return status.icon?.startsWith('data:image/png;base64,') ? h.image(status.icon).toString() : null;
      case 'motd': return status.motd;
      case 'version': return status.version?.name_clean;
      case 'online': return status.players.online?.toString();
      case 'max': return status.players.max?.toString();
      case 'ping': return status.ping != null && status.ping !== -1 ? `${status.ping}ms` : null;
      case 'software': return status.software;
      case 'edition': return status.edition === 'MCPE' ? '基岩版' : (status.edition === 'MCEE' ? '教育版' : status.edition);
      case 'gamemode': return status.gamemode;
      case 'eulablock': return status.eula_blocked ? '是' : null;
      case 'serverid': return status.server_id;
      case 'playercount': return status.players.list?.length.toString();
      case 'plugincount': return status.plugins?.length.toString();
      case 'modcount': return status.mods?.length.toString();
      case 'playerlist': return formatList(status.players.list?.map(name => ({name})), limit);
      case 'pluginlist': return formatList(status.plugins, limit);
      case 'modlist': return formatList(status.mods, limit);
      default: return null;
    }
  };
  return config.serverTemplate.split('\n')
    .map(line => {
      const placeholders = [...line.matchAll(/\{([^{}:]+)(?::(\d+))?\}/g)];
      if (placeholders.length > 0 && placeholders.every(p => !getValue(p[1], p[2] ? parseInt(p[2]) : undefined))) return '';
      return line.replace(/\{([^{}:]+)(?::(\d+))?\}/g, (match, name, limitStr) => getValue(name, limitStr ? parseInt(limitStr) : undefined) ?? '');
    })
    .filter(line => line.trim().length > 0)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * 向 Koishi 注册 `mc.info` 和 `mc.info.be` 命令。
 * @param {any} parent - 父命令对象。
 * @param {Config} config - 插件配置。
 */
export function registerInfo(parent: any, config: Config) {
  const commandAction = async (session: any, server: string | undefined, type: 'java' | 'bedrock') => {
    const targetServer = server || (config.serverMaps.find(m => m.platform === session.platform && m.channelId === session.guildId)?.serverAddress ?? null);
    if (!targetServer) return '请提供服务器地址';
    const status = await fetchServerStatus(targetServer, type, config);
    return formatServerStatus(status, config);
  };

  const mcinfo = parent.subcommand('.info [server]', '查询 Java 服务器')
    .usage(`用法: mc.info [地址[:端口]]\n查询 Java 版服务器的状态。`)
    .action(async ({ session }, server) => commandAction(session, server, 'java'));

  mcinfo.subcommand('.be [server]', '查询 Bedrock 服务器')
    .usage(`用法: mc.info.be [地址[:端口]]\n查询基岩版服务器的状态。`)
    .action(async ({ session }, server) => commandAction(session, server, 'bedrock'));
}
