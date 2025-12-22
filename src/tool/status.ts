import { Context, Command } from 'koishi';
import { Config } from '../index';

/**
 * 定义机器人发送通知的目标。
 */
export interface StatusTarget {
  platform: string;
  channelId: string;
}

/**
 * 定义了 Minecraft 服务状态的数据结构。
 * true 代表正常, false 代表异常。
 */
type MinecraftServiceStatus = Record<string, boolean>;

/** 需要监控的 Minecraft 服务列表 */
const servicesToCheck = {
  'Minecraft Net': 'https://minecraft.net/',
  'Session': 'http://session.minecraft.net/',
  'Textures': 'http://textures.minecraft.net/',
  'Mojang API': 'https://api.mojang.com/',
  'Account': 'http://account.mojang.com/',
  'Session Server': 'https://sessionserver.mojang.com/',
};

/**
 * 将 Minecraft 状态对象格式化为用户友好的字符串。
 * @param status - 要格式化的状态对象。
 * @returns 格式化后的消息字符串。
 */
function formatStatusMessage(status: MinecraftServiceStatus): string {
  const statusLines = Object.entries(status).map(([service, isOnline]) => {
    const symbol = isOnline ? '[√]' : '[×]';
    return `${symbol} ${service}`;
  });
  return ['Minecraft 服务状态:', ...statusLines].join('\n');
}

/**
 * 检查单个服务的在线状态。
 * @param url - 要检查的服务 URL。
 */
async function checkServiceStatus(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10000), redirect: 'follow' });
    return response.status < 500;
  } catch {
    return false;
  }
}

/**
 * 并发检查所有预定义的服务，并返回它们的状态集合。
 * @returns 包含所有服务状态的对象。
 */
async function getMinecraftStatus(): Promise<MinecraftServiceStatus> {
  const statusEntries = await Promise.all(
    Object.entries(servicesToCheck).map(async ([name, url]) => {
      const isOnline = await checkServiceStatus(url);
      return [name, isOnline] as const;
    })
  );
  return Object.fromEntries(statusEntries);
}

/**
 * 向 Koishi 注册 .status 子命令。
 * @param mc - 父命令 'mc' 的实例。
 */
export function registerStatus(mc: Command) {
  mc.subcommand('.status', '查询 Minecraft 服务状态')
    .action(async ({ }) => {
      try {
        const currentStatus = await getMinecraftStatus();
        return formatStatusMessage(currentStatus);
      } catch (error) {
        return '获取 Minecraft 服务状态失败';
      }
    });
}

/**
 * 启动后台定时状态检查任务。
 * 仅在所有服务全部宕机或全部恢复正常时发送通知。
 * @param ctx - Koishi 的上下文对象。
 * @param config - 插件配置，包含通知目标和检查频率。
 */
export function regStatusCheck(ctx: Context, config: Config & { statusNoticeTargets?: StatusTarget[], statusUpdInterval?: number }) {
  const targets = config.statusNoticeTargets;
  if (!targets?.length) return;
  let lastConfirmedState = true;
  let pendingState: boolean | null = null;
  let count = 0;

  const check = async () => {
    try {
      const current = await getMinecraftStatus();
      const onlineCount = Object.values(current).filter(v => v).length;
      const totalCount = Object.keys(servicesToCheck).length;
      let currentState: boolean | null = null;
      if (onlineCount === totalCount) currentState = true;
      else if (onlineCount === 0) currentState = false;
      if (currentState === null || currentState === lastConfirmedState) {
        count = 0;
        pendingState = null;
        return;
      }
      if (currentState === pendingState) {
        count++;
      } else {
        pendingState = currentState;
        count = 1;
      }
      if (count >= 3) {
        const msg = currentState
          ? 'Minecraft 服务恢复正常'
          : 'Minecraft 服务全部宕机';
        const channels = targets.map(t => `${t.platform}:${t.channelId}`);
        await ctx.broadcast(channels, msg);
        lastConfirmedState = currentState;
        count = 0;
        pendingState = null;
      }
    } catch (e) {
      ctx.logger.warn('检查 Minecraft 服务状态失败:', e);
    }
  };

  check();
  ctx.setInterval(check, (config.statusUpdInterval) * 60000);
}
