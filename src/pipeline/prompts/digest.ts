/** 本集简介 prompt：一句话概括本集剧情，供后续剧集"前情回顾"复用 */
export function buildDigestPrompt(title: string, storyboard: string): string {
  return (
    '请根据以下漫画剧本，用一句话（不超过60字）概括本集剧情，作为连载合集的"本集简介"。直接输出该句子，不要引号、不要前缀：\n' +
    `标题：${title}\n分镜：\n${storyboard}`
  );
}
