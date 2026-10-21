"use client";

import "react-photo-view/dist/react-photo-view.css";
import { PhotoProvider, PhotoView } from "react-photo-view";
import {
  createContext,
  useContext,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";

/** 是否已处于一个 <PreviewGroup> 的 PhotoProvider 内部（避免嵌套 provider）。 */
const InGroupContext = createContext(false);

// ---------- 全局"灯箱开启"状态 ----------
// react-photo-view 的灯箱通过 createPortal 渲染到 document.body，是 Radix Dialog
// portal 的兄弟节点：灯箱打开期间在灯箱内的 pointerdown 会被 Radix 判为
// "interact outside"，导致父弹窗跟着一起关闭。
// 这里维护一个全局计数器，供含 <PreviewImage> 的 DialogContent 通过
// preventLightboxInteract 在 onPointerDownOutside / onInteractOutside /
// onEscapeKeyDown 中 preventDefault，阻止弹窗误关。

let lightboxCount = 0;
const lightboxListeners = new Set<() => void>();

function setLightboxCount(next: number) {
  lightboxCount = Math.max(0, next);
  lightboxListeners.forEach((listener) => listener());
}

function subscribeToLightbox(onStoreChange: () => void) {
  lightboxListeners.add(onStoreChange);
  return () => {
    lightboxListeners.delete(onStoreChange);
  };
}

/** 当前是否有任一图片灯箱处于打开状态。 */
export function isPhotoLightboxOpen(): boolean {
  return lightboxCount > 0;
}

/** React 订阅版：灯箱开/关时触发重渲染。 */
export function usePhotoLightboxOpen(): boolean {
  return useSyncExternalStore(subscribeToLightbox, isPhotoLightboxOpen);
}

/**
 * Radix DismissibleLayer 事件守卫：灯箱打开时对事件 preventDefault，
 * 阻止 Dialog 等"可关闭层"因点击其外部（实为灯箱内部）而关闭。
 */
export function preventLightboxInteract(event: { preventDefault(): void }): void {
  if (isPhotoLightboxOpen()) {
    event.preventDefault();
  }
}

/** 统一的 PhotoProvider 包装：透传 props，并跟踪灯箱开/关。 */
function TrackedPhotoProvider({
  children,
  onVisibleChange,
  ...rest
}: {
  children?: ReactNode;
  onVisibleChange?: (visible: boolean, index: number, state: unknown) => void;
} & Record<string, unknown>) {
  return (
    <PhotoProvider
      maskClosable
      pullClosable
      {...rest}
      onVisibleChange={(visible) => {
        setLightboxCount(visible ? lightboxCount + 1 : lightboxCount - 1);
        onVisibleChange?.(visible, 0, undefined);
      }}
    >
      {children}
    </PhotoProvider>
  );
}

type PreviewImageProps = {
  src: string;
  alt?: string;
  className?: string;
  style?: CSSProperties;
  loading?: "eager" | "lazy";
};

/**
 * 可预览图片：点击后进入全屏灯箱（支持缩放 / 旋转 / 下拉关闭）。
 * - 单独使用：自成单图预览。
 * - 放在 <PreviewGroup> 内：与同组图片一起可左右切换。
 */
export function PreviewImage({ src, alt, className, style, loading }: PreviewImageProps) {
  const insideGroup = useContext(InGroupContext);
  const img = (
    <img
      src={src}
      alt={alt}
      className={cn("cursor-pointer", className)}
      style={style}
      loading={loading}
    />
  );
  const view = <PhotoView src={src}>{img}</PhotoView>;
  if (insideGroup) {
    return view;
  }
  return (
    <TrackedPhotoProvider>
      <InGroupContext.Provider value={true}>{view}</InGroupContext.Provider>
    </TrackedPhotoProvider>
  );
}

/**
 * 图片预览组：把若干 <PreviewImage> 包在一个 PhotoProvider 里，
 * 点击任意图进入灯箱后可在同组图片间左右切换。不产生额外 DOM 节点。
 */
export function PreviewGroup({ children }: { children: ReactNode }) {
  return (
    <TrackedPhotoProvider>
      <InGroupContext.Provider value={true}>{children}</InGroupContext.Provider>
    </TrackedPhotoProvider>
  );
}
