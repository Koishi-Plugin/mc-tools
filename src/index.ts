import { Context, Schema } from 'koishi'
import { registerPlayer } from './tool/player'
import { registerInfo } from './server/info'
import { registerServer, ServerConfig } from './server/server'
import { registerVer, regVerCheck, UpdTarget, ServerMaps } from './tool/ver'
import { registerStatus, regStatusCheck, StatusTarget } from './tool/status'
import { registerLinkParser } from './resource/parser'
import { registerCurseForge } from './resource/curseforge'
import { registerModrinth } from './resource/modrinth'
import { registerSearch } from './resource/search'
import { registerMcmod } from './resource/mcmod'
import { registerMcwiki } from './resource/mcwiki'

export const name = 'mc-tools'
export const inject = {optional: ['puppeteer', 'database']}

export const usage = `
<div style="border-radius: 10px; border: 1px solid #ddd; padding: 16px; margin-bottom: 20px; box-shadow: 0 2px 5px rgba(0,0,0,0.1);">
  <h2 style="margin-top: 0; color: #4a6ee0;">📌 插件说明</h2>
  <p>📖 <strong>使用文档</strong>：请点击左上角的 <strong>插件主页</strong> 查看插件使用文档</p>
  <p>🔍 <strong>更多插件</strong>：可访问 <a href="https://github.com/YisRime" style="color:#4a6ee0;text-decoration:none;">苡淞的 GitHub</a> 查看本人的所有插件</p>
</div>

<div style="border-radius: 10px; border: 1px solid #ddd; padding: 16px; margin-bottom: 20px; box-shadow: 0 2px 5px rgba(0,0,0,0.1);">
  <h2 style="margin-top: 0; color: #e0574a;">❤️ 支持与反馈</h2>
  <p>🌟 喜欢这个插件？请在 <a href="https://github.com/YisRime" style="color:#e0574a;text-decoration:none;">GitHub</a> 上给我一个 Star！</p>
  <p>🐛 遇到问题？请通过 <strong>Issues</strong> 提交反馈，或加入 QQ 群 <a href="https://qm.qq.com/q/PdLMx9Jowq" style="color:#e0574a;text-decoration:none;"><strong>855571375</strong></a> 进行交流</p>
</div>
`

export interface Config {
  noticeTargets: UpdTarget[]
  updInterval: number
  verEnabled: boolean
  statusEnabled: boolean
  statusNoticeTargets: StatusTarget[]
  statusUpdInterval: number
  playerEnabled: boolean
  infoEnabled: boolean
  serverTemplate: string
  serverMaps: ServerMaps[]
  rconServers: ServerConfig[]
  bindEnabled: boolean
  useForward: boolean
  useScreenshot: boolean
  useFallback: boolean
  curseforgeEnabled: false | string
  modrinthEnabled: boolean
  mcmodEnabled: false | string
  mcwikiEnabled: boolean
  linkParserEnabled: 'disable' | 'text' | 'shot'
  linkParserCache: number
  maxParagraphs: number
  maxDescLength: number
}

export const Config: Schema<Config> = Schema.intersect([
  Schema.object({
    linkParserEnabled: Schema.union([
      Schema.const('disable').description('禁用'),
      Schema.const('text').description('启用'),
      Schema.const('shot').description('启用（截图）')
    ]).description('启用链接解析').default('disable'),
    linkParserCache: Schema.number().description('链接解析冷却 (分钟)').default(60).min(0),
    mcwikiEnabled: Schema.boolean().description('启用 MC Wiki 查询').default(true),
    modrinthEnabled: Schema.boolean().description('启用 Modrinth 查询').default(true),
    mcmodEnabled: Schema.union([
      Schema.const(false).description('禁用'),
      Schema.string().description('启用').role('link').default('https://mcmod-api.yis-rime.workers.dev/')
    ]).description('启用 MC 百科 查询').default('https://mcmod-api.yis-rime.workers.dev/'),
    curseforgeEnabled: Schema.union([
      Schema.const(false).description('禁用'),
      Schema.string().description('启用').role('secret')
    ]).description('启用 CurseForge 查询').default(false)
  }).description('查询开关配置'),
  Schema.object({
    useForward: Schema.boolean().description('启用合并转发').default(true),
    useScreenshot: Schema.boolean().description('启用网页截图').default(true),
    useFallback: Schema.boolean().description('启用发送回退').default(true),
    maxParagraphs: Schema.number().description('详情段数限制').default(20).min(1).max(100),
    maxDescLength: Schema.number().description('每段字数限制').default(512).min(128).max(2048),
  }).description('资源查询配置'),
  Schema.object({
    playerEnabled: Schema.boolean().description('启用玩家信息查询').default(true),
    verEnabled: Schema.boolean().description('启用最新版本查询').default(true),
    updInterval: Schema.number().description('更新检查间隔(分钟)').default(1).min(1).max(1440),
    noticeTargets: Schema.array(Schema.object({
      platform: Schema.string().description('平台 ID'),
      channelId: Schema.string().description('频道 ID'),
      type: Schema.union([
        Schema.const('release').description('仅正式版'),
        Schema.const('snapshot').description('仅快照版'),
        Schema.const('both').description('所有版本')
      ]).description('推送类型').default('both')
    })).description('版本更新推送目标').role('table'),
    statusEnabled: Schema.boolean().description('启用服务状态查询').default(true),
    statusUpdInterval: Schema.number().description('状态检查间隔(分钟)').default(5).min(1).max(1440),
    statusNoticeTargets: Schema.array(Schema.object({
      platform: Schema.string().description('平台 ID'),
      channelId: Schema.string().description('频道 ID'),
    })).description('状态变更推送目标').role('table')
  }).description('版本&玩家&状态查询配置'),
  Schema.object({
    infoEnabled: Schema.boolean().description('启用服务器查询').default(true),
    serverTemplate: Schema.string().role('textarea')
    .description('服务器信息模板（使用{...:x}指代数据，数字代表数量限制）')
    .default('{icon}\n{motd}\n{edition}{software} {version} | {online}/{max} | {ping}\n{gamemode} {serverid} {eulablock}\n玩家({playercount}):{playerlist:10}\n插件({plugincount}):{pluginlist:10}\n模组({modcount}):{modlist:10}')
  }).description('服务器查询配置'),
  Schema.object({
    bindEnabled: Schema.boolean().description('启用白名单管理').default(false),
    serverMaps: Schema.array(Schema.object({
      serverId: Schema.number().description('服务器 ID').required(),
      platform: Schema.string().description('平台 ID'),
      channelId: Schema.string().description('频道 ID'),
      serverAddress: Schema.string().description('服务器地址'),
    })).description('服务器映射群组').default([]).role('table'),
    rconServers: Schema.array(Schema.object({
      id: Schema.number().description('服务器 ID').required(),
      rconAddress: Schema.string().description('地址').default('localhost:25575'),
      rconPassword: Schema.string().description('密码').role('secret')
    })).description('RCON 配置').default([]).role('table')
  }).description('服务器连接配置')
])

export function apply(ctx: Context, config: Config) {
  const mc = ctx.command('mc', 'Minecraft 工具')
  // 帮助
  mc.subcommand('.help', 'Minecraft 插件帮助')
    .action(() => `MC-Tools 插件帮助\n[详细说明](https://github.com/YisRime/koishi-plugin-mc-tools)`)
  // 最新版本查询
  config.verEnabled !== false && registerVer(mc)
  config.noticeTargets?.length && regVerCheck(ctx, config)
  // 服务状态查询
  config.statusEnabled !== false && registerStatus(mc)
  config.statusNoticeTargets?.length && regStatusCheck(ctx, config)
  // 玩家信息查询
  config.playerEnabled !== false && registerPlayer(ctx, mc)
  // 服务器信息查询
  config.infoEnabled !== false && registerInfo(mc, config)
  // 服务器连接与管理
  if (config.rconServers.length > 0) registerServer(ctx, mc, config)
  // 资源查询
  if (config.modrinthEnabled) registerModrinth(ctx, mc, config)
  if (typeof config.curseforgeEnabled === 'string' && config.curseforgeEnabled) registerCurseForge(ctx, mc, config)
  if (typeof config.mcmodEnabled === 'string' && config.mcmodEnabled) registerMcmod(ctx, mc, config)
  if (config.mcwikiEnabled) registerMcwiki(ctx, mc, config)
  // 链接解析
  if (config.linkParserEnabled !== 'disable') registerLinkParser(ctx, config)
  // 统一搜索
  if (config.mcmodEnabled || config.mcwikiEnabled || config.modrinthEnabled
    || config.curseforgeEnabled) registerSearch(ctx, mc, config)
}
