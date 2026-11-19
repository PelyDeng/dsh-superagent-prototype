import { expect, it } from 'vitest'
import { transcript } from '../src/app/resources.ts'

/**
 * rc.5 适配回归:transcript 的分页翻页游标曾误用 page.cursor(读取时的日志上界),
 * 会话超过两页时从第 3 页起原地打转(死循环)。这里用假 controller 复现多页场景,
 * 断言:游标按「本页最旧记录 seq」推进、全部页只读一次、结果按 seq 升序无重复。
 */
function pagedController(total: number, pageSize: number) {
  const calls: { beforeSeq: number | undefined }[] = []
  const events = async (request: { beforeSeq?: number | undefined }) => {
    calls.push({ beforeSeq: request.beforeSeq })
    // beforeSeq 是排他上界(宿主 paginate 取 slice(cut, beforeSeq));缺省读至日志末尾。
    const upper = request.beforeSeq === undefined ? total : request.beforeSeq - 1
    const low = Math.max(1, upper - pageSize + 1)
    const records = Array.from({ length: Math.max(0, upper - low + 1) }, (_, i) =>
      ({ event: { type: 'user/message', seq: low + i, data: {} } }))
    return { records, hasMore: low > 1, cursor: total }
  }
  return { events, calls }
}

it('walks every page backwards once using the oldest record seq as the cursor and returns events in order', async () => {
  const controller = pagedController(450, 200)
  const host = { context: { sessionController: controller } } as never
  const result = await transcript(host, 'T-1')
  expect(controller.calls.map(call => call.beforeSeq)).toEqual([undefined, 251, 51])
  expect(result).toHaveLength(450)
  expect(result.map(event => (event as unknown as { seq: number }).seq)).toEqual(Array.from({ length: 450 }, (_, i) => i + 1))
})

it('stops after one page when the session fits', async () => {
  const controller = pagedController(10, 200)
  const host = { context: { sessionController: controller } } as never
  const result = await transcript(host, 'T-2')
  expect(controller.calls.map(call => call.beforeSeq)).toEqual([undefined])
  expect(result).toHaveLength(10)
})
