import type { Prisma } from "@prisma/client";

export type TaskSearchParams = {
  q?: string;
  status?: string;
  from?: string;
  to?: string;
  id?: string;
  seriesId?: string;
  tagId?: string;
};

/** 列表搜索 → Prisma where：q 模糊标题/大纲，id 匹配任务ID或草稿ID，from/to 为创建时间范围 */
export function buildTaskWhere(params: TaskSearchParams): Prisma.TaskWhereInput {
  const where: Prisma.TaskWhereInput = {};
  const or: Prisma.TaskWhereInput[] = [];

  const q = params.q?.trim();
  if (q) {
    or.push({ title: { contains: q } }, { outlineText: { contains: q } });
  }

  const id = params.id?.trim();
  if (id) {
    or.push({ taskId: id }, { draftMediaId: id });
  }

  if (or.length > 0) {
    where.OR = or;
  }

  const status = params.status?.trim();
  if (status && status !== "all") {
    where.status = status;
  }

  const seriesId = params.seriesId?.trim();
  if (seriesId === "none") {
    // 哨兵值：主合集与附加归属均为空才算无合集
    where.AND = [{ seriesId: null }, { seriesLinks: { none: {} } }];
  } else if (seriesId) {
    // 按合集筛选：主合集或附加归属任一命中
    const seriesConds: Prisma.TaskWhereInput[] = [
      { seriesId },
      { seriesLinks: { some: { seriesId } } },
    ];
    if (or.length > 0) {
      where.OR = or;
      where.AND = [{ OR: seriesConds }];
    } else {
      where.OR = seriesConds;
    }
  } else if (or.length > 0) {
    where.OR = or;
  }

  const tagId = params.tagId?.trim();
  if (tagId) {
    where.tags = { some: { tagId } };
  }

  const from = params.from?.trim();
  const to = params.to?.trim();
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = new Date(from);
    if (to) where.createdAt.lte = new Date(to);
  }

  return where;
}
