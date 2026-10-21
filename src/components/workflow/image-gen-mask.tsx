/** 生成进度遮罩：毛玻璃蒙层 + 旋转指示，覆盖在图片区域上（主体卡与漫画分格格口共用） */
export function ImageGenMask({ label = "生成中…" }: { label?: string }) {
  return (
    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-white/70 backdrop-blur-[1.5px]">
      <div className="flex flex-col items-center gap-1">
        <div className="h-3.5 w-3.5 animate-spin rounded-full border-[2.5px] border-primary/50 border-t-primary" />
        {label ? (
          <span className="text-[11px] font-medium leading-tight text-primary">{label}</span>
        ) : null}
      </div>
    </div>
  );
}
