import * as React from "react";

import { ChevronLeft, ChevronRight, MoreHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function Pagination({ className, ...props }: React.ComponentProps<"nav">) {
  return (
    <nav
      role="navigation"
      aria-label="pagination"
      data-slot="pagination"
      className={cn("flex w-full justify-center", className)}
      {...props}
    />
  );
}

function PaginationContent({ className, ...props }: React.ComponentProps<"ul">) {
  return (
    <ul
      data-slot="pagination-content"
      className={cn("flex flex-row items-center gap-1", className)}
      {...props}
    />
  );
}

function PaginationItem({ ...props }: React.ComponentProps<"li">) {
  return <li data-slot="pagination-item" {...props} />;
}

type PaginationLinkProps = {
  /** 是否为当前页（高亮并标记 aria-current） */
  isActive?: boolean;
} & React.ComponentProps<typeof Button>;

function PaginationLink({ className, isActive, variant = "ghost", ...props }: PaginationLinkProps) {
  return (
    <Button
      type="button"
      variant={isActive ? "outline" : variant}
      aria-current={isActive ? "page" : undefined}
      className={cn("h-8 min-w-8 rounded-md px-2 font-normal tabular-nums", className)}
      {...props}
    />
  );
}

function PaginationPrevious({ className, ...props }: React.ComponentProps<typeof Button>) {
  return (
    <Button
      type="button"
      size="icon"
      variant="outline"
      className={cn("size-8", className)}
      {...props}
    >
      <ChevronLeft />
      <span className="sr-only">上一页</span>
    </Button>
  );
}

function PaginationNext({ className, ...props }: React.ComponentProps<typeof Button>) {
  return (
    <Button
      type="button"
      size="icon"
      variant="outline"
      className={cn("size-8", className)}
      {...props}
    >
      <ChevronRight />
      <span className="sr-only">下一页</span>
    </Button>
  );
}

function PaginationEllipsis({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="pagination-ellipsis"
      aria-hidden
      className={cn("flex size-8 items-center justify-center text-slate-400", className)}
      {...props}
    >
      <MoreHorizontal className="size-4" />
    </span>
  );
}

export {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationPrevious,
  PaginationNext,
  PaginationEllipsis,
};
