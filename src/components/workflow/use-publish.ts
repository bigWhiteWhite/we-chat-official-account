import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { toast } from "sonner";

import { api, type ApiError, type PublishResult } from "@/lib/api";

export type PublishFailure = { error: string; errcode?: number; errmsg?: string };

/** 发布状态与动作：发布步骤内容与弹窗底部按钮共享 */
export function usePublish(taskId: string | null) {
  const queryClient = useQueryClient();
  const [publishing, setPublishing] = useState(false);
  const [result, setResult] = useState<PublishResult | null>(null);
  const [failure, setFailure] = useState<PublishFailure | null>(null);

  const publish = useCallback(async () => {
    if (!taskId || publishing) return;
    setPublishing(true);
    setResult(null);
    setFailure(null);
    try {
      const r = await api.publish(taskId);
      setResult(r);
      toast.success("已创建公众号草稿，请到公众号后台人工发表");
      void queryClient.invalidateQueries({ queryKey: ["tasks"] });
      void queryClient.invalidateQueries({ queryKey: ["task", taskId] });
    } catch (err) {
      const e = err as ApiError;
      setFailure({
        error: e.message || "发布失败",
        errcode: e.feedback?.errcode,
        errmsg: e.feedback?.errmsg,
      });
    } finally {
      setPublishing(false);
    }
  }, [taskId, publishing, queryClient]);

  const reset = useCallback(() => {
    setPublishing(false);
    setResult(null);
    setFailure(null);
  }, []);

  return { publishing, result, failure, publish, reset };
}
