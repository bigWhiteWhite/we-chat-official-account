import { db } from "@/lib/db";

/** 写一条任务事件（“查看日志”时间线数据源）；payload 存在时落 payloadJson。 */
export async function logTaskEvent(
  taskId: string,
  stage: string,
  eventType: string,
  message = "",
  payload?: unknown,
): Promise<void> {
  await db.taskEvent.create({
    data: {
      taskId,
      stage,
      eventType,
      message,
      payloadJson: payload === undefined ? null : JSON.stringify(payload),
    },
  });
}
