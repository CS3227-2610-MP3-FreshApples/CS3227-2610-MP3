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
    <nav aria-label="Pagination">
      {currentPage > 1 ? <a aria-label="Previous page" className={className} href={hrefForPage(currentPage - 1)}>Previous</a> : <span aria-disabled="true">Previous</span>}
      <span aria-current="page">Page {currentPage} of {totalPages}</span>
      {currentPage > 0 && currentPage < totalPages ? <a aria-label="Next page" className={className} href={hrefForPage(currentPage + 1)}>Next</a> : <span aria-disabled="true">Next</span>}
    </nav>
  );
}
