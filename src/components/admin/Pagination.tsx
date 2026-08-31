"use client";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
export const PAGE_SIZES = [10, 20, 50, 100] as const;
export function Pagination({ page, pageSize, total, onPageChange, onPageSizeChange }: { page: number; pageSize: number; total: number; onPageChange: (page: number) => void; onPageSizeChange: (size: number) => void }) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize)); const current = Math.min(page, pageCount);
  return <div className="admin-pagination"><span className="admin-pagination-summary">共 {total} 条 · 第 {current}/{pageCount} 页</span><div className="admin-pagination-actions"><Select value={String(pageSize)} onValueChange={(value) => onPageSizeChange(Number(value))}><SelectTrigger className="admin-page-size-select h-8 text-xs"><SelectValue /></SelectTrigger><SelectContent>{PAGE_SIZES.map((size) => <SelectItem value={String(size)} key={size}>每页 {size} 条</SelectItem>)}</SelectContent></Select><button type="button" className="admin-page-button" aria-label="上一页" title="上一页" disabled={current <= 1} onClick={() => onPageChange(current - 1)}><ChevronLeft className="h-4 w-4" /></button><button type="button" className="admin-page-button" aria-label="下一页" title="下一页" disabled={current >= pageCount} onClick={() => onPageChange(current + 1)}><ChevronRight className="h-4 w-4" /></button></div></div>;
}
