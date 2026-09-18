import { type PostWorktreeToLinearTarget, parseLinearTarget } from 'portta-contracts/taskflow'
import { flowApi } from './daemon.ts'
import { CommandUsageError, formatServerError, resolveProjectBaseUrl } from './shared.ts'

export interface ParsedLinearPostCommand {
  branch: string
  target: PostWorktreeToLinearTarget
  titleOverride: string | null
}

export function parseLinearTargetArg(raw: string): PostWorktreeToLinearTarget {
  const target = parseLinearTarget(raw)
  if (target.kind === 'team') {
    return { kind: 'team', teamKey: target.teamKey }
  }
  if (target.kind === 'issue') {
    throw new CommandUsageError(
      `Post target must be a team key (e.g. ENG). To post to issue ${target.issueId} as part of a session, use --linear ${target.issueId} on the oneshot/add command (loads issue context and posts back to it).`,
    )
  }
  throw new CommandUsageError(`Invalid Linear team key "${target.raw}". Use a team key like ENG.`)
}

export function linearPostFromCli(
  branch: string,
  targetRaw: string,
  options: { title?: string },
): ParsedLinearPostCommand {
  const titleOverride = options.title ?? null
  const baseTarget = parseLinearTargetArg(targetRaw)
  const target =
    baseTarget.kind === 'team' && titleOverride
      ? { kind: 'team' as const, teamKey: baseTarget.teamKey, title: titleOverride }
      : baseTarget

  return { branch, target, titleOverride }
}

export async function runLinearCommand(post: ParsedLinearPostCommand, port: number): Promise<number> {
  try {
    const api = flowApi(await resolveProjectBaseUrl(port))
    const response = await api.postWorktreeToLinear({
      params: { name: post.branch },
      body: { target: post.target },
    })
    console.log(`Posted to Linear issue: ${response.issueUrl}`)
    if (response.commentUrl) console.log(`Comment: ${response.commentUrl}`)
    console.log(`Attachment: ${response.attachmentUrl}`)
    return 0
  } catch (error) {
    console.error(formatServerError(error, port))
    return 1
  }
}
