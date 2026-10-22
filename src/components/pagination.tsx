type PaginationProps = Readonly<{
  hrefForPage: (page: number) => string;
  page: number;
  pageSize: number;
  total: number;
}>;

export function Pagination({ hrefForPage, page, pageSize, total }: PaginationProps) {
  const totalPages = pageSize > 0 && total > 0 ? Math.ceil(total / pageSize) : 0;
  const currentPage = totalPages === 0 ? 0 : Math.min(Math.max(1, page), totalPages);
  const className = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700";

  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm" data-pagination="admin">
      {currentPage > 1 ? <a aria-label="Previous page" className={`rounded-md px-2 py-2 font-semibold text-blue-700 hover:bg-blue-50 ${className}`} href={hrefForPage(currentPage - 1)}>Previous</a> : <span aria-disabled="true" className="px-2 py-2 text-slate-400">Previous</span>}
      <span aria-current="page" className="font-medium text-slate-600">Page {currentPage} of {totalPages}</span>
      {currentPage > 0 && currentPage < totalPages ? <a aria-label="Next page" className={`rounded-md px-2 py-2 font-semibold text-blue-700 hover:bg-blue-50 ${className}`} href={hrefForPage(currentPage + 1)}>Next</a> : <span aria-disabled="true" className="px-2 py-2 text-slate-400">Next</span>}
    </nav>
  );
}
