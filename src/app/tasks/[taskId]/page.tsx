import { TaskDetail } from "@/components/task-detail";

export default async function TaskPage({ params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params;
  return <TaskDetail taskId={taskId} />;
}
