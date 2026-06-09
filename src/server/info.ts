import { h } from 'koishi'
import { Config } from '../index'
import * as net from 'net'
import * as dgram from 'dgram'

/**
 * Minecraft 服务器状态信息接口
 * @interface ServerStatus
 */
interface ServerStatus {
  online: boolean
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
 * 验证给定的 Minecraft 服务器地址。
 * @param {string} input - 用户输入的服务器地址。
 * @returns {{ valid: boolean, type?: 'private' | 'format' }} 验证结果。
 */
function validateServerAddress(input: string): { valid: boolean, type?: 'private' | 'format' } {
  const addr = input.trim().toLowerCase();
  if (!addr) return { valid: false, type: 'format' };
  let host = addr;
  if (addr.startsWith('[')) {
    host = addr.substring(1, addr.lastIndexOf(']'));
  } else if (addr.includes(':')) {
    host = addr.split(':')[0];
  }
  // 检查是否为私有/回环地址
  const privatePatterns = [
    /^localhost$/i, /^127\./, /^0\.0\.0\.0$/, /^\[::1\]$/, /^::1$/, /^\[::\]$/, /^::$/,
    /^10\./, /^172\.(1[6-9]|2[0-9]|3[0-1])\./, /^192\.168\./, /^169\.254\./,
    /^fe80:/i, /^[fd][0-9a-f]{2}:/i, /^ff/i ];
  if (privatePatterns.some(p => p.test(host))) return { valid: false, type: 'private' };
  // 检查基础格式 (域名或 IP)
  const formatPattern = /^([a-z0-9][a-z0-9-]*\.)+[a-z0-9][a-z0-9-]*$|^(\d{1,3}\.){3}\d{1,3}$|^\[[0-9a-f:]+\]$/i;
  if (!formatPattern.test(host) && host !== 'localhost') return { valid: false, type: 'format' };
  return { valid: true };
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
 * @returns {{host: string; port: number}} 解析出的主机和端口对象。
 */
function parseServerAddress(address: string, defaultPort: number): { host: string; port: number } {
  const ipv6WithPortMatch = address.match(/^\[(.+)\]:(\d+)$/);
  if (ipv6WithPortMatch) return { host: ipv6WithPortMatch[1], port: parseInt(ipv6WithPortMatch[2], 10) };
  const ipv6Match = address.match(/^\[(.+)\]$/);
  if (ipv6Match) return { host: ipv6Match[1], port: defaultPort };
  const lastColonIndex = address.lastIndexOf(':');
  if (lastColonIndex > address.lastIndexOf(']')) {
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
 * @param {Config} [config] - 插件的配置对象。
 * @returns {Promise<ServerStatus>} 返回一个包含服务器状态的 Promise 对象。
 */
async function fetchServerStatus(server: string, forceType: 'java' | 'bedrock'): Promise<ServerStatus> {
  const serverType = forceType || 'java';
  const defaultPort = serverType === 'java' ? 25565 : 19132;
  const checkResult = validateServerAddress(server);
  if (!checkResult.valid) {
    const { host, port } = parseServerAddress(server, defaultPort);
    return { online: false, host, port, players: { online: null, max: null }, error: checkResult.type === 'private' ? '地址私有或保留' : '地址格式错误' };
  }
  const { host, port } = parseServerAddress(server, defaultPort);
  const apis = serverType === 'java'
    ? [`https://api.mcstatus.io/v2/status/java/${server}`, `https://api.mcsrvstat.us/3/${server}`, `https://api.imlazy.ink/mcapi?type=json&host=${server}`]
    : [`https://api.mcstatus.io/v2/status/bedrock/${server}`, `https://api.mcsrvstat.us/bedrock/3/${server}`, `https://api.imlazy.ink/mcapi?type=json&host=${server}&be=true`];
  for (const url of apis) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Koishi-Plugin-MC-Tools/1.0' }, signal: AbortSignal.timeout(10000) });
      if (res.ok) {
        const data = await res.json();
        const status = normalizeApiResponse(data, server, serverType);
        if (status.online) {
          status.ping = await pingServer(status.host, status.port, serverType);
          return status;
        }
      }
    } catch (e) {}
  }
  return { online: false, host, port, players: { online: null, max: null }, error: '查询状态失败' };
}

/**
 * 将来自不同 API 的响应数据统一转换为标准的 `ServerStatus` 格式。
 * @param {any} data - 从 API 获取的原始 JSON 数据。
 * @param {string} address - 用户输入的服务器地址。
 * @param {'java' | 'bedrock'} serverType - 服务器类型。
 * @returns {ServerStatus} 标准化后的服务器状态对象。
 */
function normalizeApiResponse(data: any, address: string, serverType: 'java' | 'bedrock'): ServerStatus {
  const isOnline = data.online === true || data.status === 'success' || data.status === 'online' || data.status === true;
  if (!isOnline) return { online: false, host: '', port: 0, players: { online: null, max: null } };
  const { host, port: defPort } = parseServerAddress(address, serverType === 'java' ? 25565 : 19132);
  const motdData = data.motd?.clean || data.motd?.raw || data.description?.text || data.description || data.motd;
  const motd = Array.isArray(motdData) ? motdData.join('\n') : (typeof motdData === 'object' && motdData !== null ? (motdData.text || '') : (motdData || ''));
  const rawPlayerList = data.players?.list || data.players?.sample || data.players_list;
  const playerList = Array.isArray(rawPlayerList) ? rawPlayerList.map((p: any) => typeof p === 'string' ? p : (p?.name_clean || p?.name || '')).filter(Boolean) : undefined;
  const modsRaw = Array.isArray(data.mods) ? data.mods : (Array.isArray(data.modinfo?.modList) ? data.modinfo.modList : (Array.isArray(data.modlist) ? data.modlist : []));
  const pluginsRaw = Array.isArray(data.plugins) ? data.plugins : [];
  return {
    online: true,
    host: data.hostname || data.host || host,
    port: data.port || defPort,
    ip_address: data.ip_address || data.ip || data.hostip,
    eula_blocked: !!data.eula_blocked,
    motd: motd.trim(),
    version: { name_clean: data.version?.name_clean || data.version?.name || data.version },
    players: {
      online: data.players?.online ?? data.players_online ?? data.players?.now ?? 0,
      max: data.players?.max ?? data.players_max ?? 0,
      list: playerList?.length > 0 ? playerList : undefined,
    },
    icon: data.icon || data.favicon || data.favocion,
    software: data.software,
    plugins: pluginsRaw.length > 0 ? pluginsRaw : undefined,
    mods: modsRaw.length > 0 ? modsRaw : undefined,
    gamemode: data.gamemode || data.gametype,
    server_id: data.server_id || data.serverid,
    edition: data.edition || (serverType === 'bedrock' ? 'MCPE' : null),
  };
}

/**
 * 将标准化的 `ServerStatus` 对象格式化为用户可读的字符串。
 * @param {ServerStatus} status - 服务器状态对象。
 * @param {Config} config - 插件配置。
 * @returns {string} 格式化后的、准备发送给用户的消息文本。
 */
function formatServerStatus(status: ServerStatus, config: Config): string {
  if (!status.online) return status.error || '服务器离线';
  const formatList = (list: any[], limit?: number): string | null => {
    if (!Array.isArray(list) || !list.length) return null;
    const items = list.slice(0, limit).filter(item => item != null)
      .map(item => {
        if (typeof item === 'string') return item;
        return item.version ? `${item.name}-${item.version}` : item.name;
      }).filter(Boolean);
    if (!items.length) return null;
    return items.join(', ') + (list.length > (limit || 999) ? '...' : '');
  };
  const getValue = (name: string, limit?: number): string | null => {
    switch (name) {
      case 'ip': return status.ip_address || null;
      case 'icon': return status.icon?.startsWith('data:image/') ? h.image(status.icon).toString() : null;
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
      case 'playercount': return status.players.list?.length?.toString() || null;
      case 'plugincount': return status.plugins?.length?.toString() || null;
      case 'modcount': return status.mods?.length?.toString() || null;
      case 'playerlist': return formatList(status.players.list || [], limit);
      case 'pluginlist': return formatList(status.plugins || [], limit);
      case 'modlist': return formatList(status.mods || [], limit);
      default: return null;
    }
  };
  return config.serverTemplate.split('\n')
    .map(line => {
      const placeholders = [...line.matchAll(/\{([^{}:]+)(?::(\d+))?\}/g)];
      if (placeholders.length > 0 && placeholders.every(p => !getValue(p[1], p[2] ? parseInt(p[2]) : undefined))) return '';
      return line.replace(/\{([^{}:]+)(?::(\d+))?\}/g, (match, name, limitStr) => getValue(name, limitStr ? parseInt(limitStr) : undefined) ?? '');
    }).filter(line => line.trim().length > 0).join('\n').replace(/\n{3,}/g, '\n\n').trim();
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
    const status = await fetchServerStatus(targetServer, type);
    return formatServerStatus(status, config);
  };

  const mcinfo = parent.subcommand('.info [server]', '查询 Java 服务器')
    .usage(`用法: mc.info [地址[:端口]]\n查询 Java 版服务器的状态。`)
    .action(async ({ session }, server) => commandAction(session, server, 'java'));

  mcinfo.subcommand('.be [server]', '查询 Bedrock 服务器')
    .usage(`用法: mc.info.be [地址[:端口]]\n查询基岩版服务器的状态。`)
    .action(async ({ session }, server) => commandAction(session, server, 'bedrock'));
}
