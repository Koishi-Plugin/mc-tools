import { Context, Command } from 'koishi';
import { Config } from '../index';

export interface StatusTarget { platform: string; channelId: string }

type MinecraftServiceStatus = Record<string, boolean>;

/**
 * 获取 Minecraft 相关服务的状态。
 * 模拟 Microsoft OAuth、Xbox Live、Minecraft API 等关键服务的请求，判断它们是否正常响应。
 * @returns 包含各服务在线状态的对象
 */
async function getMinecraftStatus(): Promise<MinecraftServiceStatus> {
  const endpoints: Array<[string, string, 'GET' | 'POST', string?]> = [
    // Microsoft OAuth: 获取 OAuth2 token
    ['Microsoft Login', 'https://login.live.com/oauth20_authorize.srf?client_id=dummy_client_id&response_type=code&scope=service::user.auth.xboxlive.com::MBI_SSL&redirect_uri=https://login.live.com/oauth20_desktop.srf', 'GET'],
    // Xbox Live: 使用 MS Token 获取 XBL Token
    ['Xbox Auth', 'https://user.auth.xboxlive.com/user/authenticate', 'POST', JSON.stringify({ Properties: { AuthMethod: "RPS", SiteName: "user.auth.xboxlive.com", RpsTicket: "d=dummy_token" }, RelyingParty: "http://auth.xboxlive.com", TokenType: "JWT" })],
    // Xbox XSTS: 使用 XBL Token 获取 XSTS Token
    ['Xbox XSTS', 'https://xsts.auth.xboxlive.com/xsts/authorize', 'POST', JSON.stringify({ Properties: { SandboxId: "RETAIL", UserTokens: ["dummy_uhs_token"] }, RelyingParty: "rp://api.minecraftservices.com/", TokenType: "JWT" })],
    // Minecraft API: 使用 XSTS Token 获取 Access Token
    ['Minecraft API', 'https://api.minecraftservices.com/authentication/login_with_xbox', 'POST', JSON.stringify({ identityToken: "XBL3.0 x=dummy_uhs;dummy_xsts_token" })],
    // Session Server: 使用 Access Token 获取 Session ID 和 Profile ID
    ['Session Server', 'https://sessionserver.mojang.com/?username=dummy_user&serverId=dummy_server_id', 'GET'],
    // Mojang API: 获取 UUID 和 Name History
    ['Mojang API', 'https://api.mojang.com/?username=dummy_user', 'GET'],
    // Skin/Cape: 获取 Skin 和 Cape
    ['Skin (Textures)', 'https://textures.minecraft.net/?texture=dummy_texture_id', 'GET'],
  ];

  const results = await Promise.all(
    endpoints.map(async ([name, url, method, reqBody]) => {
      try {
        const response = await fetch(url, {
          method, headers: method === 'POST' ? { 'Content-Type': 'application/json', 'Accept': 'application/json' } : undefined,
          body: method === 'POST' ? (reqBody || '{}') : undefined, signal: AbortSignal.timeout(10000), redirect: 'follow'
        });
        return [name, response.status < 500] as const;
      } catch {
        return [name, false] as const;
      }
    })
  );
  return Object.fromEntries(results);
}

/**
 * 向 Koishi 注册 .status 子命令。
 * @param mc - 父命令 'mc' 的实例。
 */
export function registerStatus(mc: Command) {
  mc.subcommand('.status', '查询 Minecraft 服务状态')
    .action(async () => {
      try {
        const currentStatus = await getMinecraftStatus();
        return ['Minecraft 服务状态:', ...Object.entries(currentStatus).map(([service, isOnline]) => `${isOnline ? '[√]' : '[×]'} ${service}`)].join('\n');
      } catch (error) {
        return '获取 Minecraft 服务状态失败';
      }
    });
}

/**
 * 启动后台定时状态检查任务。
 * @param ctx - Koishi 的上下文对象。
 * @param config - 插件配置，包含通知目标和检查频率。
 */
export function regStatusCheck(ctx: Context, config: Config & { statusNoticeTargets?: StatusTarget[], statusUpdInterval?: number }) {
  const targets = config.statusNoticeTargets;
  if (!targets?.length) return;
  const lastConfirmedStates: Record<string, boolean> = {};
  const pendingStates: Record<string, { state: boolean, count: number }> = {};
  const channels = targets.map(t => `${t.platform}:${t.channelId}`);
  const check = async () => {
    try {
      const currentStatus = await getMinecraftStatus();
      for (const [name, isOnline] of Object.entries(currentStatus)) {
        const expectedState = lastConfirmedStates[name] ?? true;
        if (isOnline === expectedState) {
          delete pendingStates[name];
          continue;
        }
        if (pendingStates[name]?.state === isOnline) {
          pendingStates[name].count++;
        } else {
          pendingStates[name] = { state: isOnline, count: 1 };
        }
        if (pendingStates[name].count >= 3) {
          await ctx.broadcast(channels, `${name} ${isOnline ? '恢复正常' : '出现异常'}`);
          lastConfirmedStates[name] = isOnline;
          delete pendingStates[name];
        }
      }
    } catch (e) {
      ctx.logger.warn('检查 Minecraft 服务状态失败:', e);
    }
  };

  check();
  ctx.setInterval(check, (config.statusUpdInterval) * 60000);
}
